use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration as StdDuration, Instant},
};

use axum::{
    Json,
    extract::{Query, Request, State},
    http::{
        HeaderMap, StatusCode,
        header::{AUTHORIZATION, CACHE_CONTROL, COOKIE, SET_COOKIE},
    },
    middleware::Next,
    response::{IntoResponse, Response},
};
use chrono::{Duration, Utc};
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    AppState,
    error::AppError,
    users::{ProfileRow, ProfileView},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub user_id: i64,
    pub profile_id: Uuid,
    pub role: String,
    pub token_type: String,
    pub exp: usize,
    pub iat: usize,
    pub jti: Uuid,
    #[serde(default)]
    pub session_key: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
    pub code: Option<String>,
    pub session_role: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SessionRoleRequest {
    pub role: String,
}

#[derive(Debug, Deserialize)]
pub struct GoogleLoginRequest {
    pub id_token: String,
}

#[derive(FromRow)]
struct LoginRow {
    id: Uuid,
    password: String,
    is_active: bool,
    status: String,
    role: String,
    roles: serde_json::Value,
    otp_verified: bool,
    login_otp_hash: Option<String>,
    login_otp_created_at: Option<chrono::DateTime<Utc>>,
    login_otp_attempts: i32,
    login_2fa_enabled_override: Option<bool>,
    profile_username: String,
    profile_nombre: String,
    profile_apellidos: String,
    profile_email: String,
}

pub async fn login(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<LoginRequest>,
) -> Result<Response, AppError> {
    window_id(&headers)?;
    if input.password.len() > 128 {
        return Err(AppError::Unauthorized);
    }
    let canonical_email = crate::registration::normalize_email(&input.email)?;
    enforce_login_rate(&headers, &canonical_email)?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let lookup = state.cipher.blind_index(&canonical_email)?;
    let row = sqlx::query_as::<_, LoginRow>(
        "SELECT p.id, p.user_id, u.password, u.is_active, p.status, p.role, p.roles, p.otp_verified, p.login_otp_hash, p.login_otp_created_at, p.login_otp_attempts, p.login_2fa_enabled_override,p.username AS profile_username,p.nombre AS profile_nombre,p.apellidos AS profile_apellidos,p.email AS profile_email \
         FROM accounts_userprofile p JOIN auth_user u ON u.id = p.user_id WHERE p.email_lookup = $1 LIMIT 1",
    ).bind(lookup).fetch_optional(pool).await?;
    let Some(row) = row else {
        static DUMMY_HASH: OnceLock<String> = OnceLock::new();
        let dummy = DUMMY_HASH.get_or_init(|| {
            crate::registration::hash_argon2(&Uuid::new_v4().to_string()).unwrap_or_default()
        });
        if dummy.is_empty() {
            return Err(AppError::Internal);
        }
        let _ = crate::security::verify_password_hash_async(input.password.clone(), dummy.clone())
            .await?;
        return Err(AppError::Unauthorized);
    };
    let password_correct =
        crate::security::verify_password_hash_async(input.password.clone(), row.password.clone())
            .await?;
    if !row.is_active || row.status != "activo" || !row.otp_verified || !password_correct {
        return Err(AppError::Unauthorized);
    }
    let roles = roles_from_json(&row.roles, &row.role);
    let role = input.session_role.as_deref().unwrap_or(&row.role);
    if !roles.iter().any(|candidate| candidate == role) {
        return Err(AppError::Forbidden);
    }
    if input.code.as_deref().is_some_and(str::is_empty) {
        return Err(AppError::Validation(
            "Código de acceso no válido.".to_owned(),
        ));
    }
    let policy: serde_json::Value =
        sqlx::query_scalar("SELECT value FROM core_systemsetting WHERE key='auth_policy'")
            .fetch_optional(pool)
            .await?
            .unwrap_or_else(|| serde_json::json!({"enabled":false,"required_roles":[]}));
    let needs_2fa = requires_login_otp(&policy, &roles, row.login_2fa_enabled_override);
    if needs_2fa && input.code.as_deref().unwrap_or_default().is_empty() {
        use rand::Rng as _;
        let code = format!("{:06}", rand::rng().random_range(100_000..1_000_000));
        let hash = crate::registration::hash_argon2(&code)?;
        let issued = sqlx::query("UPDATE accounts_userprofile SET login_otp_hash=$1,login_otp_created_at=NOW(),login_otp_attempts=0 WHERE id=$2 AND (login_otp_created_at IS NULL OR login_otp_created_at<NOW()-INTERVAL '1 minute')").bind(&hash).bind(row.id).execute(pool).await?;
        if issued.rows_affected() != 1 {
            return Ok((StatusCode::ACCEPTED, Json(serde_json::json!({"detail":"Ya hay un codigo vigente. Revise su correo o espere un minuto para solicitar otro.","code":"otp_required"}))).into_response());
        }
        if crate::email::send(
            &state,
            &canonical_email,
            "Código temporal de acceso UASSpain",
            &format!("Su código temporal de acceso es: {code}"),
        )
        .await
        .is_err()
        {
            sqlx::query("UPDATE accounts_userprofile SET login_otp_hash='',login_otp_created_at=NULL,login_otp_attempts=0 WHERE id=$1 AND login_otp_hash=$2").bind(row.id).bind(hash).execute(pool).await?;
            return Err(AppError::OtpDeliveryUnavailable);
        }
        return Ok((StatusCode::ACCEPTED, Json(serde_json::json!({"detail":"Código de acceso enviado. Introduzca el OTP para completar el login.","code":"otp_required"}))).into_response());
    }
    if needs_2fa {
        let code = input.code.as_deref().unwrap_or_default();
        let fresh = row
            .login_otp_created_at
            .is_some_and(|created| created > Utc::now() - chrono::Duration::minutes(15));
        if !fresh
            || row.login_otp_attempts >= 5
            || !crate::security::verify_password_hash(
                code,
                row.login_otp_hash.as_deref().unwrap_or_default(),
            )
        {
            sqlx::query("UPDATE accounts_userprofile SET login_otp_attempts=LEAST(5,login_otp_attempts+1) WHERE id=$1 AND login_otp_hash=$2 AND login_otp_created_at>NOW()-INTERVAL '15 minutes'").bind(row.id).bind(row.login_otp_hash.as_deref().unwrap_or_default()).execute(pool).await?;
            return Err(AppError::Validation(
                "Código 2FA incorrecto o caducado.".into(),
            ));
        }
        let consumed = sqlx::query("UPDATE accounts_userprofile SET login_otp_hash='',login_otp_created_at=NULL,login_otp_attempts=0 WHERE id=$1 AND login_otp_hash=$2 AND login_otp_created_at>NOW()-INTERVAL '15 minutes' AND login_otp_attempts<5").bind(row.id).bind(row.login_otp_hash.as_deref().unwrap_or_default()).execute(pool).await?;
        if consumed.rows_affected() != 1 {
            return Err(AppError::Unauthorized);
        }
    }
    finish_login(&state, &headers, &row, role, "password").await
}

fn requires_login_otp(
    policy: &serde_json::Value,
    roles: &[String],
    override_value: Option<bool>,
) -> bool {
    override_value.unwrap_or_else(|| {
        policy
            .get("enabled")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
            && policy
                .get("required_roles")
                .and_then(serde_json::Value::as_array)
                .is_some_and(|required| {
                    required
                        .iter()
                        .filter_map(serde_json::Value::as_str)
                        .any(|required_role| roles.iter().any(|role| role == required_role))
                })
    })
}

pub async fn google_challenge(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    crate::runtime_config::google_client_id(&state).await?;
    enforce_login_rate(&headers, "google-challenge")?;
    let nonce = Uuid::new_v4().simple().to_string();
    let proof = state
        .tokens
        .issue(0, Uuid::nil(), "google", "google_nonce", 5, &nonce)?;
    let secure = if state.tokens.secure_cookie {
        "; Secure"
    } else {
        ""
    };
    let mut response = Json(serde_json::json!({"nonce":nonce})).into_response();
    let nonce_cookie = google_nonce_cookie(&headers)?;
    response.headers_mut().append(SET_COOKIE, format!("{nonce_cookie}={proof}; Path=/api/auth/google/; HttpOnly; SameSite=Strict; Max-Age=300{secure}").parse().map_err(|_| AppError::Internal)?);
    Ok(response)
}

fn google_nonce_cookie(headers: &HeaderMap) -> Result<String, AppError> {
    Ok(format!("uasspain_google_nonce_{}", window_id(headers)?))
}

fn google_proof(state: &AppState, headers: &HeaderMap) -> Result<Claims, AppError> {
    let name = google_nonce_cookie(headers)?;
    let raw = cookie(headers, &name).ok_or(AppError::Unauthorized)?;
    let proof = state.tokens.decode(raw, "google_nonce")?;
    if proof.exp <= Utc::now().timestamp() as usize {
        return Err(AppError::Unauthorized);
    }
    Ok(proof)
}

fn consume_google_proof(proof: &Claims, now: usize) -> Result<(), AppError> {
    static CONSUMED: OnceLock<Mutex<HashMap<Uuid, usize>>> = OnceLock::new();
    let mut consumed = CONSUMED
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| AppError::Internal)?;
    consumed.retain(|_, expiry| *expiry > now);
    if proof.exp <= now || consumed.contains_key(&proof.jti) {
        return Err(AppError::Unauthorized);
    }
    if consumed.len() >= 10000 {
        return Err(AppError::RateLimited);
    }
    consumed.insert(proof.jti, proof.exp);
    Ok(())
}

pub async fn google_login(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<GoogleLoginRequest>,
) -> Result<Response, AppError> {
    let client_id = crate::runtime_config::google_client_id(&state).await?;
    window_id(&headers)?;
    if !(16..=8192).contains(&input.id_token.len()) {
        return Err(AppError::Validation("Token de Google no válido.".into()));
    }
    enforce_login_rate(&headers, "google")?;
    let proof = google_proof(&state, &headers)?;
    let token = crate::google_oidc::verified_token(&input.id_token, &client_id).await?;
    if token.get("nonce").and_then(serde_json::Value::as_str) != Some(proof.session_key.as_str()) {
        return Err(AppError::Unauthorized);
    }
    consume_google_proof(&proof, Utc::now().timestamp() as usize)?;
    let email = validated_google_email(&token, &client_id, Utc::now().timestamp())?;
    let lookup = state.cipher.blind_index(&email)?;
    let subject_lookup = state.cipher.blind_index(&format!(
        "google:{}",
        token["sub"].as_str().ok_or(AppError::Unauthorized)?
    ))?;
    let row = sqlx::query_as::<_, LoginRow>(
        "SELECT p.id, p.user_id, u.password, u.is_active, p.status, p.role, p.roles, p.otp_verified, p.login_otp_hash, p.login_otp_created_at, p.login_otp_attempts, p.login_2fa_enabled_override,p.username AS profile_username,p.nombre AS profile_nombre,p.apellidos AS profile_apellidos,p.email AS profile_email \
         FROM accounts_userprofile p JOIN auth_user u ON u.id = p.user_id WHERE p.google_subject_lookup=$2 OR (p.google_subject_lookup IS NULL AND p.email_lookup=$1) ORDER BY (p.google_subject_lookup=$2) DESC NULLS LAST LIMIT 1",
    )
    .bind(lookup)
    .bind(subject_lookup.clone())
    .fetch_optional(state.pool.as_ref().ok_or(AppError::Unavailable)?)
    .await?
    .ok_or(AppError::NotFound)?;
    if !row.is_active || row.status != "activo" || !row.otp_verified {
        return Err(AppError::Forbidden);
    }
    let policy: serde_json::Value =
        sqlx::query_scalar("SELECT value FROM core_systemsetting WHERE key='auth_policy'")
            .fetch_optional(state.pool.as_ref().ok_or(AppError::Unavailable)?)
            .await?
            .unwrap_or_else(|| serde_json::json!({"enabled":false,"required_roles":[]}));
    if requires_login_otp(
        &policy,
        &roles_from_json(&row.roles, &row.role),
        row.login_2fa_enabled_override,
    ) {
        return Err(AppError::Validation("Tu cuenta requiere verificación adicional. Accede con correo, contraseña y código temporal.".into()));
    }
    let linked = sqlx::query("UPDATE accounts_userprofile SET google_subject_lookup=$1 WHERE id=$2 AND (google_subject_lookup IS NULL OR google_subject_lookup=$1)").bind(subject_lookup).bind(row.id).execute(state.pool.as_ref().ok_or(AppError::Unavailable)?).await?;
    if linked.rows_affected() != 1 {
        return Err(AppError::Unauthorized);
    }
    let role = row.role.clone();
    let mut response = finish_login(&state, &headers, &row, &role, "google").await?;
    response.headers_mut().append(
        SET_COOKIE,
        format!(
            "{}=; Path=/api/auth/google/; HttpOnly; SameSite=Strict; Max-Age=0",
            google_nonce_cookie(&headers)?
        )
        .parse()
        .map_err(|_| AppError::Internal)?,
    );
    Ok(response)
}

// Google JWKS verifies the signature; bind its claims to this application.
fn validated_google_email(
    token: &serde_json::Value,
    client_id: &str,
    now: i64,
) -> Result<String, AppError> {
    let expiry = token
        .get("exp")
        .and_then(|value| value.as_i64().or_else(|| value.as_str()?.parse().ok()));
    let issuer = token.get("iss").and_then(serde_json::Value::as_str);
    let issued = token
        .get("iat")
        .and_then(|value| value.as_i64().or_else(|| value.as_str()?.parse().ok()));
    if token.get("aud").and_then(serde_json::Value::as_str) != Some(client_id)
        || !matches!(
            issuer,
            Some("accounts.google.com" | "https://accounts.google.com")
        )
        || !expiry.is_some_and(|exp| exp > now)
        || token
            .get("nbf")
            .is_some_and(|value| !value.as_i64().is_some_and(|nbf| nbf <= now))
        || !issued.is_some_and(|iat| iat <= now + 60)
        || token
            .get("azp")
            .is_some_and(|value| value.as_str() != Some(client_id))
        || !token
            .get("email_verified")
            .is_some_and(|value| value == true || value.as_str() == Some("true"))
        || !token
            .get("sub")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|subject| !subject.is_empty())
    {
        return Err(AppError::Unauthorized);
    }
    let email = token
        .get("email")
        .and_then(serde_json::Value::as_str)
        .ok_or(AppError::Unauthorized)?;
    let email = crate::registration::normalize_email(email).map_err(|_| AppError::Unauthorized)?;
    if !email.ends_with("@gmail.com")
        && !token
            .get("hd")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|domain| !domain.is_empty())
    {
        return Err(AppError::Unauthorized);
    }
    Ok(email)
}

async fn finish_login(
    state: &AppState,
    headers: &HeaderMap,
    row: &LoginRow,
    role: &str,
    method: &str,
) -> Result<Response, AppError> {
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let session_key = Uuid::new_v4().simple().to_string();
    let window_lookup = state
        .cipher
        .blind_index(&format!("window:{}", window_id(headers)?))?;
    let (context, new_cookie) = browser_credential(state, headers)?;
    let context_lookup = state
        .cipher
        .blind_index(&format!("context:{}", context.session_key))?;
    let mut tx = pool.begin().await?;
    // Take the profile lock in its own statement: a joined auth_user row read
    // before waiting could otherwise retain a credential invalidated meanwhile.
    sqlx::query("SELECT id FROM accounts_userprofile WHERE id=$1 FOR UPDATE")
        .bind(row.id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AppError::Unauthorized)?;
    let eligible: Option<bool> = sqlx::query_scalar("SELECT u.password=$2 AND u.is_active AND p.status='activo' AND p.otp_verified AND (p.role=$3 OR p.roles ? $3) FROM accounts_userprofile p JOIN auth_user u ON u.id=p.user_id WHERE p.id=$1")
        .bind(row.id).bind(&row.password).bind(role).fetch_optional(&mut *tx).await?;
    if eligible != Some(true) {
        return Err(AppError::Unauthorized);
    }
    // Serialize logins only within this browser/tab. Other tabs keep their identity.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("{context_lookup}:{window_lookup}"))
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE conexiones_registroconexion r SET estado_sesion='finalizada',fecha_cierre=clock_timestamp(),updated_date=clock_timestamp() FROM auth_tab_session s WHERE s.context_lookup=$1 AND s.window_lookup=$2 AND r.session_id=s.session_key AND r.estado_sesion='activa'")
        .bind(&context_lookup).bind(&window_lookup).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO auth_tab_session(id,profile_id,context_lookup,window_lookup,session_key,role,expires_at) VALUES($1,$2,$3,$4,$5,$6,to_timestamp($7)) ON CONFLICT(context_lookup,window_lookup) DO UPDATE SET id=EXCLUDED.id,profile_id=EXCLUDED.profile_id,session_key=EXCLUDED.session_key,role=EXCLUDED.role,created_at=clock_timestamp(),last_activity_at=clock_timestamp(),expires_at=EXCLUDED.expires_at,revoked_at=NULL")
        .bind(Uuid::new_v4()).bind(row.id).bind(context_lookup).bind(window_lookup).bind(&session_key).bind(role).bind(context.exp as f64).execute(&mut *tx).await?;
    record_login(state, headers, row, role, method, &session_key, &mut tx).await?;
    tx.commit().await?;
    state
        .events
        .publish(
            "connections",
            serde_json::json!({"type":"conexion","action":"login"}),
        )
        .await;
    let mut response =
        Json(serde_json::json!({"detail":"Inicio de sesión correcto."})).into_response();
    if let Some(cookie) = new_cookie {
        response
            .headers_mut()
            .append(SET_COOKIE, cookie.parse().map_err(|_| AppError::Internal)?);
    }
    Ok(response)
}

#[derive(Default, Deserialize)]
pub struct SessionQuery {
    #[serde(default)]
    optional: bool,
}

pub async fn me(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<SessionQuery>,
) -> Result<Response, AppError> {
    // Public navigation may ask whether a session exists. Only a request with
    // no session credentials can be anonymous; invalid/expired tokens still
    // take the normal authentication and refresh path.
    let session_cookie = headers
        .get(COOKIE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|cookies| {
            cookies.split(';').map(str::trim).any(|cookie| {
                cookie.split_once('=').is_some_and(|(name, value)| {
                    !value.is_empty()
                        && (name == state.tokens.access_cookie
                            || name == state.tokens.refresh_cookie)
                })
            })
        });
    if query.optional
        && !headers.contains_key(VERIFIED_HEADER)
        && !headers.contains_key(AUTHORIZATION)
        && !session_cookie
    {
        return Ok((
            [(CACHE_CONTROL, "private, no-store")],
            Json(serde_json::Value::Null),
        )
            .into_response());
    }
    let claims = authenticate(&state, &headers, "access")?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let row = sqlx::query_as::<_, ProfileRow>(ProfileRow::SELECT_BY_ID)
        .bind(claims.profile_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)?;
    let profile = ProfileView::from_row(row, &state.cipher)?;
    let idle_expires_at: chrono::DateTime<Utc> = sqlx::query_scalar("SELECT last_activity_at+($3::bigint * INTERVAL '1 second') FROM auth_tab_session WHERE session_key=$1 AND profile_id=$2").bind(&claims.session_key).bind(claims.profile_id).bind(IDLE_TIMEOUT_SECONDS).fetch_one(pool).await?;
    Ok((
        [(CACHE_CONTROL, "private, no-store")],
        Json(serde_json::json!({
            "id": profile.id, "user_id": claims.user_id, "email": profile.email,
            "full_name": profile.full_name(), "role": profile.role, "roles": profile.roles,
            "session_role": claims.role, "status": profile.status, "profile": profile, "idle_expires_at": idle_expires_at
        })),
    )
        .into_response())
}

pub async fn logout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    if let Ok(claims) = authenticate(&state, &headers, "access") {
        let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
        let mut tx = pool.begin().await?;
        sqlx::query("UPDATE auth_tab_session SET revoked_at=clock_timestamp() WHERE session_key=$1 AND profile_id=$2 AND revoked_at IS NULL")
            .bind(&claims.session_key).bind(claims.profile_id).execute(&mut *tx).await?;
        sqlx::query("UPDATE conexiones_registroconexion SET estado_sesion='finalizada',fecha_cierre=clock_timestamp(),tiempo_sesion=GREATEST(0,EXTRACT(EPOCH FROM(clock_timestamp()-fecha_hora))::integer),updated_date=clock_timestamp() WHERE session_id=$1 AND profile_id=$2 AND estado_sesion='activa'")
            .bind(&claims.session_key).bind(claims.profile_id).execute(&mut *tx).await?;
        tx.commit().await?;
        state
            .events
            .publish(
                "connections",
                serde_json::json!({"type":"conexion","action":"logout"}),
            )
            .await;
    }
    // This browser credential is also used by other tabs; logout revokes only this row.
    Ok(Json(serde_json::json!({"detail":"Sesión cerrada."})).into_response())
}

pub async fn refresh(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    authenticate(&state, &headers, "refresh")?;
    // Browser credentials never contain a user/role and refresh never records activity.
    Ok(Json(serde_json::json!({"detail":"Sesión comprobada."})).into_response())
}

pub async fn session_role(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<SessionRoleRequest>,
) -> Result<Response, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let role = input.role.trim();
    if !matches!(role, "admin" | "instructor" | "alumno") {
        return Err(AppError::Forbidden);
    }
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT id FROM accounts_userprofile WHERE id=$1 FOR UPDATE")
        .bind(claims.profile_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AppError::Unauthorized)?;
    let changed = sqlx::query("UPDATE auth_tab_session s SET role=$1 FROM accounts_userprofile p JOIN auth_user u ON u.id=p.user_id WHERE s.session_key=$2 AND s.profile_id=$3 AND p.id=s.profile_id AND s.revoked_at IS NULL AND s.last_activity_at>clock_timestamp()-($4::bigint * INTERVAL '1 second') AND s.expires_at>clock_timestamp() AND p.status='activo' AND p.otp_verified AND u.is_active AND (p.roles ? $1 OR p.role=$1)")
        .bind(role).bind(&claims.session_key).bind(claims.profile_id).bind(IDLE_TIMEOUT_SECONDS).execute(&mut *tx).await?;
    if changed.rows_affected() != 1 {
        return Err(if session_is_active(&state, &claims).await? {
            AppError::Forbidden
        } else {
            AppError::Unauthorized
        });
    }
    tx.commit().await?;
    Ok(
        Json(serde_json::json!({"detail":"Rol de sesión actualizado.","session_role":role}))
            .into_response(),
    )
}

const VERIFIED_HEADER: &str = "x-uasspain-verified-session";
pub const IDLE_TIMEOUT_SECONDS: i64 = 900;

fn context_cookie_name(state: &AppState) -> &'static str {
    if state.tokens.secure_cookie {
        "__Host-uasspain_context"
    } else {
        "uasspain_context"
    }
}

fn cookie<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get(COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .map(str::trim)
        .find_map(|pair| {
            pair.split_once('=')
                .filter(|(key, _)| *key == name)
                .map(|(_, value)| value)
        })
}

fn browser_credential(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(Claims, Option<String>), AppError> {
    if let Some(raw) = cookie(headers, context_cookie_name(state))
        && let Ok(context) = state.tokens.decode(raw, "browser")
    {
        return Ok((context, None));
    }
    let raw = state.tokens.issue(
        0,
        Uuid::nil(),
        "browser",
        "browser",
        state.tokens.refresh_days * 24 * 60,
        &Uuid::new_v4().simple().to_string(),
    )?;
    let claims = state.tokens.decode(&raw, "browser")?;
    let secure = if state.tokens.secure_cookie {
        "; Secure"
    } else {
        ""
    };
    Ok((
        claims,
        Some(format!(
            "{}={raw}; Path=/; HttpOnly; SameSite=Strict; Max-Age={}{}",
            context_cookie_name(state),
            state.tokens.refresh_days * 86400,
            secure
        )),
    ))
}

pub async fn browser_context(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    window_id(&headers)?;
    let (_, cookie) = browser_credential(&state, &headers)?;
    if cookie.is_some() {
        enforce_login_rate(&headers, "browser-context")?;
    }
    let mut response = Json(serde_json::json!({"detail":"Contexto preparado."})).into_response();
    if let Some(cookie) = cookie {
        response
            .headers_mut()
            .append(SET_COOKIE, cookie.parse().map_err(|_| AppError::Internal)?);
    }
    Ok(response)
}

#[derive(FromRow)]
struct TabSession {
    profile_id: Uuid,
    user_id: i32,
    role: String,
    session_key: String,
    last_activity_at: chrono::DateTime<Utc>,
    expires_at: chrono::DateTime<Utc>,
    revoked_at: Option<chrono::DateTime<Utc>>,
    server_now: chrono::DateTime<Utc>,
}

fn idle_expired(last: chrono::DateTime<Utc>, now: chrono::DateTime<Utc>) -> bool {
    now.signed_duration_since(last) >= Duration::seconds(IDLE_TIMEOUT_SECONDS)
}

pub async fn activity(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    request: Request,
) -> Result<Response, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    if request.method() == axum::http::Method::POST {
        if !crate::chat::origin_allowed(&headers) {
            return Err(AppError::Forbidden);
        }
        // Two accepted updates/second per session, with no unbounded attacker-controlled map.
        // The timestamp is exclusively the database clock, never supplied by the client.
        let updated=sqlx::query("UPDATE auth_tab_session SET last_activity_at=clock_timestamp() WHERE session_key=$1 AND profile_id=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp() AND last_activity_at>clock_timestamp()-($3::bigint * INTERVAL '1 second') AND last_activity_at<=clock_timestamp()-INTERVAL '500 milliseconds'")
            .bind(&claims.session_key).bind(claims.profile_id).bind(IDLE_TIMEOUT_SECONDS).execute(pool).await?;
        if updated.rows_affected() == 0 {
            if !session_is_active(&state, &claims).await? {
                return Err(AppError::SessionIdleExpired);
            }
            return Err(AppError::RateLimited);
        }
        sqlx::query("UPDATE conexiones_registroconexion SET ultima_actividad=clock_timestamp(),updated_date=clock_timestamp() WHERE session_id=$1 AND profile_id=$2 AND estado_sesion='activa'")
            .bind(&claims.session_key).bind(claims.profile_id).execute(pool).await?;
    }
    let deadline:chrono::DateTime<Utc>=sqlx::query_scalar("SELECT last_activity_at+($3::bigint * INTERVAL '1 second') FROM auth_tab_session WHERE session_key=$1 AND profile_id=$2")
        .bind(&claims.session_key).bind(claims.profile_id).bind(IDLE_TIMEOUT_SECONDS).fetch_one(pool).await?;
    let remaining_ms:i64=sqlx::query_scalar("SELECT GREATEST(0,EXTRACT(EPOCH FROM(last_activity_at+($3::bigint * INTERVAL '1 second')-clock_timestamp()))*1000)::bigint FROM auth_tab_session WHERE session_key=$1 AND profile_id=$2").bind(&claims.session_key).bind(claims.profile_id).bind(IDLE_TIMEOUT_SECONDS).fetch_one(pool).await?;
    Ok(([(CACHE_CONTROL,"private, no-store")],Json(serde_json::json!({"idle_expires_at":deadline,"remaining_ms":remaining_ms,"idle_timeout_seconds":IDLE_TIMEOUT_SECONDS}))).into_response())
}

#[derive(Clone)]
pub struct TokenService {
    encoding: EncodingKey,
    decoding: DecodingKey,
    pub access_cookie: String,
    pub refresh_cookie: String,
    pub access_minutes: i64,
    pub refresh_days: i64,
    pub secure_cookie: bool,
}

impl TokenService {
    pub fn from_env() -> Result<Self, AppError> {
        let secret = read_secret("SECRET_KEY", "SECRET_KEY_FILE").ok_or(AppError::Unavailable)?;
        Ok(Self {
            encoding: EncodingKey::from_secret(secret.as_bytes()),
            decoding: DecodingKey::from_secret(secret.as_bytes()),
            access_cookie: std::env::var("JWT_ACCESS_COOKIE")
                .unwrap_or_else(|_| "uasspain_access".to_owned()),
            refresh_cookie: std::env::var("JWT_REFRESH_COOKIE")
                .unwrap_or_else(|_| "uasspain_refresh".to_owned()),
            access_minutes: env_i64("JWT_ACCESS_MINUTES", 60),
            refresh_days: env_i64("JWT_REFRESH_DAYS", 7),
            secure_cookie: std::env::var("JWT_COOKIE_SECURE")
                .map_or(true, |value| value.eq_ignore_ascii_case("true")),
        })
    }

    fn issue(
        &self,
        user_id: i64,
        profile_id: Uuid,
        role: &str,
        token_type: &str,
        minutes: i64,
        session_key: &str,
    ) -> Result<String, AppError> {
        let now = Utc::now();
        let claims = Claims {
            user_id,
            profile_id,
            role: role.to_owned(),
            token_type: token_type.to_owned(),
            exp: (now + Duration::minutes(minutes)).timestamp() as usize,
            iat: now.timestamp() as usize,
            jti: Uuid::new_v4(),
            session_key: session_key.to_owned(),
        };
        encode(&Header::new(Algorithm::HS256), &claims, &self.encoding)
            .map_err(|_| AppError::Internal)
    }

    fn decode(&self, token: &str, token_type: &str) -> Result<Claims, AppError> {
        let mut validation = Validation::new(Algorithm::HS256);
        validation.leeway = 0;
        let claims = decode::<Claims>(token, &self.decoding, &validation)
            .map_err(|_| AppError::Unauthorized)?
            .claims;
        if claims.token_type != token_type {
            return Err(AppError::Unauthorized);
        }
        Ok(claims)
    }

    #[cfg(test)]
    pub fn for_test() -> Self {
        let secret = b"test-only-not-for-production-test-only-not-for-production";
        Self {
            encoding: EncodingKey::from_secret(secret),
            decoding: DecodingKey::from_secret(secret),
            access_cookie: "uasspain_access".to_owned(),
            refresh_cookie: "uasspain_refresh".to_owned(),
            access_minutes: 60,
            refresh_days: 7,
            secure_cookie: false,
        }
    }
}

pub fn authenticate(
    state: &AppState,
    headers: &HeaderMap,
    token_type: &str,
) -> Result<Claims, AppError> {
    // Only our middleware can install this short-lived signed authorization.
    // External Bearer headers and cookies are never accepted as a user's identity.
    let token = headers
        .get(VERIFIED_HEADER)
        .and_then(|v| v.to_str().ok())
        .ok_or(AppError::Unauthorized)?;
    state.tokens.decode(token, token_type)
}

pub fn window_id(headers: &HeaderMap) -> Result<&str, AppError> {
    headers
        .get("x-uasspain-window-id")
        .and_then(|v| v.to_str().ok())
        .filter(|v| {
            Uuid::parse_str(v).is_ok_and(|u| u.get_version_num() == 4 && u.to_string() == *v)
        })
        .ok_or(AppError::SessionWindowMismatch)
}

pub async fn validate_active_session(
    State(state): State<Arc<AppState>>,
    mut request: Request,
    next: Next,
) -> Result<Response, AppError> {
    request.headers_mut().remove(VERIFIED_HEADER);
    let path = request.uri().path().to_owned();
    if request.method() == axum::http::Method::GET
        && (path.starts_with("/ws/") || path.starts_with("/api/media/"))
    {
        let ids: Vec<_> =
            url::form_urlencoded::parse(request.uri().query().unwrap_or_default().as_bytes())
                .filter(|(key, _)| key == "window_id")
                .collect();
        if ids.len() == 1
            && let Ok(value) = ids[0].1.parse()
        {
            request.headers_mut().insert("x-uasspain-window-id", value);
        }
    }
    if matches!(
        path.as_str(),
        "/" | "/api/health/live/"
            | "/api/health/ready/"
            | "/api/contact/"
            | "/api/contact/config/"
            | "/ws/public-content/"
    ) || path.starts_with("/api/public/")
        || (matches!(
            *request.method(),
            axum::http::Method::GET | axum::http::Method::HEAD
        ) && (path == "/api/services"
            || path.starts_with("/api/services/")
            || path == "/api/courses"
            || path.starts_with("/api/courses/")
            || path == "/api/blog/posts"
            || path.starts_with("/api/blog/posts/")))
        || matches!(
            path.as_str(),
            "/api/auth/context/"
                | "/api/auth/login/"
                | "/api/auth/register/"
                | "/api/auth/google/"
                | "/api/auth/google/challenge/"
                | "/api/auth/verify-otp/"
                | "/api/auth/resend-otp/"
                | "/api/auth/password-reset/"
                | "/api/auth/password-reset/confirm/"
        )
    {
        return Ok(next.run(request).await);
    }
    let Some(raw) = cookie(request.headers(), context_cookie_name(&state)) else {
        if request.headers().contains_key(AUTHORIZATION)
            || cookie(request.headers(), &state.tokens.access_cookie).is_some()
            || cookie(request.headers(), &state.tokens.refresh_cookie).is_some()
        {
            return Err(AppError::Unauthorized);
        }
        return Ok(next.run(request).await);
    };
    let context = state.tokens.decode(raw, "browser")?;
    let context_lookup = state
        .cipher
        .blind_index(&format!("context:{}", context.session_key))?;
    let window_lookup = state
        .cipher
        .blind_index(&format!("window:{}", window_id(request.headers())?))?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let current:Option<TabSession>=sqlx::query_as("SELECT s.profile_id,u.id AS user_id,s.role,s.session_key,s.last_activity_at,s.expires_at,s.revoked_at,clock_timestamp() AS server_now FROM auth_tab_session s JOIN accounts_userprofile p ON p.id=s.profile_id JOIN auth_user u ON u.id=p.user_id WHERE s.context_lookup=$1 AND s.window_lookup=$2 AND p.status='activo' AND p.otp_verified AND u.is_active AND (p.role=s.role OR p.roles ? s.role)")
        .bind(context_lookup).bind(window_lookup).fetch_optional(pool).await?;
    let session = current.ok_or(AppError::SessionWindowMismatch)?;
    if session.revoked_at.is_some() || session.expires_at <= session.server_now {
        return Err(AppError::Unauthorized);
    }
    if idle_expired(session.last_activity_at, session.server_now) {
        return Err(AppError::SessionIdleExpired);
    }
    let token_type = if path == "/api/auth/refresh/" {
        "refresh"
    } else {
        "access"
    };
    let verified = state.tokens.issue(
        i64::from(session.user_id),
        session.profile_id,
        &session.role,
        token_type,
        1,
        &session.session_key,
    )?;
    request.headers_mut().insert(
        VERIFIED_HEADER,
        verified.parse().map_err(|_| AppError::Internal)?,
    );
    let claims = state.tokens.decode(&verified, token_type)?;
    let mut authorization = tokio::time::interval(StdDuration::from_secs(1));
    authorization.tick().await;
    let operation = next.run(request);
    tokio::pin!(operation);
    loop {
        tokio::select! {
            response = &mut operation => return Ok(response),
            _ = authorization.tick() => {
                if !session_is_active(&state, &claims).await? {
                    let idle: bool = sqlx::query_scalar("SELECT COALESCE((SELECT last_activity_at<=clock_timestamp()-($3::bigint * INTERVAL '1 second') FROM auth_tab_session WHERE session_key=$1 AND profile_id=$2),FALSE)")
                        .bind(&claims.session_key).bind(claims.profile_id).bind(IDLE_TIMEOUT_SECONDS).fetch_one(pool).await?;
                    // Drop the handler future, rolling back any uncommitted transaction.
                    return Err(if idle { AppError::SessionIdleExpired } else { AppError::Unauthorized });
                }
            }
        }
    }
}

pub async fn session_is_active(state: &AppState, claims: &Claims) -> Result<bool, AppError> {
    if claims.session_key.is_empty() {
        return Ok(false);
    }
    let active:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM auth_tab_session s JOIN accounts_userprofile p ON p.id=s.profile_id JOIN auth_user u ON u.id=p.user_id WHERE s.session_key=$1 AND s.profile_id=$2 AND s.role=$3 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.last_activity_at>clock_timestamp()-($4::bigint * INTERVAL '1 second') AND p.status='activo' AND p.otp_verified AND u.is_active AND (p.role=s.role OR p.roles ? s.role))")
        .bind(&claims.session_key).bind(claims.profile_id).bind(&claims.role).bind(IDLE_TIMEOUT_SECONDS).fetch_one(state.pool.as_ref().ok_or(AppError::Unavailable)?).await?;
    Ok(active)
}

async fn record_login(
    state: &AppState,
    headers: &HeaderMap,
    row: &LoginRow,
    role: &str,
    method: &str,
    session_key: &str,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<(), AppError> {
    let username = state.cipher.decrypt(&row.profile_username)?;
    let name = format!(
        "{} {}",
        state.cipher.decrypt(&row.profile_nombre)?,
        state.cipher.decrypt(&row.profile_apellidos)?
    )
    .trim()
    .to_owned();
    let email = state.cipher.decrypt(&row.profile_email)?;
    let empty = state.cipher.encrypt("")?;
    let user_agent = headers
        .get("user-agent")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let (browser, os, device) = client_agent(user_agent);
    let ip = headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| value.parse::<std::net::IpAddr>().is_ok());
    sqlx::query("INSERT INTO conexiones_registroconexion (id,created_date,updated_date,profile_id,usuario,nombre_completo,email,rol,fecha_hora,estado_acceso,motivo_fallo,metodo_autenticacion,ultima_actividad,direccion_ip,pais,ciudad,region,isp,hostname,zona_horaria,navegador,version_navegador,sistema_operativo,tipo_dispositivo,session_id,estado_sesion,tiempo_sesion,fecha_cierre) VALUES ($1,NOW(),NOW(),$2,$3,$4,$5,$6,NOW(),'correcto',$7,$8,NOW(),$9::inet,$7,$7,$7,$7,$7,$7,$10,$7,$11,$12,$13,'activa',NULL,NULL)")
        .bind(Uuid::new_v4()).bind(row.id).bind(state.cipher.encrypt(&username)?).bind(state.cipher.encrypt(&name)?).bind(state.cipher.encrypt(&email)?).bind(role).bind(&empty).bind(method).bind(ip).bind(state.cipher.encrypt(browser)?).bind(state.cipher.encrypt(os)?).bind(state.cipher.encrypt(device)?).bind(session_key).execute(&mut **tx).await?;
    Ok(())
}

fn client_agent(value: &str) -> (&'static str, &'static str, &'static str) {
    let browser = if value.contains("Edg/") {
        "Edge"
    } else if value.contains("Firefox/") {
        "Firefox"
    } else if value.contains("Chrome/") {
        "Chrome"
    } else if value.contains("Safari/") {
        "Safari"
    } else {
        "Desconocido"
    };
    let os = if value.contains("Windows") {
        "Windows"
    } else if value.contains("Android") {
        "Android"
    } else if value.contains("iPhone") || value.contains("iPad") {
        "iOS"
    } else if value.contains("Mac OS X") {
        "macOS"
    } else if value.contains("Linux") {
        "Linux"
    } else {
        "Desconocido"
    };
    let device = if value.contains("iPad") {
        "Tablet"
    } else if value.contains("Mobile")
        || value.contains("Mobi")
        || value.contains("Android")
        || value.contains("iPhone")
    {
        "Móvil"
    } else {
        "Escritorio"
    };
    (browser, os, device)
}

pub(crate) fn enforce_login_rate(headers: &HeaderMap, email: &str) -> Result<(), AppError> {
    static ATTEMPTS: OnceLock<Mutex<HashMap<String, VecDeque<Instant>>>> = OnceLock::new();
    let ip = headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .unwrap_or("local");
    let key = format!("{}|{}", ip.trim(), email.trim().to_ascii_lowercase());
    let now = Instant::now();
    let mut attempts = ATTEMPTS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| AppError::Internal)?;
    attempts.retain(|_, values| {
        while values
            .front()
            .is_some_and(|seen| now.duration_since(*seen) >= StdDuration::from_secs(300))
        {
            values.pop_front();
        }
        !values.is_empty()
    });
    if attempts.len() >= 10_000 && !attempts.contains_key(&key) {
        return Err(AppError::RateLimited);
    }
    let bucket = attempts.entry(key).or_default();
    while bucket
        .front()
        .is_some_and(|seen| now.duration_since(*seen) >= StdDuration::from_secs(300))
    {
        bucket.pop_front();
    }
    if bucket.len() >= 10 {
        return Err(AppError::RateLimited);
    }
    bucket.push_back(now);
    attempts.retain(|_, values| !values.is_empty());
    Ok(())
}

pub fn require_role(claims: &Claims, allowed: &[&str]) -> Result<(), AppError> {
    allowed
        .iter()
        .any(|role| *role == claims.role)
        .then_some(())
        .ok_or(AppError::Forbidden)
}

pub(crate) fn roles_from_json(value: &serde_json::Value, fallback: &str) -> Vec<String> {
    value
        .as_array()
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str().map(ToOwned::to_owned))
                .collect()
        })
        .filter(|roles: &Vec<String>| !roles.is_empty())
        .unwrap_or_else(|| vec![fallback.to_owned()])
}

fn read_secret(value_name: &str, file_name: &str) -> Option<String> {
    std::env::var(value_name)
        .ok()
        .filter(|value| !value.is_empty())
        .or_else(|| {
            std::env::var(file_name)
                .ok()
                .and_then(|path| std::fs::read_to_string(path).ok())
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty())
        })
}

fn env_i64(name: &str, fallback: i64) -> i64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(fallback)
}

#[cfg(test)]
mod tests {
    #[test]
    fn oauth_proof_is_independent_in_each_tab() {
        let state = crate::AppState::for_test();
        let mut first = axum::http::HeaderMap::new();
        let mut second = axum::http::HeaderMap::new();
        first.insert(
            "x-uasspain-window-id",
            uuid::Uuid::new_v4().to_string().parse().unwrap(),
        );
        second.insert(
            "x-uasspain-window-id",
            uuid::Uuid::new_v4().to_string().parse().unwrap(),
        );
        let name = super::google_nonce_cookie(&first).unwrap();
        assert_ne!(name, super::google_nonce_cookie(&second).unwrap());
        let proof = state
            .tokens
            .issue(
                0,
                uuid::Uuid::nil(),
                "google",
                "google_nonce",
                5,
                "test-nonce",
            )
            .unwrap();
        let cookies = format!("{name}={proof}");
        first.insert(axum::http::header::COOKIE, cookies.parse().unwrap());
        second.insert(axum::http::header::COOKIE, cookies.parse().unwrap());
        assert!(super::google_proof(&state, &first).is_ok());
        assert!(super::google_proof(&state, &second).is_err());
    }
    #[test]
    fn idle_deadline_expires_at_exactly_900_seconds_without_grace() {
        let last = chrono::DateTime::from_timestamp(1_000_000, 0).unwrap();
        for seconds in [0, 840, 899] {
            assert!(!super::idle_expired(
                last,
                last + chrono::Duration::seconds(seconds)
            ));
        }
        assert!(!super::idle_expired(
            last,
            last + chrono::Duration::milliseconds(899999)
        ));
        for seconds in [900, 901, 1800] {
            assert!(super::idle_expired(
                last,
                last + chrono::Duration::seconds(seconds)
            ));
        }
        // New activity defines an independent deadline, not the creation time.
        let renewed = last + chrono::Duration::seconds(899);
        assert!(!super::idle_expired(
            renewed,
            last + chrono::Duration::seconds(900)
        ));
        assert!(super::idle_expired(
            renewed,
            last + chrono::Duration::seconds(1799)
        ));
    }

    #[test]
    fn window_binding_requires_a_canonical_random_uuid() {
        let mut headers = axum::http::HeaderMap::new();
        assert!(super::window_id(&headers).is_err());
        for invalid in ["", "not-an-id", "00000000-0000-0000-0000-000000000000"] {
            headers.insert("x-uasspain-window-id", invalid.parse().unwrap());
            assert!(super::window_id(&headers).is_err());
        }
        let id = uuid::Uuid::new_v4().to_string();
        headers.insert("x-uasspain-window-id", id.parse().unwrap());
        assert_eq!(super::window_id(&headers).unwrap(), id);
    }
    use super::{Claims, TokenService, consume_google_proof, require_role, validated_google_email};
    use uuid::Uuid;

    fn claims(role: &str) -> Claims {
        Claims {
            user_id: 1,
            profile_id: Uuid::from_u128(2),
            role: role.to_owned(),
            token_type: "access".to_owned(),
            exp: usize::MAX,
            iat: 0,
            jti: Uuid::nil(),
            session_key: "test-session".to_owned(),
        }
    }

    #[test]
    fn role_gate_denies_vertical_escalation() {
        assert!(require_role(&claims("alumno"), &["admin"]).is_err());
        assert!(require_role(&claims("admin"), &["admin"]).is_ok());
    }

    #[test]
    fn google_claims_bind_issuer_audience_expiry_and_verified_identity() {
        let valid = serde_json::json!({"aud":"client-id","azp":"client-id","iss":"https://accounts.google.com", "iat":"900","exp":"1100","sub":"provider-subject","email_verified":"true","email":" User@EXAMPLE.COM ", "hd":"example.com"});
        assert_eq!(
            validated_google_email(&valid, "client-id", 1000).unwrap(),
            "user@example.com"
        );
        for (key, value) in [
            ("aud", serde_json::json!("other")),
            ("azp", serde_json::json!("other")),
            ("iss", serde_json::json!("https://attacker.example")),
            ("exp", serde_json::json!("1000")),
            ("iat", serde_json::json!("1200")),
            ("nbf", serde_json::json!(1001)),
            ("sub", serde_json::json!("")),
            ("email_verified", serde_json::json!(false)),
            ("email", serde_json::json!("invalid")),
        ] {
            let mut invalid = valid.clone();
            invalid[key] = value;
            assert!(
                validated_google_email(&invalid, "client-id", 1000).is_err(),
                "accepted invalid {key}"
            );
        }
        let mut external_email = valid.clone();
        external_email.as_object_mut().unwrap().remove("hd");
        assert!(validated_google_email(&external_email, "client-id", 1000).is_err());
        external_email["email"] = serde_json::json!("user@gmail.com");
        assert!(validated_google_email(&external_email, "client-id", 1000).is_ok());
        let mut absent_audience = valid;
        absent_audience.as_object_mut().unwrap().remove("aud");
        assert!(validated_google_email(&absent_audience, "client-id", 1000).is_err());
    }

    #[test]
    fn federated_and_password_login_share_the_account_otp_policy() {
        let policy = serde_json::json!({"enabled":true,"required_roles":["admin"]});
        let roles = vec!["instructor".to_owned(), "admin".to_owned()];
        assert!(super::requires_login_otp(&policy, &roles, None));
        assert!(!super::requires_login_otp(&policy, &roles, Some(false)));
        assert!(!super::requires_login_otp(
            &policy,
            &["alumno".to_owned()],
            None
        ));
        assert!(super::requires_login_otp(
            &serde_json::json!({"enabled":false}),
            &[],
            Some(true)
        ));
    }

    #[test]
    fn google_nonce_is_signed_bound_to_its_type_and_consumed_once() {
        let issuer = TokenService::for_test();
        let encoded = issuer
            .issue(0, Uuid::nil(), "google", "google_nonce", 5, "nonce-fixture")
            .unwrap();
        let proof = issuer.decode(&encoded, "google_nonce").unwrap();
        assert_eq!(proof.session_key, "nonce-fixture");
        assert!(issuer.decode(&encoded, "access").is_err());
        assert!(
            issuer
                .decode(&format!("{encoded}tampered"), "google_nonce")
                .is_err()
        );
        let now = chrono::Utc::now().timestamp() as usize;
        assert!(consume_google_proof(&proof, now).is_ok());
        assert!(consume_google_proof(&proof, now).is_err());
        let mut expired = proof;
        expired.jti = Uuid::new_v4();
        expired.exp = now;
        assert!(consume_google_proof(&expired, now).is_err());
    }
}
