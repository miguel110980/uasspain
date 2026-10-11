use crate::{
    AppState,
    auth::{authenticate, require_role},
    error::AppError,
};
use axum::{Json, extract::State, http::HeaderMap};
use serde_json::Value;
use sqlx::{Postgres, Transaction};
use std::sync::Arc;
use uuid::Uuid;

pub async fn list(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<Value>>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin"])?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    Ok(Json(sqlx::query_scalar("SELECT jsonb_build_object('id',id,'url',file_url,'content_type',content_type,'size_bytes',size_bytes,'created_at',created_at) FROM content_image_resources ORDER BY created_at DESC,id LIMIT 500").fetch_all(pool).await?))
}

pub(crate) async fn register(
    tx: &mut Transaction<'_, Postgres>,
    path: &str,
    url: &str,
    mime: &str,
    bytes: usize,
    owner: Uuid,
) -> Result<Uuid, AppError> {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO content_image_resources(id,storage_path,file_url,content_type,size_bytes,created_by) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(id).bind(path).bind(url).bind(mime).bind(i64::try_from(bytes).map_err(|_|AppError::Internal)?).bind(owner).execute(&mut **tx).await?;
    Ok(id)
}

pub(crate) async fn resource(
    tx: &mut Transaction<'_, Postgres>,
    url: &str,
) -> Result<Option<Uuid>, AppError> {
    if !url.starts_with("/media/") {
        return Ok(None);
    }
    let id = sqlx::query_scalar(
        "SELECT id FROM content_image_resources WHERE file_url=$1 FOR KEY SHARE",
    )
    .bind(url)
    .fetch_optional(&mut **tx)
    .await?;
    id.map(Some).ok_or_else(|| {
        AppError::Validation("Selecciona una imagen existente o sube una imagen válida.".into())
    })
}
