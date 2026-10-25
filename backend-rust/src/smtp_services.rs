use crate::{
    AppState,
    error::AppError,
    runtime_config::{self, SmtpConfig},
};
use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Service {
    Contact,
    Automatic,
}
impl Service {
    pub fn parse(value: &str) -> Result<Self, AppError> {
        match value {
            "contact" => Ok(Self::Contact),
            "automatic" => Ok(Self::Automatic),
            _ => Err(AppError::NotFound),
        }
    }
    pub fn key(self) -> &'static str {
        match self {
            Self::Contact => "contact",
            Self::Automatic => "automatic",
        }
    }
    pub fn sender(self) -> &'static str {
        match self {
            Self::Contact => crate::mail_provider::CONTACT_RECIPIENT,
            Self::Automatic => crate::mail_provider::AUTOMATED_FROM,
        }
    }
    pub fn for_kind(kind: &str) -> Self {
        if kind == "contact" {
            Self::Contact
        } else {
            Self::Automatic
        }
    }
    fn setting(self) -> String {
        format!("smtp_service_{}", self.key())
    }
    fn secret(self, draft: bool) -> String {
        format!(
            "smtp_{}_password{}",
            self.key(),
            if draft { "_candidate" } else { "" }
        )
    }
    pub fn circuit(self, shared: bool) -> &'static str {
        if shared {
            "smtp"
        } else {
            match self {
                Self::Contact => "smtp_contact",
                Self::Automatic => "smtp_automatic",
            }
        }
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct Settings {
    pub enabled: bool,
    pub shared_transport: bool,
    pub authorized_sender: bool,
    pub independent_auth_required: bool,
    pub config: Option<SmtpConfig>,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            enabled: false,
            shared_transport: true,
            authorized_sender: false,
            independent_auth_required: false,
            config: None,
        }
    }
}
#[derive(Clone, Deserialize, Serialize)]
struct Proof {
    fingerprint: String,
    at: DateTime<Utc>,
    accepted: bool,
    #[serde(default)]
    state: String,
    message_id: Uuid,
}
#[derive(Clone, Default, Deserialize, Serialize)]
struct Record {
    active: Settings,
    draft: Option<Settings>,
    proofs: Vec<Proof>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Write {
    pub settings: Settings,
    #[serde(default)]
    pub password: String,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Test {
    #[serde(default)]
    pub request_id: Option<Uuid>,
    pub recipient: String,
    pub revision: String,
    #[serde(default)]
    pub confirm_authorized_recipient: bool,
}
pub async fn api_mode(state: &AppState) -> Result<bool, AppError> {
    Ok(runtime_config::setting(state, "mail_mode")
        .await?
        .is_some_and(|v| v["api_exclusive"] == true))
}
pub async fn require_smtp_mode(state: &AppState) -> Result<(), AppError> {
    if api_mode(state).await? {
        return Err(AppError::Validation("El modo API continúa guardado. La conmutación a SMTP requiere autorización explícita; no se ha modificado su configuración.".into()));
    }
    Ok(())
}
fn identity(service: Service, mut config: SmtpConfig, enabled: bool) -> SmtpConfig {
    config.from_email = service.sender().into();
    config.from_name = "UASSpain".into();
    config.contact_recipient = crate::mail_provider::CONTACT_RECIPIENT.into();
    config.enabled = enabled && config.enabled;
    config.last_test_at = None;
    config.last_test_ok = None;
    config
}
fn fingerprint(
    state: &AppState,
    service: Service,
    settings: &Settings,
    config: &SmtpConfig,
    password: Option<&str>,
) -> Result<String, AppError> {
    let mut c = config.clone();
    c.last_test_at = None;
    c.last_test_ok = None;
    c.provider.clear();
    state.cipher.blind_index(
        &serde_json::to_string(&(
            service,
            settings.enabled,
            settings.shared_transport,
            settings.authorized_sender,
            settings.independent_auth_required,
            c,
            password,
        ))
        .map_err(|_| AppError::Internal)?,
    )
}
async fn record(state: &AppState, service: Service) -> Result<Record, AppError> {
    if let Some(value) = runtime_config::setting(state, &service.setting()).await? {
        return serde_json::from_value(value).map_err(|_| AppError::Internal);
    }
    // Only exact legacy sender evidence is reusable. A test for info@ never
    // proves no-reply@ authorization. Defaults are never written during reads.
    let (legacy, password) = runtime_config::smtp(state).await?;
    let same = legacy.from_email == service.sender()
        && (service != Service::Contact
            || legacy.contact_recipient == crate::mail_provider::CONTACT_RECIPIENT);
    let accepted = same && runtime_config::smtp_test_valid(&legacy, false);
    let settings = Settings {
        enabled: same && legacy.enabled,
        authorized_sender: accepted,
        ..Default::default()
    };
    let mut result = Record {
        active: settings.clone(),
        ..Default::default()
    };
    if accepted {
        let c = identity(service, legacy.clone(), settings.enabled);
        result.proofs.push(Proof {
            fingerprint: fingerprint(state, service, &settings, &c, password.as_deref())?,
            at: legacy.last_test_at.ok_or(AppError::Internal)?,
            accepted: true,
            state: "ACCEPTED".into(),
            message_id: Uuid::nil(),
        });
    }
    Ok(result)
}
struct Effective {
    settings: Settings,
    config: SmtpConfig,
    password: Option<String>,
    fingerprint: String,
    circuit: &'static str,
    shared_draft: bool,
}
async fn effective(
    state: &AppState,
    service: Service,
    settings: Settings,
    draft: bool,
) -> Result<Effective, AppError> {
    let (base, password, shared_draft) = if settings.shared_transport {
        if draft && let Some(pool) = &state.pool {
            let mut tx = pool.begin().await?;
            let pending = runtime_config::smtp_draft(state, &mut tx).await?;
            tx.rollback().await?;
            if let Some((c, p)) = pending {
                (c, p, true)
            } else {
                let (c, p) = runtime_config::smtp(state).await?;
                (c, p, false)
            }
        } else {
            let (c, p) = runtime_config::smtp(state).await?;
            (c, p, false)
        }
    } else {
        let draft = draft && record(state, service).await?.draft.is_some();
        let password = runtime_config::secret(state, &service.secret(draft)).await?;
        let password = if draft && password.is_none() {
            runtime_config::secret(state, &service.secret(false)).await?
        } else {
            password
        };
        (settings.config.clone().unwrap_or_default(), password, false)
    };
    let config = identity(service, base, settings.enabled);
    let fp = fingerprint(state, service, &settings, &config, password.as_deref())?;
    let circuit = service.circuit(settings.shared_transport);
    Ok(Effective {
        settings,
        config,
        password,
        fingerprint: fp,
        circuit,
        shared_draft,
    })
}
fn proof<'a>(r: &'a Record, e: &Effective, fresh: bool) -> Option<&'a Proof> {
    r.proofs.iter().find(|p| {
        p.fingerprint == e.fingerprint
            && p.accepted
            && p.at <= Utc::now()
            && (!fresh || Utc::now() - p.at < chrono::Duration::hours(24))
    })
}
fn configured(e: &Effective) -> bool {
    e.settings.enabled
        && e.settings.authorized_sender
        && runtime_config::smtp_view(&e.config, e.password.as_deref())["configured"] == true
}
pub async fn active(
    state: &AppState,
    service: Service,
) -> Result<(SmtpConfig, Option<String>), AppError> {
    let mut tx = state
        .pool
        .as_ref()
        .ok_or(AppError::Unavailable)?
        .begin()
        .await?;
    let (c, p, _) = resolve_tx(state, &mut tx, service).await?;
    tx.rollback().await?;
    Ok((c, p))
}
pub async fn password_for_job(
    state: &AppState,
    service: Service,
    shared: bool,
) -> Result<Option<String>, AppError> {
    if shared {
        Ok(runtime_config::smtp(state).await?.1)
    } else {
        runtime_config::secret(state, &service.secret(false)).await
    }
}
pub async fn view(state: &AppState, service: Service) -> Result<Value, AppError> {
    let r = record(state, service).await?;
    let pending = r.draft.is_some();
    let selected = r.draft.clone().unwrap_or_else(|| r.active.clone());
    let e = effective(state, service, selected.clone(), true).await?;
    let a = effective(state, service, r.active.clone(), false).await?;
    let blocked = api_mode(state).await?;
    Ok(
        json!({"service":service,"address":service.sender(),"settings":selected,"config":e.config,"revision":e.fingerprint,"password_configured":e.password.as_ref().is_some_and(|s|!s.is_empty()),"configured":configured(&e),"validated":runtime_config::validate_smtp(&e.config).is_ok(),"verification_status":verification(&r,&e,blocked),"active_ready":!blocked&&configured(&a)&&proof(&r,&a,false).is_some()&&crate::mail_config::circuit_ready(state,a.circuit).await?,"pending_verification":pending||e.shared_draft,"ready_to_activate":proof(&r,&e,true).is_some(),"api_mode_blocked":blocked,"inbound_reception":"BLOCKED_EXTERNAL","replies_technically_blocked":"NOT_VERIFIED"}),
    )
}
pub async fn get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(name): Path<String>,
) -> Result<Json<Value>, AppError> {
    crate::mail_config::admin(&state, &headers)?;
    Ok(Json(view(&state, Service::parse(&name)?).await?))
}
fn validate_settings(service: Service, settings: &mut Settings) -> Result<(), AppError> {
    if settings.shared_transport {
        if settings.config.is_some() {
            return Err(AppError::Validation(
                "El transporte compartido se configura una sola vez.".into(),
            ));
        }
    } else {
        if !settings.independent_auth_required {
            return Err(AppError::Validation(
                "Confirme que el proveedor exige autenticación independiente.".into(),
            ));
        }
        let c = settings
            .config
            .as_mut()
            .ok_or_else(|| AppError::Validation("Complete el transporte independiente.".into()))?;
        if (!c.from_email.is_empty() && c.from_email != service.sender())
            || (!c.from_name.is_empty() && c.from_name != "UASSpain")
            || (!c.contact_recipient.is_empty()
                && c.contact_recipient != crate::mail_provider::CONTACT_RECIPIENT)
        {
            return Err(AppError::Validation(
                "No se permiten identidades corporativas arbitrarias.".into(),
            ));
        }
        c.enabled = settings.enabled;
        *c = identity(service, c.clone(), settings.enabled);
        runtime_config::validate_smtp(c)?;
    }
    Ok(())
}
async fn write_secret(
    state: &AppState,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    service: Service,
    draft: bool,
    password: &str,
) -> Result<(), AppError> {
    if !password.is_empty() {
        runtime_config::save_smtp_secret(state, tx, &service.secret(draft), password).await?;
    }
    Ok(())
}
pub async fn put(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Json(mut input): Json<Write>,
) -> Result<Json<Value>, AppError> {
    let actor = crate::mail_config::admin(&state, &headers)?;
    let service = Service::parse(&name)?;
    validate_settings(service, &mut input.settings)?;
    if input.password.len() > 4096
        || input.password.starts_with("v1:")
        || (input.settings.shared_transport && !input.password.is_empty())
    {
        return Err(AppError::Validation(
            "Credencial no válida para este servicio.".into(),
        ));
    }
    let mut tx = state
        .pool
        .as_ref()
        .ok_or(AppError::Unavailable)?
        .begin()
        .await?;
    runtime_config::lock_email_auth_config(&mut tx).await?;
    require_mode_tx(&mut tx).await?;
    let mut r = record_tx(&state, &mut tx, service).await?;
    let previous = effective_tx(&state, &mut tx, service, r.active.clone(), false).await?;
    let two_factor:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM core_systemsetting WHERE key='auth_policy' AND value->>'enabled'='true') OR EXISTS(SELECT 1 FROM accounts_userprofile WHERE login_2fa_enabled_override IS TRUE)").fetch_one(&mut *tx).await?;
    if service == Service::Automatic
        && two_factor
        && (!input.settings.enabled || !input.settings.authorized_sender)
    {
        return Err(AppError::Validation(
            "El correo automático necesario para 2FA no puede deshabilitarse.".into(),
        ));
    }
    let pending = effective_tx(
        &state,
        &mut tx,
        service,
        r.draft.clone().unwrap_or_else(|| input.settings.clone()),
        true,
    )
    .await?;
    if input.password.is_empty() && !input.settings.shared_transport {
        input.password = pending
            .password
            .or_else(|| {
                if r.active.shared_transport {
                    None
                } else {
                    previous.password.clone()
                }
            })
            .unwrap_or_default();
    }
    let mut next = effective_tx(&state, &mut tx, service, input.settings.clone(), false).await?;
    if !input.settings.shared_transport {
        next.password = Some(input.password.clone());
        next.fingerprint = fingerprint(
            &state,
            service,
            &input.settings,
            &next.config,
            next.password.as_deref(),
        )?;
    }
    let changed = next.fingerprint != previous.fingerprint;
    let protected = configured(&previous) && proof(&r, &previous, false).is_some()
        || (service == Service::Automatic && two_factor);
    let stage = input.settings.enabled
        && input.settings.authorized_sender
        && changed
        && protected
        && proof(&r, &next, true).is_none();
    if stage {
        write_secret(&state, &mut tx, service, true, &input.password).await?;
        r.draft = Some(input.settings);
    } else {
        if changed {
            let busy:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM mail_outbox WHERE provider='smtp' AND state IN ('PENDING','RETRY_SCHEDULED','PROCESSING'))").fetch_one(&mut *tx).await?;
            if busy {
                return Err(AppError::Validation(
                    "La cola tiene mensajes pendientes; se conserva el servicio activo.".into(),
                ));
            }
        }
        write_secret(&state, &mut tx, service, false, &input.password).await?;
        r.active = input.settings;
        r.draft = None;
    }
    crate::mail_config::put_setting(&mut tx, &service.setting(), json!(r)).await?;
    sqlx::query("INSERT INTO mail_circuit(provider) VALUES($1) ON CONFLICT DO NOTHING")
        .bind(next.circuit)
        .execute(&mut *tx)
        .await?;
    crate::mail_config::audit_tx(
        &mut tx,
        actor,
        "smtp_service_saved",
        json!({"service":service,"draft":stage}),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(view(&state, service).await?))
}
pub async fn validate(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Json(mut input): Json<Write>,
) -> Result<Json<Value>, AppError> {
    crate::mail_config::admin(&state, &headers)?;
    let service = Service::parse(&name)?;
    validate_settings(service, &mut input.settings)?;
    if input.password.len() > 4096 || input.password.starts_with("v1:") {
        return Err(AppError::Validation("Contraseña no válida.".into()));
    }
    let e = effective(&state, service, input.settings, true).await?;
    runtime_config::validate_smtp(&e.config)?;
    Ok(Json(
        json!({"valid":true,"detail":"Formato válido; no se ha conectado ni enviado correo. La autorización del proveedor sigue pendiente."}),
    ))
}
pub async fn test(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Json(input): Json<Test>,
) -> Result<Json<Value>, AppError> {
    let actor = crate::mail_config::admin(&state, &headers)?;
    let service = Service::parse(&name)?;
    if !input.confirm_authorized_recipient {
        return Err(AppError::Validation(
            "Autorice expresamente la prueba para este servicio y destinatario.".into(),
        ));
    }
    crate::mail_provider::address(&input.recipient)?;
    let request_id = input.request_id.filter(|id| !id.is_nil()).ok_or_else(|| {
        AppError::Validation("La prueba requiere un identificador único de solicitud.".into())
    })?;
    let idempotency = state.cipher.blind_index(&format!(
        "smtp-test:{actor}:{}:{}:{}:{request_id}",
        service.key(),
        input.revision,
        input.recipient
    ))?;
    let recipient_index = state.cipher.blind_index(&input.recipient)?;
    let mut tx = state
        .pool
        .as_ref()
        .ok_or(AppError::Unavailable)?
        .begin()
        .await?;
    runtime_config::lock_email_auth_config(&mut tx).await?;
    require_mode_tx(&mut tx).await?;
    crate::auth::enforce_login_rate(
        &headers,
        &format!("smtp-service-test:{actor}:{}", service.key()),
    )?;

    let r = record_tx(&state, &mut tx, service).await?;
    let is_draft = r.draft.is_some();
    let e = effective_tx(
        &state,
        &mut tx,
        service,
        r.draft.clone().unwrap_or_else(|| r.active.clone()),
        true,
    )
    .await?;
    if e.fingerprint != input.revision {
        return Err(AppError::EditConflict);
    }
    if r.proofs
        .iter()
        .any(|p| p.fingerprint == e.fingerprint && p.state == "UNKNOWN")
    {
        return Err(AppError::Validation("Existe una prueba con resultado incierto para esta configuración. No se ha repetido el envío; revise el registro antes de continuar.".into()));
    }
    let uncertain:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM mail_outbox WHERE state='UNKNOWN' AND validity->>'smtp_service'=$1 AND validity->>'smtp_revision'=$2)").bind(service.key()).bind(&e.fingerprint).fetch_one(&mut *tx).await?;
    if uncertain {
        return Err(AppError::Validation(
            "La prueba anterior sigue en UNKNOWN; no se ha repetido el envío.".into(),
        ));
    }
    let in_flight:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM mail_outbox WHERE message_type='provider_test' AND state IN ('PENDING','PROCESSING','RETRY_SCHEDULED') AND validity->>'smtp_service'=$1 AND validity->>'smtp_revision'=$2 AND validity->>'smtp_test_recipient'=$3 AND idempotency_key<>$4)").bind(service.key()).bind(&e.fingerprint).bind(&recipient_index).bind(&idempotency).fetch_one(&mut *tx).await?;
    if in_flight {
        return Err(AppError::EditConflict);
    }
    if !configured(&e) {
        return Err(AppError::Validation(
            "Guarde la configuración completa y confirme el remitente autorizado antes de probar."
                .into(),
        ));
    }
    let envelope = crate::mail_provider::Envelope {
        from: service.sender().into(),
        from_name: "UASSpain".into(),
        to: input.recipient,
        reply_to: None,
        subject: format!("Prueba SMTP {} UASSpain", service.key()),
        body: "Prueba explícitamente autorizada para este servicio y destinatario.".into(),
        smtp: Some(e.config.clone()),
    };
    let id=crate::mail_queue::enqueue_explicit(&state,&mut tx,"smtp",&envelope,crate::mail_queue::QueueOptions{kind:"provider_test",ttl:chrono::Duration::minutes(5),validity:json!({"smtp_service":service,"smtp_shared":e.settings.shared_transport,"smtp_circuit":e.circuit,"smtp_revision":e.fingerprint,"smtp_test_recipient":recipient_index}),idempotency:Some(&idempotency)}).await?;
    tx.commit().await?;
    let previous_state: String = sqlx::query_scalar("SELECT state FROM mail_outbox WHERE id=$1")
        .bind(id)
        .fetch_one(state.pool.as_ref().ok_or(AppError::Unavailable)?)
        .await?;
    let result = if previous_state == "ACCEPTED" {
        crate::mail_provider::Outcome::Accepted(None)
    } else if previous_state == "FAILED" {
        crate::mail_provider::Outcome::Failed("previous_test_failed")
    } else if previous_state == "UNKNOWN" {
        crate::mail_provider::Outcome::Unknown("smtp_result_unknown")
    } else if previous_state == "PROCESSING" {
        return Err(AppError::EditConflict);
    } else if is_draft || e.shared_draft {
        crate::mail_queue::process_smtp_candidate_test(
            &state,
            id,
            e.password.as_deref().unwrap_or_default(),
        )
        .await?
    } else {
        crate::mail_queue::process_test(&state, id, e.password.as_deref().unwrap_or_default())
            .await?
    };
    let accepted = matches!(result, crate::mail_provider::Outcome::Accepted(_));
    let mut tx = state
        .pool
        .as_ref()
        .ok_or(AppError::Unavailable)?
        .begin()
        .await?;
    runtime_config::lock_email_auth_config(&mut tx).await?;
    let mut r = record_tx(&state, &mut tx, service).await?;
    let latest = effective_tx(
        &state,
        &mut tx,
        service,
        r.draft.clone().unwrap_or_else(|| r.active.clone()),
        true,
    )
    .await?;
    if latest.fingerprint != e.fingerprint {
        return Err(AppError::EditConflict);
    }
    let (delivery_state, delivery_at): (String, DateTime<Utc>) =
        sqlx::query_as("SELECT state,updated_at FROM mail_outbox WHERE id=$1")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    r.proofs.retain(|p| p.fingerprint != e.fingerprint);
    r.proofs.push(Proof {
        fingerprint: e.fingerprint.clone(),
        at: delivery_at,
        accepted,
        state: delivery_state,
        message_id: id,
    });
    if r.proofs.len() > 4 {
        let active_fingerprint = effective_tx(&state, &mut tx, service, r.active.clone(), false)
            .await?
            .fingerprint;
        if let Some(index) = r
            .proofs
            .iter()
            .position(|p| p.fingerprint != active_fingerprint)
        {
            r.proofs.remove(index);
        }
    }
    if accepted
        && e.shared_draft
        && let Some((mut c, _)) = runtime_config::smtp_draft(&state, &mut tx).await?
    {
        c.last_test_ok = Some(true);
        c.last_test_at = Some(delivery_at);
        runtime_config::store_smtp_draft(&mut tx, c).await?;
    }
    crate::mail_config::put_setting(&mut tx, &service.setting(), json!(r)).await?;
    crate::mail_config::audit_tx(&mut tx,actor,"smtp_service_test",json!({"service":service,"message_id":id,"accepted":accepted,"active_configuration_changed":false})).await?;
    tx.commit().await?;
    if !accepted {
        return Err(AppError::Unavailable);
    }
    Ok(Json(
        json!({"state":"ACCEPTED","message_id":id,"detail":"El transporte SMTP ha aceptado esta prueba. La recepción y capacidad de respuesta del buzón siguen pendientes de comprobación externa."}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config() -> SmtpConfig {
        SmtpConfig {
            enabled: true,
            host: "smtp.fixture.invalid".into(),
            port: 587,
            security: "STARTTLS".into(),
            username: "fixture@example.invalid".into(),
            from_email: "no-reply@uasspain.com".into(),
            from_name: "UASSpain".into(),
            contact_recipient: "info@uasspain.com".into(),
            timeout_seconds: 2,
            ..Default::default()
        }
    }
    fn headers(role: &str) -> HeaderMap {
        let state = AppState::for_test();
        let now = Utc::now().timestamp() as usize;
        let claims = crate::auth::Claims {
            user_id: 0,
            profile_id: Uuid::new_v4(),
            role: role.into(),
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
        let mut h = HeaderMap::new();
        h.insert("x-uasspain-verified-session", jwt.parse().unwrap());
        let _ = state;
        h
    }
    #[test]
    fn message_types_select_fixed_corporate_senders() {
        assert_eq!(Service::for_kind("contact").sender(), "info@uasspain.com");
        for kind in [
            "password_reset",
            "registration_otp",
            "login_otp",
            "notification",
            "invitation",
            "otp",
            "2fa",
        ] {
            assert_eq!(Service::for_kind(kind).sender(), "no-reply@uasspain.com");
        }
        assert!(Service::parse("postmark").is_err());
    }
    #[test]
    fn independent_configuration_requires_provider_need_and_fixed_identity() {
        let mut settings = Settings {
            enabled: true,
            shared_transport: false,
            authorized_sender: true,
            config: Some(config()),
            ..Default::default()
        };
        assert!(validate_settings(Service::Automatic, &mut settings).is_err());
        settings.independent_auth_required = true;
        assert!(validate_settings(Service::Automatic, &mut settings).is_ok());
        settings.config.as_mut().unwrap().from_email = "visitor@example.invalid".into();
        assert!(validate_settings(Service::Automatic, &mut settings).is_err());
        settings.config.as_mut().unwrap().from_email = "no-reply@uasspain.com".into();
        settings.config.as_mut().unwrap().username = "user\nInjected".into();
        assert!(validate_settings(Service::Automatic, &mut settings).is_err());
    }
    #[test]
    fn shared_transport_is_not_duplicated_in_profiles() {
        let mut s = Settings {
            config: Some(config()),
            ..Default::default()
        };
        assert!(validate_settings(Service::Contact, &mut s).is_err());
        s.config = None;
        assert!(validate_settings(Service::Contact, &mut s).is_ok());
    }
    #[test]
    fn sender_proof_is_bound_to_service_transport_credential_and_authorization() {
        let state = AppState::for_test();
        let settings = Settings {
            enabled: true,
            authorized_sender: true,
            ..Default::default()
        };
        let c = config();
        let fp = fingerprint(
            &state,
            Service::Automatic,
            &settings,
            &c,
            Some("synthetic-a"),
        )
        .unwrap();
        assert_ne!(
            fp,
            fingerprint(&state, Service::Contact, &settings, &c, Some("synthetic-a")).unwrap()
        );
        assert_ne!(
            fp,
            fingerprint(
                &state,
                Service::Automatic,
                &settings,
                &c,
                Some("synthetic-b")
            )
            .unwrap()
        );
        let mut changed = c.clone();
        changed.host = "other.fixture.invalid".into();
        assert_ne!(
            fp,
            fingerprint(
                &state,
                Service::Automatic,
                &settings,
                &changed,
                Some("synthetic-a")
            )
            .unwrap()
        );
        let mut changed_settings = settings;
        changed_settings.authorized_sender = false;
        assert_ne!(
            fp,
            fingerprint(
                &state,
                Service::Automatic,
                &changed_settings,
                &c,
                Some("synthetic-a")
            )
            .unwrap()
        );
    }
    #[test]
    fn historical_proof_preserves_active_delivery_but_new_activation_requires_recent_proof() {
        let e = Effective {
            settings: Settings::default(),
            config: config(),
            password: None,
            fingerprint: "a".into(),
            circuit: "smtp",
            shared_draft: false,
        };
        let mut r = Record {
            proofs: vec![Proof {
                fingerprint: "a".into(),
                at: Utc::now() - chrono::Duration::days(2),
                accepted: true,
                state: "ACCEPTED".into(),
                message_id: Uuid::new_v4(),
            }],
            ..Default::default()
        };
        assert!(proof(&r, &e, false).is_some());
        assert!(proof(&r, &e, true).is_none());
        r.proofs[0].at = Utc::now() + chrono::Duration::minutes(1);
        assert!(proof(&r, &e, false).is_none());
        r.proofs[0].at = Utc::now();
        r.proofs[0].accepted = false;
        assert!(proof(&r, &e, false).is_none());
    }
    #[test]
    fn client_cannot_submit_verification_evidence_or_arbitrary_sender_fields() {
        assert!(
            serde_json::from_value::<Write>(json!({"settings":{},"proofs":[{"accepted":true}]}))
                .is_err()
        );
        assert!(
            serde_json::from_value::<Write>(
                json!({"settings":{"from_email":"evil@example.invalid"}})
            )
            .is_err()
        );
        assert_ne!(
            Service::Contact.circuit(false),
            Service::Automatic.circuit(false)
        );
        assert_eq!(
            Service::Contact.circuit(true),
            Service::Automatic.circuit(true)
        );
    }
    #[tokio::test]
    async fn administrative_configuration_and_validation_require_auth_and_role() {
        let state = Arc::new(AppState::for_test());
        assert!(matches!(
            get(
                State(state.clone()),
                HeaderMap::new(),
                Path("contact".into())
            )
            .await,
            Err(AppError::Unauthorized)
        ));
        assert!(matches!(
            get(
                State(state.clone()),
                headers("alumno"),
                Path("automatic".into())
            )
            .await,
            Err(AppError::Forbidden)
        ));
        let input = Write {
            settings: Settings {
                enabled: true,
                shared_transport: false,
                authorized_sender: true,
                independent_auth_required: true,
                config: Some(config()),
            },
            password: "synthetic-fixture-only".into(),
        };
        let view = validate(
            State(state),
            headers("admin"),
            Path("automatic".into()),
            Json(input),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(view["valid"], true);
        assert!(!view.to_string().contains("synthetic-fixture-only"));
    }
}

/// Synthetic evidence only for isolated policy regression, never production.
#[cfg(test)]
pub(crate) async fn fixture_proof(
    state: &AppState,
    service: Service,
    config: &SmtpConfig,
    password: &str,
) {
    let pool = state.pool.as_ref().unwrap();
    let marker: Option<String> =
        sqlx::query_scalar("SELECT current_setting('uasspain.mail_fixture',true)")
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(marker.as_deref(), Some("mail-repair-20261025"));
    let mut r = record(state, service).await.unwrap();
    let c = identity(service, config.clone(), r.active.enabled);
    r.proofs.push(Proof {
        fingerprint: fingerprint(state, service, &r.active, &c, Some(password)).unwrap(),
        at: Utc::now(),
        accepted: true,
        state: "ACCEPTED".into(),
        message_id: Uuid::new_v4(),
    });
    let mut tx = pool.begin().await.unwrap();
    crate::mail_config::put_setting(&mut tx, &service.setting(), json!(r))
        .await
        .unwrap();
    tx.commit().await.unwrap();
}

#[cfg(test)]
#[path = "smtp_services_integration.rs"]
mod isolated_integration;

// Transaction-scoped reads prevent configuration-lock holders from waiting on
// additional pool slots exhausted by concurrent mail transactions.
async fn secret_tx(
    state: &AppState,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    key: &str,
) -> Result<Option<String>, AppError> {
    let value: Option<String> =
        sqlx::query_scalar("SELECT ciphertext FROM core_systemsecret WHERE key=$1")
            .bind(key)
            .fetch_optional(&mut **tx)
            .await?;
    value.map(|s| state.cipher.decrypt(&s)).transpose()
}
pub(crate) async fn require_mode_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<(), AppError> {
    let mode: Option<Value> =
        sqlx::query_scalar("SELECT value FROM core_systemsetting WHERE key='mail_mode'")
            .fetch_optional(&mut **tx)
            .await?;
    if mode.is_some_and(|v| v["api_exclusive"] == true) {
        return Err(AppError::Validation(
            "El modo API continúa guardado; su conmutación requiere autorización expresa.".into(),
        ));
    }
    Ok(())
}
async fn record_tx(
    state: &AppState,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    service: Service,
) -> Result<Record, AppError> {
    let value: Option<Value> =
        sqlx::query_scalar("SELECT value FROM core_systemsetting WHERE key=$1")
            .bind(service.setting())
            .fetch_optional(&mut **tx)
            .await?;
    if let Some(value) = value {
        return serde_json::from_value(value).map_err(|_| AppError::Internal);
    }
    let (legacy, password) = runtime_config::smtp_in_transaction(state, tx).await?;
    let same = legacy.from_email == service.sender()
        && (service != Service::Contact
            || legacy.contact_recipient == crate::mail_provider::CONTACT_RECIPIENT);
    let accepted = same && runtime_config::smtp_test_valid(&legacy, false);
    let settings = Settings {
        enabled: same && legacy.enabled,
        authorized_sender: accepted,
        ..Default::default()
    };
    let mut r = Record {
        active: settings.clone(),
        ..Default::default()
    };
    if accepted {
        let config = identity(service, legacy.clone(), settings.enabled);
        r.proofs.push(Proof {
            fingerprint: fingerprint(state, service, &settings, &config, password.as_deref())?,
            at: legacy.last_test_at.ok_or(AppError::Internal)?,
            accepted: true,
            state: "ACCEPTED".into(),
            message_id: Uuid::nil(),
        });
    }
    Ok(r)
}
async fn effective_tx(
    state: &AppState,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    service: Service,
    settings: Settings,
    draft: bool,
) -> Result<Effective, AppError> {
    let (base, password, shared_draft) = if settings.shared_transport {
        if draft && let Some((c, p)) = runtime_config::smtp_draft(state, tx).await? {
            (c, p, true)
        } else {
            let (c, p) = runtime_config::smtp_in_transaction(state, tx).await?;
            (c, p, false)
        }
    } else {
        let draft = draft && record_tx(state, tx, service).await?.draft.is_some();
        let p = secret_tx(state, tx, &service.secret(draft)).await?;
        let p = if draft && p.is_none() {
            secret_tx(state, tx, &service.secret(false)).await?
        } else {
            p
        };
        (settings.config.clone().unwrap_or_default(), p, false)
    };
    let config = identity(service, base, settings.enabled);
    let fp = fingerprint(state, service, &settings, &config, password.as_deref())?;
    let circuit = service.circuit(settings.shared_transport);
    Ok(Effective {
        settings,
        config,
        password,
        fingerprint: fp,
        circuit,
        shared_draft,
    })
}
pub(crate) async fn resolve_tx(
    state: &AppState,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    service: Service,
) -> Result<(SmtpConfig, Option<String>, &'static str), AppError> {
    require_mode_tx(tx).await?;
    let r = record_tx(state, tx, service).await?;
    let mut e = effective_tx(state, tx, service, r.active.clone(), false).await?;
    if let Some(p) = proof(&r, &e, false) {
        e.config.last_test_ok = Some(true);
        e.config.last_test_at = Some(p.at);
    }
    if !configured(&e) || e.config.last_test_ok != Some(true) {
        return Err(AppError::Validation(format!(
            "Configure y verifique el remitente SMTP {}.",
            service.sender()
        )));
    }
    Ok((e.config, e.password, e.circuit))
}
pub(crate) async fn automatic_shared_tx(
    state: &AppState,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<bool, AppError> {
    Ok(record_tx(state, tx, Service::Automatic)
        .await?
        .active
        .shared_transport)
}
pub(crate) async fn candidate_ready_tx(
    state: &AppState,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    service: Service,
    config: &SmtpConfig,
    password: Option<&str>,
) -> Result<bool, AppError> {
    let r = record_tx(state, tx, service).await?;
    if !r.active.shared_transport {
        return Ok(true);
    }
    let c = identity(service, config.clone(), r.active.enabled);
    let fp = fingerprint(state, service, &r.active, &c, password)?;
    Ok(r.proofs.iter().any(|p| {
        p.fingerprint == fp
            && p.accepted
            && p.at <= Utc::now()
            && Utc::now() - p.at < chrono::Duration::hours(24)
    }))
}
pub(crate) async fn shared_change_allowed_tx(
    state: &AppState,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    config: &SmtpConfig,
    password: Option<&str>,
) -> Result<bool, AppError> {
    for service in [Service::Contact, Service::Automatic] {
        let r = record_tx(state, tx, service).await?;
        if !r.active.shared_transport {
            continue;
        }
        let e = effective_tx(state, tx, service, r.active.clone(), false).await?;
        if configured(&e)
            && proof(&r, &e, false).is_some()
            && !candidate_ready_tx(state, tx, service, config, password).await?
        {
            return Ok(false);
        }
    }
    Ok(true)
}

fn verification(r: &Record, e: &Effective, blocked: bool) -> String {
    if blocked {
        return "BLOCKED_API_MODE".into();
    }
    if proof(r, e, false).is_some() {
        return "ACCEPTED".into();
    }
    if let Some(p) = r.proofs.iter().find(|p| {
        p.fingerprint == e.fingerprint
            && p.at <= Utc::now()
            && matches!(p.state.as_str(), "FAILED" | "UNKNOWN" | "RETRY_SCHEDULED")
    }) {
        return p.state.clone();
    }
    if !e.settings.enabled {
        "NOT_CONFIGURED".into()
    } else {
        "BLOCKED_PENDING_AUTHORIZED_TEST".into()
    }
}
