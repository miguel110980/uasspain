use crate::{
    AppState,
    auth::{authenticate, require_role},
    error::AppError,
};
use axum::{Json, extract::State, http::HeaderMap};
use serde_json::{Value, json};
use sqlx::{Postgres, Transaction};
use std::sync::Arc;
use uuid::Uuid;

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

pub async fn get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    admin(&state, &headers)?;
    Ok(Json(status(&state).await?))
}

pub async fn circuit_ready(state: &AppState, provider: &str) -> Result<bool, AppError> {
    let Some(pool) = &state.pool else {
        return Ok(false);
    };
    let circuit: Option<String> =
        sqlx::query_scalar("SELECT state FROM mail_circuit WHERE provider=$1")
            .bind(provider)
            .fetch_optional(pool)
            .await?;
    Ok(circuit.is_none_or(|value| value == "CLOSED"))
}

pub async fn status(state: &AppState) -> Result<Value, AppError> {
    let contact = crate::smtp_services::view(state, crate::smtp_services::Service::Contact).await?;
    let automatic =
        crate::smtp_services::view(state, crate::smtp_services::Service::Automatic).await?;
    let api = crate::smtp_services::api_mode(state).await?;
    let ready = !api && contact["active_ready"] == true && automatic["active_ready"] == true;
    let configured = contact["configured"] == true && automatic["configured"] == true;
    let verified = contact["verification_status"] == "ACCEPTED"
        && automatic["verification_status"] == "ACCEPTED";
    // Legacy API settings and encrypted credentials remain stored, but are never
    // used for SMTP delivery. A saved API mode blocks switching pending authorization.
    Ok(json!({
        "provider":if api {"blocked_api_mode"} else {"smtp"}, "api_exclusive":api, "api_enabled":false,
        "services":{"contact":contact,"automatic":automatic},"api_mode_blocked":api,
        "channel_ready":ready, "configured":configured,
        "provider_verified":verified, "activation_ready":ready,
        "sender_status":if verified {"SMTP_ACCEPTED"} else {"NOT_TESTED"},
        "api_key_configured":false, "api_sender_verified":false,
        "real_inbox_reception":"BLOCKED_EXTERNAL"
    }))
}

pub fn api_disabled() -> AppError {
    AppError::Validation(
        "El envío mediante API está desactivado. Configure exclusivamente SMTP.".into(),
    )
}

// Retain authenticated legacy endpoints as explicit refusals for old clients;
// they cannot mutate stored API configuration, rotate credentials or send mail.
pub async fn put(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(_input): Json<Value>,
) -> Result<Json<Value>, AppError> {
    admin(&state, &headers)?;
    Err(api_disabled())
}

pub async fn test(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(_input): Json<Value>,
) -> Result<Json<Value>, AppError> {
    admin(&state, &headers)?;
    Err(api_disabled())
}

pub async fn audit_tx(
    tx: &mut Transaction<'_, Postgres>,
    actor: Uuid,
    action: &str,
    extra: Value,
) -> Result<(), AppError> {
    sqlx::query("INSERT INTO core_auditlog(id,created_date,updated_date,model_name,instance_id,action,extra,profile_id) VALUES($1,NOW(),NOW(),'MailSystem','',$2,$3,$4)")
        .bind(Uuid::new_v4()).bind(action).bind(extra).bind(actor).execute(&mut **tx).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn legacy_api_endpoints_require_authentication_before_disabled_response() {
        let state = Arc::new(AppState::for_test());
        assert!(matches!(
            put(State(state.clone()), HeaderMap::new(), Json(json!({}))).await,
            Err(AppError::Unauthorized)
        ));
        assert!(matches!(
            test(
                State(state),
                HeaderMap::new(),
                Json(json!({"dry_run":true}))
            )
            .await,
            Err(AppError::Unauthorized)
        ));
    }
}
