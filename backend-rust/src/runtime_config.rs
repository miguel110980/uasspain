use crate::{
    AppState,
    auth::{authenticate, require_role},
    error::AppError,
};
use axum::{Json, extract::State, http::HeaderMap};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};
use uuid::Uuid;

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct SmtpConfig {
    pub enabled: bool,
    pub provider: String,
    pub host: String,
    pub port: u16,
    pub security: String,
    pub username: String,
    pub from_email: String,
    pub from_name: String,
    pub contact_recipient: String,
    pub timeout_seconds: u64,
    pub last_test_ok: Option<bool>,
}
#[derive(Deserialize)]
pub struct SmtpWrite {
    #[serde(flatten)]
    pub config: SmtpConfig,
    #[serde(default)]
    pub password: String,
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct GoogleConfig {
    pub enabled: bool,
    pub client_id: String,
}

pub fn valid_client_id(id: &str) -> bool {
    let Some(prefix) = id.strip_suffix(".apps.googleusercontent.com") else {
        return false;
    };
    let Some((number, key)) = prefix.split_once('-') else {
        return false;
    };
    !number.is_empty()
        && number.bytes().all(|b| b.is_ascii_digit())
        && !key.is_empty()
        && key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        && id.len() <= 256
}
pub fn validate_smtp(config: &SmtpConfig) -> Result<(), AppError> {
    let email_valid =
        |email: &str| email.len() <= 254 && email.parse::<lettre::message::Mailbox>().is_ok();
    let host_valid = config.host.len() <= 253
        && !config.host.starts_with('-')
        && config
            .host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".-:".contains(&b));
    if (!config.host.is_empty() && !host_valid)
        || (!config.security.is_empty() && !matches!(config.security.as_str(), "STARTTLS" | "TLS"))
        || config.username.len() > 254
        || config.provider.len() > 120
        || config.from_name.len() > 120
        || config.from_name.contains(['\r', '\n'])
        || config.timeout_seconds > 60
        || (!config.from_email.is_empty() && !email_valid(&config.from_email))
        || (!config.contact_recipient.is_empty() && !email_valid(&config.contact_recipient))
        || (config.enabled
            && (config.host.is_empty()
                || config.port == 0
                || config.username.is_empty()
                || config.security.is_empty()
                || config.from_email.is_empty()
                || config.timeout_seconds == 0))
    {
        return Err(AppError::Validation(
            "Configuración SMTP no válida; use TLS o STARTTLS y complete los campos obligatorios."
                .into(),
        ));
    }
    Ok(())
}
pub async fn setting(state: &AppState, key: &str) -> Result<Option<Value>, AppError> {
    let Some(pool) = &state.pool else {
        return Ok(None);
    };
    Ok(
        sqlx::query_scalar("SELECT value FROM core_systemsetting WHERE key=$1")
            .bind(key)
            .fetch_optional(pool)
            .await?,
    )
}
pub async fn google(state: &AppState) -> Result<GoogleConfig, AppError> {
    if let Some(value) = setting(state, "google_oauth").await? {
        return serde_json::from_value(value).map_err(|_| AppError::Internal);
    }
    let client_id = std::env::var("GOOGLE_CLIENT_ID")
        .unwrap_or_default()
        .trim()
        .to_owned();
    Ok(GoogleConfig {
        enabled: !client_id.is_empty(),
        client_id,
    })
}
pub async fn google_client_id(state: &AppState) -> Result<String, AppError> {
    let config = google(state).await?;
    if config.enabled && !config.client_id.is_empty() {
        Ok(config.client_id)
    } else {
        Err(AppError::Unavailable)
    }
}
pub async fn smtp(state: &AppState) -> Result<(SmtpConfig, Option<String>), AppError> {
    if let Some(value) = setting(state, "smtp").await? {
        let config: SmtpConfig = serde_json::from_value(value).map_err(|_| AppError::Internal)?;
        // A saved disabled configuration explicitly disables delivery, including env fallback.
        let password = secret(state, "smtp_password").await?;
        return Ok((config, password));
    }
    let username = std::env::var("EMAIL_HOST_USER").unwrap_or_default();
    let host = std::env::var("EMAIL_HOST").unwrap_or_default();
    let password = std::env::var("EMAIL_HOST_PASSWORD_FILE")
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map(|s| s.trim().to_owned())
        .or_else(|| std::env::var("EMAIL_HOST_PASSWORD").ok())
        .filter(|s| !s.is_empty());
    Ok((
        SmtpConfig {
            enabled: !host.is_empty(),
            host,
            port: std::env::var("EMAIL_PORT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(587),
            security: if env_true("EMAIL_USE_SSL") {
                "TLS"
            } else {
                "STARTTLS"
            }
            .into(),
            from_email: std::env::var("DEFAULT_FROM_EMAIL").unwrap_or_else(|_| username.clone()),
            username,
            contact_recipient: std::env::var("CONTACT_EMAIL").unwrap_or_default(),
            timeout_seconds: 30,
            ..Default::default()
        },
        password,
    ))
}
async fn secret(state: &AppState, key: &str) -> Result<Option<String>, AppError> {
    let Some(pool) = &state.pool else {
        return Ok(None);
    };
    let value: Option<String> =
        sqlx::query_scalar("SELECT ciphertext FROM core_systemsecret WHERE key=$1")
            .bind(key)
            .fetch_optional(pool)
            .await?;
    value.map(|s| state.cipher.decrypt(&s)).transpose()
}
pub fn smtp_view(config: &SmtpConfig, password: Option<&str>) -> Value {
    let mut value = json!(config);
    value["password_configured"] = json!(password.is_some_and(|s| !s.is_empty()));
    value["configured"] = json!(
        config.enabled
            && validate_smtp(config).is_ok()
            && !config.host.is_empty()
            && password.is_some_and(|s| !s.is_empty())
    );
    value
}
fn admin(state: &AppState, headers: &HeaderMap) -> Result<Uuid, AppError> {
    let claims = authenticate(state, headers, "access")?;
    require_role(&claims, &["admin"])?;
    Ok(claims.profile_id)
}
pub async fn audit(state: &AppState, profile: Uuid, action: &str) -> Result<(), AppError> {
    sqlx::query("INSERT INTO core_auditlog (id,created_date,updated_date,model_name,instance_id,action,extra,profile_id) VALUES ($1,NOW(),NOW(),'SystemConfiguration','',$2,'{}'::jsonb,$3)")
        .bind(Uuid::new_v4()).bind(action).bind(profile).execute(state.pool.as_ref().ok_or(AppError::Unavailable)?).await?;
    Ok(())
}
async fn save(state: &AppState, key: &str, value: Value) -> Result<(), AppError> {
    sqlx::query("INSERT INTO core_systemsetting (id,created_date,updated_date,key,value) VALUES ($1,NOW(),NOW(),$2,$3) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_date=NOW()")
        .bind(Uuid::new_v4()).bind(key).bind(value).execute(state.pool.as_ref().ok_or(AppError::Unavailable)?).await?;
    Ok(())
}
pub async fn smtp_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    admin(&state, &headers)?;
    let (config, password) = smtp(&state).await?;
    Ok(Json(smtp_view(&config, password.as_deref())))
}
pub async fn smtp_put(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(mut input): Json<SmtpWrite>,
) -> Result<Json<Value>, AppError> {
    let profile = admin(&state, &headers)?;
    validate_smtp(&input.config)?;
    if input.password.len() > 4096 || input.password.starts_with("v1:") {
        return Err(AppError::Validation("Contraseña SMTP no válida.".into()));
    }
    if input.password.is_empty() && secret(&state, "smtp_password").await?.is_none() {
        // Preserve an environment-supplied password when adopting runtime config.
        input.password = smtp(&state).await?.1.unwrap_or_default();
    }
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let mut tx = pool.begin().await?;
    if !input.password.is_empty() {
        let ciphertext = state.cipher.encrypt(&input.password)?;
        sqlx::query("INSERT INTO core_systemsecret (id,key,ciphertext) VALUES ($1,'smtp_password',$2) ON CONFLICT (key) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,updated_at=NOW(),rotated_at=NOW()")
            .bind(Uuid::new_v4()).bind(ciphertext).execute(&mut *tx).await?;
    }
    input.config.last_test_ok = None;
    sqlx::query("INSERT INTO core_systemsetting (id,created_date,updated_date,key,value) VALUES ($1,NOW(),NOW(),'smtp',$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_date=NOW()")
        .bind(Uuid::new_v4()).bind(json!(input.config)).execute(&mut *tx).await?;
    tx.commit().await?;
    audit(&state, profile, "smtp_config_updated").await?;
    let (config, password) = smtp(&state).await?;
    Ok(Json(smtp_view(&config, password.as_deref())))
}
#[derive(Deserialize)]
pub struct SmtpTest {
    pub recipient: String,
}
pub async fn smtp_test(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<SmtpTest>,
) -> Result<Json<Value>, AppError> {
    let profile = admin(&state, &headers)?;
    crate::auth::enforce_login_rate(&headers, &format!("smtp-test:{profile}"))?;
    let (config, password) = smtp(&state).await?;
    if !config.enabled || password.is_none() {
        return Err(AppError::Unavailable);
    }
    let result = crate::email::deliver(
        &config,
        password.as_deref().unwrap_or_default(),
        &input.recipient,
        "Prueba de correo UASSpain",
        "Configuración de correo verificada.",
    )
    .await;
    let mut config = config;
    config.last_test_ok = Some(result.is_ok());
    save(&state, "smtp", json!(config)).await?;
    audit(
        &state,
        profile,
        if result.is_ok() {
            "smtp_test_success"
        } else {
            "smtp_test_failed"
        },
    )
    .await?;
    result?;
    Ok(Json(
        json!({"ok":true,"detail":"Correo de prueba enviado."}),
    ))
}
pub fn google_view(config: GoogleConfig) -> Value {
    let configured = config.enabled && !config.client_id.is_empty();
    let origins: Vec<String> = ["FRONTEND_URL", "SITE_URL"]
        .into_iter()
        .filter_map(|key| std::env::var(key).ok())
        .filter_map(|s| url::Url::parse(&s).ok())
        .map(|u| u.origin().ascii_serialization())
        .fold(Vec::new(), |mut v, s| {
            if !v.contains(&s) {
                v.push(s)
            }
            v
        });
    json!({"enabled":config.enabled,"configured":configured,"client_id":config.client_id,"origins":origins})
}
pub async fn google_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    admin(&state, &headers)?;
    Ok(Json(google_view(google(&state).await?)))
}
pub async fn google_put(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(mut input): Json<GoogleConfig>,
) -> Result<Json<Value>, AppError> {
    let profile = admin(&state, &headers)?;
    input.client_id = input.client_id.trim().to_owned();
    if (!input.client_id.is_empty() && !valid_client_id(&input.client_id))
        || (input.enabled && input.client_id.is_empty())
    {
        return Err(AppError::Validation(
            "Client ID de Google no válido.".into(),
        ));
    }
    save(&state, "google_oauth", json!(input)).await?;
    audit(&state, profile, "google_oauth_config_update").await?;
    Ok(Json(google_view(input)))
}
pub fn env_true(key: &str) -> bool {
    std::env::var(key).is_ok_and(|s| matches!(s.to_lowercase().as_str(), "1" | "true" | "yes"))
}
pub async fn database_probe(state: &AppState) -> bool {
    match &state.pool {
        Some(pool) => matches!(
            tokio::time::timeout(
                Duration::from_secs(3),
                sqlx::query_scalar::<_, i32>("SELECT 1").fetch_one(pool)
            )
            .await,
            Ok(Ok(1))
        ),
        None => false,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn client_ids_are_validated() {
        assert!(valid_client_id(
            "1234-public_test.apps.googleusercontent.com"
        ));
        assert!(!valid_client_id("evil"));
        assert!(!valid_client_id("-id.apps.googleusercontent.com"));
    }
    #[test]
    fn smtp_no_secret_serialized() {
        let config = SmtpConfig::default();
        let view = smtp_view(&config, Some("fixture"));
        assert!(view["password_configured"].as_bool().unwrap());
        assert!(!view.to_string().contains("fixture"));
        assert!(view.get("password").is_none());
        assert!(view.get("ciphertext").is_none());
    }
    #[test]
    fn smtp_rejects_plaintext_and_invalid_hosts() {
        let mut c = SmtpConfig {
            host: "host\ncommand".into(),
            ..Default::default()
        };
        assert!(validate_smtp(&c).is_err());
        c.host = "mail.example.invalid".into();
        c.security = "NONE".into();
        assert!(validate_smtp(&c).is_err());
        c.security = "TLS".into();
        assert!(validate_smtp(&c).is_ok());
        c.enabled = true;
        assert!(validate_smtp(&c).is_err());
    }
    #[tokio::test]
    async fn no_pool_is_not_connected() {
        assert!(!database_probe(&AppState::for_test()).await);
    }
    #[test]
    fn disabled_google_is_not_configured() {
        let view = google_view(GoogleConfig {
            enabled: false,
            client_id: "123-fixture.apps.googleusercontent.com".into(),
        });
        assert_eq!(view["configured"], false);
    }
}
