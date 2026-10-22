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

pub const AUTOMATED_FROM: &str = "no-reply@uasspain.com";
pub const FROM_NAME: &str = "UASSpain";
pub const CONTACT_RECIPIENT: &str = "info@uasspain.com";
pub const AUTOMATED_NOTICE: &str = "Este es un mensaje automático de UASSpain. Por favor, no respondas a este correo. Para cualquier consulta, contacta con info@uasspain.com";

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
        if self.from != AUTOMATED_FROM || self.from_name != FROM_NAME {
            return Err(AppError::Unavailable);
        }
        let mut payload = json!({"From":Mailbox::new(Some(self.from_name.clone()),address(&self.from)?).to_string(),
            "To":self.to,"Subject":self.subject,"TextBody":self.body,
            "MessageStream":"outbound","TrackOpens":false,"TrackLinks":"None",
            "Metadata":{"uasspain_message_id":id.to_string()}});
        if let Some(reply) = &self.reply_to {
            payload["ReplyTo"] = json!(reply);
        }
        Ok(payload)
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

pub fn failure_detail(code: &str) -> &'static str {
    match code {
        "provider_authentication_failed" => {
            "Postmark ha rechazado el Server API Token. Compruebe que pertenece al servidor y no a la cuenta."
        }
        "sender_unverified" => {
            "Postmark no ha autorizado el remitente no-reply@uasspain.com. Compruebe su firma y la autenticación del dominio."
        }
        "account_pending_approval" => {
            "La cuenta Postmark está pendiente de aprobación y restringe los destinatarios al dominio del remitente."
        }
        "account_not_approved" => "Postmark no ha aprobado esta cuenta para enviar correo.",
        "provider_credit_limit" => {
            "Postmark ha rechazado el envío por el límite de créditos de la cuenta."
        }
        "provider_stream_invalid" => {
            "El Message Stream outbound no existe o no admite este envío en el servidor Postmark."
        }
        "provider_server_invalid" => "Postmark no reconoce el servidor configurado.",
        "recipient_invalid" => "Postmark ha rechazado un destinatario inactivo o no válido.",
        "provider_request_invalid" => "Postmark ha rechazado el formato o los campos del mensaje.",
        "provider_rate_limited" => {
            "Postmark ha limitado las solicitudes. Espere antes de volver a probar."
        }
        "provider_maintenance" => {
            "Postmark está en mantenimiento. La solicitud podrá reintentarse más tarde."
        }
        "provider_unreachable" => "No se pudo conectar con Postmark mediante HTTPS.",
        "provider_result_unknown" => {
            "No se puede confirmar el resultado de Postmark. Compruebe el registro antes de repetir el envío."
        }
        _ => {
            "Postmark no ha aceptado la solicitud. Revise el estado de la cuenta, el remitente y el registro de correo."
        }
    }
}

fn rejection(code: Option<u64>) -> Outcome {
    match code {
        Some(100) => Outcome::Retry("provider_maintenance", None),
        Some(10) => Outcome::Failed("provider_authentication_failed"),
        Some(400 | 401) => Outcome::Failed("sender_unverified"),
        Some(405) => Outcome::Failed("provider_credit_limit"),
        Some(406) => Outcome::Failed("recipient_invalid"),
        Some(412) => Outcome::Failed("account_pending_approval"),
        Some(413) => Outcome::Failed("account_not_approved"),
        Some(422) => Outcome::Failed("provider_server_invalid"),
        Some(1226 | 1235) => Outcome::Failed("provider_stream_invalid"),
        Some(300 | 402 | 403) => Outcome::Failed("provider_request_invalid"),
        _ => Outcome::Failed("provider_rejected"),
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
    let status = response.status();
    let value = bounded_json(response).await?;
    if !status.is_success() {
        let result = if status.as_u16() == 401 {
            Outcome::Failed("provider_authentication_failed")
        } else {
            rejection(value["ErrorCode"].as_u64())
        };
        return Err(AppError::Validation(failure_detail(result.code()).into()));
    }
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
    postmark_request(endpoint, envelope, token, id, false).await
}

// This token validates the payload without delivery. It is never persisted,
// promoted to a live credential or used by the delivery worker.
pub async fn validate_payload(envelope: &Envelope) -> Outcome {
    postmark_request(
        "https://api.postmarkapp.com/email",
        envelope,
        "POSTMARK_API_TEST",
        Uuid::new_v4(),
        true,
    )
    .await
}

async fn postmark_request(
    endpoint: &str,
    envelope: &Envelope,
    token: &str,
    id: Uuid,
    validation_only: bool,
) -> Outcome {
    let header = if validation_only && token == "POSTMARK_API_TEST" {
        Ok(reqwest::header::HeaderValue::from_static(
            "POSTMARK_API_TEST",
        ))
    } else {
        token_header(token)
    };
    let (Ok(client), Ok(header), Ok(payload)) = (client(), header, envelope.postmark_payload(id))
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
    let Ok(value) = bounded_json(response).await else {
        return Outcome::Unknown("provider_result_unknown");
    };
    if status.is_server_error() {
        return if value["ErrorCode"].as_u64() == Some(100) {
            rejection(Some(100))
        } else {
            Outcome::Unknown("provider_result_unknown")
        };
    }
    if !status.is_success() || value["ErrorCode"].as_u64() != Some(0) {
        return rejection(value["ErrorCode"].as_u64());
    }
    if validation_only {
        return Outcome::Accepted(None);
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
    async fn postmark_classifies_safe_errors_and_test_token_never_proves_delivery() {
        use axum::{
            Json, Router,
            extract::Path,
            http::{HeaderMap, StatusCode},
            routing::post,
        };
        let app = Router::new()
            .route("/error/{code}", post(|Path(code): Path<u64>| async move {
                (StatusCode::UNPROCESSABLE_ENTITY, Json(json!({"ErrorCode":code,"Message":"sensitive visitor and provider details must not be retained"})))
            }))
            .route("/maintenance", post(|| async {
                (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"ErrorCode":100})))
            }))
            .route("/validate", post(|headers: HeaderMap, Json(payload): Json<Value>| async move {
                assert_eq!(headers["X-Postmark-Server-Token"], "POSTMARK_API_TEST");
                assert_eq!(payload["From"], "UASSpain <no-reply@uasspain.com>");
                assert_eq!(payload["To"], "info@uasspain.com");
                assert_eq!(payload["ReplyTo"], "visitor@example.invalid");
                assert_eq!(payload["MessageStream"], "outbound");
                Json(json!({"ErrorCode":0,"MessageID":"00000000-0000-0000-0000-000000000000"}))
            }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let envelope = Envelope {
            from: AUTOMATED_FROM.into(),
            from_name: FROM_NAME.into(),
            to: CONTACT_RECIPIENT.into(),
            reply_to: Some("visitor@example.invalid".into()),
            subject: "Consulta validada".into(),
            body: "Consulta de prueba".into(),
            smtp: None,
        };
        for (code, expected) in [
            (10, "provider_authentication_failed"),
            (300, "provider_request_invalid"),
            (400, "sender_unverified"),
            (401, "sender_unverified"),
            (405, "provider_credit_limit"),
            (406, "recipient_invalid"),
            (412, "account_pending_approval"),
            (413, "account_not_approved"),
            (422, "provider_server_invalid"),
            (1235, "provider_stream_invalid"),
        ] {
            let result = postmark_at(
                &format!("{origin}/error/{code}"),
                &envelope,
                "isolated-fixture",
                Uuid::new_v4(),
            )
            .await;
            assert!(matches!(result, Outcome::Failed(_)));
            assert_eq!(result.code(), expected);
            assert!(!failure_detail(result.code()).contains("sensitive"));
        }
        assert!(matches!(
            postmark_at(
                &format!("{origin}/maintenance"),
                &envelope,
                "isolated-fixture",
                Uuid::new_v4()
            )
            .await,
            Outcome::Retry("provider_maintenance", None)
        ));
        assert!(matches!(
            postmark_at(
                &format!("{origin}/validate"),
                &envelope,
                "POSTMARK_API_TEST",
                Uuid::new_v4()
            )
            .await,
            Outcome::Failed("configuration_invalid")
        ));
        assert!(matches!(
            postmark_request(
                &format!("{origin}/validate"),
                &envelope,
                "POSTMARK_API_TEST",
                Uuid::new_v4(),
                true
            )
            .await,
            Outcome::Accepted(None)
        ));
        server.abort();
    }

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
