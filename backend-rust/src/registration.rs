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
    headers: HeaderMap,
    Json(input): Json<RegisterRequest>,
) -> Result<(axum::http::StatusCode, Json<Value>), AppError> {
    if !env_true("REGISTRATION_ENABLED", true) {
        return Err(AppError::Forbidden);
    }
    let email = normalize_email(&input.email)?;
    crate::auth::enforce_login_rate(&headers, &format!("register:{email}"))?;
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
        .bind(state.cipher.encrypt(&input.foto_perfil)?).bind(&otp_hash).bind(user_id).bind(username_lookup).bind(email_lookup).bind(dni_lookup)
        .bind(state.cipher.encrypt(&input.fecha_nacimiento.map(|date| date.to_string()).unwrap_or_default())?).execute(&mut *tx).await?;
    sqlx::query("UPDATE accounts_userprofile SET otp_created_at=NOW() WHERE id=$1")
        .bind(profile_id)
        .execute(&mut *tx)
        .await?;
    let mail_id = crate::mail_queue::enqueue(&state,&mut tx,crate::mail_queue::MailRequest{to:&email,reply_to:None,subject:"Código de verificación UASSpain",body:&format!("Su código de verificación es: {otp}"),options:crate::mail_queue::QueueOptions{kind:"registration_otp",ttl:chrono::Duration::minutes(15),validity:json!({"kind":"registration_otp","profile_id":profile_id,"hash":otp_hash}),idempotency:None}})
    .await?;
    tx.commit().await?;
    crate::email::dispatch(&state, mail_id).await?;
    Ok((
        axum::http::StatusCode::CREATED,
        Json(
            json!({"id":profile_id,"user_id":user_id,"email":email,"username":username,"nombre":input.nombre,"apellidos":input.apellidos,"status":"pendiente","role":"alumno","roles":["alumno"],"otp_verified":false}),
        ),
    ))
}

pub async fn verify_otp(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<OtpRequest>,
) -> Result<Json<Value>, AppError> {
    let email = normalize_email(&input.email)?;
    crate::auth::enforce_login_rate(&headers, &format!("registration-otp:{email}"))?;
    let code = otp_code(input.code)?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let lookup = state.cipher.blind_index(&email)?;
    let row: Option<(Uuid, String)> = sqlx::query_as("SELECT id,otp_hash FROM accounts_userprofile WHERE email_lookup=$1 AND NOT otp_verified AND otp_created_at>NOW()-INTERVAL '15 minutes' AND otp_attempts<5")
        .bind(lookup).fetch_optional(pool).await?;
    let (id, hash) =
        row.ok_or_else(|| AppError::Validation("Codigo incorrecto o caducado.".into()))?;
    if !verify_password_hash(&code, &hash) {
        sqlx::query("UPDATE accounts_userprofile SET otp_attempts=LEAST(5,otp_attempts+1) WHERE id=$1 AND otp_hash=$2 AND NOT otp_verified").bind(id).bind(hash).execute(pool).await?;
        return Err(AppError::Validation("Codigo incorrecto o caducado.".into()));
    }
    let consumed = sqlx::query("UPDATE accounts_userprofile SET otp_hash='',otp_created_at=NULL,otp_verified=TRUE,updated_date=NOW() WHERE id=$1 AND otp_hash=$2 AND NOT otp_verified AND otp_created_at>NOW()-INTERVAL '15 minutes' AND otp_attempts<5")
        .bind(id).bind(hash).execute(pool).await?;
    if consumed.rows_affected() != 1 {
        return Err(AppError::Validation("Codigo incorrecto o caducado.".into()));
    }
    Ok(Json(
        json!({"detail":"Email verificado correctamente. Un instructor revisara su solicitud de acceso."}),
    ))
}

pub async fn resend_otp(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<OtpRequest>,
) -> Result<Json<Value>, AppError> {
    let started = std::time::Instant::now();
    let email = normalize_email(&input.email)?;
    crate::auth::enforce_login_rate(&headers, &format!("resend-otp:{email}"))?;
    let lookup = state.cipher.blind_index(&email)?;
    let otp = format!("{:06}", rand::rng().random_range(100_000..1_000_000));
    let hash = hash_argon2(&otp)?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    // The non-enumerating endpoint records token and email atomically. A
    // delivery outage must not issue a token without its durable work item.
    let mut tx = pool.begin().await?;
    let profile:Option<Uuid>=sqlx::query_scalar("UPDATE accounts_userprofile SET otp_hash=$1,otp_created_at=NOW(),otp_attempts=0,updated_date=NOW() WHERE email_lookup=$2 AND NOT otp_verified AND status='pendiente' AND (otp_created_at IS NULL OR otp_created_at<NOW()-INTERVAL '1 minute') RETURNING id").bind(&hash).bind(lookup).fetch_optional(&mut *tx).await?;
    if let Some(profile) = profile {
        let queued = crate::mail_queue::enqueue(
            &state,
            &mut tx,
            crate::mail_queue::MailRequest {
                to: &email,
                reply_to: None,
                subject: "Codigo de verificacion UASSpain",
                body: &format!("Su codigo de verificacion es: {otp}"),
                options: crate::mail_queue::QueueOptions {
                    kind: "registration_otp",
                    ttl: chrono::Duration::minutes(15),
                    validity: json!({"kind":"registration_otp","profile_id":profile,"hash":hash}),
                    idempotency: None,
                },
            },
        )
        .await;
        if let Ok(id) = queued {
            tx.commit().await?;
            tokio::spawn(async move {
                if crate::email::dispatch(&state, id).await.is_err() {
                    tracing::warn!("registration delivery not accepted; durable result retained");
                }
            });
        }
    }
    tokio::time::sleep(std::time::Duration::from_millis(250).saturating_sub(started.elapsed()))
        .await;
    Ok(Json(
        json!({"detail":"Si hay una verificacion pendiente, recibiras un nuevo codigo."}),
    ))
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
    let user_id = i32::try_from(claims.user_id).map_err(|_| AppError::Internal)?;
    let mut tx = pool.begin().await?;
    let updated = sqlx::query("UPDATE auth_user SET password=$1 WHERE id=$2 AND password=$3")
        .bind(hash)
        .bind(user_id)
        .bind(old)
        .execute(&mut *tx)
        .await?;
    if updated.rows_affected() != 1 {
        return Err(AppError::Unauthorized);
    }
    sqlx::query("UPDATE accounts_userprofile SET active_session_key=$1,active_refresh_jti='',active_window_lookup='',login_otp_hash='',login_otp_created_at=NULL,updated_date=NOW() WHERE id=$2")
        .bind(Uuid::new_v4().simple().to_string()).bind(claims.profile_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE accounts_passwordresettoken SET consumed_at=NOW() WHERE user_id=$1 AND consumed_at IS NULL").bind(user_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"detail":"Contrasena actualizada."})))
}

const RESET_RESPONSE: &str = "Si existe una cuenta asociada a ese correo, recibirás un enlace para restablecer tu contraseña.";

pub async fn password_reset_request(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<PasswordResetRequest>,
) -> Result<Json<Value>, AppError> {
    let started = std::time::Instant::now();
    let email = normalize_email(&input.email)?;
    crate::auth::enforce_login_rate(&headers, &format!("reset:{email}"))?;
    let lookup = state.cipher.blind_index(&email)?;
    let user = sqlx::query_as::<_, ResetUser>("SELECT u.id,u.password,u.last_login,u.email,p.username AS username,p.email AS profile_email,p.dni_nie FROM auth_user u JOIN accounts_userprofile p ON p.user_id=u.id WHERE p.email_lookup=$1 AND p.status='activo' AND u.is_active LIMIT 1")
        .bind(lookup).fetch_optional(state.pool.as_ref().ok_or(AppError::Unavailable)?).await?;
    // Delivery happens independently of the public response, including failures.
    // Neither status, message nor SMTP latency discloses whether an account exists.
    if let Some(user) = user {
        tokio::spawn(async move {
            if send_reset_link(&state, &user, &email).await.is_err() {
                tracing::warn!("password recovery delivery unavailable");
            }
        });
    }
    tokio::time::sleep(std::time::Duration::from_millis(250).saturating_sub(started.elapsed()))
        .await;
    Ok(Json(json!({"detail":RESET_RESPONSE})))
}

fn digest_hex(value: &str) -> String {
    Sha256::digest(value.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn new_reset_token() -> String {
    format!("r2_{}", URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>()))
}

fn reset_link(frontend: &str, user_id: i32, token: &str) -> Result<String, AppError> {
    let mut link = reqwest::Url::parse(frontend).map_err(|_| AppError::Unavailable)?;
    if link.scheme() != "https"
        || link.host_str().is_none()
        || !link.username().is_empty()
        || link.password().is_some()
    {
        return Err(AppError::Unavailable);
    }
    link.set_path("/restablecer-contrasena");
    link.set_query(None);
    link.set_fragment(None);
    link.query_pairs_mut()
        .append_pair("uid", &URL_SAFE_NO_PAD.encode(user_id.to_string()))
        .append_pair("token", token);
    Ok(link.into())
}

async fn send_reset_link(state: &AppState, user: &ResetUser, email: &str) -> Result<(), AppError> {
    let token = new_reset_token();
    let frontend = std::env::var("FRONTEND_URL").unwrap_or_else(|_| "https://localhost".into());
    let link = reset_link(&frontend, user.id, &token)?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let id = Uuid::new_v4();
    let mut tx = pool.begin().await?;
    // Lock the user so concurrent issuances leave exactly one current token.
    sqlx::query("SELECT id FROM auth_user WHERE id=$1 FOR UPDATE")
        .bind(user.id)
        .execute(&mut *tx)
        .await?;
    let recently_sent: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM accounts_passwordresettoken WHERE user_id=$1 AND consumed_at IS NULL AND expires_at>NOW() AND created_at>NOW()-INTERVAL '1 minute')")
        .bind(user.id).fetch_one(&mut *tx).await?;
    if recently_sent {
        return Ok(());
    }
    sqlx::query("DELETE FROM accounts_passwordresettoken WHERE user_id=$1")
        .bind(user.id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO accounts_passwordresettoken (id,user_id,token_hash,credential_hash,expires_at) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 hour')")
        .bind(id).bind(user.id).bind(digest_hex(&token)).bind(digest_hex(&user.password)).execute(&mut *tx).await?;
    let mail_id = crate::mail_queue::enqueue(
        state,
        &mut tx,
        crate::mail_queue::MailRequest {
            to: email,
            reply_to: None,
            subject: "Restablecer contrasena UASSpain",
            body: &format!("Use este enlace para restablecer su contrasena: {link}"),
            options: crate::mail_queue::QueueOptions {
                kind: "password_reset",
                ttl: chrono::Duration::hours(1),
                validity: json!({"kind":"password_reset","reset_id":id}),
                idempotency: None,
            },
        },
    )
    .await?;
    tx.commit().await?;
    crate::email::dispatch(state, mail_id).await?;
    Ok(())
}

pub async fn password_reset_confirm(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Form(input): Form<PasswordResetConfirmRequest>,
) -> Result<Json<Value>, AppError> {
    if input.uid.len() > 32 || input.token.len() > 128 {
        return Err(AppError::Validation("Enlace invalido.".into()));
    }
    crate::auth::enforce_login_rate(&headers, &format!("reset-confirm:{}", input.uid))?;
    let decoded = URL_SAFE_NO_PAD
        .decode(input.uid.as_bytes())
        .map_err(|_| AppError::Validation("Enlace invalido.".into()))?;
    let user_id: i32 = String::from_utf8(decoded)
        .ok()
        .and_then(|value| value.parse().ok())
        .filter(|id| *id > 0)
        .ok_or_else(|| AppError::Validation("Enlace invalido.".into()))?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let mut tx = pool.begin().await?;
    crate::account_lifecycle::lock(&mut tx).await?;
    let user = sqlx::query_as::<_, ResetUser>("SELECT u.id,u.password,u.last_login,u.email,p.username AS username,p.email AS profile_email,p.dni_nie FROM auth_user u JOIN accounts_userprofile p ON p.user_id=u.id WHERE u.id=$1 AND p.status='activo' AND u.is_active FOR UPDATE OF u")
        .bind(user_id).fetch_optional(&mut *tx).await?.ok_or_else(|| AppError::Validation("Token invalido o expirado.".into()))?;
    let valid = if input.token.starts_with("r2_") {
        sqlx::query("UPDATE accounts_passwordresettoken SET consumed_at=NOW() WHERE user_id=$1 AND token_hash=$2 AND credential_hash=$3 AND consumed_at IS NULL AND expires_at>NOW()")
            .bind(user_id).bind(digest_hex(&input.token)).bind(digest_hex(&user.password)).execute(&mut *tx).await?.rows_affected() == 1
    } else {
        // Preserve already sent legacy links; the row lock makes consumption atomic.
        let lifecycle_changed:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM account_lifecycle l JOIN accounts_userprofile p ON p.id=l.profile_id WHERE p.user_id=$1 AND l.revision>0)").bind(user_id).fetch_one(&mut *tx).await?;
        !lifecycle_changed && valid_reset_token(&user, &input.token)?
    };
    if !valid {
        return Err(AppError::Validation("Token invalido o expirado.".into()));
    }
    let profile_email = state.cipher.decrypt(&user.profile_email)?;
    let dni = state.cipher.decrypt(&user.dni_nie)?;
    validate_password(
        &input.password,
        &state.cipher.decrypt(&user.username)?,
        &profile_email,
        &dni,
    )?;
    let hashes: Vec<String> = sqlx::query_scalar("SELECT password FROM auth_user WHERE id<>$1")
        .bind(user_id)
        .fetch_all(&mut *tx)
        .await?;
    if hashes
        .iter()
        .any(|hash| verify_password_hash(&input.password, hash))
    {
        return Err(AppError::Validation(
            "Esta contrasena ya esta en uso por otro usuario.".into(),
        ));
    }
    let hash = hash_argon2(&input.password)?;
    sqlx::query("UPDATE auth_user SET password=$1 WHERE id=$2")
        .bind(hash)
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE accounts_userprofile SET active_session_key=$1,active_refresh_jti='',active_window_lookup='',login_otp_hash='',login_otp_created_at=NULL,updated_date=NOW() WHERE user_id=$2")
        .bind(Uuid::new_v4().simple().to_string()).bind(user_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE accounts_passwordresettoken SET consumed_at=NOW() WHERE user_id=$1 AND consumed_at IS NULL").bind(user_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"detail":"Contrasena actualizada."})))
}

pub async fn admin_password_reset(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(profile_id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    crate::auth::require_role(&claims, &["admin"])?;
    crate::auth::enforce_login_rate(&headers, &format!("admin-reset:{profile_id}"))?;
    let user = sqlx::query_as::<_, ResetUser>("SELECT u.id,u.password,u.last_login,u.email,p.username AS username,p.email AS profile_email,p.dni_nie FROM auth_user u JOIN accounts_userprofile p ON p.user_id=u.id WHERE p.id=$1 AND u.is_active")
        .bind(profile_id).fetch_optional(state.pool.as_ref().ok_or(AppError::Unavailable)?).await?.ok_or(AppError::NotFound)?;
    let email = state.cipher.decrypt(&user.profile_email)?;
    send_reset_link(&state, &user, &email).await?;
    Ok(Json(
        json!({"detail":"Enlace de restablecimiento enviado."}),
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
        &state,
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
    if timestamp > reset_timestamp() || reset_timestamp().saturating_sub(timestamp) > 259_200 {
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
        || value.parse::<lettre::Address>().is_err()
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
fn env_true(name: &str, fallback: bool) -> bool {
    std::env::var(name).map_or(fallback, |v| {
        matches!(v.to_lowercase().as_str(), "1" | "true" | "yes")
    })
}

#[cfg(test)]
mod tests {
    use super::{normalize_email, validate_password};
    #[test]
    fn reset_tokens_have_256_random_bits_and_only_a_digest_is_stored() {
        let first = super::new_reset_token();
        let second = super::new_reset_token();
        assert_ne!(first, second);
        use base64::Engine as _;
        assert_eq!(
            super::URL_SAFE_NO_PAD.decode(&first[3..]).unwrap().len(),
            32
        );
        let digest = super::digest_hex(&first);
        assert_eq!(digest.len(), 64);
        assert!(!digest.contains(&first));
    }
    #[test]
    fn recovery_links_require_https_and_cannot_carry_redirects_or_credentials() {
        assert!(super::reset_link("http://localhost", 1, "token").is_err());
        assert!(super::reset_link("https://user:password@example.test", 1, "token").is_err());
        let link = super::reset_link(
            "https://example.test/path?redirect=https://evil.test#fragment",
            1,
            "token",
        )
        .unwrap();
        assert_eq!(
            link,
            "https://example.test/restablecer-contrasena?uid=MQ&token=token"
        );
    }
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
