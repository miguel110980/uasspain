use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
    transport::smtp::authentication::Credentials,
};

use crate::error::AppError;

pub async fn send(to: &str, subject: &str, body: &str) -> Result<(), AppError> {
    if env_true("DEV_EMAIL", false) {
        tracing::warn!(to, subject, body, "development email");
        return Ok(());
    }
    let host = required("EMAIL_HOST")?;
    let user = required("EMAIL_HOST_USER")?;
    let password = secret("EMAIL_HOST_PASSWORD", "EMAIL_HOST_PASSWORD_FILE")?;
    let from = std::env::var("DEFAULT_FROM_EMAIL").unwrap_or_else(|_| user.clone());
    let message = Message::builder()
        .from(from.parse().map_err(|_| AppError::Unavailable)?)
        .to(to
            .parse()
            .map_err(|_| AppError::Validation("Email de destino no válido.".into()))?)
        .subject(subject)
        .body(body.to_owned())
        .map_err(|_| AppError::Internal)?;
    let port = std::env::var("EMAIL_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(587);
    let builder = if env_true("EMAIL_USE_SSL", false) {
        AsyncSmtpTransport::<Tokio1Executor>::relay(&host)
    } else {
        AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&host)
    }
    .map_err(|_| AppError::Unavailable)?;
    let transport = builder
        .port(port)
        .credentials(Credentials::new(user, password))
        .build();
    transport.send(message).await.map_err(|error| {
        tracing::error!(%error,"SMTP delivery failed");
        AppError::Unavailable
    })?;
    Ok(())
}

fn required(name: &str) -> Result<String, AppError> {
    std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or(AppError::Unavailable)
}
fn secret(name: &str, file_name: &str) -> Result<String, AppError> {
    std::env::var(name)
        .ok()
        .or_else(|| {
            std::env::var(file_name)
                .ok()
                .and_then(|path| std::fs::read_to_string(path).ok())
                .map(|value| value.trim().to_owned())
        })
        .filter(|value| !value.is_empty())
        .ok_or(AppError::Unavailable)
}
fn env_true(name: &str, fallback: bool) -> bool {
    std::env::var(name).map_or(fallback, |value| {
        matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes")
    })
}
