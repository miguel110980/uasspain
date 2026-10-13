use crate::{error::AppError, runtime_config::SmtpConfig};
use chrono::{DateTime, Utc};
use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
    message::Mailbox,
    transport::smtp::{
        authentication::Credentials,
        client::{Certificate, Tls, TlsParameters},
    },
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::Duration;
use uuid::Uuid;

#[derive(Clone, Deserialize, Serialize)]
pub struct Envelope {
    pub from: String,
    pub from_name: String,
    pub to: String,
    pub reply_to: Option<String>,
    pub subject: String,
    pub body: String,
    pub smtp: Option<SmtpConfig>,
}

pub fn address(value: &str) -> Result<lettre::Address, AppError> {
    if value.is_empty()
        || value.len() > 254
        || value.trim() != value
        || value.chars().any(char::is_control)
    {
        return Err(AppError::Validation(
            "Dirección de correo no válida.".into(),
        ));
    }
    value
        .parse()
        .map_err(|_| AppError::Validation("Dirección de correo no válida.".into()))
}

impl Envelope {
    pub fn message(&self) -> Result<Message, AppError> {
        self.validate()?;
        let mut message = Message::builder()
            .from(Mailbox::new(
                Some(self.from_name.clone()),
                address(&self.from)?,
            ))
            .to(Mailbox::new(None, address(&self.to)?))
            .subject(&self.subject)
            .header(lettre::message::header::ContentType::TEXT_PLAIN);
        if let Some(reply) = &self.reply_to {
            message = message.reply_to(Mailbox::new(None, address(reply)?));
        }
        message
            .body(self.body.clone())
            .map_err(|_| AppError::Internal)
    }
    pub fn validate(&self) -> Result<(), AppError> {
        address(&self.from)?;
        address(&self.to)?;
        if let Some(reply) = &self.reply_to {
            address(reply)?;
        }
        if self.from_name.len() > 120
            || self.from_name.chars().any(char::is_control)
            || self.subject.is_empty()
            || self.subject.len() > 1000
            || self.subject.chars().any(char::is_control)
            || self.body.len() > 64 * 1024
        {
            return Err(AppError::Validation("Mensaje de correo no válido.".into()));
        }
        Ok(())
    }
    pub fn postmark_payload(&self, id: Uuid) -> Result<Value, AppError> {
        self.validate()?;
        if address(&self.from)?.domain() != "uasspain.com" {
            return Err(AppError::Unavailable);
        }
        Ok(
            json!({"From":Mailbox::new(Some(self.from_name.clone()),address(&self.from)?).to_string(),
            "To":self.to,"ReplyTo":self.reply_to,"Subject":self.subject,"TextBody":self.body,
            "MessageStream":"outbound","TrackOpens":false,"TrackLinks":"None",
            "Metadata":{"uasspain_message_id":id.to_string()}}),
        )
    }
}

#[derive(Clone, Debug)]
pub enum Outcome {
    Accepted(Option<Uuid>),
    Retry(&'static str, Option<u64>),
    Failed(&'static str),
    Unknown(&'static str),
}
impl Outcome {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Accepted(_) => "",
            Self::Retry(code, _) | Self::Failed(code) | Self::Unknown(code) => code,
        }
    }
    pub fn affects_circuit(&self) -> bool {
        !matches!(self, Self::Accepted(_) | Self::Failed("recipient_invalid"))
    }
}

fn client() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| AppError::Unavailable)
}
fn token_header(token: &str) -> Result<reqwest::header::HeaderValue, AppError> {
    if token.is_empty() || token == "POSTMARK_API_TEST" {
        return Err(AppError::Unavailable);
    }
    let mut header =
        reqwest::header::HeaderValue::from_str(token).map_err(|_| AppError::Unavailable)?;
    header.set_sensitive(true);
    Ok(header)
}
fn retry_after(value: &str, now: DateTime<Utc>) -> Option<u64> {
    let seconds = value.parse::<u64>().ok().or_else(|| {
        DateTime::parse_from_rfc2822(value)
            .ok()
            .map(|at| (at.with_timezone(&Utc) - now).num_seconds().max(1) as u64)
    })?;
    // All message lifetimes are at most one day: a longer provider wait expires
    // the message before another attempt rather than sending too early.
    Some(seconds.clamp(1, 86400))
}
async fn bounded_json(mut response: reqwest::Response) -> Result<Value, AppError> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| AppError::Unavailable)? {
        if body.len() + chunk.len() > 65536 {
            return Err(AppError::Unavailable);
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| AppError::Unavailable)
}

pub async fn check_server(token: &str) -> Result<(), AppError> {
    let response = client()?
        .get("https://api.postmarkapp.com/server")
        .header("X-Postmark-Server-Token", token_header(token)?)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|_| AppError::Unavailable)?;
    if !response.status().is_success() {
        return Err(AppError::Unavailable);
    }
    let value = bounded_json(response).await?;
    // The server response contains API tokens: never serialize it or log it.
    if value["ID"].as_u64().is_none_or(|id| id == 0) || value["DeliveryType"] != "Live" {
        return Err(AppError::Unavailable);
    }
    Ok(())
}

pub async fn postmark(envelope: &Envelope, token: &str, id: Uuid) -> Outcome {
    postmark_at("https://api.postmarkapp.com/email", envelope, token, id).await
}
pub(crate) async fn postmark_at(
    endpoint: &str,
    envelope: &Envelope,
    token: &str,
    id: Uuid,
) -> Outcome {
    let (Ok(client), Ok(header), Ok(payload)) =
        (client(), token_header(token), envelope.postmark_payload(id))
    else {
        return Outcome::Failed("configuration_invalid");
    };
    let response = match client
        .post(endpoint)
        .header("X-Postmark-Server-Token", header)
        .header("Accept", "application/json")
        .json(&payload)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) if error.is_connect() => return Outcome::Retry("provider_unreachable", None),
        Err(_) => return Outcome::Unknown("provider_result_unknown"),
    };
    let status = response.status();
    if status.as_u16() == 429 {
        let retry = response
            .headers()
            .get("Retry-After")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| retry_after(v, Utc::now()));
        return Outcome::Retry("provider_rate_limited", retry);
    }
    if status.as_u16() == 401 {
        return Outcome::Failed("provider_authentication_failed");
    }
    if status.is_server_error() {
        return Outcome::Unknown("provider_result_unknown");
    }
    let Ok(value) = bounded_json(response).await else {
        return Outcome::Unknown("provider_result_unknown");
    };
    if !status.is_success() || value["ErrorCode"].as_u64() != Some(0) {
        return Outcome::Failed(match value["ErrorCode"].as_u64() {
            Some(400 | 401) => "sender_unverified",
            Some(406) => "recipient_invalid",
            Some(300 | 402 | 403) => "provider_request_invalid",
            _ => "provider_rejected",
        });
    }
    let Some(external) = value["MessageID"]
        .as_str()
        .and_then(|v| Uuid::parse_str(v).ok())
        .filter(|v| !v.is_nil())
    else {
        return Outcome::Unknown("provider_result_unknown");
    };
    if value["To"].as_str() != Some(envelope.to.as_str()) {
        return Outcome::Unknown("provider_result_unknown");
    }
    Outcome::Accepted(Some(external))
}

pub async fn smtp(envelope: &Envelope, config: &SmtpConfig, password: &str) -> Outcome {
    if envelope.validate().is_err()
        || crate::runtime_config::validate_smtp(config).is_err()
        || password.is_empty()
    {
        return Outcome::Failed("configuration_invalid");
    }
    let message = match envelope.message() {
        Ok(message) => message,
        Err(_) => return Outcome::Failed("configuration_invalid"),
    };
    let mut tls = TlsParameters::builder(config.host.clone());
    if std::env::var("CONTACT_SMTP_HOST").ok().as_deref() == Some(config.host.as_str())
        && let Ok(path) = std::env::var("CONTACT_SMTP_CA_FILE")
        && !path.is_empty()
    {
        let certificate = std::fs::read(path)
            .ok()
            .and_then(|bytes| Certificate::from_pem(&bytes).ok());
        let Some(certificate) = certificate else {
            return Outcome::Failed("tls_configuration_invalid");
        };
        tls = tls.add_root_certificate(certificate);
    }
    let Ok(tls) = tls.build() else {
        return Outcome::Failed("tls_configuration_invalid");
    };
    let transport = AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&config.host)
        .port(config.port)
        .tls(if config.security == "TLS" {
            Tls::Wrapper(tls)
        } else {
            Tls::Required(tls)
        })
        .timeout(Some(Duration::from_secs(
            config.timeout_seconds.clamp(1, 60),
        )))
        .credentials(Credentials::new(config.username.clone(), password.into()))
        .build();
    match transport.send(message).await {
        Ok(_) => Outcome::Accepted(None),
        Err(error) if error.is_transient() => Outcome::Retry("smtp_transient_rejection", None),
        Err(error) if error.is_permanent() => {
            let code = error.status().map(|v| v.to_string()).unwrap_or_default();
            Outcome::Failed(if matches!(code.as_str(), "550" | "551" | "553") {
                "recipient_invalid"
            } else {
                "smtp_permanent_rejection"
            })
        }
        Err(_) => Outcome::Unknown("smtp_result_unknown"),
    }
}

#[derive(Deserialize)]
struct OutboundDetails {
    #[serde(rename = "MessageID")]
    message_id: Uuid,
    #[serde(rename = "MessageEvents")]
    events: Vec<Value>,
    #[serde(rename = "Sandboxed")]
    sandboxed: bool,
}
pub async fn delivery_evidence(
    token: &str,
    id: Uuid,
    recipient: &str,
) -> Result<Option<(String, DateTime<Utc>)>, AppError> {
    let response = client()?
        .get(format!(
            "https://api.postmarkapp.com/messages/outbound/{id}/details"
        ))
        .header("X-Postmark-Server-Token", token_header(token)?)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|_| AppError::Unavailable)?;
    if !response.status().is_success() {
        return Err(AppError::Unavailable);
    }
    let value: OutboundDetails =
        serde_json::from_value(bounded_json(response).await?).map_err(|_| AppError::Unavailable)?;
    if value.message_id != id || value.sandboxed {
        return Err(AppError::Unavailable);
    }
    for event in value.events {
        if event["Recipient"].as_str() != Some(recipient) {
            continue;
        }
        let Some(kind) = event["Type"]
            .as_str()
            .filter(|v| matches!(*v, "Delivered" | "Bounced"))
        else {
            continue;
        };
        let Some(at) = event["ReceivedAt"]
            .as_str()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|at| at.with_timezone(&Utc))
        else {
            continue;
        };
        return Ok(Some((kind.to_owned(), at)));
    }
    Ok(None)
}

pub async fn find_message(
    token: &str,
    id: Uuid,
    envelope: &Envelope,
) -> Result<Option<Uuid>, AppError> {
    let response = client()?
        .get("https://api.postmarkapp.com/messages/outbound")
        .query(&[
            ("count", "2".to_owned()),
            ("offset", "0".to_owned()),
            ("metadata_uasspain_message_id", id.to_string()),
        ])
        .header("X-Postmark-Server-Token", token_header(token)?)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|_| AppError::Unavailable)?;
    if !response.status().is_success() {
        return Err(AppError::Unavailable);
    }
    let value = bounded_json(response).await?;
    if value["TotalCount"].as_u64() != Some(1) {
        return Ok(None);
    }
    let Some(row) = value["Messages"]
        .as_array()
        .filter(|v| v.len() == 1)
        .and_then(|v| v.first())
    else {
        return Ok(None);
    };
    let expected = id.to_string();
    if row["Sandboxed"] != false
        || row["Metadata"]["uasspain_message_id"].as_str() != Some(expected.as_str())
        || row["Subject"].as_str() != Some(envelope.subject.as_str())
        || row["Recipients"]
            .as_array()
            .is_none_or(|v| v.len() != 1 || v[0].as_str() != Some(envelope.to.as_str()))
    {
        return Ok(None);
    }
    let from: Mailbox = row["From"]
        .as_str()
        .ok_or(AppError::Unavailable)?
        .parse()
        .map_err(|_| AppError::Unavailable)?;
    if from.email.to_string() != envelope.from {
        return Ok(None);
    }
    Ok(row["MessageID"]
        .as_str()
        .and_then(|v| Uuid::parse_str(v).ok())
        .filter(|v| !v.is_nil()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn provider_rejections_and_uncertain_results_are_not_delivery() {
        use axum::{Json, Router, http::StatusCode, routing::post};
        let app = Router::new()
            .route(
                "/rate",
                post(|| async {
                    (
                        StatusCode::TOO_MANY_REQUESTS,
                        [("Retry-After", "60")],
                        Json(json!({})),
                    )
                }),
            )
            .route("/auth", post(|| async { StatusCode::UNAUTHORIZED }))
            .route("/uncertain", post(|| async { StatusCode::BAD_GATEWAY }))
            .route(
                "/recipient",
                post(|| async { Json(json!({"ErrorCode":406})) }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let e = Envelope {
            from: "no-reply@uasspain.com".into(),
            from_name: "UASSpain".into(),
            to: "fixture@example.invalid".into(),
            reply_to: None,
            subject: "TEMP".into(),
            body: "TEMP".into(),
            smtp: None,
        };
        assert!(matches!(
            postmark_at(
                &format!("{origin}/rate"),
                &e,
                "isolated-fixture",
                Uuid::new_v4()
            )
            .await,
            Outcome::Retry("provider_rate_limited", Some(60))
        ));
        assert!(matches!(
            postmark_at(
                &format!("{origin}/auth"),
                &e,
                "isolated-fixture",
                Uuid::new_v4()
            )
            .await,
            Outcome::Failed("provider_authentication_failed")
        ));
        assert!(matches!(
            postmark_at(
                &format!("{origin}/uncertain"),
                &e,
                "isolated-fixture",
                Uuid::new_v4()
            )
            .await,
            Outcome::Unknown(_)
        ));
        let recipient = postmark_at(
            &format!("{origin}/recipient"),
            &e,
            "isolated-fixture",
            Uuid::new_v4(),
        )
        .await;
        assert!(matches!(recipient, Outcome::Failed("recipient_invalid")));
        assert!(!recipient.affects_circuit());
        server.abort();
    }
    #[test]
    fn provider_retry_dates_and_long_waits_are_respected() {
        let now = DateTime::parse_from_rfc3339("2026-10-12T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(
            retry_after("Mon, 12 Oct 2026 14:00:00 GMT", now),
            Some(7200)
        );
        assert_eq!(retry_after("10000", now), Some(10000));
        assert_eq!(retry_after("not-a-delay", now), None);
    }
    #[test]
    fn no_header_injection_or_visitor_from() {
        for value in [
            "a@example.invalid\r\nBcc:a@evil.invalid",
            "a@example.invalid,b@example.invalid",
            " a@example.invalid",
        ] {
            assert!(address(value).is_err());
        }
        let mut e = Envelope {
            from: "no-reply@uasspain.com".into(),
            from_name: "UASSpain".into(),
            to: "info@uasspain.com".into(),
            reply_to: Some("visitor@example.invalid".into()),
            subject: "Consulta".into(),
            body: "Consulta sintética".into(),
            smtp: None,
        };
        let payload = e.postmark_payload(Uuid::new_v4()).unwrap();
        assert_eq!(payload["ReplyTo"], "visitor@example.invalid");
        assert!(
            payload["From"]
                .as_str()
                .unwrap()
                .contains("no-reply@uasspain.com")
        );
        e.from = "visitor@example.invalid".into();
        assert!(e.postmark_payload(Uuid::new_v4()).is_err());
    }
}
