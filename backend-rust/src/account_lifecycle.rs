//! Voluntary account closure. Academic identities and security holds are retained.
use std::{collections::BTreeSet, sync::Arc};

use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use crate::{
    AppState,
    auth::{self, authenticate, require_role},
    error::AppError,
};

pub async fn lock(tx: &mut Transaction<'_, Postgres>) -> Result<(), AppError> {
    sqlx::query("SELECT pg_advisory_xact_lock(724851906)")
        .execute(&mut **tx)
        .await?;
    Ok(())
}

pub async fn protect_last_admin(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
) -> Result<(), AppError> {
    let remaining: i64 = sqlx::query_scalar("SELECT count(*) FROM accounts_userprofile p JOIN auth_user u ON u.id=p.user_id WHERE p.id<>$1 AND p.status='activo' AND p.otp_verified AND u.is_active AND (p.role='admin' OR p.roles ? 'admin')")
        .bind(id).fetch_one(&mut **tx).await?;
    if remaining == 0 {
        return Err(AppError::Validation(
            "No puede darse de baja o retirar permisos al último administrador operativo.".into(),
        ));
    }
    Ok(())
}

fn essential(id: Uuid) -> Result<bool, AppError> {
    let configured = std::env::var("ESSENTIAL_ACCOUNT_PROFILE_IDS").unwrap_or_default();
    let ids = configured
        .split(',')
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(Uuid::parse_str)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| AppError::Unavailable)?;
    Ok(ids.contains(&id))
}

pub async fn event(
    tx: &mut Transaction<'_, Postgres>,
    profile: Uuid,
    actor: Option<Uuid>,
    operation: &str,
    result: &str,
    context: Value,
    request: Option<Uuid>,
) -> Result<Uuid, AppError> {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO account_lifecycle_event(id,profile_id,actor_id,operation,result,correlation_id,context,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)")
        .bind(id).bind(profile).bind(actor).bind(operation).bind(result).bind(id).bind(context).bind(request).execute(&mut **tx).await?;
    Ok(id)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeactivateRequest {
    confirmation: String,
    current_password: String,
    request_id: Uuid,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReactivateRequest {
    confirm: bool,
    expected_revision: i64,
}
#[derive(sqlx::FromRow)]
struct ReactivationRow {
    status: String,
    is_active: bool,
    otp_verified: bool,
    current_member: bool,
    revision: i64,
    deactivated_at: Option<DateTime<Utc>>,
    previous_status: Option<String>,
    email: String,
}

pub(crate) async fn actor_active(
    tx: &mut Transaction<'_, Postgres>,
    claims: &auth::Claims,
) -> Result<(), AppError> {
    let valid: bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM auth_tab_session s JOIN accounts_userprofile p ON p.id=s.profile_id JOIN auth_user u ON u.id=p.user_id WHERE s.session_key=$1 AND p.id=$2 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.last_activity_at>clock_timestamp()-($3::bigint*INTERVAL '1 second') AND p.status='activo' AND p.otp_verified AND u.is_active AND s.role=$4 AND (p.role=s.role OR p.roles ? s.role))")
        .bind(&claims.session_key).bind(claims.profile_id).bind(auth::IDLE_TIMEOUT_SECONDS).bind(&claims.role).fetch_one(&mut **tx).await?;
    if !valid {
        return Err(AppError::Unauthorized);
    }
    Ok(())
}

pub async fn info(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let is_admin: bool = sqlx::query_scalar(
        "SELECT role='admin' OR roles ? 'admin' FROM accounts_userprofile WHERE id=$1",
    )
    .bind(claims.profile_id)
    .fetch_one(state.pool.as_ref().ok_or(AppError::Unavailable)?)
    .await?;
    let mut tx = state
        .pool
        .as_ref()
        .ok_or(AppError::Unavailable)?
        .begin()
        .await?;
    let blocked = if essential(claims.profile_id)? {
        Some("Esta cuenta técnica esencial no puede darse de baja por este mecanismo.".to_owned())
    } else if is_admin {
        protect_last_admin(&mut tx, claims.profile_id)
            .await
            .err()
            .map(|e| e.to_string())
    } else {
        None
    };
    tx.rollback().await?;
    Ok(Json(
        json!({"can_deactivate":blocked.is_none(),"blocked_reason":blocked,"confirmation":"DARME DE BAJA","reauthentication":"current_password","retention_policy":"PENDING_APPROVED_POLICY"}),
    ))
}

pub async fn deactivate(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<DeactivateRequest>,
) -> Result<Json<Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    auth::enforce_login_rate(
        &headers,
        &format!("account-deactivate:{}", claims.profile_id),
    )?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    if input.confirmation != "DARME DE BAJA"
        || input.current_password.is_empty()
        || input.current_password.len() > 128
        || input.request_id.is_nil()
    {
        let mut tx = pool.begin().await?;
        event(
            &mut tx,
            claims.profile_id,
            Some(claims.profile_id),
            "deactivation_denied",
            "DENIED",
            json!({"reason":"invalid_confirmation"}),
            None,
        )
        .await?;
        tx.commit().await?;
        return Err(AppError::Validation(
            "Escriba DARME DE BAJA y confirme su contraseña actual.".into(),
        ));
    }
    let hash:String=sqlx::query_scalar("SELECT u.password FROM auth_user u JOIN accounts_userprofile p ON p.user_id=u.id WHERE p.id=$1")
        .bind(claims.profile_id).fetch_one(pool).await?;
    if !crate::security::verify_password_hash_async(input.current_password, hash.clone()).await? {
        let mut tx = pool.begin().await?;
        event(
            &mut tx,
            claims.profile_id,
            Some(claims.profile_id),
            "deactivation_denied",
            "DENIED",
            json!({"reason":"reauthentication_failed"}),
            None,
        )
        .await?;
        tx.commit().await?;
        return Err(AppError::Validation(
            "No se pudo confirmar la autenticación reciente.".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    lock(&mut tx).await?;
    if let Some(id)=sqlx::query_scalar::<_,Uuid>("SELECT id FROM account_lifecycle_event WHERE profile_id=$1 AND request_id=$2 AND operation='deactivated' AND result='PASS'")
        .bind(claims.profile_id).bind(input.request_id).fetch_optional(&mut *tx).await? {
        let still_deactivated:bool=sqlx::query_scalar("SELECT status='baja' FROM accounts_userprofile WHERE id=$1").bind(claims.profile_id).fetch_one(&mut *tx).await?;
        tx.rollback().await?;
        if !still_deactivated{return Err(AppError::EditConflict);}
        return Ok(Json(json!({"deactivated":true,"event_id":id,"idempotent":true})));
    }
    actor_active(&mut tx, &claims).await?;
    let (status,role,roles,credential,email):(String,String,Value,String,String)=sqlx::query_as("SELECT p.status,p.role,p.roles,u.password,p.email FROM accounts_userprofile p JOIN auth_user u ON u.id=p.user_id WHERE p.id=$1 FOR UPDATE OF p,u")
        .bind(claims.profile_id).fetch_one(&mut *tx).await?;
    if status != "activo" || credential != hash {
        return Err(AppError::Unauthorized);
    }
    let denial = if essential(claims.profile_id)? {
        Some(AppError::Validation(
            "Esta cuenta técnica esencial no puede darse de baja.".into(),
        ))
    } else if crate::users::is_administrator(&role, &roles) {
        protect_last_admin(&mut tx, claims.profile_id).await.err()
    } else {
        None
    };
    if let Some(error) = denial {
        event(
            &mut tx,
            claims.profile_id,
            Some(claims.profile_id),
            "deactivation_denied",
            "DENIED",
            json!({"reason":"protected_administrator_or_technical_account"}),
            None,
        )
        .await?;
        tx.commit().await?;
        return Err(error);
    }
    event(
        &mut tx,
        claims.profile_id,
        Some(claims.profile_id),
        "deactivation_requested",
        "PASS",
        json!({"confirmation":"explicit","reauthentication":"verified"}),
        None,
    )
    .await?;
    event(
        &mut tx,
        claims.profile_id,
        Some(claims.profile_id),
        "deactivation_confirmed",
        "PASS",
        json!({}),
        None,
    )
    .await?;
    let id = event(
        &mut tx,
        claims.profile_id,
        Some(claims.profile_id),
        "deactivated",
        "PASS",
        json!({"type":"voluntary"}),
        Some(input.request_id),
    )
    .await?;
    sqlx::query("INSERT INTO account_lifecycle(profile_id,deactivated_at,deactivated_by,deactivation_type,previous_status,revision) VALUES($1,clock_timestamp(),$1,'voluntary',$2,1) ON CONFLICT(profile_id) DO UPDATE SET deactivated_at=clock_timestamp(),deactivated_by=$1,deactivation_type='voluntary',previous_status=$2,revision=account_lifecycle.revision+1")
        .bind(claims.profile_id).bind(status).execute(&mut *tx).await?;
    sqlx::query("UPDATE accounts_userprofile SET status='baja',active_session_key=NULL,active_refresh_jti='',active_window_lookup='',login_otp_hash='',login_otp_created_at=NULL,otp_hash='',updated_date=clock_timestamp() WHERE id=$1")
        .bind(claims.profile_id).execute(&mut *tx).await?;
    let revoked=sqlx::query("UPDATE auth_tab_session SET revoked_at=clock_timestamp() WHERE profile_id=$1 AND revoked_at IS NULL")
        .bind(claims.profile_id).execute(&mut *tx).await?.rows_affected();
    sqlx::query("UPDATE accounts_passwordresettoken SET consumed_at=clock_timestamp() WHERE user_id=(SELECT user_id FROM accounts_userprofile WHERE id=$1) AND consumed_at IS NULL")
        .bind(claims.profile_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE conexiones_registroconexion SET estado_sesion='finalizada',fecha_cierre=clock_timestamp(),tiempo_sesion=GREATEST(0,EXTRACT(EPOCH FROM(clock_timestamp()-fecha_hora))::integer),updated_date=clock_timestamp() WHERE profile_id=$1 AND estado_sesion='activa'")
        .bind(claims.profile_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE conexiones_videollamada SET estado='finalizada',fecha_fin=clock_timestamp(),updated_date=clock_timestamp() WHERE estado IN ('activa','pendiente') AND (alumno_id=$1 OR instructor_id=$1 OR administrador_id=$1 OR instructor_peer_id=$1 OR moderador_id=$1)")
        .bind(claims.profile_id).execute(&mut *tx).await?;
    event(
        &mut tx,
        claims.profile_id,
        Some(claims.profile_id),
        "sessions_revoked",
        "PASS",
        json!({"sessions":revoked}),
        None,
    )
    .await?;
    if role == "instructor"
        || roles
            .as_array()
            .is_some_and(|v| v.iter().any(|r| r == "instructor"))
    {
        let dependent:i64=sqlx::query_scalar("SELECT count(*) FROM accounts_userprofile WHERE assigned_instructor_id=$1 AND status<>'baja'").bind(claims.profile_id).fetch_one(&mut *tx).await?;
        event(
            &mut tx,
            claims.profile_id,
            Some(claims.profile_id),
            "instructor_assignment_review",
            "PENDING",
            json!({"dependent_students":dependent,"automatic_reassignment":false}),
            None,
        )
        .await?;
    }
    sqlx::query("INSERT INTO account_notice(event_id,recipient_ciphertext) VALUES($1,$2)")
        .bind(id)
        .bind(email)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    publish_change(Arc::clone(&state));
    Ok(Json(
        json!({"deactivated":true,"event_id":id,"sessions_revoked":revoked,"detail":"Tu cuenta ha sido dada de baja. El acceso queda deshabilitado."}),
    ))
}

pub async fn reactivate(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<ReactivateRequest>,
) -> Result<Json<Value>, AppError> {
    reactivate_impl(state, headers, id, input, true).await
}
pub async fn reactivate_account(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<ReactivateRequest>,
) -> Result<Json<Value>, AppError> {
    reactivate_impl(state, headers, id, input, false).await
}
async fn reactivate_impl(
    state: Arc<AppState>,
    headers: HeaderMap,
    id: Uuid,
    input: ReactivateRequest,
    student_only: bool,
) -> Result<Json<Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin"])?;
    auth::enforce_login_rate(
        &headers,
        &format!("student-reactivate:{}", claims.profile_id),
    )?;
    if !input.confirm || input.expected_revision < 1 {
        return Err(AppError::Validation(
            "Confirme la reactivación y actualice el registro.".into(),
        ));
    }
    let mut tx = state
        .pool
        .as_ref()
        .ok_or(AppError::Unavailable)?
        .begin()
        .await?;
    lock(&mut tx).await?;
    actor_active(&mut tx, &claims).await?;
    let row:Option<ReactivationRow>=sqlx::query_as("SELECT p.status,u.is_active,p.otp_verified,COALESCE(m.current_member,false) AS current_member,l.revision,l.deactivated_at,l.previous_status,p.email FROM accounts_userprofile p JOIN auth_user u ON u.id=p.user_id LEFT JOIN student_membership m ON m.profile_id=p.id JOIN account_lifecycle l ON l.profile_id=p.id WHERE p.id=$1 FOR UPDATE OF p,u,l")
        .bind(id).fetch_optional(&mut *tx).await?;
    let Some(ReactivationRow {
        status,
        is_active: active,
        otp_verified: verified,
        current_member: member,
        revision,
        deactivated_at: deactivated,
        previous_status: previous,
        email,
    }) = row
    else {
        return Err(AppError::NotFound);
    };
    if revision != input.expected_revision {
        return Err(AppError::EditConflict);
    }
    if deactivated.is_none()
        || status != "baja"
        || !active
        || !verified
        || (student_only && !member)
        || previous.as_deref() != Some("activo")
        || essential(id)?
    {
        event(
            &mut tx,
            id,
            Some(claims.profile_id),
            "reactivation_denied",
            "DENIED",
            json!({"reason":"security_or_membership_condition"}),
            None,
        )
        .await?;
        tx.commit().await?;
        return Err(AppError::Validation("La cuenta debe estar de baja, verificada, sin bloqueos de seguridad y conservar su pertenencia como alumno.".into()));
    }
    sqlx::query("UPDATE account_lifecycle SET deactivated_at=NULL,reactivated_at=clock_timestamp(),reactivated_by=$2,revision=revision+1 WHERE profile_id=$1")
        .bind(id).bind(claims.profile_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE accounts_userprofile SET status='activo',active_session_key=NULL,active_refresh_jti='',active_window_lookup='',login_otp_hash='',login_otp_created_at=NULL,updated_date=clock_timestamp() WHERE id=$1")
        .bind(id).execute(&mut *tx).await?;
    // No old session or refresh credential is restored.
    let event_id = event(
        &mut tx,
        id,
        Some(claims.profile_id),
        "reactivated",
        "PASS",
        json!({"new_authentication_required":true}),
        None,
    )
    .await?;
    sqlx::query("INSERT INTO account_notice(event_id,recipient_ciphertext) VALUES($1,$2)")
        .bind(event_id)
        .bind(email)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    publish_change(Arc::clone(&state));
    Ok(Json(
        json!({"reactivated":true,"event_id":event_id,"revision":revision+1,"new_authentication_required":true}),
    ))
}

fn search_grams(value: &str) -> BTreeSet<String> {
    let chars: Vec<char> = value.to_lowercase().chars().collect();
    [2, 3]
        .into_iter()
        .flat_map(|n| chars.windows(n).map(|v| v.iter().collect::<String>()))
        .collect()
}

pub async fn index_pending(state: &AppState) -> Result<(), AppError> {
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    loop {
        let mut tx = pool.begin().await?;
        let rows:Vec<(Uuid,String,String,String)>=sqlx::query_as("SELECT p.id,p.nombre,p.apellidos,p.email FROM student_membership m JOIN accounts_userprofile p ON p.id=m.profile_id WHERE m.indexed_source IS NULL ORDER BY p.id LIMIT 200 FOR UPDATE OF p SKIP LOCKED")
            .fetch_all(&mut *tx).await?;
        if rows.is_empty() {
            tx.rollback().await?;
            break;
        }
        for (id, nombre, apellidos, email) in rows {
            let decoded = format!(
                "{} {} {} {id}",
                state.cipher.decrypt(&nombre)?,
                state.cipher.decrypt(&apellidos)?,
                state.cipher.decrypt(&email)?
            );
            let grams = search_grams(&decoded);
            let tokens = grams
                .into_iter()
                .map(|gram| state.cipher.blind_index(&format!("student-search:{gram}")))
                .collect::<Result<Vec<_>, _>>()?;
            sqlx::query("DELETE FROM student_search_token WHERE profile_id=$1")
                .bind(id)
                .execute(&mut *tx)
                .await?;
            sqlx::query(
                "INSERT INTO student_search_token(profile_id,token) SELECT $1,unnest($2::text[])",
            )
            .bind(id)
            .bind(tokens)
            .execute(&mut *tx)
            .await?;
            sqlx::query("UPDATE student_membership SET indexed_source=$2 WHERE profile_id=$1")
                .bind(id)
                .bind(
                    state
                        .cipher
                        .blind_index(&format!("{nombre}|{apellidos}|{email}"))?,
                )
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
    }
    Ok(())
}
pub(crate) fn query_tokens(state: &AppState, value: &str) -> Result<Vec<String>, AppError> {
    let size = if value.chars().count() < 3 { 2 } else { 3 };
    let chars: Vec<char> = value.to_lowercase().chars().collect();
    chars
        .windows(size)
        .map(|gram| {
            state.cipher.blind_index(&format!(
                "student-search:{}",
                gram.iter().collect::<String>()
            ))
        })
        .collect::<Result<BTreeSet<_>, _>>()
        .map(|v| v.into_iter().collect())
}

async fn queue_notices(state: &AppState) -> Result<(), AppError> {
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let ids:Vec<Uuid>=sqlx::query_scalar("SELECT event_id FROM account_notice WHERE mail_id IS NULL AND next_attempt_at<=NOW() ORDER BY next_attempt_at LIMIT 20").fetch_all(pool).await?;
    for id in ids {
        let mut tx = pool.begin().await?;
        // Same order as normal enqueue; no lifecycle lock is held while sending.
        crate::runtime_config::lock_email_auth_config(&mut tx).await?;
        let row:Option<(String,String,DateTime<Utc>)>=sqlx::query_as("SELECT n.recipient_ciphertext,e.operation,e.created_at FROM account_notice n JOIN account_lifecycle_event e ON e.id=n.event_id WHERE n.event_id=$1 AND n.mail_id IS NULL FOR UPDATE OF n SKIP LOCKED").bind(id).fetch_optional(&mut *tx).await?;
        let Some((recipient, operation, date)) = row else {
            tx.rollback().await?;
            continue;
        };
        let to = state.cipher.decrypt(&recipient)?;
        let subject = if operation == "deactivated" {
            "Confirmación de baja de cuenta UASSpain"
        } else {
            "Confirmación de reactivación UASSpain"
        };
        let body = format!(
            "Estado: {}. Fecha UTC: {}. Para solicitar información sobre reactivación, utilice el formulario de contacto de UASSpain. La reactivación requiere una nueva autenticación.",
            if operation == "deactivated" {
                "baja"
            } else {
                "activa"
            },
            date.to_rfc3339()
        );
        let identity = format!("account-event:{id}");
        let job = crate::mail_queue::enqueue(
            state,
            &mut tx,
            crate::mail_queue::MailRequest {
                to: &to,
                reply_to: None,
                subject,
                body: &body,
                options: crate::mail_queue::QueueOptions {
                    kind: "account_notice",
                    ttl: chrono::Duration::hours(24),
                    validity: json!({}),
                    idempotency: Some(&identity),
                },
            },
        )
        .await;
        match job {
            Ok(mail) => {
                sqlx::query("UPDATE account_notice SET mail_id=$2,queued_at=NOW(),last_error='' WHERE event_id=$1").bind(id).bind(mail).execute(&mut *tx).await?;
            }
            Err(AppError::Unavailable) => {
                sqlx::query("UPDATE account_notice SET next_attempt_at=NOW()+INTERVAL '1 minute',last_error='mail_not_configured_or_available' WHERE event_id=$1").bind(id).execute(&mut *tx).await?;
            }
            Err(error) => {
                tx.rollback().await?;
                return Err(error);
            }
        }
        tx.commit().await?;
    }
    Ok(())
}
fn publish_change(state: Arc<AppState>) {
    tokio::spawn(async move {
        state
            .events
            .publish("connections", json!({"type":"account_state"}))
            .await;
    });
}
pub fn spawn_worker(state: Arc<AppState>) {
    tokio::spawn(async move {
        let mut timer = tokio::time::interval(std::time::Duration::from_secs(10));
        loop {
            timer.tick().await;
            if index_pending(&state).await.is_err() || queue_notices(&state).await.is_err() {
                tracing::warn!("account metadata or notification preparation unavailable");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn search_uses_unicode_not_bytes() {
        let grams = search_grams("Muñoz");
        assert!(grams.contains("uñ"));
        assert!(grams.contains("ñoz"));
        assert!(!grams.contains("MU"));
    }
    #[test]
    fn manipulated_identity_is_not_deserializable() {
        assert!(serde_json::from_value::<DeactivateRequest>(json!({"confirmation":"DARME DE BAJA","current_password":"fixture","request_id":Uuid::new_v4(),"profile_id":Uuid::new_v4()})).is_err());
    }
}
