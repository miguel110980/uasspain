use std::{sync::Arc, time::Duration};

use crate::{AppState, error::AppError};
use axum::{
    Json,
    extract::{
        Path, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, StatusCode},
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OrderItem {
    id: Uuid,
    version: i64,
    sort_order: i32,
}

pub async fn reorder(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(kind): Path<String>,
    Json(mut items): Json<Vec<OrderItem>>,
) -> Result<StatusCode, AppError> {
    let claims = crate::auth::authenticate(&state, &headers, "access")?;
    crate::auth::require_role(&claims, &["admin"])?;
    let table = match kind.as_str() {
        "posts" => "blog_posts",
        "courses" => "courses",
        "services" => "services",
        _ => return Err(AppError::NotFound),
    };
    let mut ids = std::collections::HashSet::new();
    if items.is_empty()
        || items.len() > 200
        || items
            .iter()
            .any(|i| i.version < 1 || i.sort_order < 0 || !ids.insert(i.id))
    {
        return Err(AppError::Validation("Orden no válido.".into()));
    }
    items.sort_by_key(|i| i.id);
    let mut tx = state
        .pool
        .as_ref()
        .ok_or(AppError::Unavailable)?
        .begin()
        .await?;
    for item in &items {
        let mut matching = HeaderMap::new();
        matching.insert(
            "if-match",
            item.version
                .to_string()
                .parse()
                .map_err(|_| AppError::Internal)?,
        );
        lock_edit(&mut tx, table, item.id, &matching).await?;
    }
    let query =
        format!("UPDATE {table} SET sort_order=$2 WHERE id=$1 AND sort_order IS DISTINCT FROM $2");
    for item in items {
        sqlx::query(&query)
            .bind(item.id)
            .bind(item.sort_order)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn revisions(State(state): State<Arc<AppState>>) -> Result<Json<Value>, AppError> {
    snapshot(state.pool.as_ref().ok_or(AppError::Unavailable)?)
        .await
        .map(Json)
}

async fn snapshot(pool: &PgPool) -> Result<Value, AppError> {
    Ok(
        sqlx::query_scalar("SELECT jsonb_object_agg(kind,revision::text) FROM content_revisions")
            .fetch_one(pool)
            .await?,
    )
}

// Require an explicit revision and hold the row lock until all children, media,
// content and outbox changes have committed. A stale editor cannot overwrite.
pub(crate) async fn lock_edit(
    tx: &mut Transaction<'_, Postgres>,
    table: &str,
    id: Uuid,
    headers: &HeaderMap,
) -> Result<(), AppError> {
    let expected = headers
        .get("if-match")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim_matches('"').parse::<i64>().ok())
        .filter(|v| *v > 0)
        .ok_or(AppError::EditConflict)?;
    let sql = match table {
        "blog_posts" => {
            "SELECT version FROM blog_posts WHERE id=$1 AND status!='deleted' FOR UPDATE"
        }
        "courses" => "SELECT version FROM courses WHERE id=$1 AND status!='deleted' FOR UPDATE",
        "services" => "SELECT version FROM services WHERE id=$1 AND status!='deleted' FOR UPDATE",
        _ => return Err(AppError::Internal),
    };
    let actual: i64 = sqlx::query_scalar(sql)
        .bind(id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or(AppError::NotFound)?;
    if actual != expected {
        return Err(AppError::EditConflict);
    }
    Ok(())
}

pub fn spawn_dispatcher(state: Arc<AppState>) {
    if state.pool.is_none() {
        return;
    }
    tokio::spawn(async move {
        loop {
            if dispatch(&state).await.is_err() {
                tracing::warn!("content notification dispatch deferred");
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
    });
}

async fn dispatch(state: &AppState) -> Result<(), AppError> {
    let mut tx = state
        .pool
        .as_ref()
        .ok_or(AppError::Unavailable)?
        .begin()
        .await?;
    // One dispatcher across replicas; preserve commit order and retry durably
    // after Redis failures. Duplicate notices are harmless to versioned clients.
    let acquired: bool = sqlx::query_scalar("SELECT pg_try_advisory_xact_lock(873510112)")
        .fetch_one(&mut *tx)
        .await?;
    if !acquired {
        return Ok(());
    }
    let rows: Vec<(i64, String, i64)> = sqlx::query_as(
        "SELECT id,kind,revision FROM content_outbox ORDER BY id LIMIT 64 FOR UPDATE",
    )
    .fetch_all(&mut *tx)
    .await?;
    for (id, kind, revision) in rows {
        if !state
            .events
            .publish_confirmed(
                "public_content",
                json!({"type":"content_changed","kind":kind,"revision":revision.to_string()}),
            )
            .await
        {
            break;
        }
        sqlx::query("DELETE FROM content_outbox WHERE id=$1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn socket(
    upgrade: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    if !crate::chat::origin_allowed(&headers) {
        return Err(AppError::Forbidden);
    }
    // This channel is deliberately public: only whitelisted collection versions
    // are sent. It never accepts commands or reveals identities, IDs or drafts.
    Ok(upgrade
        .max_message_size(128)
        .max_frame_size(128)
        .on_upgrade(move |socket| run(socket, state)))
}

async fn run(socket: WebSocket, state: Arc<AppState>) {
    let Some(pool) = state.pool.as_ref() else {
        return;
    };
    let (mut output, mut input) = socket.split();
    let mut events = state.events.subscribe();
    let mut check = tokio::time::interval(Duration::from_secs(15));
    let mut seen = json!({});
    loop {
        tokio::select! {
            _=check.tick()=> {
                let Ok(current)=snapshot(pool).await else {break;};
                if current!=seen {
                    if output.send(Message::Text(json!({"type":"content_snapshot","versions":current}).to_string().into())).await.is_err(){break;}
                    seen=current;
                } else if output.send(Message::Ping(Vec::new().into())).await.is_err(){break;}
            },
            event=events.recv()=>match event {
                Ok(event) if event.topic=="public_content" => {
                    // Do not relay Redis payloads blindly, even from another instance.
                    let kind=event.payload.get("kind").and_then(Value::as_str);
                    let revision=event.payload.get("revision").and_then(Value::as_str).and_then(|v|v.parse::<u64>().ok());
                    if let (Some(kind @ ("posts"|"courses"|"services")),Some(revision))=(kind,revision)
                        && output.send(Message::Text(json!({"type":"content_changed","kind":kind,"revision":revision.to_string()}).to_string().into())).await.is_err(){break;}
                },
                Ok(_)=>{},
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_))=> {check.reset_immediately();},
                Err(tokio::sync::broadcast::error::RecvError::Closed)=>break,
            },
            incoming=input.next()=>match incoming {
                Some(Ok(Message::Ping(bytes)))=> {if output.send(Message::Pong(bytes)).await.is_err(){break;}},
                Some(Ok(Message::Pong(_)))=>{},
                _=>break,
            }
        }
    }
}
