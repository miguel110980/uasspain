use std::{sync::Arc, time::Instant};

use crate::AppState;
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    auth::{authenticate, require_role},
    error::AppError,
};

#[derive(sqlx::FromRow, serde::Serialize)]
pub struct PublicPublication {
    id: Uuid,
    titulo: String,
    resumen: String,
    fecha_publicacion: Option<chrono::NaiveDate>,
    url: String,
    categoria: String,
    activo: bool,
    created_date: chrono::DateTime<chrono::Utc>,
}

pub async fn root() -> Json<serde_json::Value> {
    Json(serde_json::json!({"name":"UASSpain API","runtime":"rust","status":"ok"}))
}
pub async fn live() -> Json<serde_json::Value> {
    Json(serde_json::json!({"status":"alive"}))
}

pub async fn ready(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let database = match &state.pool {
        Some(pool) => sqlx::query_scalar::<_, i32>("SELECT 1")
            .fetch_one(pool)
            .await
            .is_ok(),
        None => false,
    };
    let redis = !state.events.configured() || state.events.connected();
    let status = if database && redis {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (
        status,
        Json(
            serde_json::json!({"status": if database && redis {"ready"} else {"not_ready"}, "database": database, "redis": redis, "redis_configured": state.events.configured(), "runtime":"rust"}),
        ),
    )
}

pub async fn public_stats(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let Some(pool) = &state.pool else {
        return Json(serde_json::json!({"alumnos":0,"instructores":0,"runtime":"rust"}));
    };
    let alumnos: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM accounts_userprofile WHERE role = 'alumno' AND status = 'activo'",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(0);
    let instructores: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM accounts_userprofile WHERE role IN ('instructor','admin') AND status = 'activo'").fetch_one(pool).await.unwrap_or(0);
    let examenes_realizados: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM examenes_resultadoexamen")
            .fetch_one(pool)
            .await
            .unwrap_or(0);
    let examenes_disponibles: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM examenes_examen WHERE activo")
            .fetch_one(pool)
            .await
            .unwrap_or(0);
    let materiales_activos: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM materiales_material WHERE activo")
            .fetch_one(pool)
            .await
            .unwrap_or(0);
    Json(
        serde_json::json!({"alumnos_activos":alumnos,"instructores_activos":instructores,"examenes_realizados":examenes_realizados,"examenes_disponibles":examenes_disponibles,"materiales_activos":materiales_activos}),
    )
}

pub async fn system_status(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    Json(
        serde_json::json!({"backend":{"status":"ok","runtime":"rust","uptime_seconds":state.started.elapsed().as_secs()},"database":{"status":if state.pool.is_some(){"ok"}else{"error"}},"redis":{"status":if state.events.connected(){"ok"}else if state.events.configured(){"error"}else{"not_configured"}},"websocket":{"status":"ok"}}),
    )
}

pub async fn not_found() -> impl IntoResponse {
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({"detail":"Recurso no encontrado.","code":"not_found"})),
    )
}

#[derive(Debug, Deserialize)]
pub struct AuthPolicyWrite {
    enabled: bool,
    required_roles: Vec<String>,
}
pub async fn auth_policy_get(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    admin(&state, &headers)?;
    Ok(Json(json!(load_auth_policy(&state).await?)))
}
pub async fn auth_policy_put(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<AuthPolicyWrite>,
) -> Result<Json<Value>, AppError> {
    admin(&state, &headers)?;
    let mut roles = Vec::new();
    for role in input.required_roles {
        if !matches!(role.as_str(), "admin" | "instructor" | "alumno") {
            return Err(AppError::Validation("Rol no válido.".into()));
        }
        if !roles.contains(&role) {
            roles.push(role)
        }
    }
    let value = json!({"enabled":input.enabled,"required_roles":roles});
    sqlx::query("INSERT INTO core_systemsetting (id,created_date,updated_date,key,value) VALUES ($1,NOW(),NOW(),'auth_policy',$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_date=NOW()").bind(Uuid::new_v4()).bind(&value).execute(pool(&state)?).await?;
    Ok(Json(value))
}
async fn load_auth_policy(state: &AppState) -> Result<Value, AppError> {
    Ok(sqlx::query_scalar::<_, Value>(
        "SELECT value FROM core_systemsetting WHERE key='auth_policy'",
    )
    .fetch_optional(pool(state)?)
    .await?
    .unwrap_or_else(|| json!({"enabled":false,"required_roles":[]})))
}

pub async fn public_google_oauth() -> Json<Value> {
    let client = std::env::var("GOOGLE_CLIENT_ID")
        .ok()
        .filter(|v| !v.trim().is_empty());
    Json(json!({"configured":client.is_some(),"client_id":client}))
}
pub async fn public_publications(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<PublicPublication>>, AppError> {
    let rows = sqlx::query_as::<_, PublicPublication>("SELECT id,titulo,resumen,fecha_publicacion,url,categoria,activo,created_date FROM materiales_publicacionboe WHERE activo ORDER BY fecha_publicacion DESC NULLS LAST,created_date DESC LIMIT 20").fetch_all(pool(&state)?).await?;
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
pub struct ContactWrite {
    nombre: String,
    #[serde(default)]
    empresa: String,
    email: String,
    telefono: String,
    servicio: String,
    mensaje: String,
}
pub async fn contact(Json(input): Json<ContactWrite>) -> Result<Json<Value>, AppError> {
    if input.nombre.trim().is_empty()
        || input.nombre.len() > 120
        || input.email.len() > 254
        || !input.email.contains('@')
        || input.telefono.trim().is_empty()
        || input.telefono.len() > 50
        || input.servicio.trim().is_empty()
        || input.servicio.len() > 120
        || input.mensaje.trim().is_empty()
        || input.mensaje.len() > 5000
        || input.empresa.len() > 120
    {
        return Err(AppError::Validation("Datos de contacto no válidos.".into()));
    }
    let recipient = std::env::var("CONTACT_EMAIL")
        .or_else(|_| std::env::var("EMAIL_HOST_USER"))
        .or_else(|_| {
            env_true("DEV_EMAIL", false)
                .then(|| "contacto@localhost".to_owned())
                .ok_or(std::env::VarError::NotPresent)
        })
        .map_err(|_| AppError::Unavailable)?;
    crate::email::send(
        &recipient,
        "Nuevo contacto UASSpain",
        &format!(
            "Nombre: {}\nEmpresa: {}\nEmail: {}\nTelefono: {}\nServicio: {}\n\n{}",
            input.nombre, input.empresa, input.email, input.telefono, input.servicio, input.mensaje
        ),
    )
    .await?;
    let mut payload = json!({"detail":"Mensaje enviado correctamente."});
    if env_true("DEV_EMAIL", false) {
        payload["warning"] = json!("Modo desarrollo: el email no se envió por SMTP.");
    }
    Ok(Json(payload))
}
fn admin(state: &AppState, headers: &HeaderMap) -> Result<(), AppError> {
    let claims = authenticate(state, headers, "access")?;
    require_role(&claims, &["admin"])
}
fn pool(state: &AppState) -> Result<&sqlx::PgPool, AppError> {
    state.pool.as_ref().ok_or(AppError::Unavailable)
}
fn env_true(name: &str, fallback: bool) -> bool {
    std::env::var(name).map_or(fallback, |v| {
        matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes")
    })
}

pub fn uptime(started: Instant) -> u64 {
    started.elapsed().as_secs()
}
