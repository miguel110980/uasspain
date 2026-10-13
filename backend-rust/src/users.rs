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
    auth::{self, authenticate, require_role},
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
    pub assigned_instructor_nombre: Option<String>,
    pub assigned_instructor_apellidos: Option<String>,
}

impl ProfileRow {
    pub const FIELDS: &'static str = "id, user_id, nombre, apellidos, email, username, dni_nie, fecha_nacimiento, foto_perfil, status, role, roles, otp_verified, login_2fa_enabled_override, created_date, assigned_instructor_id, (SELECT i.nombre FROM accounts_userprofile i WHERE i.id=accounts_userprofile.assigned_instructor_id) AS assigned_instructor_nombre, (SELECT i.apellidos FROM accounts_userprofile i WHERE i.id=accounts_userprofile.assigned_instructor_id) AS assigned_instructor_apellidos";
    pub const SELECT_BY_ID: &'static str = "SELECT id, user_id, nombre, apellidos, email, username, dni_nie, fecha_nacimiento, foto_perfil, status, role, roles, otp_verified, login_2fa_enabled_override, created_date, assigned_instructor_id, (SELECT i.nombre FROM accounts_userprofile i WHERE i.id=accounts_userprofile.assigned_instructor_id) AS assigned_instructor_nombre, (SELECT i.apellidos FROM accounts_userprofile i WHERE i.id=accounts_userprofile.assigned_instructor_id) AS assigned_instructor_apellidos FROM accounts_userprofile WHERE id = $1";
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
    pub assigned_instructor_name: Option<String>,
}

impl ProfileView {
    pub fn from_row(row: ProfileRow, cipher: &FieldCipher) -> Result<Self, AppError> {
        let assigned_instructor_name = match (
            &row.assigned_instructor_nombre,
            &row.assigned_instructor_apellidos,
        ) {
            (Some(nombre), Some(apellidos)) => Some(
                format!("{} {}", cipher.decrypt(nombre)?, cipher.decrypt(apellidos)?)
                    .trim()
                    .to_owned(),
            ),
            _ => None,
        };
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
            assigned_instructor_name,
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
    #[serde(default, deserialize_with = "optional_boolean_update")]
    login_2fa_enabled_override: Option<Option<bool>>,
    assigned_instructor_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct StudentIds {
    student_ids: Vec<Uuid>,
}

#[derive(FromRow, Serialize)]
pub struct InstructorOption {
    id: Uuid,
    nombre: String,
    apellidos: String,
    username: String,
}

#[derive(FromRow)]
struct AssignmentProfile {
    id: Uuid,
    role: String,
    roles: serde_json::Value,
    status: String,
    otp_verified: bool,
    is_active: Option<bool>,
    assigned_instructor_id: Option<Uuid>,
}

impl AssignmentProfile {
    fn has_role(&self, role: &str) -> bool {
        self.role == role
            || self
                .roles
                .as_array()
                .is_some_and(|roles| roles.iter().any(|value| value.as_str() == Some(role)))
    }
    fn assignable(&self) -> bool {
        self.has_role("instructor")
            && self.status == "activo"
            && self.otp_verified
            && self.is_active == Some(true)
    }
    fn can_be_assigned_by(&self, claims: &auth::Claims, target: Uuid) -> bool {
        if !self.has_role("alumno") || self.id == target {
            return false;
        }
        claims.role == "admin"
            || (claims.role == "instructor"
                && (self.assigned_instructor_id == Some(claims.profile_id)
                    || (self.assigned_instructor_id.is_none() && target == claims.profile_id))
                && ((!self.has_role("admin") && !self.has_role("instructor"))
                    || (self.assigned_instructor_id == Some(target)
                        && target == claims.profile_id)))
    }
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
        "admin" => sqlx::query_as::<_, ProfileRow>(&format!("SELECT {} FROM accounts_userprofile WHERE ($1::text IS NULL OR role = $1 OR roles ? $1) AND ($2::text IS NULL OR status = $2) ORDER BY created_date DESC,id DESC LIMIT $3 OFFSET $4", ProfileRow::FIELDS)).bind(query.role).bind(query.status).bind(limit).bind(offset).fetch_all(pool).await?,
        "instructor" => sqlx::query_as::<_, ProfileRow>(&format!("SELECT {} FROM accounts_userprofile WHERE (id = $1 OR assigned_instructor_id = $1) AND ($3::text IS NOT NULL OR status<>'baja') AND ($2::text IS NULL OR role=$2 OR roles ? $2) AND ($3::text IS NULL OR status=$3) ORDER BY created_date DESC,id DESC LIMIT $4 OFFSET $5", ProfileRow::FIELDS)).bind(claims.profile_id).bind(query.role).bind(query.status).bind(limit).bind(offset).fetch_all(pool).await?,
        _ => sqlx::query_as::<_, ProfileRow>(&format!("SELECT {} FROM accounts_userprofile WHERE id=$1 AND ($2::text IS NULL OR role=$2 OR roles ? $2) AND ($3::text IS NULL OR status=$3) LIMIT $4 OFFSET $5", ProfileRow::FIELDS)).bind(claims.profile_id).bind(query.role).bind(query.status).bind(limit).bind(offset).fetch_all(pool).await?,
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
    let mut tx = pool(&state)?.begin().await?;
    crate::account_lifecycle::lock(&mut tx).await?;
    crate::account_lifecycle::actor_active(&mut tx, &claims).await?;
    if input.login_2fa_enabled_override.is_some() {
        crate::runtime_config::lock_email_auth_config(&mut tx).await?;
    }
    let current =
        sqlx::query_as::<_, ProfileRow>(&format!("{} FOR UPDATE", ProfileRow::SELECT_BY_ID))
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or(AppError::NotFound)?;
    // Check the locked, persisted roles before accepting a role replacement.
    // A forged PATCH cannot demote and block an administrator in one request.
    protect_administrator_from_block(&current.role, &current.roles, input.status.as_deref())?;
    if current.status == "baja" && input.status.is_some() {
        return Err(AppError::Validation(
            "Una cuenta de baja sólo puede reactivarse mediante el procedimiento autorizado."
                .into(),
        ));
    }
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
                && !auth::roles_from_json(&current.roles, &current.role)
                    .iter()
                    .any(|role| role == "admin" || role == "instructor")
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
    if claims.role != "admin" {
        input.assigned_instructor_id = None;
    }
    if input.login_2fa_enabled_override == Some(Some(true)) {
        crate::runtime_config::require_email_2fa_ready(&state, &mut tx).await?;
    }
    normalize_role_change(&current.role, &mut input.role, &mut input.roles)?;
    let target_roles = input
        .roles
        .clone()
        .unwrap_or_else(|| auth::roles_from_json(&current.roles, &current.role));
    if is_administrator(&current.role, &current.roles)
        && (input.status.as_deref().is_some_and(|v| v != "activo")
            || !target_roles.iter().any(|v| v == "admin"))
    {
        crate::account_lifecycle::protect_last_admin(&mut tx, id).await?;
    }
    if let Some(instructor_id) = input.assigned_instructor_id {
        let valid: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM accounts_userprofile p JOIN auth_user u ON u.id=p.user_id WHERE p.id=$1 AND p.status='activo' AND p.otp_verified AND u.is_active AND (p.role='instructor' OR p.roles ? 'instructor'))")
            .bind(instructor_id).fetch_one(&mut *tx).await?;
        if !valid {
            return Err(AppError::Validation(
                "El instructor asignado no está activo o no tiene el rol instructor.".into(),
            ));
        }
        if instructor_id == id || !target_roles.iter().any(|role| role == "alumno") {
            return Err(AppError::Validation(
                "Solo se puede asignar instructor a un alumno.".into(),
            ));
        }
    }
    let role_changed = input
        .role
        .as_ref()
        .is_some_and(|role| role != &current.role)
        || input
            .roles
            .as_ref()
            .is_some_and(|roles| serde_json::json!(roles) != current.roles);
    if let Some(status) = &input.status {
        if !matches!(
            status.as_str(),
            "pendiente" | "activo" | "bloqueado" | "rechazado"
        ) {
            return Err(AppError::Validation("Estado no válido.".into()));
        }
        if status == "activo"
            && target_roles.iter().any(|role| role == "alumno")
            && !current.otp_verified
        {
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
    sqlx::query("UPDATE accounts_userprofile SET nombre=COALESCE($2,nombre),apellidos=COALESCE($3,apellidos),email=COALESCE($4,email),username=COALESCE($5,username),dni_nie=COALESCE($6,dni_nie),fecha_nacimiento=COALESCE($7,fecha_nacimiento),foto_perfil=COALESCE($8,foto_perfil),status=COALESCE($9,status),role=COALESCE($10,role),roles=COALESCE($11,roles),login_2fa_enabled_override=CASE WHEN $12 THEN $13 ELSE login_2fa_enabled_override END,username_lookup=COALESCE($14,username_lookup),email_lookup=COALESCE($15,email_lookup),dni_lookup=COALESCE($16,dni_lookup),updated_date=NOW() WHERE id=$1")
        .bind(id).bind(nombre).bind(apellidos).bind(email.clone()).bind(username).bind(dni).bind(date).bind(photo).bind(input.status).bind(input.role).bind(input.roles.map(|v|serde_json::to_value(v).unwrap_or_default())).bind(input.login_2fa_enabled_override.is_some()).bind(input.login_2fa_enabled_override.flatten()).bind(username_lookup).bind(email_lookup).bind(dni_lookup).execute(&mut *tx).await?;
    if let Some(instructor_id) = input.assigned_instructor_id {
        sqlx::query("UPDATE accounts_userprofile SET assigned_instructor_id=$2 WHERE id=$1")
            .bind(id)
            .bind(instructor_id)
            .execute(&mut *tx)
            .await?;
    }
    if role_changed {
        sqlx::query("UPDATE auth_tab_session SET revoked_at=clock_timestamp() WHERE profile_id=$1 AND revoked_at IS NULL").bind(id).execute(&mut *tx).await?;
        crate::account_lifecycle::event(
            &mut tx,
            id,
            Some(claims.profile_id),
            "roles_changed",
            "PASS",
            serde_json::json!({"previous":current.roles,"current":target_roles}),
            None,
        )
        .await?;
        sqlx::query("UPDATE accounts_userprofile SET active_session_key=NULL,active_refresh_jti='',session_role=role,assigned_instructor_id=CASE WHEN role='alumno' OR roles ? 'alumno' THEN assigned_instructor_id ELSE NULL END WHERE id=$1")
            .bind(id).execute(&mut *tx).await?;
        sqlx::query("UPDATE conexiones_registroconexion SET estado_sesion='finalizada',fecha_cierre=NOW(),ultima_actividad=NOW(),tiempo_sesion=GREATEST(0,EXTRACT(EPOCH FROM (NOW()-fecha_hora))::integer),updated_date=NOW() WHERE profile_id=$1 AND estado_sesion='activa'")
            .bind(id).execute(&mut *tx).await?;
    }
    if let Some(email) = email {
        sqlx::query("UPDATE auth_user SET email=$1 WHERE id=$2")
            .bind(email)
            .bind(current.user_id)
            .execute(&mut *tx)
            .await?;
    }
    if claims.role == "admin" && (input.nombre.is_some() || input.apellidos.is_some()) {
        sqlx::query("INSERT INTO core_auditlog (id,created_date,updated_date,model_name,instance_id,action,extra,profile_id) VALUES ($1,NOW(),NOW(),'UserProfile',$2,'admin_profile_repair','{}'::jsonb,$3)")
            .bind(Uuid::new_v4()).bind(id.to_string()).bind(claims.profile_id).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    detail(State(state), headers, Path(id)).await
}

pub(crate) fn is_administrator(role: &str, roles: &serde_json::Value) -> bool {
    role == "admin"
        || roles
            .as_array()
            .is_some_and(|values| values.iter().any(|value| value == "admin"))
}

fn protect_administrator_from_block(
    role: &str,
    roles: &serde_json::Value,
    status: Option<&str>,
) -> Result<(), AppError> {
    if status == Some("bloqueado") && is_administrator(role, roles) {
        return Err(AppError::Forbidden);
    }
    Ok(())
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
            && !auth::roles_from_json(&row.roles, &row.role)
                .iter()
                .any(|role| role == "admin" || role == "instructor")
            && row.assigned_instructor_id == Some(claims.profile_id))
    {
        return Err(AppError::Forbidden);
    }
    let mut transaction = pool(&state)?.begin().await?;
    crate::account_lifecycle::lock(&mut transaction).await?;
    crate::account_lifecycle::actor_active(&mut transaction, &claims).await?;
    let locked =
        sqlx::query_as::<_, ProfileRow>(&format!("{} FOR UPDATE", ProfileRow::SELECT_BY_ID))
            .bind(id)
            .fetch_one(&mut *transaction)
            .await?;
    if claims.role != "admin"
        && (locked.assigned_instructor_id != Some(claims.profile_id)
            || locked.role != "alumno"
            || is_administrator(&locked.role, &locked.roles)
            || auth::roles_from_json(&locked.roles, &locked.role)
                .iter()
                .any(|r| r == "instructor"))
    {
        return Err(AppError::Forbidden);
    }
    if is_administrator(&locked.role, &locked.roles) {
        crate::account_lifecycle::protect_last_admin(&mut transaction, id).await?;
    }
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
    require_role(&claims, &["admin", "instructor"])?;
    if claims.role != "admin" && claims.profile_id != id {
        return Err(AppError::Forbidden);
    }
    let rows=sqlx::query_as::<_,ProfileRow>(&format!("SELECT {} FROM accounts_userprofile WHERE assigned_instructor_id=$1 AND status<>'baja' AND (role='alumno' OR roles ? 'alumno') ORDER BY created_date DESC",ProfileRow::FIELDS)).bind(id).fetch_all(pool(&state)?).await?;
    views(rows, &state)
}
pub async fn assign_students(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<StudentIds>,
) -> Result<Json<serde_json::Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin", "instructor"])?;
    if input.student_ids.is_empty()
        || input.student_ids.len() > 200
        || input
            .student_ids
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != input.student_ids.len()
    {
        return Err(AppError::Validation(
            "Se requieren entre uno y 200 student_id.".into(),
        ));
    }
    let mut tx = pool(&state)?.begin().await?;
    let mut locked_ids = input.student_ids.clone();
    locked_ids.push(id);
    locked_ids.sort();
    locked_ids.dedup();
    // Lock the target and every student in a consistent order. Concurrent
    // reassignment rechecks ownership after waiting, rather than stealing a row.
    let rows = sqlx::query_as::<_, AssignmentProfile>("SELECT p.id,p.role,p.roles,p.status,p.otp_verified,u.is_active,p.assigned_instructor_id FROM accounts_userprofile p LEFT JOIN auth_user u ON u.id=p.user_id WHERE p.id=ANY($1) ORDER BY p.id FOR UPDATE OF p")
        .bind(&locked_ids).fetch_all(&mut *tx).await?;
    if !rows.iter().any(|row| row.id == id && row.assignable()) {
        return Err(AppError::Validation(
            "El instructor seleccionado debe estar activo y verificado.".into(),
        ));
    }
    for student_id in &input.student_ids {
        let student = rows
            .iter()
            .find(|row| row.id == *student_id)
            .ok_or(AppError::NotFound)?;
        if !student.has_role("alumno") || student.status == "baja" {
            return Err(AppError::NotFound);
        }
        if !student.can_be_assigned_by(&claims, id) {
            return Err(AppError::Forbidden);
        }
    }
    let count=sqlx::query("UPDATE accounts_userprofile SET assigned_instructor_id=$1,updated_date=NOW() WHERE id=ANY($2) AND (role='alumno' OR roles ? 'alumno')").bind(id).bind(&input.student_ids).execute(&mut *tx).await?.rows_affected();
    tx.commit().await?;
    state
        .events
        .publish(
            "connections",
            serde_json::json!({"type":"asignacion","action":"updated"}),
        )
        .await;
    Ok(Json(
        serde_json::json!({"detail":format!("{count} alumno(s) asignado(s)."),"assigned_count":count,"assigned_instructor_id":id}),
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
) -> Result<Json<Vec<InstructorOption>>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin", "instructor"])?;
    let mut rows = sqlx::query_as::<_, InstructorOption>("SELECT p.id,p.nombre,p.apellidos,p.username FROM accounts_userprofile p JOIN auth_user u ON u.id=p.user_id WHERE p.status='activo' AND p.otp_verified AND u.is_active AND (p.role='instructor' OR p.roles ? 'instructor')")
        .fetch_all(pool(&state)?).await?;
    for row in &mut rows {
        row.nombre = state.cipher.decrypt(&row.nombre)?;
        row.apellidos = state.cipher.decrypt(&row.apellidos)?;
        row.username = state.cipher.decrypt(&row.username)?;
    }
    rows.sort_by_cached_key(|row| {
        format!("{} {} {}", row.nombre, row.apellidos, row.username).to_lowercase()
    });
    Ok(Json(rows))
}

fn optional_boolean_update<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Option<bool>>, D::Error> {
    Option::<bool>::deserialize(deserializer).map(Some)
}

fn normalize_role_change(
    current_role: &str,
    role: &mut Option<String>,
    roles: &mut Option<Vec<String>>,
) -> Result<(), AppError> {
    if role.is_none() && roles.is_none() {
        return Ok(());
    }
    let mut values = roles
        .clone()
        .unwrap_or_else(|| role.iter().cloned().collect());
    if values.is_empty()
        || values.len() > 3
        || values
            .iter()
            .any(|value| !matches!(value.as_str(), "admin" | "instructor" | "alumno"))
    {
        return Err(AppError::Validation(
            "La lista de roles debe contener entre uno y tres roles válidos.".into(),
        ));
    }
    values.sort();
    values.dedup();
    let primary = role.clone().unwrap_or_else(|| {
        if values.iter().any(|value| value == current_role) {
            current_role.to_owned()
        } else {
            values[0].clone()
        }
    });
    if !values.contains(&primary) {
        return Err(AppError::Validation(
            "El rol principal debe pertenecer a la lista de roles.".into(),
        ));
    }
    *role = Some(primary);
    *roles = Some(values);
    Ok(())
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
    use super::{normalize_role_change, require_admin};
    #[test]
    fn blocking_checks_persisted_administrator_roles() {
        for (role, roles, protected) in [
            ("admin", serde_json::json!([]), true),
            (
                "instructor",
                serde_json::json!(["instructor", "admin"]),
                true,
            ),
            ("alumno", serde_json::json!(["alumno"]), false),
            ("instructor", serde_json::json!(["instructor"]), false),
        ] {
            assert_eq!(
                super::protect_administrator_from_block(role, &roles, Some("bloqueado")).is_err(),
                protected
            );
            assert!(super::protect_administrator_from_block(role, &roles, Some("activo")).is_ok());
            assert!(super::protect_administrator_from_block(role, &roles, None).is_ok());
        }
    }
    #[test]
    fn two_factor_override_distinguishes_omitted_inherited_and_explicit() {
        for (body, expected) in [
            ("{}", None),
            (r#"{"login_2fa_enabled_override":null}"#, Some(None)),
            (r#"{"login_2fa_enabled_override":false}"#, Some(Some(false))),
        ] {
            let update: super::ProfileWrite = serde_json::from_str(body).unwrap();
            assert_eq!(update.login_2fa_enabled_override, expected);
        }
    }
    #[test]
    fn replacing_primary_role_removes_previous_grant() {
        let mut role = Some("alumno".to_owned());
        let mut roles = None;
        normalize_role_change("admin", &mut role, &mut roles).unwrap();
        assert_eq!(roles.unwrap(), vec!["alumno"]);
    }
    #[test]
    fn multirole_updates_preserve_a_valid_primary_role() {
        let mut role = None;
        let mut roles = Some(vec![
            "instructor".to_owned(),
            "admin".to_owned(),
            "instructor".to_owned(),
        ]);
        normalize_role_change("instructor", &mut role, &mut roles).unwrap();
        assert_eq!(role.as_deref(), Some("instructor"));
        assert_eq!(roles.unwrap(), vec!["admin", "instructor"]);
    }
    #[test]
    fn invalid_or_inconsistent_role_grants_are_rejected() {
        for values in [
            vec![],
            vec!["root".to_owned()],
            vec!["instructor".to_owned()],
        ] {
            assert!(
                normalize_role_change("admin", &mut Some("admin".to_owned()), &mut Some(values))
                    .is_err()
            );
        }
    }
    #[test]
    fn admin_gate_is_deny_by_default() {
        assert!(require_admin("alumno").is_err());
        assert!(require_admin("instructor").is_err());
        assert!(require_admin("admin").is_ok());
    }

    #[test]
    fn assignment_permissions_preserve_scope_and_protect_staff_roles() {
        let owner = uuid::Uuid::new_v4();
        let recipient = uuid::Uuid::new_v4();
        let claims = super::auth::Claims {
            profile_id: owner,
            role: "instructor".into(),
            user_id: 1,
            token_type: "access".into(),
            exp: usize::MAX,
            iat: 0,
            jti: uuid::Uuid::nil(),
            session_key: String::new(),
        };
        let mut student = super::AssignmentProfile {
            id: uuid::Uuid::new_v4(),
            role: "alumno".into(),
            roles: serde_json::json!(["alumno"]),
            status: "activo".into(),
            otp_verified: true,
            is_active: Some(true),
            assigned_instructor_id: Some(owner),
        };
        assert!(student.can_be_assigned_by(&claims, recipient));
        student.assigned_instructor_id = Some(recipient);
        assert!(!student.can_be_assigned_by(&claims, owner));
        student.assigned_instructor_id = None;
        assert!(student.can_be_assigned_by(&claims, owner));
        assert!(!student.can_be_assigned_by(&claims, recipient));
        student.assigned_instructor_id = Some(owner);
        student.roles = serde_json::json!(["alumno", "admin"]);
        assert!(!student.can_be_assigned_by(&claims, recipient));
        assert!(student.can_be_assigned_by(&claims, owner));
        let admin = super::auth::Claims {
            role: "admin".into(),
            ..claims
        };
        assert!(student.can_be_assigned_by(&admin, recipient));
        assert!(!student.can_be_assigned_by(&admin, student.id));
    }

    #[test]
    fn only_active_verified_instructor_accounts_are_assignable() {
        let mut candidate = super::AssignmentProfile {
            id: uuid::Uuid::new_v4(),
            role: "admin".into(),
            roles: serde_json::json!(["admin", "instructor"]),
            status: "activo".into(),
            otp_verified: true,
            is_active: Some(true),
            assigned_instructor_id: None,
        };
        assert!(candidate.assignable());
        for status in ["pendiente", "bloqueado", "rechazado", "inactivo"] {
            candidate.status = status.into();
            assert!(!candidate.assignable());
        }
        candidate.status = "activo".into();
        candidate.otp_verified = false;
        assert!(!candidate.assignable());
        candidate.otp_verified = true;
        candidate.is_active = Some(false);
        assert!(!candidate.assignable());
        candidate.is_active = None;
        assert!(!candidate.assignable());
    }
}
