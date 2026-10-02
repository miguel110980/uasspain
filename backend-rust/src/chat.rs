use std::{sync::Arc, time::Duration};

use axum::{
    extract::{
        Path, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::HeaderMap,
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    AppState,
    auth::{Claims, authenticate, session_is_active},
    error::AppError,
};

const MAX_PAYLOAD_BYTES: usize = 16 * 1024;

pub(crate) fn staff_room(first: Uuid, second: Uuid) -> String {
    let (first, second) = if first < second {
        (first, second)
    } else {
        (second, first)
    };
    format!("staff-{first}-{second}")
}

fn staff_peer(room: &str, member: Uuid) -> Option<Uuid> {
    let pair = room.strip_prefix("staff-")?;
    let first: Uuid = pair.get(..36)?.parse().ok()?;
    let second: Uuid = pair.get(37..)?.parse().ok()?;
    if first == second || room != staff_room(first, second) {
        return None;
    }
    if member == first {
        Some(second)
    } else if member == second {
        Some(first)
    } else {
        None
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChatEvent {
    Ping,
    Pong,
    Message {
        room_id: String,
        sender_id: Uuid,
        content: String,
    },
    Ack {
        room_id: String,
    },
    Error {
        code: String,
    },
}

pub async fn socket(
    upgrade: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(room_id): Path<String>,
) -> Result<Response, AppError> {
    if !origin_allowed(&headers) {
        return Err(AppError::Forbidden);
    }
    let claims = authenticate(&state, &headers, "access")?;
    authorize_room(&state, claims.profile_id, &claims.role, &room_id).await?;
    Ok(upgrade
        .max_message_size(MAX_PAYLOAD_BYTES)
        .on_upgrade(move |socket| run_socket(socket, state, room_id, claims)))
}

pub(crate) fn origin_allowed(headers: &HeaderMap) -> bool {
    let Some(origin) = headers
        .get(axum::http::header::ORIGIN)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    std::env::var("CORS_ALLOWED_ORIGINS")
        .unwrap_or_else(|_| "http://localhost:5173,http://127.0.0.1:5173".to_owned())
        .split(',')
        .any(|allowed| allowed.trim() == origin)
}

async fn authorize_room(
    state: &AppState,
    profile_id: Uuid,
    role: &str,
    room_id: &str,
) -> Result<(), AppError> {
    if room_id.len() > 100
        || room_id.is_empty()
        || !room_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return Err(AppError::Validation("Sala no válida.".to_owned()));
    }
    let Some(pool) = &state.pool else {
        return Err(AppError::Unavailable);
    };
    let allowed: bool = if let Some(peer) = staff_peer(room_id, profile_id) {
        let expected_peer_role = if role == "admin" {
            "instructor"
        } else {
            "admin"
        };
        matches!(role, "admin" | "instructor")
            && sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM accounts_userprofile WHERE id = $1 AND status = 'activo' AND (role = $2 OR roles @> jsonb_build_array($2::text)))")
                .bind(peer).bind(expected_peer_role).fetch_one(pool).await?
    } else if let Ok(student_id) = room_id.parse::<Uuid>() {
        (role == "alumno" && student_id == profile_id)
            || (role == "instructor" && sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM accounts_userprofile WHERE id = $1 AND assigned_instructor_id = $2)").bind(student_id).bind(profile_id).fetch_one(pool).await?)
    } else {
        false
    };
    allowed.then_some(()).ok_or(AppError::Forbidden)
}

async fn run_socket(socket: WebSocket, state: Arc<AppState>, room_id: String, claims: Claims) {
    let (mut output, mut input) = socket.split();
    let mut events = state.events.subscribe();
    let event_topic = format!("chat:{room_id}");
    let mut heartbeat = tokio::time::interval(Duration::from_secs(25));
    loop {
        tokio::select! {
            incoming = input.next() => match incoming {
                Some(Ok(Message::Text(text))) if text.len() <= MAX_PAYLOAD_BYTES => {
                    if !session_is_active(&state, &claims).await.unwrap_or(false)
                        || authorize_room(&state, claims.profile_id, &claims.role, &room_id).await.is_err()
                    {
                        let _ = send(&mut output, &ChatEvent::Error { code: "session_revoked".to_owned() }).await;
                        break;
                    }
                    if let Ok(event) = serde_json::from_str::<ChatEvent>(&text) {
                        match event {
                            ChatEvent::Ping => { if send(&mut output, &ChatEvent::Pong).await.is_err() { break; } }
                            ChatEvent::Message { content, .. } if !content.trim().is_empty() && content.chars().count() <= 4000 => {
                                if persist_message(&state, &room_id, claims.profile_id, &claims.role, &content).await.is_err() {
                                    let _ = send(&mut output, &ChatEvent::Error { code: "persist_failed".to_owned() }).await;
                                    continue;
                                }
                                let event = ChatEvent::Message { room_id: room_id.clone(), sender_id: claims.profile_id, content };
                                if let Ok(payload) = serde_json::to_value(&event) {
                                    state.events.publish(event_topic.clone(), payload).await;
                                }
                                let kind = if room_id.starts_with("staff-") { "mensaje_staff" } else { "mensaje" };
                                state.events.publish("connections", serde_json::json!({"type":kind,"action":"created"})).await;
                                if send(&mut output, &ChatEvent::Ack { room_id: room_id.clone() }).await.is_err() { break; }
                            }
                            _ => {}
                        }
                    }
                }
                Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                _ => {}
            },
            event = events.recv() => if let Ok(event) = event
                && event.topic == event_topic
                && let Ok(chat_event) = serde_json::from_value::<ChatEvent>(event.payload)
                && !matches!(&chat_event, ChatEvent::Message { sender_id: event_sender, .. } if *event_sender == claims.profile_id)
                && (!session_is_active(&state, &claims).await.unwrap_or(false)
                    || authorize_room(&state, claims.profile_id, &claims.role, &room_id).await.is_err()
                    || send(&mut output, &chat_event).await.is_err()) { break; },
            _ = heartbeat.tick() => {
                if !session_is_active(&state, &claims).await.unwrap_or(false)
                    || authorize_room(&state, claims.profile_id, &claims.role, &room_id).await.is_err()
                    || output.send(Message::Ping(Vec::new().into())).await.is_err() { break; }
            },
        }
    }
    let _ = output.close().await;
}

async fn persist_message(
    state: &AppState,
    room_id: &str,
    sender_id: Uuid,
    sender_role: &str,
    content: &str,
) -> Result<(), AppError> {
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let encrypted = state.cipher.encrypt(content.trim())?;
    if let Some(peer_id) = staff_peer(room_id, sender_id) {
        if !matches!(sender_role, "admin" | "instructor") {
            return Err(AppError::Forbidden);
        }
        sqlx::query("INSERT INTO conexiones_mensajestaff (id, created_date, updated_date, remitente_id, destinatario_id, contenido, sender_role, leido_destinatario) VALUES ($1, NOW(), NOW(), $2, $3, $4, $5, FALSE)")
            .bind(Uuid::new_v4()).bind(sender_id).bind(peer_id).bind(encrypted).bind(sender_role).execute(pool).await?;
        return Ok(());
    }
    let student_id = if sender_role == "alumno" {
        sender_id
    } else {
        room_id
            .parse::<Uuid>()
            .map_err(|_| AppError::Validation("Sala no válida.".to_owned()))?
    };
    let instructor_id: Option<Uuid> = if sender_role == "instructor" {
        Some(sender_id)
    } else {
        sqlx::query_scalar("SELECT assigned_instructor_id FROM accounts_userprofile WHERE id = $1")
            .bind(student_id)
            .fetch_optional(pool)
            .await?
            .flatten()
    };
    if sender_role == "admin" || (sender_role == "instructor" && instructor_id != Some(sender_id)) {
        return Err(AppError::Forbidden);
    }
    sqlx::query("INSERT INTO conexiones_mensaje (id, created_date, updated_date, alumno_id, instructor_id, conexion_id, alumno_nombre, remitente, contenido, leido_alumno, leido_instructor) VALUES ($1, NOW(), NOW(), $2, $3, NULL, '', $4, $5, FALSE, FALSE)")
        .bind(Uuid::new_v4()).bind(student_id).bind(instructor_id).bind(sender_role).bind(encrypted).execute(pool).await?;
    Ok(())
}

async fn send(
    output: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    event: &ChatEvent,
) -> Result<(), ()> {
    let text = serde_json::to_string(event).map_err(|_| ())?;
    output
        .send(Message::Text(text.into()))
        .await
        .map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use super::{ChatEvent, MAX_PAYLOAD_BYTES, staff_peer, staff_room};
    use uuid::Uuid;
    #[test]
    fn staff_rooms_require_membership_and_canonical_pair() {
        let first = Uuid::from_u128(1);
        let second = Uuid::from_u128(2);
        let room = staff_room(first, second);
        assert_eq!(staff_peer(&room, first), Some(second));
        assert_eq!(staff_peer(&room, second), Some(first));
        assert_eq!(staff_peer(&room, Uuid::from_u128(3)), None);
        assert_eq!(staff_peer(&format!("staff-{second}-{first}"), first), None);
        assert_eq!(staff_peer(&format!("staff-{first}"), first), None);
    }
    #[test]
    fn websocket_payload_is_bounded() {
        assert_eq!(MAX_PAYLOAD_BYTES, 16 * 1024);
    }
    #[test]
    fn messages_are_typed() {
        let event: ChatEvent = serde_json::from_str(r#"{"type":"ping"}"#).unwrap();
        assert!(matches!(event, ChatEvent::Ping));
    }
}
