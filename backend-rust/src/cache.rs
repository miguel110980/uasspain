use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use futures_util::StreamExt;
use redis::{TlsCertificates, aio::ConnectionManager};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::error::AppError;

pub const KEY_PREFIX: &str = "uasspain:v1:";
const EVENT_CHANNEL: &str = "uasspain:v1:events";
const EVENT_CAPACITY: usize = 1_024;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BusEvent {
    pub instance_id: Uuid,
    pub topic: String,
    pub payload: Value,
}

pub struct EventBus {
    instance_id: Uuid,
    local: broadcast::Sender<BusEvent>,
    manager: Option<ConnectionManager>,
    connected: Arc<AtomicBool>,
}

impl EventBus {
    pub async fn from_env() -> Result<Self, AppError> {
        let instance_id = Uuid::new_v4();
        let local = broadcast::channel(EVENT_CAPACITY).0;
        let connected = Arc::new(AtomicBool::new(false));
        let raw_url = std::env::var("REDIS_URL")
            .ok()
            .filter(|value| !value.trim().is_empty());
        let raw_url = match raw_url {
            Some(value) => Some(value),
            None => redis_url_from_secret().await?,
        };
        let Some(raw_url) = raw_url else {
            return Ok(Self {
                instance_id,
                local,
                manager: None,
                connected,
            });
        };
        let url = raw_url.split('?').next().unwrap_or(&raw_url).to_owned();
        let client = redis_client(&url).await?;
        let mut manager = ConnectionManager::new(client.clone())
            .await
            .map_err(|_| AppError::Unavailable)?;
        redis::cmd("PING")
            .query_async::<String>(&mut manager)
            .await
            .map_err(|_| AppError::Unavailable)?;
        connected.store(true, Ordering::Release);
        spawn_subscriber(client, instance_id, local.clone(), Arc::clone(&connected));
        Ok(Self {
            instance_id,
            local,
            manager: Some(manager),
            connected,
        })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<BusEvent> {
        self.local.subscribe()
    }

    pub async fn publish(&self, topic: impl Into<String>, payload: Value) {
        let event = BusEvent {
            instance_id: self.instance_id,
            topic: topic.into(),
            payload,
        };
        let _ = self.local.send(event.clone());
        let Some(manager) = &self.manager else {
            return;
        };
        let Ok(serialized) = serde_json::to_string(&event) else {
            return;
        };
        let mut connection = manager.clone();
        if redis::cmd("PUBLISH")
            .arg(EVENT_CHANNEL)
            .arg(serialized)
            .query_async::<i64>(&mut connection)
            .await
            .is_err()
        {
            self.connected.store(false, Ordering::Release);
        }
    }

    pub fn configured(&self) -> bool {
        self.manager.is_some()
    }

    pub fn connected(&self) -> bool {
        self.connected.load(Ordering::Acquire)
    }
}

async fn redis_url_from_secret() -> Result<Option<String>, AppError> {
    let Some(path) = std::env::var("REDIS_PASSWORD_FILE")
        .ok()
        .filter(|value| !value.trim().is_empty())
    else {
        return Ok(None);
    };
    let password = tokio::fs::read_to_string(path)
        .await
        .map_err(|_| AppError::Unavailable)?;
    let password = password.trim();
    if password.is_empty() {
        return Err(AppError::Unavailable);
    }
    let host = std::env::var("REDIS_HOST").unwrap_or_else(|_| "redis".to_owned());
    let port = std::env::var("REDIS_PORT").unwrap_or_else(|_| "6379".to_owned());
    let mut url =
        url::Url::parse(&format!("rediss://{host}:{port}/0")).map_err(|_| AppError::Unavailable)?;
    url.set_username("app").map_err(|_| AppError::Unavailable)?;
    url.set_password(Some(password))
        .map_err(|_| AppError::Unavailable)?;
    Ok(Some(url.into()))
}

async fn redis_client(url: &str) -> Result<redis::Client, AppError> {
    let ca = std::env::var("REDIS_TLS_CA_FILE")
        .ok()
        .filter(|path| !path.trim().is_empty());
    if url.starts_with("rediss://") {
        let root_cert = if let Some(path) = ca {
            Some(
                tokio::fs::read(path)
                    .await
                    .map_err(|_| AppError::Unavailable)?,
            )
        } else {
            None
        };
        redis::Client::build_with_tls(
            url,
            TlsCertificates {
                client_tls: None,
                root_cert,
            },
        )
        .map_err(|_| AppError::Unavailable)
    } else {
        redis::Client::open(url).map_err(|_| AppError::Unavailable)
    }
}

fn spawn_subscriber(
    client: redis::Client,
    instance_id: Uuid,
    local: broadcast::Sender<BusEvent>,
    connected: Arc<AtomicBool>,
) {
    tokio::spawn(async move {
        loop {
            let attempt = async {
                let mut subscription = client.get_async_pubsub().await?;
                subscription.subscribe(EVENT_CHANNEL).await?;
                connected.store(true, Ordering::Release);
                let mut messages = subscription.on_message();
                while let Some(message) = messages.next().await {
                    let serialized: String = message.get_payload()?;
                    if let Ok(event) = serde_json::from_str::<BusEvent>(&serialized)
                        && event.instance_id != instance_id
                    {
                        let _ = local.send(event);
                    }
                }
                redis::RedisResult::Ok(())
            }
            .await;
            connected.store(false, Ordering::Release);
            if let Err(error) = attempt {
                tracing::warn!(%error, "Redis event subscriber disconnected");
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    });
}

impl Default for EventBus {
    fn default() -> Self {
        let (local, _) = broadcast::channel(EVENT_CAPACITY);
        Self {
            instance_id: Uuid::new_v4(),
            local,
            manager: None,
            connected: Arc::new(AtomicBool::new(false)),
        }
    }
}
