use crate::{
    AppState,
    error::AppError,
    mail_provider::{Envelope, Outcome},
    runtime_config,
};
use chrono::{DateTime, Duration, Utc};
use serde_json::Value;
use sqlx::{FromRow, Postgres, Transaction};
use std::sync::Arc;
use uuid::Uuid;

#[derive(FromRow)]
struct Job {
    id: Uuid,
    provider: String,
    payload_ciphertext: String,
    attempts: i32,
    expires_at: DateTime<Utc>,
    validity: Value,
}

pub struct QueueOptions<'a> {
    pub kind: &'a str,
    pub ttl: Duration,
    pub validity: Value,
    pub idempotency: Option<&'a str>,
}
pub struct MailRequest<'a> {
    pub to: &'a str,
    pub reply_to: Option<&'a str>,
    pub subject: &'a str,
    pub body: &'a str,
    pub options: QueueOptions<'a>,
}

pub async fn enqueue_explicit(
    state: &AppState,
    tx: &mut Transaction<'_, Postgres>,
    provider: &str,
    envelope: &Envelope,
    options: QueueOptions<'_>,
) -> Result<Uuid, AppError> {
    envelope.validate()?;
    if options.ttl <= Duration::zero() || options.ttl > Duration::hours(24) {
        return Err(AppError::Internal);
    }
    let id = Uuid::new_v4();
    let key = options
        .idempotency
        .map(str::to_owned)
        .unwrap_or_else(|| id.to_string());
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,724851905))")
        .bind(&key)
        .execute(&mut **tx)
        .await?;
    let existing: Option<(Uuid, String)> =
        sqlx::query_as("SELECT id,payload_ciphertext FROM mail_outbox WHERE idempotency_key=$1")
            .bind(&key)
            .fetch_optional(&mut **tx)
            .await?;
    if let Some((existing, payload)) = existing {
        let original: Envelope = serde_json::from_str(&state.cipher.decrypt(&payload)?)
            .map_err(|_| AppError::Internal)?;
        if original.to != envelope.to
            || original.body != envelope.body
            || original.subject != envelope.subject
            || original.reply_to != envelope.reply_to
        {
            return Err(AppError::EditConflict);
        }
        return Ok(existing);
    }
    sqlx::query("INSERT INTO mail_outbox(id,message_type,provider,payload_ciphertext,idempotency_key,state,expires_at,validity) VALUES($1,$2,$3,$4,$5,'PENDING',$6,$7)")
        .bind(id).bind(options.kind).bind(provider).bind(state.cipher.encrypt(&serde_json::to_string(envelope).map_err(|_|AppError::Internal)?)?)
        .bind(key).bind(Utc::now()+options.ttl).bind(options.validity).execute(&mut **tx).await?;
    Ok(id)
}

pub async fn enqueue(
    state: &AppState,
    tx: &mut Transaction<'_, Postgres>,
    request: MailRequest<'_>,
) -> Result<Uuid, AppError> {
    runtime_config::lock_email_auth_config(tx).await?;
    let MailRequest {
        to,
        reply_to,
        subject,
        body,
        options,
    } = request;
    let exclusive = crate::mail_config::api_exclusive(state).await?;
    let (provider, from, from_name, smtp) = if exclusive {
        let config = crate::mail_config::api_config(state, false).await?;
        config.validate().map_err(|_| AppError::Unavailable)?;
        // Verified credentials remain usable after the test's activation window;
        // later failures open the circuit, never silently switch transports.
        if !config.provider_verified() || crate::mail_config::token(state, false).await?.is_none() {
            return Err(AppError::Unavailable);
        }
        ("postmark", config.from_email, config.from_name, None)
    } else {
        let (config, password) = runtime_config::smtp(state).await?;
        if runtime_config::env_true("DEV_EMAIL")
            && !runtime_config::env_true("APP_PRODUCTION")
            && options.kind != "contact"
        {
            (
                "isolated",
                "no-reply@uasspain.com".into(),
                "UASSpain".into(),
                None,
            )
        } else {
            if !config.enabled || password.is_none() {
                return Err(AppError::Unavailable);
            }
            runtime_config::validate_smtp(&config)?;
            (
                "smtp",
                config.from_email.clone(),
                config.from_name.clone(),
                Some(config),
            )
        }
    };
    let body = if options.kind == "contact" {
        body.to_owned()
    } else {
        format!("{body}\n\n{}", crate::mail_provider::AUTOMATED_NOTICE)
    };
    let envelope = Envelope {
        from,
        from_name,
        to: to.into(),
        reply_to: reply_to.map(str::to_owned),
        subject: subject.into(),
        body,
        smtp,
    };
    enqueue_explicit(state, tx, provider, &envelope, options).await
}

async fn validity_live(state: &AppState, validity: &Value) -> Result<bool, AppError> {
    let Some(kind) = validity["kind"].as_str() else {
        return Ok(true);
    };
    let profile = validity["profile_id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok());
    let digest = validity["hash"].as_str().unwrap_or("");
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    match kind {
        "login_otp"=>Ok(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM accounts_userprofile p JOIN auth_user u ON u.id=p.user_id WHERE p.id=$1 AND p.status='activo' AND u.is_active AND p.login_otp_hash=$2 AND p.login_otp_created_at>NOW()-INTERVAL '15 minutes')").bind(profile).bind(digest).fetch_one(pool).await?),
        "registration_otp"=>Ok(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM accounts_userprofile WHERE id=$1 AND status='pendiente' AND NOT otp_verified AND otp_hash=$2 AND otp_created_at>NOW()-INTERVAL '15 minutes')").bind(profile).bind(digest).fetch_one(pool).await?),
        "password_reset"=>{
            let reset_id=validity["reset_id"].as_str().and_then(|s|Uuid::parse_str(s).ok());
            Ok(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM accounts_passwordresettoken r JOIN auth_user u ON u.id=r.user_id JOIN accounts_userprofile p ON p.user_id=u.id WHERE r.id=$1 AND r.consumed_at IS NULL AND r.expires_at>NOW() AND u.is_active AND p.status='activo')").bind(reset_id).fetch_one(pool).await?)
        },
        _=>Ok(false),
    }
}

async fn claim(state: &AppState, id: Option<Uuid>, test: bool) -> Result<Option<Job>, AppError> {
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let mut tx = pool.begin().await?;
    runtime_config::lock_email_auth_config(&mut tx).await?;
    // A process may have died after sending. Its durable lease becomes UNKNOWN
    // and must be reconciled; never put it back on the automatic send queue.
    sqlx::query("UPDATE mail_outbox SET state='UNKNOWN',last_error='worker_result_unknown',lease_until=NULL,updated_at=NOW() WHERE state='PROCESSING' AND lease_until<NOW()")
        .execute(&mut *tx).await?;
    sqlx::query("UPDATE mail_outbox SET state='EXPIRED',last_error='message_expired',updated_at=NOW() WHERE state IN ('PENDING','RETRY_SCHEDULED') AND expires_at<=NOW()")
        .execute(&mut *tx).await?;
    let job=sqlx::query_as::<_,Job>("SELECT id,provider,payload_ciphertext,attempts,expires_at,validity FROM mail_outbox o WHERE state IN ('PENDING','RETRY_SCHEDULED') AND next_attempt_at<=NOW() AND expires_at>NOW() AND ($1::uuid IS NULL OR id=$1) AND ($2 OR message_type<>'provider_test') AND ($2 OR provider='isolated' OR EXISTS(SELECT 1 FROM mail_circuit c WHERE c.provider=o.provider AND (c.state='CLOSED' OR c.opened_at<NOW()-INTERVAL '2 minutes'))) ORDER BY created_at FOR UPDATE OF o SKIP LOCKED LIMIT 1")
        .bind(id).bind(test).fetch_optional(&mut *tx).await?;
    let Some(mut job) = job else {
        tx.commit().await?;
        return Ok(None);
    };
    if job.provider != "isolated" && !test {
        let circuit: (String, Option<DateTime<Utc>>) =
            sqlx::query_as("SELECT state,opened_at FROM mail_circuit WHERE provider=$1 FOR UPDATE")
                .bind(&job.provider)
                .fetch_one(&mut *tx)
                .await?;
        if circuit.0 == "OPEN" || circuit.0 == "HALF_OPEN" {
            let allowed = circuit
                .1
                .is_some_and(|at| Utc::now() - at >= Duration::seconds(120));
            if !allowed {
                tx.commit().await?;
                return Ok(None);
            }
            sqlx::query("UPDATE mail_circuit SET state='HALF_OPEN',opened_at=NOW(),checked_at=NOW() WHERE provider=$1").bind(&job.provider).execute(&mut *tx).await?;
        }
    }
    sqlx::query("UPDATE mail_outbox SET state='PROCESSING',attempts=attempts+1,lease_until=NOW()+INTERVAL '2 minutes',updated_at=NOW() WHERE id=$1").bind(job.id).execute(&mut *tx).await?;
    job.attempts += 1;
    tx.commit().await?;
    Ok(Some(job))
}

pub async fn move_pending(
    state: &AppState,
    tx: &mut Transaction<'_, Postgres>,
    api: bool,
    api_config: &crate::mail_config::ApiConfig,
) -> Result<usize, AppError> {
    let previous = if api { "smtp" } else { "postmark" };
    let busy: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM mail_outbox WHERE provider=$1 AND state='PROCESSING')",
    )
    .bind(previous)
    .fetch_one(&mut **tx)
    .await?;
    if busy {
        return Err(AppError::EditConflict);
    }
    let pending:Vec<(Uuid,String)>=sqlx::query_as("SELECT id,payload_ciphertext FROM mail_outbox WHERE provider=$1 AND state IN ('PENDING','RETRY_SCHEDULED') AND message_type<>'provider_test' FOR UPDATE")
        .bind(previous).fetch_all(&mut **tx).await?;
    let smtp = if api {
        None
    } else {
        Some(runtime_config::smtp(state).await?.0)
    };
    for (id, payload) in &pending {
        let mut envelope: Envelope = serde_json::from_str(&state.cipher.decrypt(payload)?)
            .map_err(|_| AppError::Internal)?;
        if api {
            envelope.from = api_config.from_email.clone();
            envelope.from_name = api_config.from_name.clone();
            envelope.smtp = None;
        } else if let Some(config) = &smtp {
            envelope.from = config.from_email.clone();
            envelope.from_name = config.from_name.clone();
            envelope.smtp = Some(config.clone());
        }
        envelope.validate()?;
        let encrypted = state
            .cipher
            .encrypt(&serde_json::to_string(&envelope).map_err(|_| AppError::Internal)?)?;
        sqlx::query("UPDATE mail_outbox SET provider=$2,payload_ciphertext=$3,updated_at=NOW() WHERE id=$1 AND state IN ('PENDING','RETRY_SCHEDULED')")
            .bind(id).bind(if api{"postmark"}else{"smtp"}).bind(encrypted).execute(&mut **tx).await?;
    }
    Ok(pending.len())
}
pub fn retry_delay(attempt: i32, retry_after: Option<u64>, jitter: u64) -> u64 {
    retry_after
        .unwrap_or(5 * (1_u64 << attempt.clamp(0, 8)))
        .max(1)
        .saturating_add(jitter % 11)
        .min(86410)
}
async fn finish(
    state: &AppState,
    job: &Job,
    outcome: &Outcome,
    latency: u128,
) -> Result<(), AppError> {
    finish_scoped(state, job, outcome, latency, true).await
}
async fn finish_scoped(
    state: &AppState,
    job: &Job,
    outcome: &Outcome,
    latency: u128,
    affects_active_circuit: bool,
) -> Result<(), AppError> {
    let mut tx = state
        .pool
        .as_ref()
        .ok_or(AppError::Unavailable)?
        .begin()
        .await?;
    let (status, external, next) = match outcome {
        Outcome::Accepted(id) => ("ACCEPTED", *id, Utc::now()),
        Outcome::Retry(_, retry) if job.attempts < 5 && job.expires_at > Utc::now() => (
            "RETRY_SCHEDULED",
            None,
            Utc::now()
                + Duration::seconds(retry_delay(job.attempts, *retry, rand::random::<u64>()) as i64),
        ),
        Outcome::Retry(_, _) | Outcome::Failed(_) => ("FAILED", None, Utc::now()),
        Outcome::Unknown(_) => ("UNKNOWN", None, Utc::now()),
    };
    sqlx::query("UPDATE mail_outbox SET state=$2,external_id=$3,last_error=$4,next_attempt_at=$5,provider_latency_ms=$6,lease_until=NULL,updated_at=NOW() WHERE id=$1 AND state='PROCESSING'")
        .bind(job.id).bind(status).bind(external).bind(outcome.code()).bind(next).bind(latency.min(i64::MAX as u128) as i64).execute(&mut *tx).await?;
    if job.provider != "isolated" && affects_active_circuit {
        // An inactive recipient is a definitive provider response. It proves
        // the transport recovered and must release a HALF_OPEN probe.
        if matches!(
            outcome,
            Outcome::Accepted(_) | Outcome::Failed("recipient_invalid")
        ) {
            sqlx::query("UPDATE mail_circuit SET state='CLOSED',failures=0,opened_at=NULL,checked_at=NOW(),last_error='' WHERE provider=$1").bind(&job.provider).execute(&mut *tx).await?;
        } else if outcome.affects_circuit() {
            sqlx::query("UPDATE mail_circuit SET failures=failures+1,last_error=$2,checked_at=NOW(),state=CASE WHEN failures+1>=3 OR state='HALF_OPEN' THEN 'OPEN' ELSE state END,opened_at=CASE WHEN failures+1>=3 OR state='HALF_OPEN' THEN NOW() ELSE opened_at END WHERE provider=$1")
                .bind(&job.provider).bind(outcome.code()).execute(&mut *tx).await?;
        }
    }
    tx.commit().await?;
    Ok(())
}
async fn deliver_job(
    state: &AppState,
    job: &Job,
    candidate_token: Option<&str>,
    affects_active_circuit: bool,
) -> Result<Outcome, AppError> {
    if !validity_live(state, &job.validity).await? || job.expires_at <= Utc::now() {
        sqlx::query("UPDATE mail_outbox SET state='EXPIRED',last_error='credential_expired_or_replaced',lease_until=NULL,updated_at=NOW() WHERE id=$1 AND state='PROCESSING'").bind(job.id).execute(state.pool.as_ref().ok_or(AppError::Unavailable)?).await?;
        return Ok(Outcome::Failed("credential_expired_or_replaced"));
    }
    let envelope: Envelope = serde_json::from_str(&state.cipher.decrypt(&job.payload_ciphertext)?)
        .map_err(|_| AppError::Internal)?;
    let start = std::time::Instant::now();
    let outcome = match job.provider.as_str() {
        "postmark" => {
            let token = if let Some(value) = candidate_token {
                Some(value.to_owned())
            } else {
                crate::mail_config::token(state, false).await?
            };
            if let Some(token) = token {
                crate::mail_provider::postmark(&envelope, &token, job.id).await
            } else {
                Outcome::Failed("configuration_invalid")
            }
        }
        "smtp" => {
            let password = if let Some(value) = candidate_token.filter(|v| !v.is_empty()) {
                Some(value.to_owned())
            } else {
                runtime_config::smtp(state).await?.1
            };
            if let (Some(config), Some(password)) = (&envelope.smtp, password) {
                crate::mail_provider::smtp(&envelope, config, &password).await
            } else {
                Outcome::Failed("configuration_invalid")
            }
        }
        "isolated"
            if !runtime_config::env_true("APP_PRODUCTION")
                && runtime_config::env_true("DEV_EMAIL") =>
        {
            crate::email::development_sink(state, &envelope.to, &envelope.subject, &envelope.body)
                .await?;
            Outcome::Accepted(None)
        }
        _ => Outcome::Failed("configuration_invalid"),
    };
    if affects_active_circuit {
        finish(state, job, &outcome, start.elapsed().as_millis()).await?;
    } else {
        finish_scoped(state, job, &outcome, start.elapsed().as_millis(), false).await?;
    }
    Ok(outcome)
}
pub async fn process_test(state: &AppState, id: Uuid, token: &str) -> Result<Outcome, AppError> {
    let job = claim(state, Some(id), true)
        .await?
        .ok_or(AppError::EditConflict)?;
    deliver_job(state, &job, Some(token), true).await
}
pub async fn process_smtp_candidate_test(
    state: &AppState,
    id: Uuid,
    password: &str,
) -> Result<Outcome, AppError> {
    let job = claim(state, Some(id), true)
        .await?
        .ok_or(AppError::EditConflict)?;
    if job.provider != "smtp" {
        return Err(AppError::EditConflict);
    }
    // Draft failures are persisted without poisoning the circuit used by 2FA.
    deliver_job(state, &job, Some(password), false).await
}
pub async fn process_id(state: &AppState, id: Uuid) -> Result<Option<Outcome>, AppError> {
    if let Some(job) = claim(state, Some(id), false).await? {
        return deliver_job(state, &job, None, true).await.map(Some);
    }
    Ok(None)
}
pub fn spawn_worker(state: Arc<AppState>) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(2));
        loop {
            interval.tick().await;
            for _ in 0..10 {
                match claim(&state, None, false).await {
                    Ok(Some(job)) => {
                        if deliver_job(&state, &job, None, true).await.is_err() {
                            tracing::warn!(
                                "mail worker operation failed; persistent lease retained"
                            );
                        }
                    }
                    Ok(None) => break,
                    Err(_) => {
                        tracing::warn!("mail queue unavailable");
                        break;
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires the marked disposable mail-repair database"]
    async fn smtp_candidate_failures_preserve_the_active_circuit_and_unknown_messages() {
        let url = std::env::var("MAIL_REPAIR_TEST_DATABASE_URL").expect("dedicated fixture URL");
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .unwrap();
        let marker: Option<String> =
            sqlx::query_scalar("SELECT current_setting('uasspain.mail_fixture',true)")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(marker.as_deref(), Some("mail-repair-20261025"));
        let before: (String, i32) =
            sqlx::query_as("SELECT state,failures FROM mail_circuit WHERE provider='smtp'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let mut state = AppState::for_test();
        state.pool = Some(pool.clone());
        for outcome in [
            Outcome::Failed("provider_authentication_failed"),
            Outcome::Failed("provider_unreachable"),
            Outcome::Failed("sender_unverified"),
            Outcome::Unknown("provider_result_unknown"),
        ] {
            let id = Uuid::new_v4();
            sqlx::query("INSERT INTO mail_outbox(id,message_type,provider,payload_ciphertext,idempotency_key,state,expires_at) VALUES($1,'provider_test','smtp',$2,$3,'PROCESSING',NOW()+INTERVAL '1 hour')").bind(id).bind(state.cipher.encrypt("synthetic payload, never transported").unwrap()).bind(id.to_string()).execute(&pool).await.unwrap();
            let job = Job {
                id,
                provider: "smtp".into(),
                payload_ciphertext: String::new(),
                attempts: 1,
                expires_at: Utc::now() + Duration::hours(1),
                validity: serde_json::json!({}),
            };
            finish_scoped(&state, &job, &outcome, 0, false)
                .await
                .unwrap();
            let current: (String, i32) =
                sqlx::query_as("SELECT state,failures FROM mail_circuit WHERE provider='smtp'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(
                current, before,
                "an unactivated draft must not disable the working 2FA circuit"
            );
            let status: String = sqlx::query_scalar("SELECT state FROM mail_outbox WHERE id=$1")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(
                status,
                if matches!(outcome, Outcome::Unknown(_)) {
                    "UNKNOWN"
                } else {
                    "FAILED"
                }
            );
            assert!(
                claim(&state, Some(id), true).await.unwrap().is_none(),
                "uncertain or definitively rejected tests cannot be automatically resent"
            );
        }
    }

    #[tokio::test]
    #[ignore = "requires a disposable E2E database with its delivery worker stopped"]
    async fn persistent_circuit_probe_recovery_and_uncertainty() {
        let url = std::env::var("MAIL_TEST_DATABASE_URL").expect("isolated database URL");
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .unwrap();
        let database: String = sqlx::query_scalar("SELECT current_database()")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            database, "test_e2e_uasspain",
            "never run mail fixtures against the real database"
        );
        let mut state = AppState::for_test();
        state.pool = Some(pool.clone());
        sqlx::query("UPDATE mail_circuit SET state='CLOSED',failures=0,opened_at=NULL WHERE provider='postmark'").execute(&pool).await.unwrap();
        let payload = state
            .cipher
            .encrypt(
                &serde_json::to_string(&Envelope {
                    from: crate::mail_provider::AUTOMATED_FROM.into(),
                    from_name: crate::mail_provider::FROM_NAME.into(),
                    to: "circuit-fixture@example.invalid".into(),
                    reply_to: None,
                    subject: "Isolated circuit fixture".into(),
                    body: "Never transported".into(),
                    smtp: None,
                })
                .unwrap(),
            )
            .unwrap();
        let insert = |id: Uuid| {
            let pool = pool.clone();
            let payload = payload.clone();
            async move {
                sqlx::query("INSERT INTO mail_outbox(id,message_type,provider,payload_ciphertext,idempotency_key,state,expires_at) VALUES($1,'circuit_fixture','postmark',$3,$2,'PENDING',NOW()+INTERVAL '1 hour')")
                .bind(id).bind(format!("circuit-fixture-{id}")).bind(payload).execute(&pool).await.unwrap();
            }
        };
        let mut owned = Vec::new();
        for n in 0..3 {
            let id = Uuid::new_v4();
            owned.push(id);
            insert(id).await;
            let job = claim(&state, Some(id), false).await.unwrap().unwrap();
            finish(
                &state,
                &job,
                &Outcome::Retry("provider_rate_limited", Some(60)),
                1,
            )
            .await
            .unwrap();
            let circuit: (String, i32) =
                sqlx::query_as("SELECT state,failures FROM mail_circuit WHERE provider='postmark'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(
                circuit,
                (if n == 2 { "OPEN" } else { "CLOSED" }.into(), n + 1)
            );
            let row:(String,bool)=sqlx::query_as("SELECT state,next_attempt_at>NOW()+INTERVAL '59 seconds' FROM mail_outbox WHERE id=$1").bind(id).fetch_one(&pool).await.unwrap();
            assert_eq!(row, ("RETRY_SCHEDULED".into(), true));
        }
        let probe_id = Uuid::new_v4();
        owned.push(probe_id);
        insert(probe_id).await;
        assert!(
            claim(&state, Some(probe_id), false)
                .await
                .unwrap()
                .is_none()
        );
        sqlx::query("UPDATE mail_circuit SET opened_at=NOW()-INTERVAL '121 seconds' WHERE provider='postmark'").execute(&pool).await.unwrap();
        let probe = claim(&state, Some(probe_id), false).await.unwrap().unwrap();
        let second_id = Uuid::new_v4();
        owned.push(second_id);
        insert(second_id).await;
        assert!(
            claim(&state, Some(second_id), false)
                .await
                .unwrap()
                .is_none(),
            "only one half-open probe may run"
        );
        finish(&state, &probe, &Outcome::Failed("recipient_invalid"), 1)
            .await
            .unwrap();
        let circuit: (String, i32) =
            sqlx::query_as("SELECT state,failures FROM mail_circuit WHERE provider='postmark'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            circuit,
            ("CLOSED".into(), 0),
            "an inactive recipient must release the recovered circuit"
        );
        let job = claim(&state, Some(second_id), false)
            .await
            .unwrap()
            .unwrap();
        finish(
            &state,
            &job,
            &Outcome::Unknown("provider_result_unknown"),
            1,
        )
        .await
        .unwrap();
        assert!(
            claim(&state, Some(second_id), false)
                .await
                .unwrap()
                .is_none(),
            "an uncertain send must never be automatically resent"
        );
        let unknown: String = sqlx::query_scalar("SELECT state FROM mail_outbox WHERE id=$1")
            .bind(second_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(unknown, "UNKNOWN");
        sqlx::query("DELETE FROM mail_outbox WHERE id=ANY($1) AND message_type='circuit_fixture'")
            .bind(&owned)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE mail_circuit SET state='CLOSED',failures=0,opened_at=NULL,last_error='' WHERE provider='postmark'").execute(&pool).await.unwrap();
    }

    #[test]
    fn backoff_is_bounded_and_respects_retry_after() {
        assert!(retry_delay(2, None, 3) > retry_delay(1, None, 3));
        assert!(retry_delay(1, Some(120), 9) >= 120);
        assert!((1280..1300).contains(&retry_delay(100, None, 100)));
        assert!(retry_delay(100, Some(10000), 10) >= 10000);
    }
}
