use crate::{
    AppState,
    error::AppError,
    runtime_config::{SmtpConfig, env_true},
};
use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
    transport::smtp::authentication::Credentials,
};
pub async fn send(state: &AppState, to: &str, subject: &str, body: &str) -> Result<(), AppError> {
    if env_true("DEV_EMAIL") {
        if env_true("APP_PRODUCTION") {
            return Err(AppError::Unavailable);
        }
        // Isolated E2E can inspect messages without exposing tokens in logs or
        // writing plaintext. Production Compose never enables this sink.
        if let Ok(directory) = std::env::var("DEV_EMAIL_OUTBOX_DIR") {
            let directory = std::path::Path::new(&directory);
            if !directory.is_absolute() || !directory.starts_with("/app/backups/e2e-mailbox") {
                return Err(AppError::Unavailable);
            }
            tokio::fs::create_dir_all(directory)
                .await
                .map_err(|_| AppError::Internal)?;
            let message = state
                .cipher
                .encrypt(&serde_json::json!({"to":to,"subject":subject,"body":body}).to_string())?;
            tokio::fs::write(
                directory.join(format!("{}.enc", uuid::Uuid::new_v4())),
                message,
            )
            .await
            .map_err(|_| AppError::Internal)?;
        }
        tracing::warn!("development email delivery skipped");
        return Ok(());
    }
    let (config, password) = crate::runtime_config::smtp(state).await?;
    if !config.enabled {
        return Err(AppError::Unavailable);
    }
    deliver(
        &config,
        password.as_deref().ok_or(AppError::Unavailable)?,
        to,
        subject,
        body,
    )
    .await
}
pub async fn deliver(
    config: &SmtpConfig,
    password: &str,
    to: &str,
    subject: &str,
    body: &str,
) -> Result<(), AppError> {
    crate::runtime_config::validate_smtp(config)?;
    let mut from: lettre::message::Mailbox = config
        .from_email
        .parse()
        .map_err(|_| AppError::Unavailable)?;
    if !config.from_name.is_empty() {
        from.name = Some(config.from_name.clone());
    }
    let message = Message::builder()
        .from(from)
        .to(to
            .parse()
            .map_err(|_| AppError::Validation("Email de destino no valido.".into()))?)
        .subject(subject)
        .body(body.to_owned())
        .map_err(|_| AppError::Internal)?;
    let builder = if config.security == "TLS" {
        AsyncSmtpTransport::<Tokio1Executor>::relay(&config.host)
    } else {
        AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&config.host)
    }
    .map_err(|_| AppError::Unavailable)?;
    let transport = builder
        .port(config.port)
        .timeout(Some(std::time::Duration::from_secs(config.timeout_seconds)))
        .credentials(Credentials::new(
            config.username.clone(),
            password.to_owned(),
        ))
        .build();
    transport.send(message).await.map_err(|_| {
        tracing::warn!("SMTP delivery failed");
        AppError::Unavailable
    })?;
    Ok(())
}
