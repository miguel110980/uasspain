use std::sync::Arc;

use argon2::{
    Argon2, PasswordHasher,
    password_hash::{SaltString, rand_core::OsRng},
};
use axum::{
    Form, Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{NaiveDate, NaiveDateTime, Utc};
use hmac::{Hmac, Mac};
use rand::Rng as _;
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{AppState, auth::authenticate, error::AppError, security::verify_password_hash};

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    email: String,
    password: String,
    #[serde(default)]
    nombre: String,
    #[serde(default)]
    apellidos: String,
    #[serde(default)]
    username: String,
    #[serde(default)]
    dni_nie: String,
    fecha_nacimiento: Option<NaiveDate>,
    #[serde(default)]
    foto_perfil: String,
}

#[derive(Debug, Deserialize)]
pub struct OtpRequest {
    email: String,
    #[serde(alias = "otp", alias = "otpCode")]
    code: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    current_password: String,
    new_password: String,
}

#[derive(Debug, Deserialize)]
pub struct PasswordResetRequest {
    email: String,
}
#[derive(Debug, Deserialize)]
pub struct PasswordResetConfirmRequest {
    uid: String,
    token: String,
    #[serde(alias = "new_password")]
    password: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateInstructorRequest {
    nombre: String,
    #[serde(default)]
    apellidos: String,
    email: String,
    #[serde(default)]
    username: String,
    #[serde(default)]
    dni_nie: String,
    fecha_nacimiento: Option<NaiveDate>,
    password: String,
    #[serde(default)]
    es_admin: bool,
}

#[derive(Debug, Deserialize)]
pub struct InviteUserRequest {
    email: String,
    #[serde(default = "default_student_role")]
    role: String,
    #[serde(default)]
    nombre: String,
    #[serde(default)]
    apellidos: String,
}

fn default_student_role() -> String {
    "alumno".to_owned()
}

#[derive(sqlx::FromRow)]
struct ResetUser {
    id: i32,
    password: String,
    last_login: Option<NaiveDateTime>,
    email: String,
    username: String,
    profile_email: String,
    dni_nie: String,
}

pub async fn register(
    State(state): State<Arc<AppState>>,
    Json(input): Json<RegisterRequest>,
) -> Result<(axum::http::StatusCode, Json<Value>), AppError> {
    if !env_true("REGISTRATION_ENABLED", true) {
        return Err(AppError::Forbidden);
    }
    let email = normalize_email(&input.email)?;
    let username = if input.username.trim().is_empty() {
        email.clone()
    } else {
        input.username.trim().to_owned()
    };
    validate_text(&username, 150, "Usuario no valido.")?;
    validate_text(&input.nombre, 120, "Nombre no valido.")?;
    validate_text(&input.apellidos, 120, "Apellidos no validos.")?;
    if !input.foto_perfil.is_empty() && !input.foto_perfil.starts_with("https://") {
        return Err(AppError::Validation("URL de foto no valida.".to_owned()));
    }
    validate_password(&input.password, &username, &email, &input.dni_nie)?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let email_lookup = state.cipher.blind_index(&email)?;
    let username_lookup = state.cipher.blind_index(&username.to_lowercase())?;
    let dni_lookup = state
        .cipher
        .blind_index(&input.dni_nie.trim().to_uppercase())?;
    let duplicate: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM accounts_userprofile WHERE email_lookup = $1 OR username_lookup = $2 OR ($3 != '' AND dni_lookup = $3))")
        .bind(&email_lookup).bind(&username_lookup).bind(&dni_lookup).fetch_one(pool).await?;
    if duplicate {
        return Err(AppError::Validation(
            "Email, usuario o DNI/NIE ya registrado.".to_owned(),
        ));
    }
    let hashes: Vec<String> = sqlx::query_scalar("SELECT password FROM auth_user")
        .fetch_all(pool)
        .await?;
    if hashes
        .iter()
        .any(|hash| verify_password_hash(&input.password, hash))
    {
        return Err(AppError::Validation(
            "Esta contrasena ya esta en uso por otro usuario.".to_owned(),
        ));
    }
    let profile_id = Uuid::new_v4();
    let password = hash_argon2(&input.password)?;
    let auth_username = format!("u_{}", Uuid::new_v4().simple());
    let otp = format!("{:06}", rand::rng().random_range(100_000..1_000_000));
    let otp_hash = hash_argon2(&otp)?;
    let mut tx = pool.begin().await?;
    let user_id: i32 = sqlx::query_scalar("INSERT INTO auth_user (password,last_login,is_superuser,username,first_name,last_name,email,is_staff,is_active,date_joined) VALUES ($1,NULL,FALSE,$2,'','',$3,FALSE,TRUE,NOW()) RETURNING id")
        .bind(password).bind(auth_username).bind(format!("user-{profile_id}@internal.uasspain.local")).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO accounts_userprofile (id,created_date,updated_date,nombre,apellidos,email,username,dni_nie,foto_perfil,status,role,otp_hash,otp_verified,user_id,roles,username_lookup,email_lookup,dni_lookup,fecha_nacimiento,active_session_key,login_otp_created_at,login_otp_hash,login_2fa_enabled_override,session_role,assigned_instructor_id) VALUES ($1,NOW(),NOW(),$2,$3,$4,$5,$6,$7,'pendiente','alumno',$8,FALSE,$9,'[\"alumno\"]'::jsonb,$10,$11,$12,$13,'',NULL,'',NULL,'',NULL)")
        .bind(profile_id).bind(state.cipher.encrypt(input.nombre.trim())?).bind(state.cipher.encrypt(input.apellidos.trim())?)
        .bind(state.cipher.encrypt(&email)?).bind(state.cipher.encrypt(&username)?).bind(state.cipher.encrypt(input.dni_nie.trim())?)
        .bind(state.cipher.encrypt(&input.foto_perfil)?).bind(otp_hash).bind(user_id).bind(username_lookup).bind(email_lookup).bind(dni_lookup)
        .bind(input.fecha_nacimiento.map(|date| date.to_string()).unwrap_or_default()).execute(&mut *tx).await?;
    deliver_otp(&email, &otp).await?;
    tx.commit().await?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(
            json!({"id":profile_id,"user_id":user_id,"email":email,"username":username,"nombre":input.nombre,"apellidos":input.apellidos,"status":"pendiente","role":"alumno","roles":["alumno"],"otp_verified":false}),
        ),
    ))
}

pub async fn verify_otp(
    State(state): State<Arc<AppState>>,
    Json(input): Json<OtpRequest>,
) -> Result<Json<Value>, AppError> {
    let email = normalize_email(&input.email)?;
    let code = otp_code(input.code)?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let lookup = state.cipher.blind_index(&email)?;
    let row: Option<(Uuid, String)> =
        sqlx::query_as("SELECT id,otp_hash FROM accounts_userprofile WHERE email_lookup=$1")
            .bind(lookup)
            .fetch_optional(pool)
            .await?;
    let (id, hash) = row.ok_or(AppError::NotFound)?;
    if !verify_password_hash(&code, &hash) {
        return Err(AppError::Validation("Codigo incorrecto.".to_owned()));
    }
    sqlx::query("UPDATE accounts_userprofile SET otp_hash='',otp_verified=TRUE,updated_date=NOW() WHERE id=$1").bind(id).execute(pool).await?;
    Ok(Json(
        json!({"detail":"Email verificado correctamente. Un instructor revisara su solicitud de acceso."}),
    ))
}

pub async fn resend_otp(
    State(state): State<Arc<AppState>>,
    Json(input): Json<OtpRequest>,
) -> Result<Json<Value>, AppError> {
    let email = normalize_email(&input.email)?;
    let lookup = state.cipher.blind_index(&email)?;
    let otp = format!("{:06}", rand::rng().random_range(100_000..1_000_000));
    let hash = hash_argon2(&otp)?;
    let result=sqlx::query("UPDATE accounts_userprofile SET otp_hash=$1,updated_date=NOW() WHERE email_lookup=$2 AND otp_verified=FALSE AND status='pendiente'").bind(hash).bind(lookup).execute(state.pool.as_ref().ok_or(AppError::Unavailable)?).await?;
    if result.rows_affected() > 0 {
        deliver_otp(&email, &otp).await?;
    }
    Ok(Json(json!({"detail":"Codigo reenviado."})))
}

pub async fn change_password(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<ChangePasswordRequest>,
) -> Result<Json<Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let row: Option<(String,String,String,String)>=sqlx::query_as("SELECT u.password,p.username,p.email,p.dni_nie FROM auth_user u JOIN accounts_userprofile p ON p.user_id=u.id WHERE p.id=$1").bind(claims.profile_id).fetch_optional(pool).await?;
    let (old, username, email, dni) = row.ok_or(AppError::NotFound)?;
    if !verify_password_hash(&input.current_password, &old) {
        return Err(AppError::Unauthorized);
    }
    let username = state.cipher.decrypt(&username)?;
    let email = state.cipher.decrypt(&email)?;
    let dni = state.cipher.decrypt(&dni)?;
    validate_password(&input.new_password, &username, &email, &dni)?;
    let hash = hash_argon2(&input.new_password)?;
    sqlx::query("UPDATE auth_user SET password=$1 WHERE id=$2")
        .bind(hash)
        .bind(i32::try_from(claims.user_id).map_err(|_| AppError::Internal)?)
        .execute(pool)
        .await?;
    sqlx::query("UPDATE accounts_userprofile SET active_session_key=$1,login_otp_hash='',login_otp_created_at=NULL,updated_date=NOW() WHERE id=$2")
        .bind(Uuid::new_v4().simple().to_string()).bind(claims.profile_id).execute(pool).await?;
    Ok(Json(json!({"detail":"Contrasena actualizada."})))
}

pub async fn password_reset_request(
    State(state): State<Arc<AppState>>,
    Json(input): Json<PasswordResetRequest>,
) -> Result<Json<Value>, AppError> {
    let email = normalize_email(&input.email)?;
    let lookup = state.cipher.blind_index(&email)?;
    let user = sqlx::query_as::<_, ResetUser>("SELECT u.id,u.password,u.last_login,u.email,u.username,p.email AS profile_email,p.dni_nie FROM auth_user u JOIN accounts_userprofile p ON p.user_id=u.id WHERE p.email_lookup=$1 LIMIT 1")
        .bind(lookup).fetch_optional(state.pool.as_ref().ok_or(AppError::Unavailable)?).await?.ok_or(AppError::NotFound)?;
    if user.password.starts_with('!') {
        return Err(AppError::Validation("Esta cuenta no tiene contraseña configurada. Inicia sesión con Google o contacta con el centro.".into()));
    }
    let timestamp = reset_timestamp();
    let uid = URL_SAFE_NO_PAD.encode(user.id.to_string());
    let token = compatible_reset_token(&user, timestamp)?;
    let frontend = std::env::var("FRONTEND_URL").unwrap_or_else(|_| "http://localhost:5173".into());
    crate::email::send(&email, "Restablecer contraseña UASSpain", &format!("Use este enlace para restablecer su contraseña: {frontend}/restablecer-contrasena?uid={uid}&token={token}")).await?;
    Ok(Json(
        json!({"detail":"Hemos enviado un enlace para restablecer su contraseña."}),
    ))
}

pub async fn password_reset_confirm(
    State(state): State<Arc<AppState>>,
    Form(input): Form<PasswordResetConfirmRequest>,
) -> Result<Json<Value>, AppError> {
    let decoded = URL_SAFE_NO_PAD
        .decode(input.uid.as_bytes())
        .map_err(|_| AppError::Validation("Enlace inválido.".into()))?;
    let user_id: i32 = String::from_utf8(decoded)
        .ok()
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| AppError::Validation("Enlace inválido.".into()))?;
    let user = sqlx::query_as::<_, ResetUser>("SELECT u.id,u.password,u.last_login,u.email,u.username,p.email AS profile_email,p.dni_nie FROM auth_user u JOIN accounts_userprofile p ON p.user_id=u.id WHERE u.id=$1")
        .bind(user_id).fetch_optional(state.pool.as_ref().ok_or(AppError::Unavailable)?).await?.ok_or_else(|| AppError::Validation("Enlace inválido.".into()))?;
    if !valid_reset_token(&user, &input.token)? {
        return Err(AppError::Validation("Token inválido o expirado.".into()));
    }
    let profile_email = state.cipher.decrypt(&user.profile_email)?;
    let dni = state.cipher.decrypt(&user.dni_nie)?;
    validate_password(&input.password, &user.username, &profile_email, &dni)?;
    let hashes: Vec<String> = sqlx::query_scalar("SELECT password FROM auth_user WHERE id<>$1")
        .bind(user_id)
        .fetch_all(state.pool.as_ref().ok_or(AppError::Unavailable)?)
        .await?;
    if hashes
        .iter()
        .any(|hash| verify_password_hash(&input.password, hash))
    {
        return Err(AppError::Validation(
            "Esta contraseña ya está en uso por otro usuario.".into(),
        ));
    }
    let hash = hash_argon2(&input.password)?;
    sqlx::query("UPDATE auth_user SET password=$1 WHERE id=$2")
        .bind(hash)
        .bind(user_id)
        .execute(state.pool.as_ref().ok_or(AppError::Unavailable)?)
        .await?;
    sqlx::query("UPDATE accounts_userprofile SET active_session_key=$1,login_otp_hash='',login_otp_created_at=NULL,updated_date=NOW() WHERE user_id=$2")
        .bind(Uuid::new_v4().simple().to_string()).bind(user_id).execute(state.pool.as_ref().ok_or(AppError::Unavailable)?).await?;
    Ok(Json(json!({"detail":"Contraseña actualizada."})))
}

pub async fn admin_password_reset(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(profile_id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    crate::auth::require_role(&claims, &["admin"])?;
    let user = sqlx::query_as::<_, ResetUser>("SELECT u.id,u.password,u.last_login,u.email,u.username,p.email AS profile_email,p.dni_nie FROM auth_user u JOIN accounts_userprofile p ON p.user_id=u.id WHERE p.id=$1")
        .bind(profile_id).fetch_optional(state.pool.as_ref().ok_or(AppError::Unavailable)?).await?.ok_or(AppError::NotFound)?;
    let email = state.cipher.decrypt(&user.profile_email)?;
    let timestamp = reset_timestamp();
    let uid = URL_SAFE_NO_PAD.encode(user.id.to_string());
    let token = compatible_reset_token(&user, timestamp)?;
    let frontend = std::env::var("FRONTEND_URL").unwrap_or_else(|_| "http://localhost:5173".into());
    crate::email::send(&email, "Restablecer contraseña UASSpain", &format!("Use este enlace para restablecer su contraseña: {frontend}/restablecer-contrasena?uid={uid}&token={token}")).await?;
    Ok(Json(
        json!({"detail":format!("Enlace de restablecimiento enviado a {email}." )}),
    ))
}

pub async fn create_instructor(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<CreateInstructorRequest>,
) -> Result<(StatusCode, Json<crate::users::ProfileView>), AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    crate::auth::require_role(&claims, &["admin"])?;
    let email = normalize_email(&input.email)?;
    let username = if input.username.trim().is_empty() {
        email.clone()
    } else {
        input.username.trim().to_owned()
    };
    validate_text(&input.nombre, 120, "Nombre no válido.")?;
    validate_text(&input.apellidos, 120, "Apellidos no válidos.")?;
    validate_text(&username, 150, "Usuario no válido.")?;
    validate_password(&input.password, &username, &email, &input.dni_nie)?;
    let email_lookup = state.cipher.blind_index(&email)?;
    let username_lookup = state.cipher.blind_index(&username.to_lowercase())?;
    let dni_lookup = state
        .cipher
        .blind_index(&input.dni_nie.trim().to_uppercase())?;
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM accounts_userprofile WHERE email_lookup=$1 OR username_lookup=$2 OR ($3<>'' AND dni_lookup=$3))")
        .bind(&email_lookup).bind(&username_lookup).bind(&dni_lookup).fetch_one(state.pool.as_ref().ok_or(AppError::Unavailable)?).await?;
    if exists {
        return Err(AppError::Validation(
            "Email, usuario o DNI/NIE ya registrado.".into(),
        ));
    }
    let hashes: Vec<String> = sqlx::query_scalar("SELECT password FROM auth_user")
        .fetch_all(state.pool.as_ref().ok_or(AppError::Unavailable)?)
        .await?;
    if hashes
        .iter()
        .any(|hash| verify_password_hash(&input.password, hash))
    {
        return Err(AppError::Validation(
            "Esta contraseña ya está en uso por otro usuario.".into(),
        ));
    }
    let profile_id = Uuid::new_v4();
    let hash = hash_argon2(&input.password)?;
    let mut tx = state
        .pool
        .as_ref()
        .ok_or(AppError::Unavailable)?
        .begin()
        .await?;
    let user_id: i32 = sqlx::query_scalar("INSERT INTO auth_user (password,last_login,is_superuser,username,first_name,last_name,email,is_staff,is_active,date_joined) VALUES ($1,NULL,$2,$3,'','',$4,$2,TRUE,NOW()) RETURNING id")
        .bind(hash).bind(input.es_admin).bind(format!("u_{}", Uuid::new_v4().simple())).bind(format!("user-{profile_id}@internal.uasspain.local")).fetch_one(&mut *tx).await?;
    let roles = if input.es_admin {
        json!(["instructor", "admin"])
    } else {
        json!(["instructor"])
    };
    sqlx::query("INSERT INTO accounts_userprofile (id,created_date,updated_date,nombre,apellidos,email,username,dni_nie,foto_perfil,status,role,otp_hash,otp_verified,user_id,roles,username_lookup,email_lookup,dni_lookup,fecha_nacimiento,active_session_key,login_otp_created_at,login_otp_hash,login_2fa_enabled_override,session_role,assigned_instructor_id) VALUES ($1,NOW(),NOW(),$2,$3,$4,$5,$6,'','activo','instructor','',TRUE,$7,$8,$9,$10,$11,$12,'',NULL,'',NULL,'',NULL)")
        .bind(profile_id).bind(state.cipher.encrypt(input.nombre.trim())?).bind(state.cipher.encrypt(input.apellidos.trim())?).bind(state.cipher.encrypt(&email)?).bind(state.cipher.encrypt(&username)?).bind(state.cipher.encrypt(input.dni_nie.trim())?).bind(user_id).bind(roles).bind(username_lookup).bind(email_lookup).bind(dni_lookup).bind(state.cipher.encrypt(&input.fecha_nacimiento.map(|date| date.to_string()).unwrap_or_default())?).execute(&mut *tx).await?;
    tx.commit().await?;
    let row = sqlx::query_as::<_, crate::users::ProfileRow>(crate::users::ProfileRow::SELECT_BY_ID)
        .bind(profile_id)
        .fetch_one(state.pool.as_ref().ok_or(AppError::Unavailable)?)
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(crate::users::ProfileView::from_row(row, &state.cipher)?),
    ))
}

pub async fn invite_user(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<InviteUserRequest>,
) -> Result<(StatusCode, Json<crate::users::ProfileView>), AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    crate::auth::require_role(&claims, &["admin"])?;
    let email = normalize_email(&input.email)?;
    if !matches!(input.role.as_str(), "admin" | "instructor" | "alumno") {
        return Err(AppError::Validation("Rol no válido.".into()));
    }
    validate_text(&input.nombre, 120, "Nombre no válido.")?;
    validate_text(&input.apellidos, 120, "Apellidos no válidos.")?;
    let email_lookup = state.cipher.blind_index(&email)?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM accounts_userprofile WHERE email_lookup=$1)",
    )
    .bind(&email_lookup)
    .fetch_one(pool)
    .await?;
    if exists {
        return Err(AppError::Validation("El email ya existe.".into()));
    }
    let profile_id = Uuid::new_v4();
    let temporary_password = format!("Tmp_{}!", &Uuid::new_v4().simple().to_string()[..16]);
    let password_hash = hash_argon2(&temporary_password)?;
    let username_lookup = state.cipher.blind_index(&email)?;
    let mut tx = pool.begin().await?;
    let user_id: i32 = sqlx::query_scalar("INSERT INTO auth_user (password,last_login,is_superuser,username,first_name,last_name,email,is_staff,is_active,date_joined) VALUES ($1,NULL,FALSE,$2,'','',$3,FALSE,TRUE,NOW()) RETURNING id")
        .bind(password_hash)
        .bind(format!("u_{}", Uuid::new_v4().simple()))
        .bind(format!("user-{profile_id}@internal.uasspain.local"))
        .fetch_one(&mut *tx)
        .await?;
    let roles = json!([input.role]);
    sqlx::query("INSERT INTO accounts_userprofile (id,created_date,updated_date,nombre,apellidos,email,username,dni_nie,foto_perfil,status,role,otp_hash,otp_verified,user_id,roles,username_lookup,email_lookup,dni_lookup,fecha_nacimiento,active_session_key,login_otp_created_at,login_otp_hash,login_2fa_enabled_override,session_role,assigned_instructor_id) VALUES ($1,NOW(),NOW(),$2,$3,$4,$5,$6,$6,'pendiente',$7,'',FALSE,$8,$9,$10,$11,$12,$6,'',NULL,'',NULL,'',NULL)")
        .bind(profile_id)
        .bind(state.cipher.encrypt(input.nombre.trim())?)
        .bind(state.cipher.encrypt(input.apellidos.trim())?)
        .bind(state.cipher.encrypt(&email)?)
        .bind(state.cipher.encrypt(&email)?)
        .bind(state.cipher.encrypt("")?)
        .bind(&input.role)
        .bind(user_id)
        .bind(roles)
        .bind(username_lookup)
        .bind(email_lookup)
        .bind("")
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    let frontend = std::env::var("FRONTEND_URL").unwrap_or_else(|_| "http://localhost:5173".into());
    crate::email::send(
        &email,
        "Invitación a UASSpain",
        &format!("Has sido invitado a UASSpain.\n\nEmail: {email}\nContraseña temporal: {temporary_password}\n\nAccede en: {frontend}\n\nCambia tu contraseña tras el primer acceso."),
    )
    .await?;
    let row = sqlx::query_as::<_, crate::users::ProfileRow>(crate::users::ProfileRow::SELECT_BY_ID)
        .bind(profile_id)
        .fetch_one(pool)
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(crate::users::ProfileView::from_row(row, &state.cipher)?),
    ))
}

fn valid_reset_token(user: &ResetUser, token: &str) -> Result<bool, AppError> {
    let Some((stamp, _)) = token.split_once('-') else {
        return Ok(false);
    };
    let Some(timestamp) = from_base36(stamp) else {
        return Ok(false);
    };
    if reset_timestamp().saturating_sub(timestamp) > 259_200 {
        return Ok(false);
    }
    let expected = compatible_reset_token(user, timestamp)?;
    Ok(subtle::ConstantTimeEq::ct_eq(expected.as_bytes(), token.as_bytes()).into())
}

fn compatible_reset_token(user: &ResetUser, timestamp: i64) -> Result<String, AppError> {
    let login = user
        .last_login
        .map(|value| value.format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_default();
    let message = format!(
        "{}{}{}{timestamp}{}",
        user.id, user.password, login, user.email
    );
    let secret = std::env::var("SECRET_KEY")
        .ok()
        .or_else(|| {
            std::env::var("SECRET_KEY_FILE")
                .ok()
                .and_then(|path| std::fs::read_to_string(path).ok())
        })
        .ok_or(AppError::Unavailable)?;
    let key = Sha256::digest(format!("uasspain.password-reset.v1{secret}").as_bytes());
    let mut mac = Hmac::<Sha256>::new_from_slice(&key).map_err(|_| AppError::Internal)?;
    mac.update(message.as_bytes());
    let digest = mac.finalize().into_bytes();
    let mut shortened = String::with_capacity(32);
    for byte in digest.iter().step_by(2) {
        use std::fmt::Write as _;
        let _ = write!(shortened, "{byte:02x}");
    }
    Ok(format!("{}-{shortened}", to_base36(timestamp)))
}

fn reset_timestamp() -> i64 {
    Utc::now().timestamp() - 978_307_200
}
fn to_base36(mut value: i64) -> String {
    if value == 0 {
        return "0".into();
    }
    let mut result = Vec::new();
    while value > 0 {
        let digit = (value % 36) as u8;
        result.push(if digit < 10 {
            b'0' + digit
        } else {
            b'a' + digit - 10
        });
        value /= 36;
    }
    result.reverse();
    String::from_utf8(result).unwrap_or_default()
}
fn from_base36(value: &str) -> Option<i64> {
    value.bytes().try_fold(0_i64, |acc, byte| {
        let digit = match byte {
            b'0'..=b'9' => i64::from(byte - b'0'),
            b'a'..=b'z' => i64::from(byte - b'a' + 10),
            _ => return None,
        };
        acc.checked_mul(36)?.checked_add(digit)
    })
}

pub(crate) fn hash_argon2(value: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(value.as_bytes(), &salt)
        .map_err(|_| AppError::Internal)?;
    Ok(format!("argon2{hash}"))
}
pub(crate) fn normalize_email(value: &str) -> Result<String, AppError> {
    let value = value.trim().to_lowercase();
    if value.len() > 254
        || value.chars().any(char::is_whitespace)
        || value.chars().filter(|c| *c == '@').count() != 1
        || value.starts_with('@')
        || value.ends_with('@')
    {
        Err(AppError::Validation("Email no valido.".to_owned()))
    } else {
        Ok(value)
    }
}
fn otp_code(value: Option<String>) -> Result<String, AppError> {
    let value = value.unwrap_or_default();
    if value.len() == 6 && value.bytes().all(|b| b.is_ascii_digit()) {
        Ok(value)
    } else {
        Err(AppError::Validation("Codigo obligatorio.".to_owned()))
    }
}
fn validate_text(value: &str, max: usize, message: &str) -> Result<(), AppError> {
    if value.chars().count() > max {
        Err(AppError::Validation(message.to_owned()))
    } else {
        Ok(())
    }
}
pub(crate) fn validate_password(
    value: &str,
    username: &str,
    email: &str,
    dni: &str,
) -> Result<(), AppError> {
    let score = usize::from(value.len() >= 8)
        + usize::from(value.len() >= 12)
        + usize::from(value.chars().any(|c| c.is_ascii_lowercase()))
        + usize::from(value.chars().any(|c| c.is_ascii_uppercase()))
        + usize::from(value.chars().any(|c| c.is_ascii_digit()))
        + usize::from(value.chars().any(|c| !c.is_ascii_alphanumeric()));
    let normalized = value.trim().to_lowercase();
    if score <= 2
        || value.len() > 128
        || [
            username.to_lowercase(),
            email.to_lowercase(),
            dni.to_lowercase(),
            email.split('@').next().unwrap_or_default().to_lowercase(),
        ]
        .contains(&normalized)
    {
        Err(AppError::Validation(
            "Contrasena demasiado debil o vinculada a sus identificadores.".to_owned(),
        ))
    } else {
        Ok(())
    }
}
async fn deliver_otp(email: &str, code: &str) -> Result<(), AppError> {
    crate::email::send(
        email,
        "Código de verificación UASSpain",
        &format!("Su código de verificación es: {code}"),
    )
    .await
}
fn env_true(name: &str, fallback: bool) -> bool {
    std::env::var(name).map_or(fallback, |v| {
        matches!(v.to_lowercase().as_str(), "1" | "true" | "yes")
    })
}

#[cfg(test)]
mod tests {
    use super::{normalize_email, validate_password};
    #[test]
    fn password_policy_rejects_weak_and_identifiers() {
        assert!(validate_password("short", "u", "a@b.c", "").is_err());
        assert!(validate_password("Strong_12345!", "u", "a@b.c", "").is_ok());
        assert!(validate_password("User_12345!", "User_12345!", "a@b.c", "").is_err());
    }
    #[test]
    fn email_is_normalized() {
        assert_eq!(normalize_email(" A@B.COM ").unwrap(), "a@b.com");
        assert!(normalize_email("invalid").is_err());
    }
}
