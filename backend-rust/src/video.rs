use std::{sync::Arc, time::Duration};

use axum::{
    Json,
    extract::{
        Path, Query, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, StatusCode},
    response::Response,
};
use chrono::{DateTime, Utc};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    AppState,
    auth::{Claims, authenticate, session_is_active},
    chat::origin_allowed,
    error::AppError,
};

const MAX_SIGNAL_BYTES: usize = 32 * 1024;

#[derive(Debug, Deserialize)]
pub struct VideoQuery {
    alumno_id: Option<Uuid>,
    instructor_id: Option<Uuid>,
    estado: Option<String>,
    iniciada_por: Option<String>,
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct VideoWrite {
    alumno_id: Option<Uuid>,
    instructor_id: Option<Uuid>,
    #[serde(default)]
    alumno_nombre: String,
    #[serde(default)]
    instructor_nombre: String,
    #[serde(default = "pending")]
    estado: String,
    #[serde(default)]
    iniciada_por: String,
    #[serde(default)]
    room_id: String,
    fecha_inicio: Option<DateTime<Utc>>,
    fecha_fin: Option<DateTime<Utc>>,
}
fn pending() -> String {
    "pendiente".to_owned()
}

#[derive(Debug, Deserialize)]
pub struct VideoPatch {
    estado: Option<String>,
    fecha_inicio: Option<DateTime<Utc>>,
    fecha_fin: Option<DateTime<Utc>>,
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(q): Query<VideoQuery>,
) -> Result<Json<Vec<Value>>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let rows = sqlx::query_scalar::<_, Value>("SELECT to_jsonb(v) || jsonb_build_object('alumno_id', v.alumno_id, 'instructor_id', v.instructor_id) FROM conexiones_videollamada v LEFT JOIN accounts_userprofile p ON p.id = v.alumno_id WHERE ($1 = 'admin' OR ($1 = 'alumno' AND v.alumno_id = $2) OR ($1 = 'instructor' AND (v.instructor_id = $2 OR p.assigned_instructor_id = $2))) AND ($3::uuid IS NULL OR v.alumno_id = $3) AND ($4::uuid IS NULL OR v.instructor_id = $4) AND ($5::text IS NULL OR v.estado = $5) AND ($6::text IS NULL OR v.iniciada_por = $6) ORDER BY v.created_date DESC LIMIT $7")
        .bind(&claims.role).bind(claims.profile_id).bind(q.alumno_id).bind(q.instructor_id)
        .bind(q.estado.as_deref()).bind(q.iniciada_por.as_deref()).bind(q.limit.unwrap_or(100).clamp(1, 500))
        .fetch_all(state.pool.as_ref().ok_or(AppError::Unavailable)?).await?;
    Ok(Json(rows))
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(mut input): Json<VideoWrite>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let student = if claims.role == "alumno" {
        claims.profile_id
    } else {
        input
            .alumno_id
            .ok_or_else(|| AppError::Validation("Alumno obligatorio.".to_owned()))?
    };
    let instructor: Option<Uuid> = if claims.role == "instructor" {
        Some(claims.profile_id)
    } else if claims.role == "alumno" {
        sqlx::query_scalar("SELECT assigned_instructor_id FROM accounts_userprofile WHERE id = $1")
            .bind(student)
            .fetch_optional(pool)
            .await?
            .flatten()
    } else if claims.role == "admin" {
        input.instructor_id
    } else {
        return Err(AppError::Forbidden);
    };
    if claims.role == "instructor" {
        let assigned: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM accounts_userprofile WHERE id = $1 AND assigned_instructor_id = $2)").bind(student).bind(claims.profile_id).fetch_one(pool).await?;
        if !assigned {
            return Err(AppError::Forbidden);
        }
    }
    validate_state(&input.estado)?;
    let instructor = instructor.ok_or(AppError::Forbidden)?;
    let mut transaction = pool.begin().await?;
    sqlx::query("SELECT id FROM accounts_userprofile WHERE id=$1 FOR UPDATE")
        .bind(instructor)
        .execute(&mut *transaction)
        .await?;
    let assigned: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM accounts_userprofile WHERE id=$1 AND role='alumno' AND status='activo' AND assigned_instructor_id=$2)")
        .bind(student).bind(instructor).fetch_one(&mut *transaction).await?;
    if !assigned {
        return Err(AppError::Forbidden);
    }
    if input.estado == "activa" {
        let existing: Option<Value> = sqlx::query_scalar("SELECT to_jsonb(v) FROM conexiones_videollamada v WHERE alumno_id=$1 AND instructor_id=$2 AND estado='activa' ORDER BY created_date DESC LIMIT 1")
            .bind(student).bind(instructor).fetch_optional(&mut *transaction).await?;
        if let Some(row) = existing {
            transaction.commit().await?;
            return Ok((StatusCode::CREATED, Json(row)));
        }
    }
    // A classroom shares a random room only among explicitly invited students.
    input.room_id = sqlx::query_scalar::<_, String>(
        "SELECT room_id FROM conexiones_videollamada WHERE instructor_id=$1 AND estado='activa' ORDER BY created_date DESC LIMIT 1",
    ).bind(instructor).fetch_optional(&mut *transaction).await?
        .unwrap_or_else(|| format!("uasspain-video-{}", Uuid::new_v4()));
    input.iniciada_por = claims.role.clone();
    let row = sqlx::query_scalar::<_, Value>("INSERT INTO conexiones_videollamada (id, created_date, updated_date, alumno_id, instructor_id, alumno_nombre, instructor_nombre, estado, iniciada_por, room_id, fecha_inicio, fecha_fin) VALUES ($1, NOW(), NOW(), $2, $3, $4, $5, $6, $7, $8, COALESCE($9, NOW()), $10) RETURNING to_jsonb(conexiones_videollamada) || jsonb_build_object('alumno_id', alumno_id, 'instructor_id', instructor_id)")
        .bind(Uuid::new_v4()).bind(student).bind(instructor).bind(input.alumno_nombre).bind(input.instructor_nombre)
        .bind(input.estado).bind(input.iniciada_por).bind(input.room_id).bind(input.fecha_inicio).bind(input.fecha_fin)
        .fetch_one(&mut *transaction).await?;
    transaction.commit().await?;
    state
        .events
        .publish("connections", json!({"type":"video_changed"}))
        .await;
    Ok((StatusCode::CREATED, Json(row)))
}

pub async fn update(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<VideoPatch>,
) -> Result<Json<Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    if let Some(value) = input.estado.as_deref() {
        validate_state(value)?;
    }
    // Calls may be ended, but an old classroom cannot be reopened by a participant.
    if input
        .estado
        .as_deref()
        .is_some_and(|value| value != "finalizada")
    {
        return Err(AppError::Validation(
            "Inicia una nueva llamada para volver a conectar.".into(),
        ));
    }
    authorize(&state, id, claims.profile_id, &claims.role).await?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let mut transaction = pool.begin().await?;
    let instructor: Uuid =
        sqlx::query_scalar("SELECT instructor_id FROM conexiones_videollamada WHERE id=$1")
            .bind(id)
            .fetch_one(&mut *transaction)
            .await?;
    sqlx::query("SELECT id FROM accounts_userprofile WHERE id=$1 FOR UPDATE")
        .bind(instructor)
        .execute(&mut *transaction)
        .await?;
    let row = sqlx::query_scalar::<_, Value>("UPDATE conexiones_videollamada SET estado = COALESCE($2, estado), fecha_inicio = COALESCE($3, fecha_inicio), fecha_fin = CASE WHEN $2 = 'finalizada' THEN COALESCE($4, NOW()) ELSE COALESCE($4, fecha_fin) END, updated_date = NOW() WHERE id = $1 AND ($5 = 'admin' OR ($5 = 'alumno' AND alumno_id = $6) OR ($5 = 'instructor' AND instructor_id = $6)) RETURNING to_jsonb(conexiones_videollamada) || jsonb_build_object('alumno_id', alumno_id, 'instructor_id', instructor_id)")
        .bind(id).bind(input.estado).bind(input.fecha_inicio).bind(input.fecha_fin).bind(&claims.role).bind(claims.profile_id)
        .fetch_optional(&mut *transaction).await?.ok_or(AppError::NotFound)?;
    if claims.role == "instructor" && row["estado"] == "finalizada" {
        sqlx::query("UPDATE conexiones_videollamada SET estado='finalizada',fecha_fin=NOW(),updated_date=NOW() WHERE instructor_id=$1 AND room_id=$2 AND estado IN ('activa','pendiente')")
            .bind(claims.profile_id).bind(row["room_id"].as_str().ok_or(AppError::Internal)?)
            .execute(&mut *transaction).await?;
    }
    transaction.commit().await?;
    state
        .events
        .publish("connections", json!({"type":"video_changed"}))
        .await;
    Ok(Json(row))
}

pub async fn detail(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    authorize(&state, id, claims.profile_id, &claims.role).await?;
    let row = sqlx::query_scalar::<_, Value>("SELECT to_jsonb(v)||jsonb_build_object('alumno_id',alumno_id,'instructor_id',instructor_id) FROM conexiones_videollamada v WHERE id=$1")
        .bind(id).fetch_one(state.pool.as_ref().ok_or(AppError::Unavailable)?).await?;
    Ok(Json(row))
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    if claims.role == "alumno" {
        return Err(AppError::Forbidden);
    }
    authorize(&state, id, claims.profile_id, &claims.role).await?;
    let deleted = sqlx::query("DELETE FROM conexiones_videollamada WHERE id=$1")
        .bind(id)
        .execute(state.pool.as_ref().ok_or(AppError::Unavailable)?)
        .await?
        .rows_affected();
    if deleted == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn socket(
    upgrade: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Response, AppError> {
    if !origin_allowed(&headers) {
        return Err(AppError::Forbidden);
    }
    let claims = authenticate(&state, &headers, "access")?;
    authorize_active(&state, id, claims.profile_id, &claims.role).await?;
    let room: String =
        sqlx::query_scalar("SELECT room_id FROM conexiones_videollamada WHERE id=$1")
            .bind(id)
            .fetch_one(state.pool.as_ref().ok_or(AppError::Unavailable)?)
            .await?;
    Ok(upgrade
        .max_message_size(MAX_SIGNAL_BYTES)
        .on_upgrade(move |socket| run_socket(socket, state, id, room, claims)))
}

async fn authorize(state: &AppState, id: Uuid, profile: Uuid, role: &str) -> Result<(), AppError> {
    let allowed: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM conexiones_videollamada v JOIN accounts_userprofile p ON p.id=v.alumno_id WHERE v.id = $1 AND ($2 = 'admin' OR ($2 = 'alumno' AND v.alumno_id = $3) OR ($2 = 'instructor' AND v.instructor_id = $3 AND p.assigned_instructor_id=$3)))")
        .bind(id).bind(role).bind(profile).fetch_one(state.pool.as_ref().ok_or(AppError::Unavailable)?).await?;
    allowed.then_some(()).ok_or(AppError::Forbidden)
}

async fn authorize_active(
    state: &AppState,
    id: Uuid,
    profile: Uuid,
    role: &str,
) -> Result<(), AppError> {
    authorize(state, id, profile, role).await?;
    let active: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM conexiones_videollamada v JOIN accounts_userprofile p ON p.id=v.alumno_id WHERE v.id=$1 AND p.assigned_instructor_id=v.instructor_id AND (v.estado IN ('pendiente','activa') OR ($2='instructor' AND EXISTS (SELECT 1 FROM conexiones_videollamada live JOIN accounts_userprofile student ON student.id=live.alumno_id WHERE live.room_id=v.room_id AND live.instructor_id=$3 AND live.estado IN ('pendiente','activa') AND student.assigned_instructor_id=$3))))")
        .bind(id).bind(role).bind(profile).fetch_one(state.pool.as_ref().ok_or(AppError::Unavailable)?).await?;
    active.then_some(()).ok_or(AppError::Forbidden)
}

async fn run_socket(
    socket: WebSocket,
    state: Arc<AppState>,
    id: Uuid,
    room: String,
    claims: Claims,
) {
    let (mut output, mut input) = socket.split();
    let mut events = state.events.subscribe();
    let event_topic = format!("video:{room}");
    let peer_id = Uuid::new_v4();
    if output
        .send(Message::Text(
            json!({"type":"welcome","peer_id":peer_id})
                .to_string()
                .into(),
        ))
        .await
        .is_err()
    {
        return;
    }
    state
        .events
        .publish(
            event_topic.clone(),
            json!({"type":"join","sender_id":peer_id}),
        )
        .await;
    let mut heartbeat = tokio::time::interval(Duration::from_secs(25));
    loop {
        tokio::select! {
            incoming = input.next() => match incoming {
                Some(Ok(Message::Text(text))) if text.len() <= MAX_SIGNAL_BYTES => {
                    if !session_is_active(&state, &claims).await.unwrap_or(false)
                        || authorize_active(&state, id, claims.profile_id, &claims.role).await.is_err()
                    {
                        break;
                    }
                    if let Ok(mut payload) = serde_json::from_str::<Value>(&text)
                        && valid_signal(&payload)
                    {
                        payload["sender_id"] = json!(peer_id);
                        state.events.publish(event_topic.clone(), payload).await;
                    }
                },
                Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                _ => {}
            },
            event = events.recv() => if let Ok(event) = event && event.topic == event_topic
                && event.payload.get("sender_id") != Some(&json!(peer_id))
                && (!session_is_active(&state, &claims).await.unwrap_or(false)
                    || authorize_active(&state, id, claims.profile_id, &claims.role).await.is_err()
                    || output.send(Message::Text(event.payload.to_string().into())).await.is_err()) { break; },
            _ = heartbeat.tick() => {
                if !session_is_active(&state, &claims).await.unwrap_or(false)
                    || authorize_active(&state, id, claims.profile_id, &claims.role).await.is_err()
                    || output.send(Message::Ping(Vec::new().into())).await.is_err() { break; }
            },
        }
    }
    state
        .events
        .publish(event_topic, json!({"type":"hangup","sender_id":peer_id}))
        .await;
    let _ = output.close().await;
}

pub async fn ice_config(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> Result<Json<Value>, AppError> {
    authenticate(&state, &headers, "access")?;
    let config = if let Ok(path) = std::env::var("WEBRTC_ICE_SERVERS_FILE") {
        let data = tokio::fs::read(path)
            .await
            .map_err(|_| AppError::Unavailable)?;
        serde_json::from_slice::<Value>(&data).map_err(|_| AppError::Unavailable)?
    } else {
        json!([])
    };
    let servers = config.as_array().ok_or(AppError::Unavailable)?;
    if servers.len() > 8 {
        return Err(AppError::Unavailable);
    }
    for server in servers {
        let urls: Vec<&str> = match &server["urls"] {
            Value::String(url) => vec![url.as_str()],
            Value::Array(urls) => urls
                .iter()
                .map(Value::as_str)
                .collect::<Option<Vec<_>>>()
                .ok_or(AppError::Unavailable)?,
            _ => return Err(AppError::Unavailable),
        };
        if urls.is_empty()
            || urls.len() > 8
            || urls.iter().any(|url| {
                url.len() > 2048
                    || !["stun:", "stuns:", "turn:", "turns:"]
                        .iter()
                        .any(|scheme| url.starts_with(scheme))
            })
        {
            return Err(AppError::Unavailable);
        }
    }
    Ok(Json(json!({"iceServers": config})))
}

fn valid_signal(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    if object.len() > 8 {
        return false;
    }
    matches!(
        object.get("type").and_then(Value::as_str),
        Some("offer" | "answer" | "ice_candidate" | "hangup" | "ping" | "pong")
    )
}

fn validate_state(value: &str) -> Result<(), AppError> {
    matches!(value, "pendiente" | "activa" | "finalizada" | "cancelada")
        .then_some(())
        .ok_or_else(|| AppError::Validation("Estado de videollamada no valido.".to_owned()))
}
pub fn may_join(role: &str, owns_room: bool, assigned: bool) -> bool {
    role == "admin" || owns_room || (role == "instructor" && assigned)
}

#[cfg(test)]
mod tests {
    use super::{MAX_SIGNAL_BYTES, may_join, valid_signal, validate_state};
    #[test]
    fn video_access_is_deny_by_default() {
        assert!(!may_join("alumno", false, false));
        assert!(may_join("admin", false, false));
    }
    #[test]
    fn video_payload_is_bounded() {
        assert_eq!(MAX_SIGNAL_BYTES, 32 * 1024);
    }
    #[test]
    fn video_state_is_closed() {
        assert!(validate_state("activa").is_ok());
        assert!(validate_state("unknown").is_err());
    }
    #[test]
    fn video_signal_schema_is_deny_by_default() {
        assert!(valid_signal(
            &serde_json::json!({"type":"offer","sdp":"value"})
        ));
        assert!(!valid_signal(&serde_json::json!({"type":"unknown"})));
        assert!(!valid_signal(&serde_json::json!(["offer"])));
    }
}
