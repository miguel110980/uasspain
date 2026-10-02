use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    AppState,
    auth::{authenticate, require_role},
    error::AppError,
    security::FieldCipher,
};

#[derive(Debug, FromRow)]
pub struct ProfileRow {
    pub id: Uuid,
    pub user_id: Option<i32>,
    pub nombre: String,
    pub apellidos: String,
    pub email: String,
    pub username: String,
    pub dni_nie: String,
    pub fecha_nacimiento: String,
    pub foto_perfil: String,
    pub status: String,
    pub role: String,
    pub roles: serde_json::Value,
    pub otp_verified: bool,
    pub login_2fa_enabled_override: Option<bool>,
    pub created_date: DateTime<Utc>,
    pub assigned_instructor_id: Option<Uuid>,
}

impl ProfileRow {
    pub const FIELDS: &'static str = "id, user_id, nombre, apellidos, email, username, dni_nie, fecha_nacimiento, foto_perfil, status, role, roles, otp_verified, login_2fa_enabled_override, created_date, assigned_instructor_id";
    pub const SELECT_BY_ID: &'static str = "SELECT id, user_id, nombre, apellidos, email, username, dni_nie, fecha_nacimiento, foto_perfil, status, role, roles, otp_verified, login_2fa_enabled_override, created_date, assigned_instructor_id FROM accounts_userprofile WHERE id = $1";
}

#[derive(Debug, Clone, Serialize)]
pub struct ProfileView {
    pub id: Uuid,
    pub user_id: Option<i32>,
    pub nombre: String,
    pub apellidos: String,
    pub email: String,
    pub username: String,
    pub dni_nie: String,
    pub fecha_nacimiento: Option<String>,
    pub foto_perfil: String,
    pub status: String,
    pub role: String,
    pub roles: Vec<String>,
    pub otp_verified: bool,
    pub login_2fa_enabled_override: Option<bool>,
    pub created_date: DateTime<Utc>,
    pub assigned_instructor_id: Option<Uuid>,
}

impl ProfileView {
    pub fn from_row(row: ProfileRow, cipher: &FieldCipher) -> Result<Self, AppError> {
        Ok(Self {
            id: row.id,
            user_id: row.user_id,
            nombre: cipher.decrypt(&row.nombre)?,
            apellidos: cipher.decrypt(&row.apellidos)?,
            email: cipher.decrypt(&row.email)?,
            username: cipher.decrypt(&row.username)?,
            dni_nie: cipher.decrypt(&row.dni_nie)?,
            fecha_nacimiento: match cipher.decrypt(&row.fecha_nacimiento)? {
                value if value.is_empty() => None,
                value => Some(value),
            },
            foto_perfil: cipher.decrypt(&row.foto_perfil)?,
            status: row.status,
            role: row.role.clone(),
            roles: row
                .roles
                .as_array()
                .map(|values| {
                    values
                        .iter()
                        .filter_map(|v| v.as_str().map(ToOwned::to_owned))
                        .collect()
                })
                .filter(|roles: &Vec<String>| !roles.is_empty())
                .unwrap_or_else(|| vec![row.role]),
            otp_verified: row.otp_verified,
            login_2fa_enabled_override: row.login_2fa_enabled_override,
            created_date: row.created_date,
            assigned_instructor_id: row.assigned_instructor_id,
        })
    }
    pub fn full_name(&self) -> String {
        let name = format!("{} {}", self.nombre, self.apellidos)
            .trim()
            .to_owned();
        if name.is_empty() {
            self.email.clone()
        } else {
            name
        }
    }
}

#[derive(Deserialize)]
pub struct ListQuery {
    limit: Option<i64>,
    offset: Option<i64>,
    role: Option<String>,
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ProfileWrite {
    nombre: Option<String>,
    apellidos: Option<String>,
    email: Option<String>,
    username: Option<String>,
    dni_nie: Option<String>,
    fecha_nacimiento: Option<String>,
    foto_perfil: Option<String>,
    status: Option<String>,
    role: Option<String>,
    roles: Option<Vec<String>>,
    login_2fa_enabled_override: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct StudentIds {
    student_ids: Vec<Uuid>,
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<ListQuery>,
) -> Result<Json<Vec<ProfileView>>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let limit = query.limit.unwrap_or(100).clamp(1, 200);
    let offset = query.offset.unwrap_or(0).max(0);
    let rows = match claims.role.as_str() {
        "admin" => sqlx::query_as::<_, ProfileRow>(&format!("SELECT {} FROM accounts_userprofile WHERE ($1::text IS NULL OR role = $1) AND ($2::text IS NULL OR status = $2) ORDER BY created_date DESC LIMIT $3 OFFSET $4", ProfileRow::FIELDS)).bind(query.role).bind(query.status).bind(limit).bind(offset).fetch_all(pool).await?,
        "instructor" => sqlx::query_as::<_, ProfileRow>(&format!("SELECT {} FROM accounts_userprofile WHERE id = $1 OR assigned_instructor_id = $1 ORDER BY created_date DESC LIMIT $2 OFFSET $3", ProfileRow::FIELDS)).bind(claims.profile_id).bind(limit).bind(offset).fetch_all(pool).await?,
        _ => vec![sqlx::query_as::<_, ProfileRow>(ProfileRow::SELECT_BY_ID).bind(claims.profile_id).fetch_one(pool).await?],
    };
    rows.into_iter()
        .map(|row| ProfileView::from_row(row, &state.cipher))
        .collect::<Result<Vec<_>, _>>()
        .map(Json)
}

pub async fn detail(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<ProfileView>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    if claims.role == "alumno" && claims.profile_id != id {
        return Err(AppError::Forbidden);
    }
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let row = sqlx::query_as::<_, ProfileRow>(ProfileRow::SELECT_BY_ID)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)?;
    if claims.role == "instructor"
        && id != claims.profile_id
        && row.assigned_instructor_id != Some(claims.profile_id)
    {
        return Err(AppError::Forbidden);
    }
    ProfileView::from_row(row, &state.cipher).map(Json)
}

pub async fn update(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(mut input): Json<ProfileWrite>,
) -> Result<Json<ProfileView>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let current = sqlx::query_as::<_, ProfileRow>(ProfileRow::SELECT_BY_ID)
        .bind(id)
        .fetch_optional(pool(&state)?)
        .await?
        .ok_or(AppError::NotFound)?;
    match claims.role.as_str() {
        "alumno" if id == claims.profile_id => {
            input.status = None;
            input.role = None;
            input.roles = None;
            input.login_2fa_enabled_override = None;
            input.email = None;
        }
        "instructor" if id == claims.profile_id => {
            input.status = None;
            input.role = None;
            input.roles = None;
            input.login_2fa_enabled_override = None;
            input.email = None;
        }
        "instructor"
            if current.role == "alumno"
                && current.assigned_instructor_id == Some(claims.profile_id) =>
        {
            input.role = None;
            input.roles = None;
            input.login_2fa_enabled_override = None;
            input.email = None;
        }
        "admin" => {}
        _ => return Err(AppError::Forbidden),
    }
    if let Some(status) = &input.status {
        if !matches!(
            status.as_str(),
            "pendiente" | "activo" | "bloqueado" | "rechazado"
        ) {
            return Err(AppError::Validation("Estado no válido.".into()));
        }
        if status == "activo" && current.role == "alumno" && !current.otp_verified {
            return Err(AppError::Validation(
                "El alumno debe verificar su email antes de ser activado.".into(),
            ));
        }
    }
    if let Some(role) = &input.role
        && !matches!(role.as_str(), "admin" | "instructor" | "alumno")
    {
        return Err(AppError::Validation("Rol no válido.".into()));
    }
    for value in [
        &input.nombre,
        &input.apellidos,
        &input.username,
        &input.dni_nie,
    ] {
        if value.as_deref().is_some_and(|v| v.len() > 255) {
            return Err(AppError::Validation("Campo demasiado largo.".into()));
        }
    }
    let nombre = input
        .nombre
        .as_deref()
        .map(|v| state.cipher.encrypt(v.trim()))
        .transpose()?;
    let apellidos = input
        .apellidos
        .as_deref()
        .map(|v| state.cipher.encrypt(v.trim()))
        .transpose()?;
    let username = input
        .username
        .as_deref()
        .map(|v| state.cipher.encrypt(v.trim()))
        .transpose()?;
    let dni = input
        .dni_nie
        .as_deref()
        .map(|v| state.cipher.encrypt(v.trim()))
        .transpose()?;
    let date = input
        .fecha_nacimiento
        .as_deref()
        .map(|v| state.cipher.encrypt(v.trim()))
        .transpose()?;
    let photo = input
        .foto_perfil
        .as_deref()
        .map(|v| state.cipher.encrypt(v.trim()))
        .transpose()?;
    input.email = input
        .email
        .as_deref()
        .map(crate::registration::normalize_email)
        .transpose()?;
    let email = input
        .email
        .as_deref()
        .map(|v| state.cipher.encrypt(&v.trim().to_lowercase()))
        .transpose()?;
    let username_lookup = input
        .username
        .as_deref()
        .map(|v| state.cipher.blind_index(&v.trim().to_lowercase()))
        .transpose()?;
    let dni_lookup = input
        .dni_nie
        .as_deref()
        .map(|v| state.cipher.blind_index(&v.trim().to_uppercase()))
        .transpose()?;
    let email_lookup = input
        .email
        .as_deref()
        .map(|v| state.cipher.blind_index(&v.trim().to_lowercase()))
        .transpose()?;
    let mut tx = pool(&state)?.begin().await?;
    sqlx::query("UPDATE accounts_userprofile SET nombre=COALESCE($2,nombre),apellidos=COALESCE($3,apellidos),email=COALESCE($4,email),username=COALESCE($5,username),dni_nie=COALESCE($6,dni_nie),fecha_nacimiento=COALESCE($7,fecha_nacimiento),foto_perfil=COALESCE($8,foto_perfil),status=COALESCE($9,status),role=COALESCE($10,role),roles=COALESCE($11,roles),login_2fa_enabled_override=CASE WHEN $12 THEN $13 ELSE login_2fa_enabled_override END,username_lookup=COALESCE($14,username_lookup),email_lookup=COALESCE($15,email_lookup),dni_lookup=COALESCE($16,dni_lookup),updated_date=NOW() WHERE id=$1")
        .bind(id).bind(nombre).bind(apellidos).bind(email.clone()).bind(username).bind(dni).bind(date).bind(photo).bind(input.status).bind(input.role).bind(input.roles.map(|v|serde_json::to_value(v).unwrap_or_default())).bind(input.login_2fa_enabled_override.is_some()).bind(input.login_2fa_enabled_override).bind(username_lookup).bind(email_lookup).bind(dni_lookup).execute(&mut *tx).await?;
    if let Some(email) = email {
        sqlx::query("UPDATE auth_user SET email=$1 WHERE id=$2")
            .bind(email)
            .bind(current.user_id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    detail(State(state), headers, Path(id)).await
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let row = sqlx::query_as::<_, ProfileRow>(ProfileRow::SELECT_BY_ID)
        .bind(id)
        .fetch_optional(pool(&state)?)
        .await?
        .ok_or(AppError::NotFound)?;
    if claims.role != "admin"
        && !(claims.role == "instructor"
            && row.role == "alumno"
            && row.assigned_instructor_id == Some(claims.profile_id))
    {
        return Err(AppError::Forbidden);
    }
    let mut transaction = pool(&state)?.begin().await?;
    sqlx::query("UPDATE auth_user SET is_active=FALSE WHERE id=$1")
        .bind(row.user_id)
        .execute(&mut *transaction)
        .await?;
    sqlx::query("DELETE FROM accounts_userprofile WHERE id=$1")
        .bind(id)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn assigned_students(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<ProfileView>>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    if claims.role != "admin" && claims.profile_id != id {
        return Err(AppError::Forbidden);
    }
    let rows=sqlx::query_as::<_,ProfileRow>(&format!("SELECT {} FROM accounts_userprofile WHERE assigned_instructor_id=$1 AND role='alumno' ORDER BY created_date DESC",ProfileRow::FIELDS)).bind(id).fetch_all(pool(&state)?).await?;
    views(rows, &state)
}
pub async fn assign_students(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<StudentIds>,
) -> Result<Json<serde_json::Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    if input.student_ids.is_empty() {
        return Err(AppError::Validation(
            "Se requiere al menos un student_id.".into(),
        ));
    }
    if claims.role != "admin" && claims.profile_id != id {
        return Err(AppError::Forbidden);
    }
    let instructor:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM accounts_userprofile WHERE id=$1 AND (role='instructor' OR roles ? 'instructor'))").bind(id).fetch_one(pool(&state)?).await?;
    if !instructor {
        return Err(AppError::Validation(
            "El perfil seleccionado no es un instructor.".into(),
        ));
    }
    let found: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM accounts_userprofile WHERE id=ANY($1) AND role='alumno'",
    )
    .bind(&input.student_ids)
    .fetch_one(pool(&state)?)
    .await?;
    if found != input.student_ids.len() as i64 {
        return Err(AppError::NotFound);
    }
    if claims.role != "admin" {
        let conflict:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM accounts_userprofile WHERE id=ANY($1) AND assigned_instructor_id IS NOT NULL AND assigned_instructor_id<>$2)").bind(&input.student_ids).bind(id).fetch_one(pool(&state)?).await?;
        if conflict {
            return Err(AppError::Forbidden);
        }
    }
    let count=sqlx::query("UPDATE accounts_userprofile SET assigned_instructor_id=$1,updated_date=NOW() WHERE id=ANY($2) AND role='alumno'").bind(id).bind(&input.student_ids).execute(pool(&state)?).await?.rows_affected();
    Ok(Json(
        serde_json::json!({"detail":format!("{count} alumno(s) asignado(s)."),"assigned_count":count}),
    ))
}
pub async fn unassign_students(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(_id): Path<Uuid>,
    Json(_input): Json<StudentIds>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    authenticate(&state, &headers, "access")?;
    Ok((
        StatusCode::BAD_REQUEST,
        Json(
            serde_json::json!({"detail":"No se permite desasignar alumnos sin reasignarlos. Asigne el alumno a otro instructor en su lugar."}),
        ),
    ))
}
pub async fn instructors(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<ProfileView>>, AppError> {
    authenticate(&state, &headers, "access")?;
    let rows=sqlx::query_as::<_,ProfileRow>(&format!("SELECT {} FROM accounts_userprofile WHERE status='activo' AND (role='instructor' OR roles ? 'instructor') ORDER BY nombre,apellidos,email",ProfileRow::FIELDS)).fetch_all(pool(&state)?).await?;
    views(rows, &state)
}

fn pool(state: &AppState) -> Result<&sqlx::PgPool, AppError> {
    state.pool.as_ref().ok_or(AppError::Unavailable)
}
fn views(rows: Vec<ProfileRow>, state: &AppState) -> Result<Json<Vec<ProfileView>>, AppError> {
    rows.into_iter()
        .map(|row| ProfileView::from_row(row, &state.cipher))
        .collect::<Result<Vec<_>, _>>()
        .map(Json)
}

pub fn require_admin(role: &str) -> Result<(), AppError> {
    let claims = crate::auth::Claims {
        user_id: 0,
        profile_id: Uuid::nil(),
        role: role.to_owned(),
        token_type: "access".to_owned(),
        exp: usize::MAX,
        iat: 0,
        jti: uuid::Uuid::nil(),
        session_key: String::new(),
    };
    require_role(&claims, &["admin"])
}

#[cfg(test)]
mod tests {
    use super::require_admin;
    #[test]
    fn admin_gate_is_deny_by_default() {
        assert!(require_admin("alumno").is_err());
        assert!(require_admin("instructor").is_err());
        assert!(require_admin("admin").is_ok());
    }
}
