use crate::{
    AppState,
    error::AppError,
    runtime_config::{SmtpConfig, env_true},
};
use serde_json::json;

// Token issuances enqueue within their own transaction; this compatibility
// entry point is for existing notifications and invitations.
pub async fn send(state: &AppState, to: &str, subject: &str, body: &str) -> Result<(), AppError> {
    let mut tx = state
        .pool
        .as_ref()
        .ok_or(AppError::Unavailable)?
        .begin()
        .await?;
    let id = crate::mail_queue::enqueue(
        state,
        &mut tx,
        crate::mail_queue::MailRequest {
            to,
            reply_to: None,
            subject,
            body,
            options: crate::mail_queue::QueueOptions {
                kind: "notification",
                ttl: chrono::Duration::hours(24),
                validity: json!({}),
                idempotency: None,
            },
        },
    )
    .await?;
    tx.commit().await?;
    dispatch(state, id).await
}
pub async fn dispatch(state: &AppState, id: uuid::Uuid) -> Result<(), AppError> {
    let result = crate::mail_queue::process_id(state, id).await?;
    if matches!(result, Some(crate::mail_provider::Outcome::Failed(_))) {
        return Err(AppError::Unavailable);
    }
    // A persisted retry/uncertain result is internal acceptance, not delivery.
    Ok(())
}
pub async fn dispatch_required(state: &AppState, id: uuid::Uuid) -> Result<(), AppError> {
    let _ = crate::mail_queue::process_id(state, id).await?;
    for _ in 0..125 {
        let status: String = sqlx::query_scalar("SELECT state FROM mail_outbox WHERE id=$1")
            .bind(id)
            .fetch_one(state.pool.as_ref().ok_or(AppError::Unavailable)?)
            .await?;
        if matches!(status.as_str(), "ACCEPTED" | "DELIVERED") {
            return Ok(());
        }
        if status != "PROCESSING" && status != "PENDING" {
            return Err(AppError::Unavailable);
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
    Err(AppError::Unavailable)
}
pub(crate) async fn development_sink(
    state: &AppState,
    to: &str,
    subject: &str,
    body: &str,
) -> Result<(), AppError> {
    if env_true("APP_PRODUCTION") || !env_true("DEV_EMAIL") {
        return Err(AppError::Unavailable);
    }
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
            .encrypt(&json!({"to":to,"subject":subject,"body":body}).to_string())?;
        tokio::fs::write(
            directory.join(format!("{}.enc", uuid::Uuid::new_v4())),
            message,
        )
        .await
        .map_err(|_| AppError::Internal)?;
    }
    Ok(())
}
pub async fn deliver(
    config: &SmtpConfig,
    password: &str,
    to: &str,
    subject: &str,
    body: &str,
) -> Result<(), AppError> {
    let envelope = crate::mail_provider::Envelope {
        from: config.from_email.clone(),
        from_name: config.from_name.clone(),
        to: to.into(),
        reply_to: None,
        subject: subject.into(),
        body: body.into(),
        smtp: Some(config.clone()),
    };
    if matches!(
        crate::mail_provider::smtp(&envelope, config, password).await,
        crate::mail_provider::Outcome::Accepted(_)
    ) {
        Ok(())
    } else {
        Err(AppError::Unavailable)
    }
}
