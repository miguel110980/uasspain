use crate::{
    AppState,
    error::AppError,
    runtime_config::{SmtpConfig, validate_smtp},
};
use axum::{Json, extract::State, http::HeaderMap};
use lettre::{
    Address, AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
    message::{Mailbox, header::ContentType},
    transport::smtp::{
        authentication::Credentials,
        client::{Certificate, Tls, TlsParameters},
    },
};
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
    let email = std::env::var("CONTACT_EMAIL")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(defaults()?.email);
    address(&email).map_err(|_| AppError::Unavailable)?;
    Ok(email)
}
pub async fn public_config() -> Result<Json<Value>, AppError> {
    Ok(Json(json!({"email":mailbox()?})))
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

    fn postmark_payload(&self, from: &str, recipient: &str) -> Result<Value, AppError> {
        self.validate()?;
        if address(from).map_err(|_| AppError::Unavailable)?.domain() != "uasspain.com" {
            return Err(AppError::Unavailable);
        }
        address(recipient).map_err(|_| AppError::Unavailable)?;
        Ok(json!({
            "From": from, "To": recipient, "ReplyTo": self.email,
            "Subject": format!("Consulta UASSpain: {}", self.asunto.trim()),
            "TextBody": self.text_body(), "MessageStream": "outbound",
            "Tag": "uasspain-contact", "TrackOpens": false, "TrackLinks": "None"
        }))
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
    fn message(&self, config: &SmtpConfig, recipient: &str) -> Result<Message, AppError> {
        self.validate()?;
        let mut from: Mailbox = config
            .from_email
            .parse()
            .map_err(|_| AppError::Unavailable)?;
        if !config.from_name.is_empty() {
            from.name = Some(config.from_name.clone());
        }
        Message::builder()
            .from(from)
            .to(Mailbox::new(None, address(recipient)?))
            .reply_to(Mailbox::new(
                Some(self.nombre.trim().to_owned()),
                address(&self.email)?,
            ))
            .subject(format!("Consulta UASSpain: {}", self.asunto.trim()))
            .header(ContentType::TEXT_PLAIN)
            .body(self.text_body())
            .map_err(|_| AppError::Internal)
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
fn configuration(recipient: &str) -> Result<(SmtpConfig, String, String), AppError> {
    let value = |name: &str| std::env::var(name).unwrap_or_default();
    let password = std::env::var("CONTACT_SMTP_PASSWORD_FILE")
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| s.trim().to_owned())
        .or_else(|| std::env::var("CONTACT_SMTP_PASSWORD").ok())
        .filter(|s| !s.is_empty())
        .ok_or(AppError::Unavailable)?;
    let config = SmtpConfig {
        enabled: true,
        host: value("CONTACT_SMTP_HOST"),
        port: value("CONTACT_SMTP_PORT").parse().unwrap_or(587),
        security: std::env::var("CONTACT_SMTP_SECURITY").unwrap_or_else(|_| "STARTTLS".into()),
        username: value("CONTACT_SMTP_USER"),
        from_email: std::env::var("CONTACT_SMTP_FROM")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| recipient.into()),
        from_name: "UASSpain".into(),
        timeout_seconds: 15,
        ..Default::default()
    };
    validate_smtp(&config).map_err(|_| AppError::Unavailable)?;
    Ok((config, password, value("CONTACT_SMTP_CA_FILE")))
}
pub async fn send(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<ContactWrite>,
) -> Result<Json<Value>, AppError> {
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
    let recipient = mailbox()?;
    if let Some(token) = postmark_token()? {
        let from = std::env::var("POSTMARK_FROM").map_err(|_| AppError::Unavailable)?;
        let payload = input.postmark_payload(&from, &recipient)?;
        postmark_request("https://api.postmarkapp.com/email", &token, &payload).await?;
        return Ok(Json(
            json!({"detail":"Consulta enviada a UASSpain.","delivery_accepted":true}),
        ));
    }
    let (config, password, ca_file) = configuration(&recipient)?;
    let message = input.message(&config, &recipient)?;
    let mut tls = TlsParameters::builder(config.host.clone());
    if !ca_file.is_empty() {
        let ca = std::fs::read(ca_file).map_err(|_| AppError::Unavailable)?;
        tls = tls
            .add_root_certificate(Certificate::from_pem(&ca).map_err(|_| AppError::Unavailable)?);
    }
    let tls = tls.build().map_err(|_| AppError::Unavailable)?;
    let transport = AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&config.host)
        .port(config.port)
        .tls(if config.security == "TLS" {
            Tls::Wrapper(tls)
        } else {
            Tls::Required(tls)
        })
        .timeout(Some(Duration::from_secs(config.timeout_seconds)))
        .credentials(Credentials::new(config.username, password))
        .build();
    transport.send(message).await.map_err(|_| {
        tracing::warn!("Corporate contact SMTP delivery failed");
        AppError::Unavailable
    })?;
    // DEV_EMAIL is deliberately irrelevant: a contact succeeds only after the
    // configured corporate transport accepts it. No customer content is logged.
    Ok(Json(
        json!({"detail":"Consulta enviada a UASSpain.","delivery_accepted":true,"smtp_accepted":true}),
    ))
}

fn postmark_token() -> Result<Option<String>, AppError> {
    let token = match std::env::var("POSTMARK_SERVER_TOKEN_FILE") {
        Ok(path) => std::fs::read_to_string(path).map_err(|_| AppError::Unavailable)?,
        Err(_) => std::env::var("POSTMARK_SERVER_TOKEN").unwrap_or_default(),
    };
    let token = token.trim();
    if token.is_empty() {
        return Ok(None);
    }
    // Test-mode credentials cannot represent real delivery, even in DEV_EMAIL.
    if token == "POSTMARK_API_TEST" {
        return Err(AppError::Unavailable);
    }
    Ok(Some(token.to_owned()))
}

async fn postmark_request(endpoint: &str, token: &str, payload: &Value) -> Result<(), AppError> {
    let mut header =
        reqwest::header::HeaderValue::from_str(token).map_err(|_| AppError::Unavailable)?;
    header.set_sensitive(true);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| AppError::Unavailable)?;
    let mut response = client
        .post(endpoint)
        .header("X-Postmark-Server-Token", header)
        .header("Accept", "application/json")
        .json(payload)
        .send()
        .await
        .map_err(|_| AppError::Unavailable)?;
    if !response.status().is_success() {
        return Err(AppError::Unavailable);
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| AppError::Unavailable)? {
        if body.len() + chunk.len() > 65536 {
            return Err(AppError::Unavailable);
        }
        body.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&body).map_err(|_| AppError::Unavailable)?;
    if value["ErrorCode"].as_u64() != Some(0)
        || value["MessageID"]
            .as_str()
            .and_then(|id| uuid::Uuid::parse_str(id).ok())
            .is_none_or(|id| id.is_nil())
        || value["To"].as_str() != payload["To"].as_str()
    {
        return Err(AppError::Unavailable);
    }
    Ok(())
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
            .postmark_payload("info@uasspain.com", "info@uasspain.com")
            .unwrap();
        assert_eq!(payload["From"], "info@uasspain.com");
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
            .postmark_payload("info@uasspain.com", "info@uasspain.com")
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
