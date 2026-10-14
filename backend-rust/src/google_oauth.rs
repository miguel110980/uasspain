//! Google OIDC configuration and explicit linking. Email is never an identity key.
use crate::{AppState, auth, error::AppError, runtime_config};
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, header::SET_COOKIE},
    response::{IntoResponse, Response},
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Transaction};
use std::{sync::Arc, time::Duration};
use uuid::Uuid;

const SECRET_KEY: &str = "google_oauth_client_secret";
const CALLBACK_PATH: &str = "/auth/google/callback";

#[derive(Clone, Deserialize, Serialize)]
#[serde(default)]
pub struct Config {
    pub enabled: bool,
    pub client_id: String,
    pub corporate_email: String,
    pub revision: i64,
    pub verified_at: Option<DateTime<Utc>>,
    pub verification_flow_id: Option<Uuid>,
    pub verified_origin: Option<String>,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            enabled: false,
            client_id: String::new(),
            corporate_email: "info@uasspain.com".into(),
            revision: 0,
            verified_at: None,
            verification_flow_id: None,
            verified_origin: None,
        }
    }
}
impl Config {
    pub fn verified(&self) -> bool {
        self.verified_at.is_some()
            && self.verification_flow_id.is_some()
            && self
                .verified_origin
                .as_ref()
                .is_some_and(|origin| trusted_origin().is_ok_and(|actual| &actual == origin))
    }
}
pub async fn config(state: &AppState) -> Result<Config, AppError> {
    if let Some(v) = runtime_config::setting(state, "google_oauth").await? {
        serde_json::from_value(v).map_err(|_| AppError::Internal)
    } else {
        Ok(Config {
            client_id: std::env::var("GOOGLE_CLIENT_ID").unwrap_or_default(),
            ..Config::default()
        })
    }
}
pub fn trusted_origin() -> Result<String, AppError> {
    origin_from(
        &std::env::var("FRONTEND_URL").map_err(|_| AppError::Unavailable)?,
        runtime_config::env_true("APP_PRODUCTION"),
    )
}
fn origin_from(value: &str, production: bool) -> Result<String, AppError> {
    let u = url::Url::parse(value).map_err(|_| AppError::Unavailable)?;
    let local = matches!(u.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if !u.username().is_empty()
        || u.password().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
        || u.path() != "/"
        || u.host_str().is_none()
        || !(u.scheme() == "https" || (!production && local && u.scheme() == "http"))
    {
        return Err(AppError::Unavailable);
    }
    Ok(u.origin().ascii_serialization())
}
pub(crate) fn oidc_endpoint(kind: &str) -> Result<String, AppError> {
    // Synthetic endpoints are strictly limited to the existing isolated test DB.
    // A false APP_PRODUCTION flag on MAIN alone cannot activate this adapter.
    let isolated = if let Ok(value) = std::env::var("DATABASE_URL") {
        url::Url::parse(&value).is_ok_and(|u| u.path() == "/test_e2e_uasspain")
    } else {
        std::env::var("DB_NAME").ok().as_deref() == Some("test_e2e_uasspain")
            && std::env::var("DB_HOST").ok().as_deref() == Some("postgres-e2e")
    };
    if runtime_config::env_true("GOOGLE_OIDC_SYNTHETIC_TESTS") {
        if runtime_config::env_true("APP_PRODUCTION") || !isolated {
            return Err(AppError::Unavailable);
        }
        return Ok(format!("http://google-oidc-e2e:8080/{kind}"));
    }
    Ok(match kind {
        "token" => "https://oauth2.googleapis.com/token",
        "certs" => "https://www.googleapis.com/oauth2/v3/certs",
        _ => return Err(AppError::Internal),
    }
    .into())
}
async fn lock(tx: &mut Transaction<'_, Postgres>) -> Result<(), AppError> {
    sqlx::query("SELECT pg_advisory_xact_lock(724851908)")
        .execute(&mut **tx)
        .await?;
    Ok(())
}
async fn config_tx(tx: &mut Transaction<'_, Postgres>) -> Result<Config, AppError> {
    let v: Option<Value> =
        sqlx::query_scalar("SELECT value FROM core_systemsetting WHERE key='google_oauth'")
            .fetch_optional(&mut **tx)
            .await?;
    v.map(serde_json::from_value)
        .transpose()
        .map_err(|_| AppError::Internal)
        .map(|c| c.unwrap_or_default())
}
async fn audit(
    tx: &mut Transaction<'_, Postgres>,
    actor: Option<Uuid>,
    action: &str,
    context: Value,
) -> Result<(), AppError> {
    sqlx::query("INSERT INTO core_auditlog(id,created_date,updated_date,model_name,instance_id,action,extra,profile_id) VALUES($1,clock_timestamp(),clock_timestamp(),'GoogleOAuth','',$2,$3,$4)")
        .bind(Uuid::new_v4()).bind(action).bind(&context).bind(actor).execute(&mut **tx).await?;
    sqlx::query(
        "INSERT INTO google_oauth_event(id,actor_id,operation,context) VALUES($1,$2,$3,$4)",
    )
    .bind(Uuid::new_v4())
    .bind(actor)
    .bind(action)
    .bind(context)
    .execute(&mut **tx)
    .await?;
    Ok(())
}
async fn admin_tx(
    state: &AppState,
    headers: &HeaderMap,
    tx: &mut Transaction<'_, Postgres>,
) -> Result<auth::Claims, AppError> {
    let c = auth::authenticate(state, headers, "access")?;
    auth::require_role(&c, &["admin"])?;
    crate::account_lifecycle::actor_active(tx, &c).await?;
    Ok(c)
}
async fn reauthenticate(
    state: &AppState,
    headers: &HeaderMap,
    password: String,
) -> Result<(auth::Claims, String), AppError> {
    let c = auth::authenticate(state, headers, "access")?;
    auth::require_role(&c, &["admin"])?;
    auth::enforce_login_rate(headers, &format!("google-reauth:{}", c.profile_id))?;
    if password.is_empty() || password.len() > 128 {
        return Err(AppError::Validation(
            "Confirme su contraseña actual.".into(),
        ));
    }
    let hash:String=sqlx::query_scalar("SELECT u.password FROM auth_user u JOIN accounts_userprofile p ON p.user_id=u.id WHERE p.id=$1")
        .bind(c.profile_id).fetch_one(state.pool.as_ref().ok_or(AppError::Unavailable)?).await?;
    if !crate::security::verify_password_hash_async(password, hash.clone()).await? {
        let mut tx = state
            .pool
            .as_ref()
            .ok_or(AppError::Unavailable)?
            .begin()
            .await?;
        crate::account_lifecycle::actor_active(&mut tx, &c).await?;
        audit(
            &mut tx,
            Some(c.profile_id),
            "google_reauthentication_denied",
            json!({"reason":"current_password_invalid"}),
        )
        .await?;
        tx.commit().await?;
        return Err(AppError::Forbidden);
    }
    Ok((c, hash))
}
async fn public_view(state: &AppState, c: Config, actor: Uuid) -> Result<Value, AppError> {
    let secret = runtime_config::secret(state, SECRET_KEY).await?.is_some();
    let origin = trusted_origin().ok();
    let linked: bool = sqlx::query_scalar(
        "SELECT google_subject_lookup IS NOT NULL FROM accounts_userprofile WHERE id=$1",
    )
    .bind(actor)
    .fetch_one(state.pool.as_ref().ok_or(AppError::Unavailable)?)
    .await?;
    let state_name = if origin.is_none() {
        "BLOCKED_ORIGIN"
    } else if c.client_id.is_empty() || !secret {
        "NOT_CONFIGURED"
    } else if !c.verified() {
        "CONFIGURED_PENDING_VERIFICATION"
    } else if c.enabled {
        "ACTIVE"
    } else {
        "VERIFIED_DISABLED"
    };
    Ok(
        json!({"enabled":c.enabled&&c.verified()&&secret,"client_id":c.client_id,"corporate_email":c.corporate_email,"revision":c.revision,"client_secret_configured":secret,"verified_at":c.verified_at,"status":state_name,"linked":linked,"public_origin":origin,"redirect_uri":origin.as_ref().map(|o|format!("{o}{CALLBACK_PATH}")),"configured":c.verified()&&secret,"provider":"google","flow":"authorization_code_pkce","mail_provider_unchanged":true}),
    )
}
pub async fn get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    let c = auth::authenticate(&state, &headers, "access")?;
    auth::require_role(&c, &["admin"])?;
    Ok(Json(
        public_view(&state, config(&state).await?, c.profile_id).await?,
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Write {
    pub client_id: String,
    pub corporate_email: String,
    pub enabled: bool,
    #[serde(default)]
    pub client_secret: String,
    pub expected_revision: i64,
}
pub async fn put(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<Write>,
) -> Result<Json<Value>, AppError> {
    let claims = auth::authenticate(&state, &headers, "access")?;
    auth::require_role(&claims, &["admin"])?;
    auth::enforce_login_rate(&headers, "google-config-save")?;
    if !runtime_config::valid_client_id(&input.client_id)
        || input.client_secret.len() > 4096
        || input.client_secret.chars().any(char::is_control)
        || input.client_secret.starts_with("v1:")
    {
        return Err(AppError::Validation(
            "Client ID o Client Secret no válido.".into(),
        ));
    }
    crate::mail_provider::address(&input.corporate_email)?;
    trusted_origin()?;
    let mut tx = state
        .pool
        .as_ref()
        .ok_or(AppError::Unavailable)?
        .begin()
        .await?;
    lock(&mut tx).await?;
    let actor = admin_tx(&state, &headers, &mut tx).await?;
    let mut c = config_tx(&mut tx).await?;
    if input.expected_revision != c.revision {
        return Err(AppError::EditConflict);
    }
    let changed = input.client_id != c.client_id
        || input.corporate_email != c.corporate_email
        || !input.client_secret.is_empty();
    if input.enabled
        && (changed || !c.verified() || runtime_config::secret(&state, SECRET_KEY).await?.is_none())
    {
        return Err(AppError::Validation(
            "Guarde primero sin activar y complete la verificación real con Google.".into(),
        ));
    }
    if changed {
        c.verified_at = None;
        c.verification_flow_id = None;
        c.verified_origin = None;
    }
    c.client_id = input.client_id;
    c.corporate_email = input.corporate_email;
    c.enabled = input.enabled;
    c.revision += 1;
    if !input.client_secret.is_empty() {
        sqlx::query("INSERT INTO core_systemsecret(id,key,ciphertext) VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,updated_at=clock_timestamp(),rotated_at=clock_timestamp()")
        .bind(Uuid::new_v4()).bind(SECRET_KEY).bind(state.cipher.encrypt(&input.client_secret)?).execute(&mut *tx).await?;
    }
    crate::mail_config::put_setting(&mut tx, "google_oauth", json!(c)).await?;
    audit(&mut tx,Some(actor.profile_id),"google_configuration_saved",json!({"revision":c.revision,"enabled":c.enabled,"secret_changed":!input.client_secret.is_empty()})).await?;
    tx.commit().await?;
    Ok(Json(public_view(&state, c, actor.profile_id).await?))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Start {
    #[serde(default)]
    pub current_password: String,
}
#[derive(Serialize, Deserialize)]
struct Payload {
    verifier: String,
    nonce: String,
    session_key: Option<String>,
    password_fingerprint: Option<String>,
    redirect_uri: String,
}
fn random_value() -> String {
    let mut v = [0u8; 32];
    rand::rng().fill_bytes(&mut v);
    URL_SAFE_NO_PAD.encode(v)
}
fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}
fn authorization_url(
    client: &str,
    redirect: &str,
    state: &str,
    nonce: &str,
    verifier: &str,
) -> Result<String, AppError> {
    let mut u = url::Url::parse("https://accounts.google.com/o/oauth2/v2/auth")
        .map_err(|_| AppError::Internal)?;
    u.query_pairs_mut().extend_pairs([
        ("client_id", client),
        ("redirect_uri", redirect),
        ("response_type", "code"),
        ("scope", "openid email profile"),
        ("state", state),
        ("nonce", nonce),
        ("code_challenge", &challenge(verifier)),
        ("code_challenge_method", "S256"),
        ("prompt", "select_account"),
    ]);
    Ok(u.into())
}
async fn begin(
    state: Arc<AppState>,
    headers: HeaderMap,
    input: Start,
    purpose: &str,
) -> Result<Response, AppError> {
    let window = auth::window_id(&headers)?;
    auth::enforce_login_rate(&headers, &format!("google-code-start:{purpose}"))?;
    let owner = if purpose == "login" {
        None
    } else {
        Some(reauthenticate(&state, &headers, input.current_password).await?)
    };
    let mut tx = state
        .pool
        .as_ref()
        .ok_or(AppError::Unavailable)?
        .begin()
        .await?;
    lock(&mut tx).await?;
    let c = config_tx(&mut tx).await?;
    if !runtime_config::valid_client_id(&c.client_id)
        || runtime_config::secret(&state, SECRET_KEY).await?.is_none()
        || (purpose == "login" && (!c.enabled || !c.verified()))
    {
        return Err(AppError::Unavailable);
    }
    if let Some((claims, hash)) = &owner {
        admin_tx(&state, &headers, &mut tx).await?;
        let valid:bool=sqlx::query_scalar("SELECT u.password=$2 FROM accounts_userprofile p JOIN auth_user u ON u.id=p.user_id WHERE p.id=$1").bind(claims.profile_id).bind(hash).fetch_one(&mut *tx).await?;
        if !valid {
            return Err(AppError::Unauthorized);
        }
    }
    let redirect = format!("{}{CALLBACK_PATH}", trusted_origin()?);
    let id = Uuid::new_v4();
    let state_value = format!("{id}.{}", random_value());
    let cookie = random_value();
    let verifier = random_value();
    let nonce = random_value();
    let payload = Payload {
        verifier: verifier.clone(),
        nonce: nonce.clone(),
        session_key: owner.as_ref().map(|o| o.0.session_key.clone()),
        password_fingerprint: owner
            .as_ref()
            .map(|o| state.cipher.blind_index(&o.1))
            .transpose()?,
        redirect_uri: redirect.clone(),
    };
    sqlx::query("INSERT INTO google_oauth_flow(id,state_lookup,cookie_lookup,window_lookup,purpose,profile_id,config_revision,payload_ciphertext,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp()+INTERVAL '5 minutes')")
        .bind(id).bind(state.cipher.blind_index(&state_value)?).bind(state.cipher.blind_index(&cookie)?).bind(state.cipher.blind_index(&format!("window:{window}"))?).bind(purpose).bind(owner.as_ref().map(|o|o.0.profile_id)).bind(c.revision).bind(state.cipher.encrypt(&serde_json::to_string(&payload).map_err(|_|AppError::Internal)?)?).execute(&mut *tx).await?;
    audit(
        &mut tx,
        owner.as_ref().map(|o| o.0.profile_id),
        "google_flow_started",
        json!({"flow_id":id,"purpose":purpose,"revision":c.revision}),
    )
    .await?;
    tx.commit().await?;
    let secure = if redirect.starts_with("https:") {
        "; Secure"
    } else {
        ""
    };
    let mut response=Json(json!({"authorization_url":authorization_url(&c.client_id,&redirect,&state_value,&nonce,&verifier)?,"purpose":purpose})).into_response();
    response.headers_mut().append(SET_COOKIE,format!("uasspain_google_flow_{id}={cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=300{secure}").parse().map_err(|_|AppError::Internal)?);
    Ok(response)
}
pub async fn login_start(
    State(s): State<Arc<AppState>>,
    h: HeaderMap,
    Json(i): Json<Start>,
) -> Result<Response, AppError> {
    begin(s, h, i, "login").await
}
pub async fn verify_start(
    State(s): State<Arc<AppState>>,
    h: HeaderMap,
    Json(i): Json<Start>,
) -> Result<Response, AppError> {
    begin(s, h, i, "verify").await
}
pub async fn link_start(
    State(s): State<Arc<AppState>>,
    h: HeaderMap,
    Json(i): Json<Start>,
) -> Result<Response, AppError> {
    begin(s, h, i, "link").await
}
#[derive(sqlx::FromRow)]
struct Flow {
    id: Uuid,
    cookie_lookup: String,
    window_lookup: String,
    purpose: String,
    profile_id: Option<Uuid>,
    config_revision: i64,
    payload_ciphertext: String,
    expires_at: DateTime<Utc>,
    consumed_at: Option<DateTime<Utc>>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Complete {
    pub state: String,
    pub code: String,
}
async fn bounded_json(mut r: reqwest::Response) -> Result<Value, AppError> {
    let mut bytes = Vec::new();
    while let Some(c) = r.chunk().await.map_err(|_| AppError::Unavailable)? {
        if bytes.len() + c.len() > 131072 {
            return Err(AppError::Unavailable);
        }
        bytes.extend_from_slice(&c)
    }
    serde_json::from_slice(&bytes).map_err(|_| AppError::Unavailable)
}
async fn exchange(c: &Config, secret: &str, p: &Payload, code: &str) -> Result<Value, AppError> {
    let r = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| AppError::Unavailable)?
        .post(oidc_endpoint("token")?)
        .form(&[
            ("client_id", c.client_id.as_str()),
            ("client_secret", secret),
            ("code", code),
            ("code_verifier", p.verifier.as_str()),
            ("redirect_uri", p.redirect_uri.as_str()),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(|_| AppError::Unavailable)?;
    if !r.status().is_success() {
        return Err(AppError::Validation("Google ha rechazado el código o las credenciales del cliente. Reinicie la verificación.".into()));
    }
    let token = bounded_json(r).await?;
    let id = token["id_token"]
        .as_str()
        .filter(|s| s.len() <= 8192)
        .ok_or(AppError::Unauthorized)?;
    let claims = crate::google_oidc::verified_token(id, &c.client_id).await?;
    crate::auth::validated_google_email(&claims, &c.client_id, Utc::now().timestamp())?;
    if claims["nonce"].as_str() != Some(p.nonce.as_str()) {
        return Err(AppError::Unauthorized);
    }
    Ok(claims)
}
async fn complete(
    state: Arc<AppState>,
    headers: HeaderMap,
    input: Complete,
    login: bool,
) -> Result<Response, AppError> {
    auth::enforce_login_rate(&headers, "google-code-complete")?;
    if !(30..=512).contains(&input.state.len())
        || input.code.is_empty()
        || input.code.len() > 4096
        || input.code.chars().any(char::is_control)
    {
        return Err(AppError::Unauthorized);
    }
    let id = Uuid::parse_str(input.state.split('.').next().unwrap_or_default())
        .map_err(|_| AppError::Unauthorized)?;
    let cookie = auth::cookie(&headers, &format!("uasspain_google_flow_{id}"))
        .ok_or(AppError::Unauthorized)?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let mut tx = pool.begin().await?;
    lock(&mut tx).await?;
    let f=sqlx::query_as::<_,Flow>("SELECT id,cookie_lookup,window_lookup,purpose,profile_id,config_revision,payload_ciphertext,expires_at,consumed_at FROM google_oauth_flow WHERE id=$1 AND state_lookup=$2 FOR UPDATE")
        .bind(id).bind(state.cipher.blind_index(&input.state)?).fetch_optional(&mut *tx).await?.ok_or(AppError::Unauthorized)?;
    if (f.purpose == "login") != login
        || f.consumed_at.is_some()
        || f.expires_at <= Utc::now()
        || f.cookie_lookup != state.cipher.blind_index(cookie)?
        || f.window_lookup
            != state
                .cipher
                .blind_index(&format!("window:{}", auth::window_id(&headers)?))?
    {
        return Err(AppError::Unauthorized);
    }
    let p: Payload = serde_json::from_str(&state.cipher.decrypt(&f.payload_ciphertext)?)
        .map_err(|_| AppError::Internal)?;
    let actor = if login {
        None
    } else {
        let c = admin_tx(&state, &headers, &mut tx).await?;
        if Some(c.profile_id) != f.profile_id || Some(&c.session_key) != p.session_key.as_ref() {
            return Err(AppError::Unauthorized);
        }
        Some(c)
    };
    let c = config_tx(&mut tx).await?;
    if c.revision != f.config_revision
        || p.redirect_uri != format!("{}{CALLBACK_PATH}", trusted_origin()?)
    {
        return Err(AppError::EditConflict);
    }
    if login && (!c.enabled || !c.verified()) {
        return Err(AppError::Unavailable);
    }
    let secret = runtime_config::secret(&state, SECRET_KEY)
        .await?
        .ok_or(AppError::Unavailable)?;
    sqlx::query("UPDATE google_oauth_flow SET consumed_at=clock_timestamp(),result='PROCESSING' WHERE id=$1").bind(f.id).execute(&mut *tx).await?;
    tx.commit().await?;
    let token = match exchange(&c, &secret, &p, &input.code).await {
        Ok(t) => t,
        Err(e) => {
            let mut tx = pool.begin().await?;
            sqlx::query("UPDATE google_oauth_flow SET result='FAILED' WHERE id=$1")
                .bind(f.id)
                .execute(&mut *tx)
                .await?;
            audit(&mut tx,f.profile_id,"google_flow_failed",json!({"flow_id":f.id,"purpose":f.purpose,"reason":"provider_or_identity_validation_failed"})).await?;
            tx.commit().await?;
            return Err(e);
        }
    };
    let mut tx = pool.begin().await?;
    lock(&mut tx).await?;
    let mut latest = config_tx(&mut tx).await?;
    if latest.revision != f.config_revision {
        return Err(AppError::EditConflict);
    }
    if let Some(actor) = &actor {
        admin_tx(&state, &headers, &mut tx).await?;
        let hash:String=sqlx::query_scalar("SELECT u.password FROM auth_user u JOIN accounts_userprofile p ON p.user_id=u.id WHERE p.id=$1 FOR UPDATE OF p,u").bind(actor.profile_id).fetch_one(&mut *tx).await?;
        if p.password_fingerprint.as_ref() != Some(&state.cipher.blind_index(&hash)?) {
            return Err(AppError::Unauthorized);
        }
        if f.purpose == "link" {
            let subject = state.cipher.blind_index(&format!(
                "google:{}",
                token["sub"].as_str().ok_or(AppError::Unauthorized)?
            ))?;
            let occupied:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM accounts_userprofile WHERE google_subject_lookup=$1 AND id<>$2)").bind(&subject).bind(actor.profile_id).fetch_one(&mut *tx).await?;
            if occupied {
                return Err(AppError::Validation("Esta identidad Google ya está vinculada a otra cuenta. No se ha cambiado ningún vínculo.".into()));
            }
            let linked:i64=sqlx::query_scalar("WITH changed AS (UPDATE accounts_userprofile SET google_subject_lookup=$1 WHERE id=$2 AND (google_subject_lookup IS NULL OR google_subject_lookup=$1) RETURNING id) SELECT count(*) FROM changed").bind(subject).bind(actor.profile_id).fetch_one(&mut *tx).await?;
            if linked != 1 {
                return Err(AppError::Validation(
                    "Desvincule primero la identidad anterior mediante confirmación segura.".into(),
                ));
            }
        }
        latest.verified_at = Some(Utc::now());
        latest.verification_flow_id = Some(f.id);
        latest.verified_origin = Some(trusted_origin()?);
        crate::mail_config::put_setting(&mut tx, "google_oauth", json!(latest)).await?;
    }
    sqlx::query("UPDATE google_oauth_flow SET result=$2 WHERE id=$1")
        .bind(f.id)
        .bind(if login {
            "IDENTITY_VALIDATED"
        } else {
            "SUCCESS"
        })
        .execute(&mut *tx)
        .await?;
    audit(&mut tx,f.profile_id,if login{"google_code_authenticated"}else if f.purpose=="link"{"google_identity_linked"}else{"google_configuration_verified"},json!({"flow_id":f.id,"revision":f.config_revision,"source":if runtime_config::env_true("GOOGLE_OIDC_SYNTHETIC_TESTS"){"SYNTHETIC_ISOLATED_TEST"}else{"GOOGLE_LIVE"}})).await?;
    tx.commit().await?;
    let mut response = if login {
        let result = auth::google_verified_login(&state, &headers, &token, &c.client_id).await;
        let mut tx = pool.begin().await?;
        sqlx::query("UPDATE google_oauth_flow SET result=$2 WHERE id=$1")
            .bind(f.id)
            .bind(if result.is_ok() {
                "SUCCESS"
            } else {
                "LOGIN_REJECTED"
            })
            .execute(&mut *tx)
            .await?;
        if result.is_err() {
            audit(
                &mut tx,
                None,
                "google_login_rejected",
                json!({"flow_id":f.id,"reason":"uas_identity_or_access_not_eligible"}),
            )
            .await?;
        }
        tx.commit().await?;
        result?
    } else {
        Json(json!({"ok":true,"purpose":f.purpose,"verified":true,"enabled":latest.enabled,"detail":"Google ha autenticado la identidad. El correo corporativo SMTP/API no se ha modificado."})).into_response()
    };
    let secure = if p.redirect_uri.starts_with("https:") {
        "; Secure"
    } else {
        ""
    };
    response.headers_mut().append(
        SET_COOKIE,
        format!("uasspain_google_flow_{id}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{secure}")
            .parse()
            .map_err(|_| AppError::Internal)?,
    );
    Ok(response)
}
pub async fn login_complete(
    State(s): State<Arc<AppState>>,
    h: HeaderMap,
    Json(i): Json<Complete>,
) -> Result<Response, AppError> {
    complete(s, h, i, true).await
}
pub async fn admin_complete(
    State(s): State<Arc<AppState>>,
    h: HeaderMap,
    Json(i): Json<Complete>,
) -> Result<Response, AppError> {
    complete(s, h, i, false).await
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Unlink {
    current_password: String,
    confirmation: String,
}
pub async fn unlink(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<Unlink>,
) -> Result<Json<Value>, AppError> {
    let claims = auth::authenticate(&state, &headers, "access")?;
    auth::require_role(&claims, &["admin"])?;
    if input.confirmation != "DESVINCULAR" {
        return Err(AppError::Validation(
            "Escriba DESVINCULAR para confirmar.".into(),
        ));
    }
    let (actor, hash) = reauthenticate(&state, &headers, input.current_password).await?;
    let mut tx = state
        .pool
        .as_ref()
        .ok_or(AppError::Unavailable)?
        .begin()
        .await?;
    lock(&mut tx).await?;
    admin_tx(&state, &headers, &mut tx).await?;
    let current:String=sqlx::query_scalar("SELECT u.password FROM accounts_userprofile p JOIN auth_user u ON u.id=p.user_id WHERE p.id=$1 FOR UPDATE OF p,u").bind(actor.profile_id).fetch_one(&mut *tx).await?;
    if current != hash {
        return Err(AppError::Unauthorized);
    }
    sqlx::query("UPDATE accounts_userprofile SET google_subject_lookup=NULL WHERE id=$1")
        .bind(actor.profile_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE auth_tab_session SET revoked_at=clock_timestamp() WHERE profile_id=$1 AND revoked_at IS NULL").bind(actor.profile_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE conexiones_registroconexion SET estado_sesion='finalizada',fecha_cierre=clock_timestamp(),updated_date=clock_timestamp() WHERE profile_id=$1 AND estado_sesion='activa'").bind(actor.profile_id).execute(&mut *tx).await?;
    audit(
        &mut tx,
        Some(actor.profile_id),
        "google_identity_unlinked",
        json!({"conventional_access_preserved":true,"sessions_revoked":true}),
    )
    .await?;
    tx.commit().await?;
    state
        .events
        .publish("connections", json!({"type":"conexion","action":"logout"}))
        .await;
    Ok(Json(
        json!({"ok":true,"detail":"Identidad Google desvinculada. Acceda de nuevo con correo y contraseña."}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn origin_never_uses_request_headers_or_redirect_parameters() {
        assert_eq!(
            origin_from("https://example.com", true).unwrap(),
            "https://example.com"
        );
        assert_eq!(
            origin_from("http://localhost:8444", false).unwrap(),
            "http://localhost:8444"
        );
        for u in [
            "http://example.com",
            "https://user:password@example.com",
            "https://example.com/a",
            "https://example.com/?x=1",
            "https://example.com/#x",
            "file:///tmp/a",
        ] {
            assert!(origin_from(u, true).is_err())
        }
    }
    #[test]
    fn pkce_and_authorization_parameters_are_exact() {
        assert_eq!(
            challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        let u = url::Url::parse(
            &authorization_url(
                "client",
                "https://example.com/auth/google/callback",
                "state",
                "nonce",
                "verifier",
            )
            .unwrap(),
        )
        .unwrap();
        let q: std::collections::HashMap<_, _> = u.query_pairs().into_owned().collect();
        assert_eq!(q["response_type"], "code");
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["nonce"], "nonce");
        assert_eq!(q["state"], "state");
        assert!(!q.contains_key("client_secret"));
    }
    #[test]
    fn legacy_config_does_not_prove_provider_verification() {
        let c: Config =
            serde_json::from_value(json!({"enabled":true,"client_id":"legacy"})).unwrap();
        assert!(!c.verified());
    }
}
