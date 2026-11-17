//! Admission is global for staff; academic assignment remains independent.
use crate::{
    AppState,
    auth::{authenticate, require_role},
    error::AppError,
};
use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;
use uuid::Uuid;

pub async fn list(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<Value>>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin", "instructor"])?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let rows: Vec<(Uuid,String,String,String,chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT p.id,p.nombre,p.apellidos,p.email,p.created_date FROM accounts_userprofile p JOIN auth_user u ON u.id=p.user_id WHERE p.status='pendiente' AND p.otp_verified AND u.is_active AND p.role='alumno' AND jsonb_typeof(p.roles)='array' AND p.roles<@'[\"alumno\"]'::jsonb ORDER BY p.created_date,p.id")
        .fetch_all(pool).await?;
    let mut result = Vec::with_capacity(rows.len());
    for (id, name, surname, email, created) in rows {
        result.push(json!({"id":id,"nombre":state.cipher.decrypt(&name)?,"apellidos":state.cipher.decrypt(&surname)?,"email":state.cipher.decrypt(&email)?,"created_date":created}));
    }
    Ok(Json(result))
}

#[derive(Deserialize)]
pub struct Resolution {
    decision: String,
}

fn target_status(decision: &str) -> Result<&'static str, AppError> {
    match decision {
        "approve" => Ok("activo"),
        "reject" => Ok("rechazado"),
        _ => Err(AppError::Validation("Decisión no válida.".into())),
    }
}

fn student_only(role: &str, roles: &Value) -> bool {
    role == "alumno"
        && roles
            .as_array()
            .is_some_and(|items| items.iter().all(|item| item.as_str() == Some("alumno")))
}

pub async fn resolve(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<Resolution>,
) -> Result<Json<Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin", "instructor"])?;
    let status = target_status(&input.decision)?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let mut tx = pool.begin().await?;
    crate::account_lifecycle::lock(&mut tx).await?;
    crate::account_lifecycle::actor_active(&mut tx, &claims).await?;
    let (current,verified,role,roles,enabled): (String,bool,String,Value,bool) = sqlx::query_as(
        "SELECT p.status,p.otp_verified,p.role,p.roles,u.is_active FROM accounts_userprofile p JOIN auth_user u ON u.id=p.user_id WHERE p.id=$1 FOR UPDATE OF p")
        .bind(id).fetch_optional(&mut *tx).await?.ok_or(AppError::NotFound)?;
    if !student_only(&role, &roles) || !enabled {
        return Err(AppError::Forbidden);
    }
    if current != "pendiente" {
        return Err(AppError::EditConflict);
    }
    if !verified {
        return Err(AppError::Validation(
            "El alumno debe verificar el correo antes de resolver la solicitud.".into(),
        ));
    }
    sqlx::query("UPDATE accounts_userprofile SET status=$2,updated_date=NOW() WHERE id=$1")
        .bind(id)
        .bind(status)
        .execute(&mut *tx)
        .await?;
    // Admission status controls login; preserve the separate account-disable flag.
    crate::account_lifecycle::event(
        &mut tx,
        id,
        Some(claims.profile_id),
        "registration_resolution",
        status,
        json!({"decision":input.decision,"assignment_changed":false}),
        None,
    )
    .await?;
    tx.commit().await?;
    state
        .events
        .publish(
            "connections",
            json!({"type":"registration","action":"resolved"}),
        )
        .await;
    Ok(Json(
        json!({"id":id,"status":status,"resolved_by":claims.profile_id}),
    ))
}

#[cfg(test)]
mod tests {
    #[test]
    fn admission_cannot_activate_staff_or_composite_privileges() {
        use serde_json::json;
        assert!(super::student_only("alumno", &json!(["alumno"])));
        assert!(super::student_only("alumno", &json!([])));
        for role in ["admin", "instructor", "unknown"] {
            assert!(!super::student_only(role, &json!(["alumno"])));
        }
        for roles in [
            json!(["alumno", "admin"]),
            json!(["alumno", "instructor"]),
            json!(["unknown"]),
            json!({"alumno":true}),
            json!(null),
        ] {
            assert!(!super::student_only("alumno", &roles));
        }
    }
    #[test]
    fn only_admission_decisions_are_accepted() {
        assert_eq!(super::target_status("approve").unwrap(), "activo");
        assert_eq!(super::target_status("reject").unwrap(), "rechazado");
        for input in ["assign", "admin", "", "APPROVE"] {
            assert!(super::target_status(input).is_err());
        }
    }
}
