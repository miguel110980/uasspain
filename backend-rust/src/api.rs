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
        Some(pool) => matches!(
            tokio::time::timeout(
                std::time::Duration::from_secs(3),
                sqlx::query_scalar::<_, i32>("SELECT 1").fetch_one(pool)
            )
            .await,
            Ok(Ok(_))
        ),
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
    let mut tx = pool(&state)?.begin().await?;
    crate::runtime_config::lock_email_auth_config(&mut tx).await?;
    if input.enabled {
        crate::runtime_config::require_email_2fa_ready(&state, &mut tx).await?;
    }
    sqlx::query("INSERT INTO core_systemsetting (id,created_date,updated_date,key,value) VALUES ($1,NOW(),NOW(),'auth_policy',$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_date=NOW()").bind(Uuid::new_v4()).bind(&value).execute(&mut *tx).await?;
    tx.commit().await?;
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

pub async fn public_google_oauth(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Value>, AppError> {
    let config = crate::runtime_config::google(&state).await?;
    let client = (config.enabled && !config.client_id.is_empty()).then_some(config.client_id);
    Ok(Json(
        json!({"configured":client.is_some(),"client_id":client}),
    ))
}
pub async fn public_publications(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<PublicPublication>>, AppError> {
    let rows = sqlx::query_as::<_, PublicPublication>("SELECT id,titulo,resumen,fecha_publicacion,url,categoria,activo,created_date FROM materiales_publicacionboe WHERE activo AND (fecha_publicacion IS NULL OR fecha_publicacion<=CURRENT_DATE) ORDER BY fecha_publicacion DESC NULLS LAST,created_date DESC LIMIT 100").fetch_all(pool(&state)?).await?;
    Ok(Json(rows))
}

fn admin(state: &AppState, headers: &HeaderMap) -> Result<(), AppError> {
    let claims = authenticate(state, headers, "access")?;
    require_role(&claims, &["admin"])
}
fn pool(state: &AppState) -> Result<&sqlx::PgPool, AppError> {
    state.pool.as_ref().ok_or(AppError::Unavailable)
}
pub fn uptime(started: Instant) -> u64 {
    started.elapsed().as_secs()
}
