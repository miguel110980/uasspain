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

pub(crate) fn staff_peer(room: &str, member: Uuid) -> Option<Uuid> {
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
        matches!(role, "admin" | "instructor")
            && sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM accounts_userprofile p JOIN auth_user u ON u.id=p.user_id WHERE p.id=$1 AND p.status='activo' AND p.otp_verified AND u.is_active AND (p.role IN ('admin','instructor') OR p.roles ?| ARRAY['admin','instructor']))")
                .bind(peer).fetch_one(pool).await?
    } else if let Ok(student_id) = room_id.parse::<Uuid>() {
        matches!(role, "alumno" | "instructor")
            && sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM accounts_userprofile p JOIN auth_user u ON u.id=p.user_id JOIN accounts_userprofile i ON i.id=p.assigned_instructor_id JOIN auth_user iu ON iu.id=i.user_id WHERE p.id=$1 AND p.status='activo' AND p.otp_verified AND u.is_active AND (p.role='alumno' OR p.roles ? 'alumno') AND i.status='activo' AND iu.is_active AND (i.role='instructor' OR i.roles ? 'instructor') AND (($3='alumno' AND p.id=$2) OR ($3='instructor' AND p.assigned_instructor_id=$2)))")
                .bind(student_id).bind(profile_id).bind(role).fetch_one(pool).await?
    } else {
        false
    };
    allowed.then_some(()).ok_or(AppError::Forbidden)
}

async fn run_socket(socket: WebSocket, state: Arc<AppState>, room_id: String, claims: Claims) {
    let (mut output, mut input) = socket.split();
    let mut events = state.events.subscribe();
    let event_topic = format!("chat:{room_id}");
    let mut authorization = tokio::time::interval(std::time::Duration::from_secs(1));
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
                                if crate::connections::persist_socket_message(&state, &claims, &room_id, &content).await.is_err() {
                                    let _ = send(&mut output, &ChatEvent::Error { code: "persist_failed".to_owned() }).await;
                                    continue;
                                }
                                if send(&mut output, &ChatEvent::Ack { room_id: room_id.clone() }).await.is_err() { break; }
                            }
                            _ => {}
                        }
                    }
                }
                Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                _ => {}
            },
            event = events.recv() => match event {
                Ok(event) if event.topic == event_topic || (event.topic == "connections" && event.payload.get("type").and_then(serde_json::Value::as_str) == Some("asignacion")) => {
                    if !session_is_active(&state, &claims).await.unwrap_or(false)
                        || authorize_room(&state, claims.profile_id, &claims.role, &room_id).await.is_err() { break; }
                    if event.topic == event_topic {
                        // A late event from the previous instructor must not enter
                        // the new pair's channel after an assignment changes.
                        if let Ok(student) = room_id.parse::<Uuid>()
                            && event.payload.get("type").and_then(serde_json::Value::as_str) == Some("message")
                        {
                            let Some(pool) = &state.pool else { break; };
                            let current: Option<Uuid> = sqlx::query_scalar("SELECT assigned_instructor_id FROM accounts_userprofile WHERE id=$1")
                                .bind(student).fetch_optional(pool).await.unwrap_or(None).flatten();
                            let sender_instructor = event.payload.get("data").and_then(|data| data.get("instructor_id"))
                                .and_then(serde_json::Value::as_str).and_then(|id| id.parse::<Uuid>().ok());
                            if current.is_none() || sender_instructor != current { continue; }
                        }
                        if output.send(Message::Text(event.payload.to_string().into())).await.is_err() { break; }
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    if output.send(Message::Text(serde_json::json!({"type":"resync_required","room_id":room_id}).to_string().into())).await.is_err() { break; }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                _ => {}
            },
            _ = authorization.tick() => {
                if !session_is_active(&state, &claims).await.unwrap_or(false) {
                    let _ = output.send(Message::Close(Some(axum::extract::ws::CloseFrame { code: 1008, reason: "session_expired".into() }))).await;
                    break;
                }
            },
            _ = heartbeat.tick() => {
                if !session_is_active(&state, &claims).await.unwrap_or(false)
                    || authorize_room(&state, claims.profile_id, &claims.role, &room_id).await.is_err()
                    || output.send(Message::Ping(Vec::new().into())).await.is_err() { break; }
            },
        }
    }
    let _ = output.close().await;
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
