#[cfg(test)]
use crate::runtime_config::SmtpConfig;
use crate::{AppState, error::AppError};
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use lettre::Address;
#[cfg(test)]
use lettre::{Message, message::Mailbox};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

#[derive(Deserialize)]
struct Defaults {
    email: String,
}
fn defaults() -> Result<Defaults, AppError> {
    serde_json::from_str(include_str!("contact-defaults.json")).map_err(|_| AppError::Internal)
}
pub fn mailbox() -> Result<String, AppError> {
    let email = defaults()?.email;
    address(&email).map_err(|_| AppError::Unavailable)?;
    if email != crate::mail_provider::CONTACT_RECIPIENT {
        return Err(AppError::Unavailable);
    }
    Ok(email)
}
pub async fn public_config() -> Result<Json<Value>, AppError> {
    let email = mailbox()?;
    Ok(Json(json!({"email":email})))
}

#[derive(Debug, Deserialize)]
pub struct ContactWrite {
    nombre: String,
    #[serde(default)]
    empresa: String,
    email: String,
    #[serde(default)]
    telefono: String,
    servicio: String,
    asunto: String,
    mensaje: String,
    #[serde(default)]
    website: String,
    #[serde(default)]
    request_id: Option<uuid::Uuid>,
}
fn address(value: &str) -> Result<Address, AppError> {
    if value.is_empty()
        || value.len() > 254
        || value.chars().any(char::is_control)
        || value.trim() != value
    {
        return Err(AppError::Validation("Introduce un email válido.".into()));
    }
    let address = value
        .parse::<Address>()
        .map_err(|_| AppError::Validation("Introduce un email válido.".into()))?;
    if !address.domain().contains('.') {
        return Err(AppError::Validation("Introduce un email válido.".into()));
    }
    Ok(address)
}
fn header_text(value: &str, minimum: usize, maximum: usize) -> bool {
    (minimum..=maximum).contains(&value.trim().chars().count())
        && !value.chars().any(char::is_control)
}
impl ContactWrite {
    fn text_body(&self) -> String {
        format!(
            "Nombre: {}\nEmpresa: {}\nEmail: {}\nTeléfono: {}\nServicio: {}\nAsunto: {}\n\n{}",
            self.nombre.trim(),
            self.empresa.trim(),
            self.email,
            self.telefono.trim(),
            self.servicio,
            self.asunto.trim(),
            self.mensaje.trim()
        )
    }

    #[cfg(test)]
    fn envelope(&self, from: &str, recipient: &str) -> crate::mail_provider::Envelope {
        crate::mail_provider::Envelope {
            from: from.into(),
            from_name: "UASSpain".into(),
            to: recipient.into(),
            reply_to: Some(self.email.clone()),
            subject: self.asunto.trim().into(),
            body: self.text_body(),
            smtp: None,
        }
    }
    #[cfg(test)]
    fn postmark_payload(&self, from: &str, recipient: &str) -> Result<Value, AppError> {
        self.validate()?;
        self.envelope(from, recipient)
            .postmark_payload(uuid::Uuid::new_v4())
    }
    fn validate(&self) -> Result<(), AppError> {
        address(&self.email)?;
        if !header_text(&self.nombre, 1, 120)
            || !header_text(&self.asunto, 3, 120)
            || self.empresa.chars().count() > 120
            || self.empresa.chars().any(char::is_control)
            || self.telefono.len() > 20
            || self
                .telefono
                .chars()
                .any(|c| !c.is_ascii_digit() && !"+ -().".contains(c))
            || !header_text(&self.servicio, 1, 180)
            || !(10..=2000).contains(&self.mensaje.trim().chars().count())
            || self
                .mensaje
                .chars()
                .any(|c| c.is_control() && c != '\n' && c != '\r' && c != '\t')
            || !self.website.is_empty()
        {
            return Err(AppError::Validation(
                "Revisa los datos de contacto y vuelve a intentarlo.".into(),
            ));
        }
        Ok(())
    }
    #[cfg(test)]
    fn message(&self, config: &SmtpConfig, recipient: &str) -> Result<Message, AppError> {
        self.validate()?;
        self.envelope(&config.from_email, recipient).message()
    }
}

#[derive(Default)]
struct ContactRate {
    buckets: HashMap<String, VecDeque<Instant>>,
}
impl ContactRate {
    fn check(&mut self, ip: &str, now: Instant) -> Result<(), AppError> {
        let window = Duration::from_secs(60);
        self.buckets.retain(|_, bucket| {
            while bucket
                .front()
                .is_some_and(|t| now.duration_since(*t) >= window)
            {
                bucket.pop_front();
            }
            !bucket.is_empty()
        });
        if self.buckets.len() >= 10_000 && !self.buckets.contains_key(ip) {
            return Err(AppError::RateLimited);
        }
        let bucket = self.buckets.entry(ip.to_owned()).or_default();
        if bucket.len() >= 5 {
            return Err(AppError::RateLimited);
        }
        bucket.push_back(now);
        Ok(())
    }
}
fn limit(headers: &HeaderMap) -> Result<(), AppError> {
    static RATE: OnceLock<Mutex<ContactRate>> = OnceLock::new();
    // The existing proxy middleware removes untrusted forwarding headers.
    let ip = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .unwrap_or("local")
        .trim();
    RATE.get_or_init(|| Mutex::new(ContactRate::default()))
        .lock()
        .map_err(|_| AppError::Internal)?
        .check(ip, Instant::now())
}
pub async fn send(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<ContactWrite>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    if !crate::chat::origin_allowed(&headers) {
        return Err(AppError::Forbidden);
    }
    input.validate()?;
    limit(&headers)?;
    if input.servicio != "Otro" {
        let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
        let published: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM services WHERE status='published' AND title=$1)",
        )
        .bind(&input.servicio)
        .fetch_one(pool)
        .await?;
        if !published {
            return Err(AppError::Validation(
                "Selecciona un servicio publicado.".into(),
            ));
        }
    }
    // Contact enquiries always reach the corporate inbox. Neither request
    // fields nor legacy transport configuration may redirect personal data.
    let recipient = mailbox()?;
    let mut tx = state
        .pool
        .as_ref()
        .ok_or(AppError::Unavailable)?
        .begin()
        .await?;
    let request_id = input.request_id.unwrap_or_else(uuid::Uuid::new_v4);
    if request_id.is_nil() {
        return Err(AppError::Validation(
            "Identificador de solicitud no válido.".into(),
        ));
    }
    let idempotency = state.cipher.blind_index(&format!(
        "contact:{request_id}:{}",
        input.email.to_ascii_lowercase()
    ))?;
    let id = crate::mail_queue::enqueue(
        &state,
        &mut tx,
        crate::mail_queue::MailRequest {
            to: &recipient,
            reply_to: Some(&input.email),
            subject: input.asunto.trim(),
            body: &input.text_body(),
            options: crate::mail_queue::QueueOptions {
                kind: "contact",
                ttl: chrono::Duration::hours(24),
                validity: json!({}),
                idempotency: Some(&idempotency),
            },
        },
    )
    .await?;
    tx.commit().await?;
    let result = crate::mail_queue::process_id(&state, id).await?;
    if matches!(result, Some(crate::mail_provider::Outcome::Failed(_))) {
        return Ok(rejected_contact(id, "FAILED"));
    }
    let (mut status, provider): (String, String) =
        sqlx::query_as("SELECT state,provider FROM mail_outbox WHERE id=$1")
            .bind(id)
            .fetch_one(state.pool.as_ref().ok_or(AppError::Unavailable)?)
            .await?;
    for _ in 0..125 {
        if status != "PROCESSING" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
        status = sqlx::query_scalar("SELECT state FROM mail_outbox WHERE id=$1")
            .bind(id)
            .fetch_one(state.pool.as_ref().ok_or(AppError::Unavailable)?)
            .await?;
    }
    let accepted = status == "ACCEPTED" || status == "DELIVERED";
    if status == "FAILED" || status == "EXPIRED" {
        return Ok(rejected_contact(id, &status));
    }
    let detail = if accepted {
        "Consulta aceptada para su envio por el proveedor de correo."
    } else if status == "UNKNOWN" {
        "Consulta registrada. Estamos comprobando el envio; no es necesario repetirla."
    } else {
        "Consulta registrada y pendiente de envio."
    };
    Ok((
        StatusCode::OK,
        Json(
            json!({"detail":detail,"internally_accepted":true,"delivery_accepted":accepted,"delivery_confirmed":status=="DELIVERED","smtp_accepted":accepted&&provider=="smtp","state":status,"message_id":id}),
        ),
    ))
}

fn rejected_contact(id: uuid::Uuid, state: &str) -> (StatusCode, Json<Value>) {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(
            json!({"detail":"La consulta no se ha enviado. Puedes reintentar más tarde.","code":"service_unavailable","state":state,"message_id":id,"internally_accepted":false,"delivery_accepted":false,"correlation_id":uuid::Uuid::new_v4()}),
        ),
    )
}

#[cfg(test)]
async fn postmark_request(endpoint: &str, token: &str, payload: &Value) -> Result<(), AppError> {
    let from: Mailbox = payload["From"]
        .as_str()
        .ok_or(AppError::Unavailable)?
        .parse()
        .map_err(|_| AppError::Unavailable)?;
    let envelope = crate::mail_provider::Envelope {
        from: from.email.to_string(),
        from_name: from.name.unwrap_or_default(),
        to: payload["To"].as_str().unwrap_or_default().into(),
        reply_to: payload["ReplyTo"].as_str().map(str::to_owned),
        subject: payload["Subject"].as_str().unwrap_or_default().into(),
        body: payload["TextBody"].as_str().unwrap_or_default().into(),
        smtp: None,
    };
    if matches!(
        crate::mail_provider::postmark_at(endpoint, &envelope, token, uuid::Uuid::new_v4()).await,
        crate::mail_provider::Outcome::Accepted(Some(_))
    ) {
        Ok(())
    } else {
        Err(AppError::Unavailable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample() -> ContactWrite {
        ContactWrite {
            nombre: "Cliente de prueba".into(),
            empresa: "".into(),
            email: "visitor+test@example.invalid".into(),
            telefono: "".into(),
            servicio: "Otro".into(),
            asunto: "Consulta técnica".into(),
            mensaje: "Primera línea\nSegunda línea".into(),
            website: "".into(),
            request_id: None,
        }
    }
    #[test]
    fn email_and_header_injection_rejected() {
        for email in [
            "a@",
            "A <a@example.invalid>",
            "a@example.invalid\r\nBcc: b@example.invalid",
            "a@example.invalid,b@example.invalid",
        ] {
            let mut input = sample();
            input.email = email.into();
            assert!(input.validate().is_err());
        }
        let mut input = sample();
        input.asunto = "Consulta\r\nBcc: a@example.invalid".into();
        assert!(input.validate().is_err());
    }
    #[test]
    fn bounded_human_fields_and_honeypot() {
        let mut input = sample();
        assert!(input.validate().is_ok());
        input.website = "https://spam.invalid".into();
        assert!(input.validate().is_err());
        input.website.clear();
        input.mensaje = "x".repeat(2001);
        assert!(input.validate().is_err());
        input = sample();
        input.servicio = "Servicio\r\nBcc: injected@example.invalid".into();
        assert!(input.validate().is_err());
    }
    #[test]
    fn reply_routes_to_visitor_and_body_keeps_lines() {
        let config = SmtpConfig {
            from_email: "info@uasspain.com".into(),
            ..Default::default()
        };
        let message = sample().message(&config, "info@uasspain.com").unwrap();
        let raw = String::from_utf8(message.formatted()).unwrap();
        assert!(raw.contains("Reply-To:") && raw.contains("visitor+test@example.invalid"));
        assert!(raw.contains("To: info@uasspain.com"));
        assert!(raw.contains("text/plain"));
        assert!(raw.contains("Segunda l"));
        assert!(!raw.contains("Bcc:"));
    }
    #[test]
    fn five_per_ip_and_expiry() {
        let mut rate = ContactRate::default();
        let now = Instant::now();
        for _ in 0..5 {
            assert!(rate.check("A", now).is_ok());
        }
        assert!(rate.check("A", now).is_err());
        assert!(rate.check("B", now).is_ok());
        assert!(rate.check("A", now + Duration::from_secs(60)).is_ok());
    }

    #[test]
    fn postmark_from_is_corporate_and_reply_to_is_visitor() {
        let input = sample();
        let payload = input
            .postmark_payload("no-reply@uasspain.com", "info@uasspain.com")
            .unwrap();
        assert!(
            payload["From"]
                .as_str()
                .unwrap()
                .contains("no-reply@uasspain.com")
        );
        assert_eq!(payload["ReplyTo"], input.email);
        assert_eq!(payload["TextBody"], input.text_body());
        assert!(
            input
                .postmark_payload(&input.email, "info@uasspain.com")
                .is_err()
        );
        assert!(!payload.to_string().contains("Token"));
    }

    #[tokio::test]
    async fn postmark_http_success_requires_real_acceptance() {
        use axum::{Router, routing::post};
        let app = Router::new()
            .route("/ok", post(|| async { Json(json!({"ErrorCode":0,"MessageID":"93bb2e8a-239b-4b4a-8534-833995cc3213","To":"info@uasspain.com"})) }))
            .route("/rejected", post(|| async { Json(json!({"ErrorCode":300,"MessageID":"93bb2e8a-239b-4b4a-8534-833995cc3213","To":"info@uasspain.com"})) }))
            .route("/fake", post(|| async { Json(json!({"ErrorCode":0,"MessageID":"00000000-0000-0000-0000-000000000000","To":"info@uasspain.com"})) }))
            .route("/redirect", post(|| async { axum::response::Redirect::temporary("/ok") }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let payload = sample()
            .postmark_payload("no-reply@uasspain.com", "info@uasspain.com")
            .unwrap();
        assert!(
            postmark_request(&format!("{origin}/ok"), "isolated-fixture", &payload)
                .await
                .is_ok()
        );
        for path in ["rejected", "fake", "redirect"] {
            assert!(
                postmark_request(&format!("{origin}/{path}"), "isolated-fixture", &payload)
                    .await
                    .is_err()
            );
        }
        server.abort();
    }
}
