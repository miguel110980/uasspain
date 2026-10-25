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
    pub last_test_at: Option<chrono::DateTime<chrono::Utc>>,
}
#[derive(Deserialize)]
pub struct SmtpWrite {
    #[serde(flatten)]
    pub config: SmtpConfig,
    #[serde(default)]
    pub password: String,
}
#[derive(Deserialize, Serialize)]
struct SmtpDraft {
    config: SmtpConfig,
    pending: bool,
}
fn same_secret(left: Option<&str>, right: Option<&str>) -> bool {
    subtle::ConstantTimeEq::ct_eq(
        left.unwrap_or_default().as_bytes(),
        right.unwrap_or_default().as_bytes(),
    )
    .into()
}
fn same_smtp_transport(left: &SmtpConfig, right: &SmtpConfig) -> bool {
    left.enabled == right.enabled
        && left.host == right.host
        && left.port == right.port
        && left.security == right.security
        && left.username == right.username
        && left.from_email == right.from_email
        && left.timeout_seconds == right.timeout_seconds
}
pub(crate) fn smtp_test_valid(config: &SmtpConfig, fresh: bool) -> bool {
    config.last_test_ok == Some(true)
        && config.last_test_at.is_some_and(|at| {
            let age = chrono::Utc::now() - at;
            age >= chrono::Duration::zero() && (!fresh || age < chrono::Duration::hours(24))
        })
}
async fn smtp_draft(
    state: &AppState,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<Option<(SmtpConfig, Option<String>)>, AppError> {
    let value: Option<Value> =
        sqlx::query_scalar("SELECT value FROM core_systemsetting WHERE key='smtp_draft'")
            .fetch_optional(&mut **tx)
            .await?;
    let Some(value) = value else { return Ok(None) };
    let draft: SmtpDraft = serde_json::from_value(value).map_err(|_| AppError::Internal)?;
    if !draft.pending {
        return Ok(None);
    }
    let encrypted: Option<String> = sqlx::query_scalar(
        "SELECT ciphertext FROM core_systemsecret WHERE key='smtp_password_candidate'",
    )
    .fetch_optional(&mut **tx)
    .await?;
    Ok(Some((
        draft.config,
        encrypted.map(|v| state.cipher.decrypt(&v)).transpose()?,
    )))
}
async fn save_smtp_secret(
    state: &AppState,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    key: &str,
    password: &str,
) -> Result<(), AppError> {
    let encrypted: Option<String> =
        sqlx::query_scalar("SELECT ciphertext FROM core_systemsecret WHERE key=$1")
            .bind(key)
            .fetch_optional(&mut **tx)
            .await?;
    if let Some(encrypted) = encrypted
        && same_secret(Some(&state.cipher.decrypt(&encrypted)?), Some(password))
    {
        return Ok(());
    }
    sqlx::query("INSERT INTO core_systemsecret(id,key,ciphertext) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,updated_at=NOW(),rotated_at=NOW()")
        .bind(Uuid::new_v4()).bind(key).bind(state.cipher.encrypt(password)?).execute(&mut **tx).await?;
    Ok(())
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
        && (config.host.parse::<std::net::IpAddr>().is_ok()
            || config.host.trim_end_matches('.').split('.').all(|label| {
                !label.is_empty()
                    && label.len() <= 63
                    && !label.starts_with('-')
                    && !label.ends_with('-')
                    && label
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-')
            }));
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

// All administrative writers share this transaction lock so enabling 2FA
// cannot race a change that disables its delivery infrastructure.
pub async fn lock_email_auth_config(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<(), AppError> {
    sqlx::query("SELECT pg_advisory_xact_lock(724851903)")
        .execute(&mut **tx)
        .await?;
    Ok(())
}

fn validate_email_2fa(
    config: &SmtpConfig,
    password: Option<&str>,
    production: bool,
    development_mailbox: bool,
) -> Result<(), AppError> {
    validate_email_2fa_proof(config, password, production, development_mailbox, true)
}
fn validate_email_2fa_proof(
    config: &SmtpConfig,
    password: Option<&str>,
    production: bool,
    development_mailbox: bool,
    require_recent: bool,
) -> Result<(), AppError> {
    if development_mailbox && !production {
        return Ok(());
    }
    if !config.enabled
        || validate_smtp(config).is_err()
        || !password.is_some_and(|value| !value.is_empty())
    {
        return Err(AppError::Validation(
            "Configure SMTP con TLS o STARTTLS y una contraseña antes de activar el acceso 2FA por correo.".into(),
        ));
    }
    if production && !smtp_test_valid(config, require_recent) {
        return Err(AppError::Validation(
            "En producción, envíe una prueba SMTP satisfactoria en las últimas 24 horas antes de activar el acceso 2FA por correo.".into(),
        ));
    }
    Ok(())
}

pub async fn require_email_2fa_ready(
    state: &AppState,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<(), AppError> {
    let mode: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT value FROM core_systemsetting WHERE key='mail_mode'")
            .fetch_optional(&mut **tx)
            .await?;
    if mode.is_some_and(|value| value["api_exclusive"] == true) {
        if !crate::mail_config::active_api_ready(state).await? {
            return Err(AppError::Validation(
                "Verifique la API de correo antes de activar 2FA.".into(),
            ));
        }
        return Ok(());
    }
    let (config, password) = smtp_in_transaction(state, tx).await?;
    validate_email_2fa(
        &config,
        password.as_deref(),
        env_true("APP_PRODUCTION"),
        env_true("DEV_EMAIL"),
    )
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
    let config = crate::google_oauth::config(state).await?;
    let secret = secret(state, "google_oauth_client_secret").await?.is_some();
    Ok(GoogleConfig {
        enabled: config.enabled && config.verified() && secret,
        client_id: config.client_id,
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
    Ok(smtp_from_env())
}

async fn smtp_in_transaction(
    state: &AppState,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<(SmtpConfig, Option<String>), AppError> {
    let value: Option<Value> =
        sqlx::query_scalar("SELECT value FROM core_systemsetting WHERE key='smtp'")
            .fetch_optional(&mut **tx)
            .await?;
    let Some(value) = value else {
        return Ok(smtp_from_env());
    };
    let config = serde_json::from_value(value).map_err(|_| AppError::Internal)?;
    let ciphertext: Option<String> =
        sqlx::query_scalar("SELECT ciphertext FROM core_systemsecret WHERE key='smtp_password'")
            .fetch_optional(&mut **tx)
            .await?;
    let password = ciphertext.map(|s| state.cipher.decrypt(&s)).transpose()?;
    Ok((config, password))
}

fn smtp_from_env() -> (SmtpConfig, Option<String>) {
    if std::env::var("EMAIL_HOST").unwrap_or_default().is_empty()
        && !std::env::var("CONTACT_SMTP_HOST")
            .unwrap_or_default()
            .is_empty()
    {
        let password = std::env::var("CONTACT_SMTP_PASSWORD_FILE")
            .ok()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .or_else(|| std::env::var("CONTACT_SMTP_PASSWORD").ok())
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        let recipient = crate::contact::mailbox().unwrap_or_default();
        return (
            SmtpConfig {
                enabled: true,
                host: std::env::var("CONTACT_SMTP_HOST").unwrap_or_default(),
                port: std::env::var("CONTACT_SMTP_PORT")
                    .ok()
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(587),
                security: std::env::var("CONTACT_SMTP_SECURITY")
                    .unwrap_or_else(|_| "STARTTLS".into()),
                username: std::env::var("CONTACT_SMTP_USER").unwrap_or_default(),
                from_email: std::env::var("CONTACT_SMTP_FROM")
                    .ok()
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| recipient.clone()),
                from_name: "UASSpain".into(),
                contact_recipient: recipient,
                timeout_seconds: 15,
                ..Default::default()
            },
            password,
        );
    }
    let username = std::env::var("EMAIL_HOST_USER").unwrap_or_default();
    let host = std::env::var("EMAIL_HOST").unwrap_or_default();
    let password = std::env::var("EMAIL_HOST_PASSWORD_FILE")
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .map(|s| s.trim().to_owned())
        .or_else(|| std::env::var("EMAIL_HOST_PASSWORD").ok())
        .filter(|s| !s.is_empty());
    (
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
    )
}
pub(crate) async fn secret(state: &AppState, key: &str) -> Result<Option<String>, AppError> {
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
    let mut view = smtp_view(&config, password.as_deref());
    if !crate::mail_config::api_exclusive(&state).await? {
        let mut tx = state
            .pool
            .as_ref()
            .ok_or(AppError::Unavailable)?
            .begin()
            .await?;
        if let Some((draft, candidate)) = smtp_draft(&state, &mut tx).await? {
            view = smtp_view(&draft, candidate.as_deref());
            view["pending_verification"] = json!(true);
            view["ready_to_activate"] = json!(smtp_test_valid(&draft, true));
            view["active_configured"] =
                smtp_view(&config, password.as_deref())["configured"].clone();
        }
    }
    Ok(Json(view))
}
pub async fn smtp_put(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(mut input): Json<SmtpWrite>,
) -> Result<Json<Value>, AppError> {
    let profile = admin(&state, &headers)?;
    if crate::mail_config::api_exclusive(&state).await? {
        return Err(AppError::Forbidden);
    }
    validate_smtp(&input.config)?;
    if input.password.len() > 4096 || input.password.starts_with("v1:") {
        return Err(AppError::Validation("Contraseña SMTP no válida.".into()));
    }
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let mut tx = pool.begin().await?;
    lock_email_auth_config(&mut tx).await?;
    let mode: Option<Value> =
        sqlx::query_scalar("SELECT value FROM core_systemsetting WHERE key='mail_mode'")
            .fetch_optional(&mut *tx)
            .await?;
    if mode.is_some_and(|v| v["api_exclusive"] == true) {
        return Err(AppError::Forbidden);
    }
    let (existing, existing_password) = smtp_in_transaction(&state, &mut tx).await?;
    let draft = smtp_draft(&state, &mut tx).await?;
    if input.password.is_empty() {
        // Preserve an environment-supplied password when adopting runtime config.
        input.password = draft
            .as_ref()
            .and_then(|(_, pw)| pw.clone())
            .or_else(|| existing_password.clone())
            .unwrap_or_default();
    }
    let changed = !same_smtp_transport(&existing, &input.config)
        || !same_secret(existing_password.as_deref(), Some(&input.password));
    input.config.last_test_ok = None;
    input.config.last_test_at = None;
    if !changed {
        input.config.last_test_ok = existing.last_test_ok;
        input.config.last_test_at = existing.last_test_at;
    }
    let two_factor_enabled: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM core_systemsetting WHERE key='auth_policy' AND value->>'enabled'='true') OR EXISTS(SELECT 1 FROM accounts_userprofile WHERE login_2fa_enabled_override IS TRUE)",
    ).fetch_one(&mut *tx).await?;
    let operating_smtp = existing.enabled
        && validate_smtp(&existing).is_ok()
        && existing_password
            .as_deref()
            .is_some_and(|password| !password.is_empty());
    if changed && (two_factor_enabled || (operating_smtp && input.config.enabled)) {
        if !input.config.enabled {
            return Err(AppError::Validation(
                "El canal SMTP necesario para 2FA no puede deshabilitarse.".into(),
            ));
        }
        let verified = draft.as_ref().filter(|(config, password)| {
            same_smtp_transport(config, &input.config)
                && same_secret(password.as_deref(), Some(&input.password))
                && smtp_test_valid(config, true)
        });
        if let Some((config, _)) = verified {
            input.config.last_test_ok = config.last_test_ok;
            input.config.last_test_at = config.last_test_at;
        } else {
            if !input.password.is_empty() {
                save_smtp_secret(&state, &mut tx, "smtp_password_candidate", &input.password)
                    .await?;
            }
            crate::mail_config::put_setting(
                &mut tx,
                "smtp_draft",
                json!(SmtpDraft {
                    config: input.config,
                    pending: true
                }),
            )
            .await?;
            crate::mail_config::audit_tx(
                &mut tx,
                profile,
                "smtp_draft_saved",
                json!({"active_transport_preserved":true}),
            )
            .await?;
            tx.commit().await?;
            return smtp_get(State(state), headers).await;
        }
    }
    if two_factor_enabled {
        validate_email_2fa_proof(
            &input.config,
            Some(input.password.as_str()),
            env_true("APP_PRODUCTION"),
            env_true("DEV_EMAIL"),
            false,
        )?;
    }
    if changed {
        let busy:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM mail_outbox WHERE provider='smtp' AND state IN ('PENDING','RETRY_SCHEDULED','PROCESSING'))").fetch_one(&mut *tx).await?;
        if busy {
            return Err(AppError::Validation("La cola SMTP tiene envíos pendientes o en curso. Se conserva el transporte operativo; espere a que finalicen antes de aplicar cambios de conexión o credenciales.".into()));
        }
    }
    if !input.password.is_empty() {
        save_smtp_secret(&state, &mut tx, "smtp_password", &input.password).await?;
    }
    sqlx::query("INSERT INTO core_systemsetting (id,created_date,updated_date,key,value) VALUES ($1,NOW(),NOW(),'smtp',$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_date=NOW()")
        .bind(Uuid::new_v4()).bind(json!(input.config)).execute(&mut *tx).await?;
    if draft.is_some() {
        crate::mail_config::put_setting(
            &mut tx,
            "smtp_draft",
            json!(SmtpDraft {
                config: input.config,
                pending: false
            }),
        )
        .await?;
    }
    tx.commit().await?;
    audit(&state, profile, "smtp_config_updated").await?;
    smtp_get(State(state), headers).await
}
#[derive(Deserialize)]
pub struct SmtpTest {
    pub recipient: String,
    #[serde(default)]
    pub confirm_rollback: bool,
}
pub async fn smtp_test(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<SmtpTest>,
) -> Result<Json<Value>, AppError> {
    let profile = admin(&state, &headers)?;
    if crate::mail_config::api_exclusive(&state).await? && !input.confirm_rollback {
        return Err(AppError::Forbidden);
    }
    crate::auth::enforce_login_rate(&headers, &format!("smtp-test:{profile}"))?;
    let mut tx = state
        .pool
        .as_ref()
        .ok_or(AppError::Unavailable)?
        .begin()
        .await?;
    lock_email_auth_config(&mut tx).await?;
    let api_active = crate::mail_config::api_exclusive(&state).await?;
    if api_active && !input.confirm_rollback {
        return Err(AppError::Forbidden);
    }
    let pending = if !api_active {
        smtp_draft(&state, &mut tx).await?
    } else {
        None
    };
    let testing_draft = pending.is_some();
    let (config, password) = if let Some(draft) = pending {
        draft
    } else {
        smtp_in_transaction(&state, &mut tx).await?
    };
    if !config.enabled || password.is_none() {
        return Err(AppError::Unavailable);
    }
    let envelope = crate::mail_provider::Envelope {
        from: config.from_email.clone(),
        from_name: config.from_name.clone(),
        to: input.recipient,
        reply_to: None,
        subject: "Prueba de correo UASSpain".into(),
        body: "Prueba autorizada del canal SMTP.".into(),
        smtp: Some(config.clone()),
    };
    let id = crate::mail_queue::enqueue_explicit(
        &state,
        &mut tx,
        "smtp",
        &envelope,
        crate::mail_queue::QueueOptions {
            kind: "provider_test",
            ttl: chrono::Duration::minutes(5),
            validity: json!({}),
            idempotency: None,
        },
    )
    .await?;
    tx.commit().await?;
    let result = if testing_draft {
        crate::mail_queue::process_smtp_candidate_test(
            &state,
            id,
            password.as_deref().unwrap_or_default(),
        )
        .await?
    } else {
        crate::mail_queue::process_test(&state, id, password.as_deref().unwrap_or_default()).await?
    };
    let success = matches!(result, crate::mail_provider::Outcome::Accepted(_));
    let mut tx = state
        .pool
        .as_ref()
        .ok_or(AppError::Unavailable)?
        .begin()
        .await?;
    lock_email_auth_config(&mut tx).await?;
    let (latest, latest_password) = if testing_draft {
        smtp_draft(&state, &mut tx)
            .await?
            .ok_or(AppError::EditConflict)?
    } else {
        smtp_in_transaction(&state, &mut tx).await?
    };
    let same_password: bool = subtle::ConstantTimeEq::ct_eq(
        latest_password.as_deref().unwrap_or_default().as_bytes(),
        password.as_deref().unwrap_or_default().as_bytes(),
    )
    .into();
    if json!(latest) != json!(config) || !same_password {
        return Err(AppError::EditConflict);
    }
    // Testing can adopt environment configuration. Preserve its credential in
    // the same transaction; a saved setting must never lose its tested secret.
    let secret_key = if testing_draft {
        "smtp_password_candidate"
    } else {
        "smtp_password"
    };
    let stored: Option<String> =
        sqlx::query_scalar("SELECT ciphertext FROM core_systemsecret WHERE key=$1")
            .bind(secret_key)
            .fetch_optional(&mut *tx)
            .await?;
    if let Some(stored) = stored {
        let existing = state.cipher.decrypt(&stored)?;
        let unchanged: bool = subtle::ConstantTimeEq::ct_eq(
            existing.as_bytes(),
            password.as_deref().unwrap_or_default().as_bytes(),
        )
        .into();
        if !unchanged {
            return Err(AppError::EditConflict);
        }
    } else if let Some(password) = &password {
        sqlx::query("INSERT INTO core_systemsecret(id,key,ciphertext) VALUES($1,$2,$3)")
            .bind(Uuid::new_v4())
            .bind(secret_key)
            .bind(state.cipher.encrypt(password)?)
            .execute(&mut *tx)
            .await?;
    }
    let mut config = config;
    config.last_test_ok = Some(success);
    config.last_test_at = Some(chrono::Utc::now());
    if testing_draft {
        crate::mail_config::put_setting(
            &mut tx,
            "smtp_draft",
            json!(SmtpDraft {
                config,
                pending: true
            }),
        )
        .await?;
    } else {
        crate::mail_config::put_setting(&mut tx, "smtp", json!(config)).await?;
    }
    crate::mail_config::audit_tx(
        &mut tx,
        profile,
        if success {
            "smtp_test_success"
        } else {
            "smtp_test_failed"
        },
        json!({"outbox_id":id}),
    )
    .await?;
    tx.commit().await?;
    if !success {
        return Err(AppError::Unavailable);
    }
    Ok(Json(
        json!({"ok":true,"state":"ACCEPTED","message_id":id,"detail":"El servidor SMTP ha aceptado la prueba. La recepcion final requiere comprobacion del buzon."}),
    ))
}

pub fn google_view(config: GoogleConfig) -> Value {
    let configured = config.enabled && !config.client_id.is_empty();
    let origin = crate::google_oauth::trusted_origin().ok();
    let origins: Vec<String> = origin.iter().cloned().collect();
    json!({"enabled":config.enabled,"configured":configured,"client_id":config.client_id,"origins":origins,"public_origin":origin,"redirect_uri":origin.as_ref().map(|value|format!("{value}/auth/google/callback"))})
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
    fn valid_smtp_fixture() -> SmtpConfig {
        SmtpConfig {
            enabled: true,
            host: "mail.example.invalid".into(),
            port: 587,
            security: "STARTTLS".into(),
            username: "fixture@example.invalid".into(),
            from_email: "fixture@example.invalid".into(),
            timeout_seconds: 5,
            ..Default::default()
        }
    }
    #[test]
    fn harmless_smtp_metadata_preserves_transport_evidence() {
        let base = valid_smtp_fixture();
        let mut metadata = base.clone();
        metadata.provider = "Display label".into();
        metadata.from_name = "Corporate display name".into();
        metadata.contact_recipient = "contact@example.invalid".into();
        assert!(same_smtp_transport(&base, &metadata));
        for field in [
            "host",
            "port",
            "security",
            "username",
            "from_email",
            "timeout_seconds",
            "enabled",
        ] {
            let mut value = json!(base);
            value[field] = match field {
                "port" => json!(465),
                "timeout_seconds" => json!(30),
                "enabled" => json!(false),
                "security" => json!("TLS"),
                _ => json!("changed.example.invalid"),
            };
            let changed: SmtpConfig = serde_json::from_value(value).unwrap();
            assert!(!same_smtp_transport(&base, &changed), "{field}");
        }
        assert!(same_secret(Some("fixture"), Some("fixture")));
        assert!(!same_secret(Some("fixture"), Some("new-fixture")));
    }
    #[test]
    fn historical_smtp_proof_keeps_existing_2fa_without_loosening_new_activation() {
        let mut config = valid_smtp_fixture();
        config.last_test_ok = Some(true);
        config.last_test_at = Some(chrono::Utc::now() - chrono::Duration::days(2));
        assert!(validate_email_2fa(&config, Some("fixture"), true, false).is_err());
        assert!(validate_email_2fa_proof(&config, Some("fixture"), true, false, false).is_ok());
        assert!(!smtp_test_valid(&config, true));
        assert!(smtp_test_valid(&config, false));
        config.last_test_at = Some(chrono::Utc::now() + chrono::Duration::hours(1));
        assert!(validate_email_2fa_proof(&config, Some("fixture"), true, true, false).is_err());
        assert!(validate_email_2fa_proof(&SmtpConfig::default(), None, true, true, false).is_err());
    }
    #[tokio::test]
    #[ignore = "requires the dedicated marked disposable mail-repair database; never the operational database"]
    async fn mail_repair_preserves_active_transport_credentials_2fa_and_history() {
        let url = std::env::var("MAIL_REPAIR_TEST_DATABASE_URL").expect("dedicated fixture URL");
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(4)
            .connect(&url)
            .await
            .unwrap();
        let marker: Option<String> =
            sqlx::query_scalar("SELECT current_setting('uasspain.mail_fixture',true)")
                .fetch_one(&pool)
                .await
                .unwrap();
        let database: String = sqlx::query_scalar("SELECT current_database()")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(database, "test_e2e_uasspain");
        assert_eq!(marker.as_deref(), Some("mail-repair-20261025"));
        assert!(env_true("APP_PRODUCTION"));
        assert!(!env_true("DEV_EMAIL"));
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let actor = Uuid::new_v4();
        sqlx::query("INSERT INTO accounts_userprofile(id,created_date,updated_date,nombre,apellidos,email,username,dni_nie,foto_perfil,status,role,otp_hash,otp_verified,roles,username_lookup,email_lookup,dni_lookup,fecha_nacimiento,session_role) VALUES($1,NOW(),NOW(),'Mail','Fixture','fixture@example.invalid','fixture','','','activo','admin','',true,'[\"admin\"]','fixture-mail-user','fixture-mail-email','','','admin')").bind(actor).execute(&pool).await.unwrap();
        let mut state = AppState::for_test();
        state.pool = Some(pool.clone());
        let state = Arc::new(state);
        // Handler integration only: the fixture signs the same internal claims as
        // TokenService::for_test; HTTP middleware still rejects external headers.
        let now = chrono::Utc::now().timestamp() as usize;
        let claims = crate::auth::Claims {
            user_id: 0,
            profile_id: actor,
            role: "admin".into(),
            token_type: "access".into(),
            exp: now + 3600,
            iat: now,
            jti: Uuid::new_v4(),
            session_key: String::new(),
        };
        let jwt = jsonwebtoken::encode(
            &jsonwebtoken::Header::default(),
            &claims,
            &jsonwebtoken::EncodingKey::from_secret(
                b"test-only-not-for-production-test-only-not-for-production",
            ),
        )
        .unwrap();
        let mut headers = HeaderMap::new();
        headers.insert("x-uasspain-verified-session", jwt.parse().unwrap());
        let mut active = valid_smtp_fixture();
        active.last_test_ok = Some(true);
        active.last_test_at = Some(chrono::Utc::now() - chrono::Duration::days(2));
        let mut tx = pool.begin().await.unwrap();
        crate::mail_config::put_setting(&mut tx, "smtp", json!(active))
            .await
            .unwrap();
        crate::mail_config::put_setting(&mut tx, "mail_mode", json!({"api_exclusive":false}))
            .await
            .unwrap();
        crate::mail_config::put_setting(&mut tx, "auth_policy", json!({"enabled":true}))
            .await
            .unwrap();
        save_smtp_secret(&state, &mut tx, "smtp_password", "initial-fixture-password")
            .await
            .unwrap();
        crate::mail_config::audit_tx(
            &mut tx,
            actor,
            "preserved_fixture_audit",
            json!({"preserve":true}),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
        let ciphertext: String = sqlx::query_scalar(
            "SELECT ciphertext FROM core_systemsecret WHERE key='smtp_password'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let mut innocuous = active.clone();
        innocuous.from_name = "Saved corporate display name".into();
        innocuous.last_test_ok = Some(false); // Client proof is never authoritative.
        let _ = smtp_put(
            State(state.clone()),
            headers.clone(),
            Json(SmtpWrite {
                config: innocuous,
                password: String::new(),
            }),
        )
        .await
        .unwrap();
        let (saved, pw) = smtp(&state).await.unwrap();
        assert_eq!(saved.last_test_at, active.last_test_at);
        assert_eq!(saved.last_test_ok, Some(true));
        assert_eq!(pw.as_deref(), Some("initial-fixture-password"));
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT ciphertext FROM core_systemsecret WHERE key='smtp_password'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            ciphertext
        );
        let mut candidate = saved.clone();
        candidate.host = "new-smtp.example.invalid".into();
        let view = smtp_put(
            State(state.clone()),
            headers.clone(),
            Json(SmtpWrite {
                config: candidate.clone(),
                password: "new-fixture-password".into(),
            }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(view["pending_verification"], true);
        assert_eq!(view["ready_to_activate"], false);
        assert_eq!(smtp(&state).await.unwrap().0.host, saved.host);
        assert_eq!(
            smtp(&state).await.unwrap().1.as_deref(),
            Some("initial-fixture-password")
        );
        candidate.last_test_ok = Some(true);
        candidate.last_test_at = Some(chrono::Utc::now());
        let view = smtp_put(
            State(state.clone()),
            headers.clone(),
            Json(SmtpWrite {
                config: candidate.clone(),
                password: String::new(),
            }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(
            view["ready_to_activate"], false,
            "forged client timestamps cannot promote a draft"
        );
        let mut disabled = candidate.clone();
        disabled.enabled = false;
        assert!(
            smtp_put(
                State(state.clone()),
                headers.clone(),
                Json(SmtpWrite {
                    config: disabled,
                    password: String::new()
                })
            )
            .await
            .is_err()
        );
        // Synthetic provider-test success: exercise promotion policy without
        // transmitting an email or claiming actual mailbox delivery.
        let mut tx = pool.begin().await.unwrap();
        crate::mail_config::put_setting(
            &mut tx,
            "smtp_draft",
            json!(SmtpDraft {
                config: candidate.clone(),
                pending: true
            }),
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
        let view = smtp_put(
            State(state.clone()),
            headers.clone(),
            Json(SmtpWrite {
                config: candidate,
                password: String::new(),
            }),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(view.get("pending_verification"), None);
        assert_eq!(
            smtp(&state).await.unwrap().0.host,
            "new-smtp.example.invalid"
        );
        assert_eq!(
            smtp(&state).await.unwrap().1.as_deref(),
            Some("new-fixture-password")
        );
        assert_eq!(
            setting(&state, "auth_policy").await.unwrap().unwrap()["enabled"],
            true
        );
        let api = crate::mail_config::ApiConfig {
            sender_panel_confirmed: false,
            verified_at: Some(chrono::Utc::now() - chrono::Duration::days(2)),
            verification_message_id: Some(Uuid::new_v4()),
            ..Default::default()
        };
        let mut tx = pool.begin().await.unwrap();
        crate::mail_config::put_setting(&mut tx, "mail_api", json!(api))
            .await
            .unwrap();
        crate::mail_config::put_setting(&mut tx, "mail_api_draft", json!(api))
            .await
            .unwrap();
        crate::mail_config::put_setting(&mut tx, "mail_mode", json!({"api_exclusive":true}))
            .await
            .unwrap();
        save_smtp_secret(
            &state,
            &mut tx,
            "postmark_server_token",
            "isolated-never-transmitted-provider-token",
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        require_email_2fa_ready(&state, &mut tx).await.unwrap();
        tx.rollback().await.unwrap();
        let status = crate::mail_config::status(&state).await.unwrap();
        assert_eq!(status["sender_status"], "UNCONFIRMED");
        assert_eq!(status["provider_verified"], true);
        assert_eq!(status["activation_ready"], false);
        assert_eq!(status["channel_ready"], true);
        let general = crate::system_status::status(State(state.clone()), headers.clone())
            .await
            .unwrap()
            .0;
        assert_eq!(general.mail["sender_status"], status["sender_status"]);
        assert_eq!(general.mail["channel_ready"], status["channel_ready"]);
        sqlx::query("UPDATE mail_circuit SET state='OPEN',failures=17,opened_at=NOW() WHERE provider='postmark'").execute(&pool).await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        assert!(require_email_2fa_ready(&state, &mut tx).await.is_err());
        tx.rollback().await.unwrap();
        // Queueing with API selected never silently falls back to SMTP.
        let mut tx = pool.begin().await.unwrap();
        let id = crate::mail_queue::enqueue(
            &state,
            &mut tx,
            crate::mail_queue::MailRequest {
                to: "fixture@example.invalid",
                reply_to: None,
                subject: "Fixture only",
                body: "Never delivered",
                options: crate::mail_queue::QueueOptions {
                    kind: "fixture",
                    ttl: chrono::Duration::minutes(1),
                    validity: json!({}),
                    idempotency: None,
                },
            },
        )
        .await
        .unwrap();
        let provider: String = sqlx::query_scalar("SELECT provider FROM mail_outbox WHERE id=$1")
            .bind(id)
            .fetch_one(&mut *tx)
            .await
            .unwrap();
        assert_eq!(provider, "postmark");
        tx.rollback().await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        crate::mail_config::put_setting(&mut tx, "mail_mode", json!({"api_exclusive":false}))
            .await
            .unwrap();
        tx.commit().await.unwrap();
        let mut old = api;
        old.sender_panel_confirmed = true;
        assert!(
            crate::mail_config::put(
                State(state.clone()),
                headers,
                Json(crate::mail_config::Write {
                    api_exclusive: true,
                    config: old.clone(),
                    api_key: String::new(),
                    confirm_rollback: false
                })
            )
            .await
            .is_err()
        );
        assert!(!crate::mail_config::api_exclusive(&state).await.unwrap());
        old.verified_at = Some(chrono::Utc::now() - chrono::Duration::minutes(1));
        let mut tx = pool.begin().await.unwrap();
        crate::mail_config::put_setting(&mut tx, "mail_api", json!(old))
            .await
            .unwrap();
        crate::mail_config::put_setting(&mut tx, "mail_api_draft", json!(old))
            .await
            .unwrap();
        tx.commit().await.unwrap();
        let mut headers = HeaderMap::new();
        headers.insert("x-uasspain-verified-session", jwt.parse().unwrap());
        let rejected = crate::mail_config::put(
            State(state.clone()),
            headers,
            Json(crate::mail_config::Write {
                api_exclusive: true,
                config: old,
                api_key: String::new(),
                confirm_rollback: false,
            }),
        )
        .await;
        assert!(
            matches!(rejected,Err(AppError::Validation(message)) if message.starts_with("Guarde la configuración API")),
            "even a fresh proof must not activate a known blocked provider"
        );
        let audit: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM core_auditlog WHERE action='preserved_fixture_audit'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(audit, 1);
        let messages: i64 = sqlx::query_scalar("SELECT count(*) FROM mail_outbox")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            messages, 0,
            "no SMTP/API test delivery or destructive queue change was performed"
        );
    }
    #[test]
    fn email_2fa_requires_enabled_valid_smtp_and_password() {
        let config = valid_smtp_fixture();
        assert!(validate_email_2fa(&config, Some("fixture"), false, false).is_ok());
        for password in [None, Some("")] {
            assert!(validate_email_2fa(&config, password, false, false).is_err());
        }
        for config in [
            SmtpConfig {
                enabled: false,
                ..config.clone()
            },
            SmtpConfig {
                port: 0,
                ..config.clone()
            },
            SmtpConfig {
                security: "NONE".into(),
                ..config.clone()
            },
            SmtpConfig {
                from_email: "invalid".into(),
                ..config
            },
        ] {
            assert!(validate_email_2fa(&config, Some("fixture"), false, false).is_err());
        }
    }
    #[test]
    fn production_email_2fa_requires_recent_successful_transport_test() {
        let mut config = valid_smtp_fixture();
        assert!(validate_email_2fa(&config, Some("fixture"), true, false).is_err());
        config.last_test_ok = Some(true);
        assert!(validate_email_2fa(&config, Some("fixture"), true, false).is_err());
        config.last_test_at = Some(chrono::Utc::now());
        assert!(validate_email_2fa(&config, Some("fixture"), true, false).is_ok());
        config.last_test_ok = Some(false);
        assert!(validate_email_2fa(&config, Some("fixture"), true, false).is_err());
        config.last_test_ok = Some(true);
        for at in [
            chrono::Utc::now() - chrono::Duration::hours(25),
            chrono::Utc::now() + chrono::Duration::minutes(1),
        ] {
            config.last_test_at = Some(at);
            assert!(validate_email_2fa(&config, Some("fixture"), true, false).is_err());
        }
    }
    #[test]
    fn development_mailbox_never_bypasses_production_smtp_gate() {
        assert!(validate_email_2fa(&SmtpConfig::default(), None, false, true).is_ok());
        assert!(validate_email_2fa(&SmtpConfig::default(), None, true, true).is_err());
    }
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
    #[test]
    fn smtp_host_requires_a_valid_dns_name_or_ip_address() {
        let mut config = valid_smtp_fixture();
        for host in [
            "mail..example.invalid",
            "mail-.invalid",
            "-mail.invalid",
            ":",
            "mail.invalid:587",
            "...",
        ] {
            config.host = host.into();
            assert!(validate_smtp(&config).is_err());
        }
        for host in ["mail.example.invalid", "localhost", "127.0.0.1", "::1"] {
            config.host = host.into();
            assert!(validate_smtp(&config).is_ok());
        }
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
