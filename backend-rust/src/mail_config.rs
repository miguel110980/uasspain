use crate::{
    AppState,
    auth::{authenticate, require_role},
    error::AppError,
    runtime_config,
};
use axum::{Json, extract::State, http::HeaderMap};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{Postgres, Transaction};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(default)]
pub struct ApiConfig {
    pub provider: String,
    pub from_email: String,
    pub from_name: String,
    pub contact_recipient: String,
    pub sender_panel_confirmed: bool,
    pub verified_at: Option<DateTime<Utc>>,
    pub verification_message_id: Option<Uuid>,
}
impl Default for ApiConfig {
    fn default() -> Self {
        Self {
            provider: "postmark".into(),
            from_email: "no-reply@uasspain.com".into(),
            from_name: "UASSpain".into(),
            contact_recipient: "info@uasspain.com".into(),
            sender_panel_confirmed: false,
            verified_at: None,
            verification_message_id: None,
        }
    }
}
impl ApiConfig {
    fn validate(&self) -> Result<(), AppError> {
        if self.provider != "postmark"
            || crate::mail_provider::address(&self.from_email)?.domain() != "uasspain.com"
            || self.from_name.len() > 120
            || self.from_name.chars().any(char::is_control)
        {
            return Err(AppError::Validation(
                "Seleccione Postmark y un remitente autorizado @uasspain.com.".into(),
            ));
        }
        crate::mail_provider::address(&self.contact_recipient)?;
        Ok(())
    }
    pub fn verified(&self) -> bool {
        self.verified_at.is_some_and(|at| {
            let age = Utc::now() - at;
            age >= chrono::Duration::zero() && age < chrono::Duration::hours(24)
        }) && self.verification_message_id.is_some()
    }
}
pub async fn api_config(state: &AppState, draft: bool) -> Result<ApiConfig, AppError> {
    let key = if draft { "mail_api_draft" } else { "mail_api" };
    if let Some(value) = runtime_config::setting(state, key).await? {
        return serde_json::from_value(value).map_err(|_| AppError::Internal);
    }
    if draft && let Some(value) = runtime_config::setting(state, "mail_api").await? {
        return serde_json::from_value(value).map_err(|_| AppError::Internal);
    }
    let from = std::env::var("POSTMARK_FROM")
        .ok()
        .filter(|v| !v.is_empty());
    let contact = crate::contact::mailbox()?;
    Ok(ApiConfig {
        from_email: from.unwrap_or_else(|| "no-reply@uasspain.com".into()),
        contact_recipient: contact,
        ..Default::default()
    })
}
pub async fn api_exclusive(state: &AppState) -> Result<bool, AppError> {
    Ok(runtime_config::setting(state, "mail_mode")
        .await?
        .is_some_and(|v| v["api_exclusive"] == true))
}
pub async fn token(state: &AppState, draft: bool) -> Result<Option<String>, AppError> {
    if draft && let Some(value) = runtime_config::secret(state, "postmark_candidate").await? {
        return Ok(Some(value));
    }
    if let Some(value) = runtime_config::secret(state, "postmark_server_token").await? {
        return Ok(Some(value));
    }
    let value = if let Ok(path) = std::env::var("POSTMARK_SERVER_TOKEN_FILE") {
        std::fs::read_to_string(path).map_err(|_| AppError::Unavailable)?
    } else {
        std::env::var("POSTMARK_SERVER_TOKEN").unwrap_or_default()
    };
    Ok((!value.trim().is_empty()).then(|| value.trim().to_owned()))
}
pub fn admin(state: &AppState, headers: &HeaderMap) -> Result<Uuid, AppError> {
    let claims = authenticate(state, headers, "access")?;
    require_role(&claims, &["admin"])?;
    Ok(claims.profile_id)
}
pub async fn put_setting(
    tx: &mut Transaction<'_, Postgres>,
    key: &str,
    value: Value,
) -> Result<(), AppError> {
    sqlx::query("INSERT INTO core_systemsetting(id,created_date,updated_date,key,value) VALUES($1,NOW(),NOW(),$2,$3) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_date=NOW()")
        .bind(Uuid::new_v4()).bind(key).bind(value).execute(&mut **tx).await?;
    Ok(())
}
async fn put_secret(
    state: &AppState,
    tx: &mut Transaction<'_, Postgres>,
    key: &str,
    value: &str,
) -> Result<(), AppError> {
    sqlx::query("INSERT INTO core_systemsecret(id,key,ciphertext) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,updated_at=NOW(),rotated_at=NOW()")
        .bind(Uuid::new_v4()).bind(key).bind(state.cipher.encrypt(value)?).execute(&mut **tx).await?;
    Ok(())
}
pub async fn get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    admin(&state, &headers)?;
    let config = api_config(&state, true).await?;
    let key_configured = token(&state, true).await?.is_some();
    Ok(Json(
        json!({"api_exclusive":api_exclusive(&state).await?,"config":config,"key_configured":key_configured,
        "sender_status":if config.verified(){"VERIFIED"}else if config.sender_panel_confirmed{"PENDING_VERIFICATION"}else{"UNCONFIRMED"},
        "account_api":"NOT_PROVIDED","real_inbox_reception":"BLOCKED_EXTERNAL","real_reply_to_validation":"BLOCKED_EXTERNAL"}),
    ))
}
#[derive(Deserialize)]
pub struct Write {
    pub api_exclusive: bool,
    pub config: ApiConfig,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub confirm_rollback: bool,
}
pub async fn put(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(mut input): Json<Write>,
) -> Result<Json<Value>, AppError> {
    let actor = admin(&state, &headers)?;
    input.config.validate()?;
    if input.api_key.len() > 4096
        || input.api_key.starts_with("v1:")
        || input.api_key.chars().any(char::is_control)
        || input.api_key == "POSTMARK_API_TEST"
    {
        return Err(AppError::Validation("API Key no válida.".into()));
    }
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let mut tx = pool.begin().await?;
    runtime_config::lock_email_auth_config(&mut tx).await?;
    let current: Option<Value> =
        sqlx::query_scalar("SELECT value FROM core_systemsetting WHERE key='mail_api'")
            .fetch_optional(&mut *tx)
            .await?;
    let verified = current
        .clone()
        .and_then(|v| serde_json::from_value::<ApiConfig>(v).ok());
    let previous: Option<Value> =
        sqlx::query_scalar("SELECT value FROM core_systemsetting WHERE key='mail_mode'")
            .fetch_optional(&mut *tx)
            .await?;
    let was_api = previous
        .as_ref()
        .is_some_and(|v| v["api_exclusive"] == true);
    let pending_key: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM core_systemsecret WHERE key='postmark_candidate')",
    )
    .fetch_one(&mut *tx)
    .await?;
    // Trust neither a submitted timestamp nor a submitted provider message ID.
    input.config.verified_at = None;
    input.config.verification_message_id = None;
    let same = verified.as_ref().is_some_and(|c| {
        c.from_email == input.config.from_email
            && c.from_name == input.config.from_name
            && c.provider == input.config.provider
    });
    if same
        && input.api_key.is_empty()
        && !pending_key
        && let Some(c) = &verified
    {
        input.config.verified_at = c.verified_at;
        input.config.verification_message_id = c.verification_message_id;
    }
    if input.api_exclusive
        && !was_api
        && (!input.api_key.is_empty() || !same || !input.config.verified())
    {
        return Err(AppError::Validation("Guarde la configuración API sin activarla y verifique credenciales y remitente mediante una prueba autorizada antes de conmutar.".into()));
    }
    if !input.api_key.is_empty() {
        put_secret(&state, &mut tx, "postmark_candidate", &input.api_key).await?;
    }
    put_setting(&mut tx, "mail_api_draft", json!(input.config)).await?;
    if same && input.api_key.is_empty() && !pending_key {
        put_setting(&mut tx, "mail_api", json!(input.config)).await?;
    }
    if was_api && !input.api_exclusive {
        if !input.confirm_rollback {
            return Err(AppError::Validation("Confirme expresamente la reversión a SMTP. Se conservarán la cola y las credenciales API.".into()));
        }
        let (smtp, password) = runtime_config::smtp(&state).await?;
        if !smtp.enabled
            || password.is_none()
            || smtp.last_test_ok != Some(true)
            || smtp
                .last_test_at
                .is_none_or(|at| Utc::now() - at > chrono::Duration::hours(24))
        {
            return Err(AppError::Validation("Compruebe SMTP con una prueba autorizada antes de cambiar el canal activo. La configuración API se conserva.".into()));
        }
        crate::mail_migration::transition(
            &mut tx,
            "ROLLBACK_REQUIRED",
            json!({"source":"explicit_admin_request"}),
            Some(actor),
        )
        .await?;
        crate::mail_migration::transition(&mut tx,"ROLLBACK_IN_PROGRESS",json!({"source":"authorized_non_destructive_rollback","smtp_test_at":smtp.last_test_at}),Some(actor)).await?;
    }
    if was_api != input.api_exclusive {
        let moved =
            crate::mail_queue::move_pending(&state, &mut tx, input.api_exclusive, &input.config)
                .await?;
        audit_tx(
            &mut tx,
            actor,
            "mail_pending_channel_changed",
            json!({"eligible_messages":moved,"uncertain_or_accepted_untouched":true}),
        )
        .await?;
    }
    put_setting(
        &mut tx,
        "mail_mode",
        json!({"api_exclusive":input.api_exclusive}),
    )
    .await?;
    let phase: Option<String> = sqlx::query_scalar("SELECT last_passed FROM mail_migration")
        .fetch_optional(&mut *tx)
        .await?;
    if phase.as_deref() == Some("DATA_VERIFIED")
        && (!input.api_key.is_empty() || token(&state, true).await?.is_some())
    {
        crate::mail_migration::transition(&mut tx,"API_CONFIGURED",json!({"source":"saved_provider_configuration","provider":"postmark","secret_available":true}),Some(actor)).await?;
    }
    if input.api_exclusive && !was_api {
        crate::mail_migration::transition(
            &mut tx,
            "CUTOVER_READY",
            json!({"source":"provider_test","outbox_id":input.config.verification_message_id}),
            Some(actor),
        )
        .await?;
        crate::mail_migration::transition(
            &mut tx,
            "API_ACTIVE",
            json!({"source":"atomic_channel_selection","fallback":false}),
            Some(actor),
        )
        .await?;
    }
    if was_api && !input.api_exclusive {
        crate::mail_migration::transition(&mut tx,"ROLLED_BACK",json!({"source":"atomic_channel_selection_after_smtp_check","queued_messages_preserved":true}),Some(actor)).await?;
    }
    audit_tx(
        &mut tx,
        actor,
        "mail_configuration_saved",
        json!({"api_exclusive":input.api_exclusive,"candidate_key":!input.api_key.is_empty()}),
    )
    .await?;
    tx.commit().await?;
    get(State(state), headers).await
}
pub async fn audit_tx(
    tx: &mut Transaction<'_, Postgres>,
    actor: Uuid,
    action: &str,
    evidence: Value,
) -> Result<(), AppError> {
    sqlx::query("INSERT INTO core_auditlog(id,created_date,updated_date,model_name,instance_id,action,extra,profile_id) VALUES($1,NOW(),NOW(),'MailSystem','',$2,$3,$4)")
        .bind(Uuid::new_v4()).bind(action).bind(evidence).bind(actor).execute(&mut **tx).await?;
    Ok(())
}
#[derive(Deserialize)]
pub struct Test {
    pub recipient: String,
    pub confirm_authorized_recipient: bool,
}
pub async fn test(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<Test>,
) -> Result<Json<Value>, AppError> {
    let actor = admin(&state, &headers)?;
    crate::auth::enforce_login_rate(&headers, &format!("mail-api-test:{actor}"))?;
    crate::mail_provider::address(&input.recipient)?;
    let mut tx = state
        .pool
        .as_ref()
        .ok_or(AppError::Unavailable)?
        .begin()
        .await?;
    runtime_config::lock_email_auth_config(&mut tx).await?;
    let mut config = api_config(&state, true).await?;
    if !config.sender_panel_confirmed || !input.confirm_authorized_recipient {
        return Err(AppError::Validation("Confirme primero el remitente en el panel de Postmark y autorice el destinatario de prueba.".into()));
    }
    let phase: Option<String> = sqlx::query_scalar("SELECT last_passed FROM mail_migration")
        .fetch_optional(&mut *tx)
        .await?;
    if phase.as_deref() != Some("API_CONFIGURED")
        && phase.as_deref() != Some("API_VERIFIED")
        && phase.as_deref() != Some("API_ACTIVE")
    {
        return Err(AppError::Validation("Complete primero la auditoría, el backup recuperado y la verificación de datos de la migración.".into()));
    }
    let candidate_token = token(&state, true).await?.ok_or(AppError::Unavailable)?;
    crate::mail_provider::check_server(&candidate_token).await?;
    let envelope=crate::mail_provider::Envelope{from:config.from_email.clone(),from_name:config.from_name.clone(),to:input.recipient,reply_to:None,subject:"Prueba autorizada UASSpain".into(),body:"Prueba del canal transaccional de UASSpain. La aceptación del proveedor no acredita recepción en el buzón.".into(),smtp:None};
    let id = crate::mail_queue::enqueue_explicit(
        &state,
        &mut tx,
        "postmark",
        &envelope,
        crate::mail_queue::QueueOptions {
            kind: "provider_test",
            ttl: chrono::Duration::minutes(5),
            validity: json!({}),
            idempotency: None,
        },
    )
    .await?;
    // Persist PROCESSING before the external side effect. A crash is UNKNOWN,
    // never an automatic resend. Configuration changes remain locked below.
    tx.commit().await?;
    let result = crate::mail_queue::process_test(&state, id, &candidate_token).await?;
    if !matches!(result, crate::mail_provider::Outcome::Accepted(Some(_))) {
        return Err(AppError::Unavailable);
    }
    let mut tx = state
        .pool
        .as_ref()
        .ok_or(AppError::Unavailable)?
        .begin()
        .await?;
    runtime_config::lock_email_auth_config(&mut tx).await?;
    let latest = api_config(&state, true).await?;
    let latest_token = token(&state, true).await?.ok_or(AppError::Unavailable)?;
    let same_token: bool =
        subtle::ConstantTimeEq::ct_eq(latest_token.as_bytes(), candidate_token.as_bytes()).into();
    if latest != config || !same_token {
        return Err(AppError::EditConflict);
    }
    config.verified_at = Some(Utc::now());
    config.verification_message_id = Some(id);
    put_secret(&state, &mut tx, "postmark_server_token", &candidate_token).await?;
    // Remove only the candidate slot whose exact value was successfully tested.
    sqlx::query("DELETE FROM core_systemsecret WHERE key='postmark_candidate'")
        .execute(&mut *tx)
        .await?;
    put_setting(&mut tx, "mail_api", json!(config)).await?;
    put_setting(&mut tx, "mail_api_draft", json!(config)).await?;
    if phase.as_deref() == Some("API_CONFIGURED") {
        crate::mail_migration::transition(
            &mut tx,
            "API_VERIFIED",
            json!({"source":"postmark_live_api","outbox_id":id,"sender":config.from_email}),
            Some(actor),
        )
        .await?;
    }
    audit_tx(
        &mut tx,
        actor,
        "mail_api_verified",
        json!({"outbox_id":id,"provider":"postmark"}),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(
        json!({"ok":true,"message_id":id,"state":"ACCEPTED","detail":"Postmark ha aceptado la prueba. Falta comprobar la recepción real en el buzón."}),
    ))
}
