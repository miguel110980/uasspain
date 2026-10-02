use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration as StdDuration, Instant},
};

use axum::{
    Json,
    extract::{Request, State},
    http::{
        HeaderMap, StatusCode,
        header::{AUTHORIZATION, COOKIE, SET_COOKIE},
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
    security::verify_password_hash,
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
    user_id: Option<i32>,
    password: String,
    is_active: bool,
    status: String,
    role: String,
    roles: serde_json::Value,
    otp_verified: bool,
    login_otp_hash: Option<String>,
    login_otp_created_at: Option<chrono::DateTime<Utc>>,
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
    enforce_login_rate(&headers, &input.email)?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let lookup = state
        .cipher
        .blind_index(&input.email.trim().to_lowercase())?;
    let row = sqlx::query_as::<_, LoginRow>(
        "SELECT p.id, p.user_id, u.password, u.is_active, p.status, p.role, p.roles, p.otp_verified, p.login_otp_hash, p.login_otp_created_at, p.login_2fa_enabled_override,p.username AS profile_username,p.nombre AS profile_nombre,p.apellidos AS profile_apellidos,p.email AS profile_email \
         FROM accounts_userprofile p JOIN auth_user u ON u.id = p.user_id WHERE p.email_lookup = $1 LIMIT 1",
    ).bind(lookup).fetch_optional(pool).await?.ok_or(AppError::Unauthorized)?;

    if !row.is_active
        || row.status != "activo"
        || !row.otp_verified
        || !verify_password_hash(&input.password, &row.password)
    {
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
    let policy_enabled = policy
        .get("enabled")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let required = policy
        .get("required_roles")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    let needs_2fa = row.login_2fa_enabled_override.unwrap_or(
        policy_enabled
            && required
                .iter()
                .filter_map(serde_json::Value::as_str)
                .any(|required_role| {
                    roles
                        .iter()
                        .any(|profile_role| profile_role == required_role)
                }),
    );
    if needs_2fa && input.code.as_deref().unwrap_or_default().is_empty() {
        use rand::Rng as _;
        let code = format!("{:06}", rand::rng().random_range(100_000..1_000_000));
        let hash = crate::registration::hash_argon2(&code)?;
        sqlx::query("UPDATE accounts_userprofile SET login_otp_hash=$1,login_otp_created_at=NOW() WHERE id=$2").bind(hash).bind(row.id).execute(pool).await?;
        if let Err(error) = crate::email::send(
            &input.email,
            "Código temporal de acceso UASSpain",
            &format!("Su código temporal de acceso es: {code}"),
        )
        .await
        {
            let _ = sqlx::query("UPDATE accounts_userprofile SET login_otp_hash='',login_otp_created_at=NULL WHERE id=$1").bind(row.id).execute(pool).await;
            return Err(error);
        }
        return Ok((StatusCode::ACCEPTED, Json(serde_json::json!({"detail":"Código de acceso enviado. Introduzca el OTP para completar el login.","code":"otp_required","roles":roles}))).into_response());
    }
    if needs_2fa {
        let code = input.code.as_deref().unwrap_or_default();
        let fresh = row
            .login_otp_created_at
            .is_some_and(|created| created > Utc::now() - chrono::Duration::minutes(15));
        if !fresh
            || !crate::security::verify_password_hash(
                code,
                row.login_otp_hash.as_deref().unwrap_or_default(),
            )
        {
            return Err(AppError::Validation(
                "Código 2FA incorrecto o caducado.".into(),
            ));
        }
        sqlx::query("UPDATE accounts_userprofile SET login_otp_hash='',login_otp_created_at=NULL WHERE id=$1").bind(row.id).execute(pool).await?;
    }
    finish_login(&state, &headers, &row, role, "password").await
}

pub async fn google_login(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<GoogleLoginRequest>,
) -> Result<Response, AppError> {
    let client_id = std::env::var("GOOGLE_CLIENT_ID")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or(AppError::Unavailable)?;
    if !(16..=8192).contains(&input.id_token.len()) {
        return Err(AppError::Validation("Token de Google no válido.".into()));
    }
    enforce_login_rate(&headers, "google")?;
    let response = reqwest::Client::builder()
        .timeout(StdDuration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| AppError::Unavailable)?
        .get("https://oauth2.googleapis.com/tokeninfo")
        .query(&[("id_token", input.id_token.as_str())])
        .send()
        .await
        .map_err(|_| AppError::Unauthorized)?;
    if !response.status().is_success() {
        return Err(AppError::Unauthorized);
    }
    let token: serde_json::Value = response.json().await.map_err(|_| AppError::Unauthorized)?;
    let audience = token
        .get("aud")
        .or_else(|| token.get("azp"))
        .and_then(serde_json::Value::as_str);
    let verified = token
        .get("email_verified")
        .is_some_and(|value| value == true || value.as_str() == Some("true"));
    let email = token
        .get("email")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| value.contains('@'))
        .ok_or(AppError::Unauthorized)?;
    if audience != Some(client_id.as_str()) || !verified {
        return Err(AppError::Unauthorized);
    }
    let lookup = state.cipher.blind_index(&email.to_lowercase())?;
    let row = sqlx::query_as::<_, LoginRow>(
        "SELECT p.id, p.user_id, u.password, u.is_active, p.status, p.role, p.roles, p.otp_verified, p.login_otp_hash, p.login_otp_created_at, p.login_2fa_enabled_override,p.username AS profile_username,p.nombre AS profile_nombre,p.apellidos AS profile_apellidos,p.email AS profile_email \
         FROM accounts_userprofile p JOIN auth_user u ON u.id = p.user_id WHERE p.email_lookup = $1 LIMIT 1",
    )
    .bind(lookup)
    .fetch_optional(state.pool.as_ref().ok_or(AppError::Unavailable)?)
    .await?
    .ok_or(AppError::NotFound)?;
    if !row.is_active || row.status != "activo" || !row.otp_verified {
        return Err(AppError::Forbidden);
    }
    let role = row.role.clone();
    finish_login(&state, &headers, &row, &role, "google").await
}

async fn finish_login(
    state: &AppState,
    headers: &HeaderMap,
    row: &LoginRow,
    role: &str,
    method: &str,
) -> Result<Response, AppError> {
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let user_id = i64::from(row.user_id.ok_or(AppError::Unauthorized)?);
    let session_key = Uuid::new_v4().simple().to_string();
    sqlx::query("UPDATE accounts_userprofile SET active_session_key=$1,session_role=$2,updated_date=NOW() WHERE id=$3")
        .bind(&session_key).bind(role).bind(row.id).execute(pool).await?;
    record_login(state, headers, row, role, method, &session_key).await?;
    let access = state.tokens.issue(
        user_id,
        row.id,
        role,
        "access",
        state.tokens.access_minutes,
        &session_key,
    )?;
    let refresh = state.tokens.issue(
        user_id,
        row.id,
        role,
        "refresh",
        state.tokens.refresh_days * 24 * 60,
        &session_key,
    )?;
    let secure = if state.tokens.secure_cookie {
        "; Secure"
    } else {
        ""
    };
    let mut response = (
        StatusCode::OK,
        Json(serde_json::json!({"detail": "Inicio de sesión correcto."})),
    )
        .into_response();
    response.headers_mut().append(
        SET_COOKIE,
        format!(
            "{}={access}; Path=/; HttpOnly; SameSite=Strict; Max-Age={}{}",
            state.tokens.access_cookie,
            state.tokens.access_minutes * 60,
            secure
        )
        .parse()
        .map_err(|_| AppError::Internal)?,
    );
    response.headers_mut().append(
        SET_COOKIE,
        format!(
            "{}={refresh}; Path=/api/auth/; HttpOnly; SameSite=Strict; Max-Age={}{}",
            state.tokens.refresh_cookie,
            state.tokens.refresh_days * 86_400,
            secure
        )
        .parse()
        .map_err(|_| AppError::Internal)?,
    );
    Ok(response)
}

pub async fn me(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let row = sqlx::query_as::<_, ProfileRow>(ProfileRow::SELECT_BY_ID)
        .bind(claims.profile_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)?;
    let profile = ProfileView::from_row(row, &state.cipher)?;
    Ok(Json(serde_json::json!({
        "id": profile.id, "user_id": claims.user_id, "email": profile.email,
        "full_name": profile.full_name(), "role": profile.role, "roles": profile.roles,
        "session_role": claims.role, "status": profile.status, "profile": profile
    })))
}

pub async fn logout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    if let Ok(claims) = authenticate(&state, &headers, "access")
        && let Some(pool) = &state.pool
    {
        let current: Option<String> =
            sqlx::query_scalar("SELECT active_session_key FROM accounts_userprofile WHERE id=$1")
                .bind(claims.profile_id)
                .fetch_optional(pool)
                .await?;
        if !claims.session_key.is_empty() && current.as_deref() == Some(&claims.session_key) {
            finalize_sessions(pool, claims.profile_id).await?;
            sqlx::query("UPDATE accounts_userprofile SET active_session_key=$1,updated_date=NOW() WHERE id=$2")
                .bind(Uuid::new_v4().simple().to_string()).bind(claims.profile_id).execute(pool).await?;
        }
    }
    let secure = if state.tokens.secure_cookie {
        "; Secure"
    } else {
        ""
    };
    let mut response = (
        StatusCode::OK,
        Json(serde_json::json!({"detail": "Sesión cerrada."})),
    )
        .into_response();
    response.headers_mut().append(
        SET_COOKIE,
        format!(
            "{}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0{secure}",
            state.tokens.access_cookie
        )
        .parse()
        .map_err(|_| AppError::Internal)?,
    );
    response.headers_mut().append(
        SET_COOKIE,
        format!(
            "{}=; Path=/api/auth/; HttpOnly; SameSite=Strict; Max-Age=0{secure}",
            state.tokens.refresh_cookie
        )
        .parse()
        .map_err(|_| AppError::Internal)?,
    );
    Ok(response)
}

pub async fn refresh(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let claims = authenticate(&state, &headers, "refresh")?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let current_session: Option<String> = sqlx::query_scalar(
        "SELECT p.active_session_key FROM accounts_userprofile p JOIN auth_user u ON u.id=p.user_id WHERE p.id=$1 AND p.status='activo' AND p.otp_verified AND u.is_active",
    )
    .bind(claims.profile_id)
    .fetch_optional(pool)
    .await?;
    if claims.session_key.is_empty() || current_session.as_deref() != Some(&claims.session_key) {
        return Err(AppError::Unauthorized);
    }
    let access = state.tokens.issue(
        claims.user_id,
        claims.profile_id,
        &claims.role,
        "access",
        state.tokens.access_minutes,
        &claims.session_key,
    )?;
    let rotated = state.tokens.issue(
        claims.user_id,
        claims.profile_id,
        &claims.role,
        "refresh",
        state.tokens.refresh_days * 24 * 60,
        &claims.session_key,
    )?;
    let secure = if state.tokens.secure_cookie {
        "; Secure"
    } else {
        ""
    };
    let mut response = (
        StatusCode::OK,
        Json(serde_json::json!({"detail": "Token actualizado."})),
    )
        .into_response();
    response.headers_mut().append(
        SET_COOKIE,
        format!(
            "{}={access}; Path=/; HttpOnly; SameSite=Strict; Max-Age={}{}",
            state.tokens.access_cookie,
            state.tokens.access_minutes * 60,
            secure
        )
        .parse()
        .map_err(|_| AppError::Internal)?,
    );
    response.headers_mut().append(
        SET_COOKIE,
        format!(
            "{}={rotated}; Path=/api/auth/; HttpOnly; SameSite=Strict; Max-Age={}{}",
            state.tokens.refresh_cookie,
            state.tokens.refresh_days * 86_400,
            secure
        )
        .parse()
        .map_err(|_| AppError::Internal)?,
    );
    Ok(response)
}

pub async fn session_role(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<SessionRoleRequest>,
) -> Result<Response, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let role = input.role.trim();
    if !matches!(role, "admin" | "instructor" | "alumno") {
        return Err(AppError::Validation(format!("Rol no válido: {role}")));
    }
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let roles: serde_json::Value =
        sqlx::query_scalar("SELECT roles FROM accounts_userprofile WHERE id = $1")
            .bind(claims.profile_id)
            .fetch_optional(pool)
            .await?
            .ok_or(AppError::NotFound)?;
    if !roles
        .as_array()
        .is_some_and(|values| values.iter().any(|value| value.as_str() == Some(role)))
    {
        return Err(AppError::Forbidden);
    }
    sqlx::query(
        "UPDATE accounts_userprofile SET session_role = $1, updated_date = NOW() WHERE id = $2",
    )
    .bind(role)
    .bind(claims.profile_id)
    .execute(pool)
    .await?;
    let access = state.tokens.issue(
        claims.user_id,
        claims.profile_id,
        role,
        "access",
        state.tokens.access_minutes,
        &claims.session_key,
    )?;
    let secure = if state.tokens.secure_cookie {
        "; Secure"
    } else {
        ""
    };
    let mut response = (
        StatusCode::OK,
        Json(serde_json::json!({
            "detail": format!("Rol de sesión actualizado a {role}."), "session_role": role
        })),
    )
        .into_response();
    response.headers_mut().append(
        SET_COOKIE,
        format!(
            "{}={access}; Path=/; HttpOnly; SameSite=Strict; Max-Age={}{}",
            state.tokens.access_cookie,
            state.tokens.access_minutes * 60,
            secure
        )
        .parse()
        .map_err(|_| AppError::Internal)?,
    );
    Ok(response)
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
        let validation = Validation::new(Algorithm::HS256);
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
    let bearer = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    let cookie_name = if token_type == "refresh" {
        &state.tokens.refresh_cookie
    } else {
        &state.tokens.access_cookie
    };
    let cookie = headers
        .get(COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|cookies| {
            cookies
                .split(';')
                .map(str::trim)
                .find_map(|cookie| cookie.strip_prefix(&format!("{cookie_name}=")))
        });
    state
        .tokens
        .decode(bearer.or(cookie).ok_or(AppError::Unauthorized)?, token_type)
}

pub async fn validate_active_session(
    State(state): State<Arc<AppState>>,
    request: Request,
    next: Next,
) -> Result<Response, AppError> {
    let path = request.uri().path();
    if matches!(
        path,
        "/" | "/api/health/live/" | "/api/health/ready/" | "/api/contact/"
    ) || path.starts_with("/api/public/")
        || matches!(
            path,
            "/api/auth/login/"
                | "/api/auth/logout/"
                | "/api/auth/register/"
                | "/api/auth/verify-otp/"
                | "/api/auth/resend-otp/"
                | "/api/auth/password-reset/"
                | "/api/auth/password-reset/confirm/"
        )
    {
        return Ok(next.run(request).await);
    }
    let token_type = if path == "/api/auth/refresh/" {
        "refresh"
    } else {
        "access"
    };
    let bearer = request
        .headers()
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    let cookie_name = if token_type == "refresh" {
        &state.tokens.refresh_cookie
    } else {
        &state.tokens.access_cookie
    };
    let cookie = request
        .headers()
        .get(COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|cookies| {
            cookies
                .split(';')
                .map(str::trim)
                .find_map(|cookie| cookie.strip_prefix(&format!("{cookie_name}=")))
        });
    let Some(token) = bearer.or(cookie) else {
        return Ok(next.run(request).await);
    };
    let claims = state.tokens.decode(token, token_type)?;
    if claims.session_key.is_empty() {
        return Err(AppError::Unauthorized);
    }
    if !session_is_active(&state, &claims).await? {
        return Err(AppError::Unauthorized);
    }
    sqlx::query("UPDATE conexiones_registroconexion SET ultima_actividad=NOW(),updated_date=NOW() WHERE profile_id=$1 AND session_id=$2 AND estado_sesion='activa' AND (ultima_actividad IS NULL OR ultima_actividad < NOW()-INTERVAL '60 seconds')")
        .bind(claims.profile_id).bind(&claims.session_key).execute(state.pool.as_ref().ok_or(AppError::Unavailable)?).await?;
    Ok(next.run(request).await)
}

pub async fn session_is_active(state: &AppState, claims: &Claims) -> Result<bool, AppError> {
    if claims.session_key.is_empty() || claims.exp <= Utc::now().timestamp() as usize {
        return Ok(false);
    }
    let current: Option<(Option<String>, String, serde_json::Value)> = sqlx::query_as(
        "SELECT p.active_session_key, p.role, p.roles FROM accounts_userprofile p JOIN auth_user u ON u.id=p.user_id WHERE p.id=$1 AND p.status='activo' AND p.otp_verified AND u.is_active",
    )
    .bind(claims.profile_id)
    .fetch_optional(state.pool.as_ref().ok_or(AppError::Unavailable)?)
    .await?;
    Ok(current.is_some_and(|(session, role, roles)| {
        session.as_deref() == Some(&claims.session_key)
            && roles_from_json(&roles, &role).contains(&claims.role)
    }))
}

async fn record_login(
    state: &AppState,
    headers: &HeaderMap,
    row: &LoginRow,
    role: &str,
    method: &str,
    session_key: &str,
) -> Result<(), AppError> {
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    finalize_sessions(pool, row.id).await?;
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
        .bind(Uuid::new_v4()).bind(row.id).bind(state.cipher.encrypt(&username)?).bind(state.cipher.encrypt(&name)?).bind(state.cipher.encrypt(&email)?).bind(role).bind(&empty).bind(method).bind(ip).bind(state.cipher.encrypt(browser)?).bind(state.cipher.encrypt(os)?).bind(state.cipher.encrypt(device)?).bind(session_key).execute(pool).await?;
    Ok(())
}

async fn finalize_sessions(pool: &sqlx::PgPool, profile_id: Uuid) -> Result<(), AppError> {
    sqlx::query("UPDATE conexiones_registroconexion SET estado_sesion='finalizada',fecha_cierre=NOW(),ultima_actividad=NOW(),tiempo_sesion=GREATEST(0,EXTRACT(EPOCH FROM (NOW()-fecha_hora))::integer),updated_date=NOW() WHERE profile_id=$1 AND estado_sesion='activa'")
        .bind(profile_id).execute(pool).await?;
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

fn enforce_login_rate(headers: &HeaderMap, email: &str) -> Result<(), AppError> {
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

fn roles_from_json(value: &serde_json::Value, fallback: &str) -> Vec<String> {
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
    use super::{Claims, require_role};
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
}
