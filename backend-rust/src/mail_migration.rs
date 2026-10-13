use crate::{AppState, error::AppError, mail_config};
use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use serde_json::{Value, json};
use sqlx::{Postgres, Transaction};
use std::sync::Arc;
use uuid::Uuid;

pub const STAGES: [&str; 12] = [
    "NOT_STARTED",
    "AUDITED",
    "BACKUP_VERIFIED",
    "SCHEMA_EXPANDED",
    "DATA_MIGRATED",
    "DATA_VERIFIED",
    "API_CONFIGURED",
    "API_VERIFIED",
    "CUTOVER_READY",
    "API_ACTIVE",
    "POST_CUTOVER_VERIFIED",
    "COMPLETED",
];
pub fn transition_allowed(old: &str, last: &str, next: &str) -> bool {
    if matches!(next, "BLOCKED" | "FAILED" | "ROLLBACK_REQUIRED") {
        return old != "NOT_STARTED" || next == "BLOCKED";
    }
    if next == "ROLLBACK_IN_PROGRESS" {
        return old == "ROLLBACK_REQUIRED";
    }
    if next == "ROLLED_BACK" {
        return old == "ROLLBACK_IN_PROGRESS";
    }
    let effective = if matches!(old, "BLOCKED" | "FAILED") {
        last
    } else {
        old
    };
    STAGES.windows(2).any(|pair| pair == [effective, next])
}
pub async fn transition(
    tx: &mut Transaction<'_, Postgres>,
    next: &str,
    evidence: Value,
    actor: Option<Uuid>,
) -> Result<(), AppError> {
    sqlx::query("SELECT pg_advisory_xact_lock(724851904)")
        .execute(&mut **tx)
        .await?;
    let current: Option<(Uuid, Uuid, String, String, i64)> = sqlx::query_as(
        "SELECT id,attempt_id,state,last_passed,version FROM mail_migration FOR UPDATE",
    )
    .fetch_optional(&mut **tx)
    .await?;
    let (id, attempt, old, last, version) = if let Some(current) = current {
        current
    } else {
        let id = Uuid::new_v4();
        let attempt = Uuid::new_v4();
        sqlx::query("INSERT INTO mail_migration(id,attempt_id) VALUES($1,$2)")
            .bind(id)
            .bind(attempt)
            .execute(&mut **tx)
            .await?;
        (id, attempt, "NOT_STARTED".into(), "NOT_STARTED".into(), 0)
    };
    if old == next {
        return Ok(());
    }
    if !transition_allowed(&old, &last, next)
        || !evidence.is_object()
        || evidence.as_object().is_none_or(|v| v.is_empty())
    {
        return Err(AppError::EditConflict);
    }
    let passed = if STAGES.contains(&next) {
        next.to_owned()
    } else {
        last
    };
    sqlx::query("UPDATE mail_migration SET state=$2,last_passed=$3,version=version+1,updated_at=NOW() WHERE id=$1 AND version=$4")
        .bind(id).bind(next).bind(&passed).bind(version).execute(&mut **tx).await?;
    let schema: i64 = sqlx::query_scalar("SELECT max(version) FROM _sqlx_migrations WHERE success")
        .fetch_one(&mut **tx)
        .await?;
    sqlx::query("INSERT INTO mail_migration_transition(id,migration_id,attempt_id,previous_state,new_state,software_version,schema_version,actor_id,evidence,error_code,corrective_action,last_passed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)")
        .bind(Uuid::new_v4()).bind(id).bind(attempt).bind(old).bind(next).bind(env!("CARGO_PKG_VERSION")).bind(schema).bind(actor)
        .bind(&evidence).bind(evidence["error_code"].as_str().unwrap_or(""))
        .bind(evidence["corrective_action"].as_str().unwrap_or("")).bind(passed).execute(&mut **tx).await?;
    Ok(())
}

pub async fn monitor(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    mail_config::admin(&state, &headers)?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let counts:Value=sqlx::query_scalar("SELECT COALESCE(jsonb_object_agg(state,count),'{}'::jsonb) FROM (SELECT state,count(*) FROM mail_outbox GROUP BY state) s").fetch_one(pool).await?;
    let queue_age:Option<f64>=sqlx::query_scalar("SELECT EXTRACT(EPOCH FROM NOW()-min(created_at))::float8 FROM mail_outbox WHERE state IN ('PENDING','RETRY_SCHEDULED','PROCESSING')").fetch_one(pool).await?;
    let circuits: Value = sqlx::query_scalar(
        "SELECT COALESCE(jsonb_agg(to_jsonb(c)),'[]'::jsonb) FROM mail_circuit c",
    )
    .fetch_one(pool)
    .await?;
    let migration: Option<Value> = sqlx::query_scalar("SELECT to_jsonb(m) FROM mail_migration m")
        .fetch_optional(pool)
        .await?;
    let history:Value=sqlx::query_scalar("SELECT COALESCE(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM (SELECT * FROM mail_migration_transition ORDER BY created_at DESC LIMIT 50) t").fetch_one(pool).await?;
    let jobs:Value=sqlx::query_scalar("SELECT COALESCE(jsonb_agg(to_jsonb(j)),'[]'::jsonb) FROM (SELECT id,message_type,provider,state,created_at,updated_at,attempts,next_attempt_at,external_id,last_error,provider_latency_ms FROM mail_outbox ORDER BY created_at DESC LIMIT 50) j").fetch_one(pool).await?;
    let mut alerts = Vec::new();
    if counts["UNKNOWN"].as_u64().unwrap_or(0) > 0 {
        alerts.push("Hay envíos con resultado desconocido; compruébelos antes de reenviar.");
    }
    if counts["FAILED"].as_u64().unwrap_or(0) > 0 {
        alerts.push("Hay envíos fallidos registrados.");
    }
    if queue_age.is_some_and(|age| age > 900.0) {
        alerts.push("La cola contiene mensajes pendientes desde hace más de 15 minutos.");
    }
    if circuits
        .as_array()
        .is_some_and(|rows| rows.iter().any(|v| v["state"] == "OPEN"))
    {
        alerts.push("Un proveedor tiene el circuito abierto.");
    }
    if migration.as_ref().is_none_or(|m| {
        matches!(
            m["state"].as_str(),
            Some("BLOCKED" | "FAILED" | "ROLLBACK_REQUIRED")
        )
    }) {
        alerts.push("La migración necesita completar comprobaciones pendientes.");
    }
    Ok(Json(
        json!({"channel":if mail_config::api_exclusive(&state).await?{"postmark"}else{"smtp"},"counts":counts,"queue_age_seconds":queue_age,"circuits":circuits,"migration":migration,"transitions":history,"messages":jobs,"alerts":alerts}),
    ))
}
pub async fn reconcile(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let actor = mail_config::admin(&state, &headers)?;
    crate::auth::enforce_login_rate(&headers, &format!("mail-reconcile:{actor}"))?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let row: Option<(String, String, Option<Uuid>, String)> = sqlx::query_as(
        "SELECT provider,state,external_id,payload_ciphertext FROM mail_outbox WHERE id=$1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    let (provider, status, external, payload) = row.ok_or(AppError::NotFound)?;
    if provider != "postmark" || !matches!(status.as_str(), "UNKNOWN" | "ACCEPTED" | "DELIVERED") {
        return Err(AppError::Validation(
            "Esta comprobación requiere un envío Postmark aceptado o con resultado desconocido."
                .into(),
        ));
    }
    let token = mail_config::token(&state, false)
        .await?
        .ok_or(AppError::Unavailable)?;
    let envelope: crate::mail_provider::Envelope =
        serde_json::from_str(&state.cipher.decrypt(&payload)?).map_err(|_| AppError::Internal)?;
    let external = if let Some(external) = external {
        Some(external)
    } else {
        crate::mail_provider::find_message(&token, id, &envelope).await?
    };
    let Some(external) = external else {
        return Ok(Json(
            json!({"id":id,"state":"UNKNOWN","detail":"El proveedor no aporta evidencia suficiente. No se ha reenviado el mensaje."}),
        ));
    };
    let evidence = crate::mail_provider::delivery_evidence(&token, external, &envelope.to).await?;
    let new_state = match evidence.as_ref().map(|(kind, _)| kind.as_str()) {
        Some("Delivered") => "DELIVERED",
        Some("Bounced") => "FAILED",
        _ => "ACCEPTED",
    };
    let safe_evidence=evidence.map(|(kind,at)|json!({"source":"postmark_authenticated_api","event":kind,"received_at":at,"message_id":external}));
    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE mail_outbox SET state=$2,external_id=$3,delivery_evidence=$4,last_error=CASE WHEN $2='FAILED' THEN 'provider_bounced' ELSE '' END,updated_at=NOW() WHERE id=$1 AND state IN ('UNKNOWN','ACCEPTED','DELIVERED')")
        .bind(id).bind(new_state).bind(external).bind(safe_evidence).execute(&mut *tx).await?;
    mail_config::audit_tx(
        &mut tx,
        actor,
        "mail_result_reconciled",
        json!({"outbox_id":id,"state":new_state}),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(
        json!({"id":id,"state":new_state,"detail":"Estado comprobado en la API del proveedor. La recepción y Responder en el buzón requieren comprobación independiente."}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mandatory_stages_cannot_be_skipped_even_after_failure() {
        assert!(transition_allowed("AUDITED", "AUDITED", "BACKUP_VERIFIED"));
        assert!(!transition_allowed("AUDITED", "AUDITED", "API_ACTIVE"));
        assert!(transition_allowed(
            "BLOCKED",
            "DATA_VERIFIED",
            "API_CONFIGURED"
        ));
        assert!(!transition_allowed("BLOCKED", "DATA_VERIFIED", "COMPLETED"));
        assert!(transition_allowed(
            "ROLLBACK_REQUIRED",
            "API_ACTIVE",
            "ROLLBACK_IN_PROGRESS"
        ));
        assert!(transition_allowed(
            "ROLLBACK_IN_PROGRESS",
            "API_ACTIVE",
            "ROLLED_BACK"
        ));
    }
}
