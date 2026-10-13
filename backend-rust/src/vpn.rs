use crate::{
    AppState,
    auth::{authenticate, require_role},
    error::AppError,
};
use axum::{Json, extract::State, http::HeaderMap};
use serde_json::Value;
use std::sync::Arc;

pub async fn status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin"])?;
    Ok(Json(crate::infrastructure::vpn_status(&state).await?))
}
