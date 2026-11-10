use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    AppState,
    auth::{Claims, authenticate, require_role},
    error::AppError,
};

#[derive(Debug, Deserialize)]
pub struct MaterialQuery {
    categoria: Option<String>,
    tipo: Option<String>,
    activo: Option<bool>,
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct MaterialWrite {
    titulo: String,
    #[serde(default)]
    descripcion: String,
    #[serde(default)]
    categoria: String,
    #[serde(default)]
    tipo: String,
    #[serde(default)]
    archivo_url: String,
    #[serde(default)]
    archivo_path: String,
    #[serde(default)]
    archivo_nombre_original: String,
    #[serde(default)]
    archivo_content_type: String,
    archivo_tamano: Option<u64>,
    #[serde(default)]
    archivo_sha256: String,
    #[serde(default)]
    video_url: String,
    #[serde(default)]
    orden: u32,
    activo: Option<bool>,
    duracion_minutos: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct MaterialPatch {
    titulo: Option<String>,
    descripcion: Option<String>,
    categoria: Option<String>,
    tipo: Option<String>,
    archivo_url: Option<String>,
    archivo_path: Option<String>,
    archivo_nombre_original: Option<String>,
    archivo_content_type: Option<String>,
    archivo_tamano: Option<u64>,
    archivo_sha256: Option<String>,
    video_url: Option<String>,
    orden: Option<u32>,
    activo: Option<bool>,
    duracion_minutos: Option<u32>,
}

pub async fn list_materials(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<MaterialQuery>,
) -> Result<Json<Vec<Value>>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let rows = sqlx::query_scalar::<_, Value>(&format!(
        "SELECT to_jsonb(m) FROM materiales_material m WHERE \
         ($1::text IS NULL OR m.categoria = $1) AND ($2::text IS NULL OR m.tipo = $2) \
         AND ($3::boolean IS NULL OR m.activo = $3) AND \
         {access} \
         AND {} ORDER BY m.orden, m.created_date DESC LIMIT $6",
        crate::academic_scope::resource_scope("m", "subido_por_id", 4, 5),
        access = crate::academic_scope::material_access("m", 4, 5)
    ))
    .bind(query.categoria.as_deref())
    .bind(query.tipo.as_deref())
    .bind(query.activo)
    .bind(&claims.role)
    .bind(claims.profile_id)
    .bind(limit(query.limit))
    .fetch_all(pool(&state)?)
    .await?;
    Ok(Json(rows))
}

pub async fn create_material(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<MaterialWrite>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let claims = staff(&state, &headers)?;
    validate_material(&input)?;
    ensure_file_scope(
        pool(&state)?,
        &claims,
        &input.archivo_path,
        &input.archivo_url,
    )
    .await?;
    let row = sqlx::query_scalar::<_, Value>(
        "INSERT INTO materiales_material (id, created_date, updated_date, titulo, descripcion, \
         categoria, tipo, archivo_url, archivo_path, archivo_nombre_original, archivo_content_type, \
         archivo_tamano, archivo_sha256, video_url, orden, activo, duracion_minutos, subido_por_id) \
         VALUES ($1, NOW(), NOW(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, \
         $14, $15, $16) RETURNING to_jsonb(materiales_material)",
    )
    .bind(Uuid::new_v4())
    .bind(input.titulo.trim())
    .bind(input.descripcion)
    .bind(input.categoria)
    .bind(input.tipo)
    .bind(input.archivo_url)
    .bind(input.archivo_path)
    .bind(input.archivo_nombre_original)
    .bind(input.archivo_content_type)
    .bind(input.archivo_tamano.map(i64::try_from).transpose().map_err(|_| AppError::Validation("TamaÃ±o no vÃ¡lido.".to_owned()))?)
    .bind(input.archivo_sha256)
    .bind(input.video_url)
    .bind(i32::try_from(input.orden).map_err(|_| AppError::Validation("Orden no vÃ¡lido.".to_owned()))?)
    .bind(input.activo.unwrap_or(true))
    .bind(input.duracion_minutos.map(i32::try_from).transpose().map_err(|_| AppError::Validation("DuraciÃ³n no vÃ¡lida.".to_owned()))?)
    .bind(claims.profile_id)
    .fetch_one(pool(&state)?)
    .await?;
    Ok((StatusCode::CREATED, Json(row)))
}

pub async fn material_detail(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let statement = format!(
        "SELECT to_jsonb(m) FROM materiales_material m WHERE m.id=$1 AND {access} AND {}",
        crate::academic_scope::resource_scope("m", "subido_por_id", 2, 3),
        access = crate::academic_scope::material_access("m", 2, 3)
    );
    let row = sqlx::query_scalar::<_, Value>(&statement)
        .bind(id)
        .bind(&claims.role)
        .bind(claims.profile_id)
        .fetch_optional(pool(&state)?)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

pub async fn update_material(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<MaterialPatch>,
) -> Result<Json<Value>, AppError> {
    let claims = staff(&state, &headers)?;
    crate::academic_scope::staff_resource(pool(&state)?, &claims, "material", id, false).await?;
    if input.archivo_path.is_some() || input.archivo_url.is_some() {
        ensure_file_scope(
            pool(&state)?,
            &claims,
            input.archivo_path.as_deref().unwrap_or(""),
            input.archivo_url.as_deref().unwrap_or(""),
        )
        .await?;
    }
    validate_material_patch(&input)?;
    let size = input
        .archivo_tamano
        .map(i64::try_from)
        .transpose()
        .map_err(|_| AppError::Validation("Tamaño no válido.".into()))?;
    let order = input
        .orden
        .map(i32::try_from)
        .transpose()
        .map_err(|_| AppError::Validation("Orden no válido.".into()))?;
    let duration = input
        .duracion_minutos
        .map(i32::try_from)
        .transpose()
        .map_err(|_| AppError::Validation("Duración no válida.".into()))?;
    let row = sqlx::query_scalar::<_, Value>("UPDATE materiales_material SET titulo=COALESCE($2,titulo),descripcion=COALESCE($3,descripcion),categoria=COALESCE($4,categoria),tipo=COALESCE($5,tipo),archivo_url=COALESCE($6,archivo_url),archivo_path=COALESCE($7,archivo_path),archivo_nombre_original=COALESCE($8,archivo_nombre_original),archivo_content_type=COALESCE($9,archivo_content_type),archivo_tamano=COALESCE($10,archivo_tamano),archivo_sha256=COALESCE($11,archivo_sha256),video_url=COALESCE($12,video_url),orden=COALESCE($13,orden),activo=COALESCE($14,activo),duracion_minutos=COALESCE($15,duracion_minutos),updated_date=NOW() WHERE id=$1 RETURNING to_jsonb(materiales_material)")
        .bind(id).bind(input.titulo.map(|v| v.trim().to_owned())).bind(input.descripcion).bind(input.categoria).bind(input.tipo)
        .bind(input.archivo_url).bind(input.archivo_path).bind(input.archivo_nombre_original).bind(input.archivo_content_type)
        .bind(size).bind(input.archivo_sha256).bind(input.video_url).bind(order).bind(input.activo).bind(duration)
        .fetch_optional(pool(&state)?).await?.ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

pub async fn delete_material(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let claims = staff(&state, &headers)?;
    crate::academic_scope::staff_resource(pool(&state)?, &claims, "material", id, false).await?;
    delete(pool(&state)?, "materiales_material", id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct ScopedQuery {
    alumno_id: Option<Uuid>,
    material_id: Option<Uuid>,
    categoria: Option<String>,
    completado: Option<bool>,
    permitido: Option<bool>,
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct CompletionWrite {
    alumno_id: Option<Uuid>,
    material_id: Uuid,
    completado: Option<bool>,
    fecha_completado: Option<DateTime<Utc>>,
    progreso: Option<u16>,
}

#[derive(Debug, Deserialize)]
pub struct CompletionPatch {
    completado: Option<bool>,
    fecha_completado: Option<DateTime<Utc>>,
    progreso: Option<u16>,
}

#[derive(Debug, Deserialize)]
pub struct CompletionDeleteQuery {
    alumno_id: Uuid,
}

pub async fn list_completions(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<ScopedQuery>,
) -> Result<Json<Vec<Value>>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let rows = sqlx::query_scalar::<_, Value>(
        "SELECT to_jsonb(c) || jsonb_build_object('alumno_id', c.alumno_id, 'material_id', c.material_id) \
         FROM materiales_materialcompletado c LEFT JOIN accounts_userprofile p ON p.id = c.alumno_id \
         WHERE ($1 = 'admin' OR ($1 = 'alumno' AND c.alumno_id = $2) OR \
         ($1 = 'instructor' AND p.assigned_instructor_id = $2)) \
         AND ($3::uuid IS NULL OR c.alumno_id = $3) AND ($4::uuid IS NULL OR c.material_id = $4) \
         AND ($5::text IS NULL OR c.categoria = $5) AND ($6::boolean IS NULL OR c.completado = $6) \
         ORDER BY c.created_date DESC LIMIT $7",
    )
    .bind(&claims.role)
    .bind(claims.profile_id)
    .bind(query.alumno_id)
    .bind(query.material_id)
    .bind(query.categoria.as_deref())
    .bind(query.completado)
    .bind(limit(query.limit))
    .fetch_all(pool(&state)?)
    .await?;
    Ok(Json(rows))
}

pub async fn create_completion(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<CompletionWrite>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let student = if claims.role == "alumno" {
        claims.profile_id
    } else {
        require_role(&claims, &["admin", "instructor"])?;
        let student = input
            .alumno_id
            .ok_or_else(|| AppError::Validation("Alumno obligatorio.".to_owned()))?;
        ensure_assigned_student(&state, &claims, student).await?;
        student
    };
    let (mut tx, title, category) =
        completion_transaction(&state, &claims, student, input.material_id).await?;
    let progress = input.progreso.unwrap_or(100).min(100) as i16;
    let row = sqlx::query_scalar::<_, Value>(
        "INSERT INTO materiales_materialcompletado (id, created_date, updated_date, alumno_id, \
         material_id, material_titulo, categoria, completado, fecha_completado, progreso) \
         VALUES ($1, NOW(), NOW(), $2, $3, $4, $5, $6, COALESCE($7, NOW()), $8) \
         ON CONFLICT (alumno_id, material_id) DO UPDATE SET completado = EXCLUDED.completado, \
         fecha_completado = EXCLUDED.fecha_completado, progreso = EXCLUDED.progreso, updated_date = NOW() \
         RETURNING to_jsonb(materiales_materialcompletado) || \
         jsonb_build_object('alumno_id', alumno_id, 'material_id', material_id)",
    )
    .bind(Uuid::new_v4()).bind(student).bind(input.material_id).bind(title)
    .bind(category).bind(input.completado.unwrap_or(true)).bind(input.fecha_completado)
    .bind(progress).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(row)))
}

pub async fn update_completion(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<CompletionPatch>,
) -> Result<Json<Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let (student, material): (Uuid, Uuid) = sqlx::query_as(
        "SELECT alumno_id,material_id FROM materiales_materialcompletado WHERE id=$1",
    )
    .bind(id)
    .fetch_optional(pool(&state)?)
    .await?
    .ok_or(AppError::NotFound)?;
    let (mut tx, _, _) = completion_transaction(&state, &claims, student, material).await?;
    let progress = input.progreso.map(|value| value.min(100) as i16);
    let row = sqlx::query_scalar::<_, Value>(
        "UPDATE materiales_materialcompletado SET completado = COALESCE($2, completado), \
         fecha_completado = COALESCE($3, fecha_completado), progreso = COALESCE($4, progreso), \
         updated_date = NOW() WHERE id = $1 AND ($5 = 'admin' OR ($5 = 'alumno' AND alumno_id = $6) OR ($5 = 'instructor' AND EXISTS (SELECT 1 FROM accounts_userprofile p WHERE p.id=alumno_id AND p.assigned_instructor_id=$6))) \
         RETURNING to_jsonb(materiales_materialcompletado) || \
         jsonb_build_object('alumno_id', alumno_id, 'material_id', material_id)",
    )
    .bind(id)
    .bind(input.completado)
    .bind(input.fecha_completado)
    .bind(progress)
    .bind(&claims.role)
    .bind(claims.profile_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppError::NotFound)?;
    tx.commit().await?;
    Ok(Json(row))
}

async fn completion_transaction(
    state: &AppState,
    claims: &Claims,
    student: Uuid,
    material: Uuid,
) -> Result<(sqlx::Transaction<'static, sqlx::Postgres>, String, String), AppError> {
    require_role(claims, &["admin", "instructor", "alumno"])?;
    let mut tx = pool(state)?.begin().await?;
    crate::account_lifecycle::lock(&mut tx).await?;
    crate::account_lifecycle::actor_active(&mut tx, claims).await?;
    let assigned: Option<Uuid> = sqlx::query_scalar("SELECT assigned_instructor_id FROM accounts_userprofile WHERE id=$1 AND status='activo' AND otp_verified AND (role='alumno' OR roles ? 'alumno') FOR UPDATE")
        .bind(student).fetch_optional(&mut *tx).await?.ok_or(AppError::NotFound)?;
    if (claims.role == "alumno" && claims.profile_id != student)
        || (claims.role == "instructor" && assigned != Some(claims.profile_id))
    {
        return Err(AppError::Forbidden);
    }
    let statement = format!(
        "SELECT m.titulo,m.categoria FROM materiales_material m WHERE m.id=$1 AND {} AND {} FOR SHARE OF m",
        crate::academic_scope::resource_scope("m", "subido_por_id", 2, 3),
        crate::academic_scope::material_access("m", 2, 3)
    );
    let (title, category): (String, String) = sqlx::query_as(&statement)
        .bind(material)
        .bind(&claims.role)
        .bind(claims.profile_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok((tx, title, category))
}

pub async fn completion_detail(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let row = sqlx::query_scalar::<_, Value>("SELECT to_jsonb(c) || jsonb_build_object('alumno_id',c.alumno_id,'material_id',c.material_id) FROM materiales_materialcompletado c LEFT JOIN accounts_userprofile p ON p.id=c.alumno_id WHERE c.id=$1 AND ($2='admin' OR ($2='alumno' AND c.alumno_id=$3) OR ($2='instructor' AND p.assigned_instructor_id=$3))")
        .bind(id).bind(&claims.role).bind(claims.profile_id).fetch_optional(pool(&state)?).await?.ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

pub async fn delete_completion(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let result = sqlx::query("DELETE FROM materiales_materialcompletado c USING accounts_userprofile p WHERE c.id=$1 AND p.id=c.alumno_id AND ($2='admin' OR ($2='alumno' AND c.alumno_id=$3) OR ($2='instructor' AND p.assigned_instructor_id=$3))")
        .bind(id).bind(&claims.role).bind(claims.profile_id).execute(pool(&state)?).await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete_completions_many(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<CompletionDeleteQuery>,
) -> Result<Json<Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin"])?;
    let deleted = sqlx::query("DELETE FROM materiales_materialcompletado WHERE alumno_id=$1")
        .bind(input.alumno_id)
        .execute(pool(&state)?)
        .await?
        .rows_affected();
    Ok(Json(json!({"deleted":deleted})))
}

#[derive(Debug, Deserialize)]
pub struct PublicationWrite {
    titulo: String,
    #[serde(default)]
    resumen: String,
    fecha_publicacion: Option<NaiveDate>,
    #[serde(default)]
    url: String,
    #[serde(default)]
    categoria: String,
    activo: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct PublicationPatch {
    titulo: Option<String>,
    resumen: Option<String>,
    fecha_publicacion: Option<NaiveDate>,
    url: Option<String>,
    categoria: Option<String>,
    activo: Option<bool>,
}

pub async fn list_publications(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<MaterialQuery>,
) -> Result<Json<Vec<Value>>, AppError> {
    authenticate(&state, &headers, "access")?;
    let rows = sqlx::query_scalar::<_, Value>("SELECT to_jsonb(p) FROM materiales_publicacionboe p WHERE ($1::text IS NULL OR categoria = $1) AND ($2::boolean IS NULL OR activo = $2) ORDER BY fecha_publicacion DESC NULLS LAST, created_date DESC LIMIT $3")
        .bind(query.categoria.as_deref()).bind(query.activo).bind(limit(query.limit)).fetch_all(pool(&state)?).await?;
    Ok(Json(rows))
}

pub async fn create_publication(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<PublicationWrite>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    staff(&state, &headers)?;
    if input.titulo.trim().is_empty() || input.titulo.chars().count() > 500 {
        return Err(AppError::Validation("Titulo no valido.".to_owned()));
    }
    validate_url(&input.url)?;
    let row = sqlx::query_scalar::<_, Value>("INSERT INTO materiales_publicacionboe (id, created_date, updated_date, titulo, resumen, fecha_publicacion, url, categoria, activo) VALUES ($1, NOW(), NOW(), $2, $3, $4, $5, $6, $7) RETURNING to_jsonb(materiales_publicacionboe)")
        .bind(Uuid::new_v4()).bind(input.titulo.trim()).bind(input.resumen).bind(input.fecha_publicacion)
        .bind(input.url).bind(input.categoria).bind(input.activo.unwrap_or(true)).fetch_one(pool(&state)?).await?;
    Ok((StatusCode::CREATED, Json(row)))
}

pub async fn publication_detail(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    authenticate(&state, &headers, "access")?;
    let row = sqlx::query_scalar::<_, Value>(
        "SELECT to_jsonb(p) FROM materiales_publicacionboe p WHERE id=$1",
    )
    .bind(id)
    .fetch_optional(pool(&state)?)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

pub async fn update_publication(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<PublicationPatch>,
) -> Result<Json<Value>, AppError> {
    staff(&state, &headers)?;
    if input
        .titulo
        .as_deref()
        .is_some_and(|v| v.trim().is_empty() || v.chars().count() > 500)
    {
        return Err(AppError::Validation("Título no válido.".into()));
    }
    if let Some(url) = &input.url {
        validate_url(url)?;
    }
    let row = sqlx::query_scalar::<_, Value>("UPDATE materiales_publicacionboe SET titulo=COALESCE($2,titulo),resumen=COALESCE($3,resumen),fecha_publicacion=COALESCE($4,fecha_publicacion),url=COALESCE($5,url),categoria=COALESCE($6,categoria),activo=COALESCE($7,activo),updated_date=NOW() WHERE id=$1 RETURNING to_jsonb(materiales_publicacionboe)")
        .bind(id).bind(input.titulo.map(|v|v.trim().to_owned())).bind(input.resumen).bind(input.fecha_publicacion).bind(input.url).bind(input.categoria).bind(input.activo).fetch_optional(pool(&state)?).await?.ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

pub async fn delete_publication(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    staff(&state, &headers)?;
    delete(pool(&state)?, "materiales_publicacionboe", id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct PermissionWrite {
    alumno_id: Uuid,
    material_id: Option<Uuid>,
    #[serde(default)]
    categoria: String,
    permitido: Option<bool>,
    #[serde(default)]
    motivo: String,
}

#[derive(Debug, Deserialize)]
pub struct PermissionPatch {
    material_id: Option<Uuid>,
    categoria: Option<String>,
    permitido: Option<bool>,
    motivo: Option<String>,
}

pub async fn list_permissions(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<ScopedQuery>,
) -> Result<Json<Vec<Value>>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let rows = sqlx::query_scalar::<_, Value>("SELECT to_jsonb(a) || jsonb_build_object('alumno_id', a.alumno_id, 'material_id', a.material_id) FROM materiales_permisoaccesomaterial a LEFT JOIN accounts_userprofile p ON p.id = a.alumno_id WHERE ($1 = 'admin' OR ($1 = 'alumno' AND a.alumno_id = $2) OR ($1 = 'instructor' AND p.assigned_instructor_id = $2)) AND ($3::uuid IS NULL OR a.alumno_id = $3) AND ($4::uuid IS NULL OR a.material_id = $4) AND ($5::text IS NULL OR a.categoria = $5) AND ($6::boolean IS NULL OR a.permitido = $6) ORDER BY a.created_date DESC LIMIT $7")
        .bind(&claims.role).bind(claims.profile_id).bind(query.alumno_id).bind(query.material_id)
        .bind(query.categoria.as_deref()).bind(query.permitido).bind(limit(query.limit)).fetch_all(pool(&state)?).await?;
    Ok(Json(rows))
}

pub async fn create_permission(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<PermissionWrite>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let claims = staff(&state, &headers)?;
    ensure_assigned_student(&state, &claims, input.alumno_id).await?;
    if let Some(material) = input.material_id {
        crate::academic_scope::staff_resource(pool(&state)?, &claims, "material", material, false)
            .await?;
    }
    let row = sqlx::query_scalar::<_, Value>("INSERT INTO materiales_permisoaccesomaterial (id, created_date, updated_date, alumno_id, material_id, categoria, permitido, motivo, concedido_por_id) VALUES ($1, NOW(), NOW(), $2, $3, $4, $5, $6, $7) RETURNING to_jsonb(materiales_permisoaccesomaterial) || jsonb_build_object('alumno_id', alumno_id, 'material_id', material_id)")
        .bind(Uuid::new_v4()).bind(input.alumno_id).bind(input.material_id).bind(input.categoria)
        .bind(input.permitido.unwrap_or(true)).bind(input.motivo).bind(claims.profile_id).fetch_one(pool(&state)?).await?;
    Ok((StatusCode::CREATED, Json(row)))
}

pub async fn permission_detail(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let row=sqlx::query_scalar::<_,Value>("SELECT to_jsonb(a)||jsonb_build_object('alumno_id',a.alumno_id,'material_id',a.material_id) FROM materiales_permisoaccesomaterial a LEFT JOIN accounts_userprofile p ON p.id=a.alumno_id WHERE a.id=$1 AND ($2='admin' OR ($2='alumno' AND a.alumno_id=$3) OR ($2='instructor' AND p.assigned_instructor_id=$3))").bind(id).bind(&claims.role).bind(claims.profile_id).fetch_optional(pool(&state)?).await?.ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

pub async fn update_permission(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<PermissionPatch>,
) -> Result<Json<Value>, AppError> {
    let claims = staff(&state, &headers)?;
    let (student, material): (Uuid, Option<Uuid>) = sqlx::query_as(
        "SELECT alumno_id,material_id FROM materiales_permisoaccesomaterial WHERE id=$1",
    )
    .bind(id)
    .fetch_optional(pool(&state)?)
    .await?
    .ok_or(AppError::NotFound)?;
    ensure_assigned_student(&state, &claims, student).await?;
    for material in [material, input.material_id].into_iter().flatten() {
        crate::academic_scope::staff_resource(pool(&state)?, &claims, "material", material, false)
            .await?;
    }
    let row=sqlx::query_scalar::<_,Value>("UPDATE materiales_permisoaccesomaterial SET material_id=COALESCE($2,material_id),categoria=COALESCE($3,categoria),permitido=COALESCE($4,permitido),motivo=COALESCE($5,motivo),updated_date=NOW() WHERE id=$1 AND ($6='admin' OR EXISTS (SELECT 1 FROM accounts_userprofile p WHERE p.id=alumno_id AND p.assigned_instructor_id=$7)) RETURNING to_jsonb(materiales_permisoaccesomaterial)||jsonb_build_object('alumno_id',alumno_id,'material_id',material_id)").bind(id).bind(input.material_id).bind(input.categoria).bind(input.permitido).bind(input.motivo).bind(&claims.role).bind(claims.profile_id).fetch_optional(pool(&state)?).await?.ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

pub async fn delete_permission(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let claims = staff(&state, &headers)?;
    let count = sqlx::query("DELETE FROM materiales_permisoaccesomaterial a WHERE id=$1 AND ($2='admin' OR EXISTS (SELECT 1 FROM accounts_userprofile p WHERE p.id=a.alumno_id AND p.assigned_instructor_id=$3))")
        .bind(id)
        .bind(&claims.role)
        .bind(claims.profile_id)
        .execute(pool(&state)?)
        .await?
        .rows_affected();
    if count == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

fn validate_material(input: &MaterialWrite) -> Result<(), AppError> {
    if input.titulo.trim().is_empty() || input.titulo.chars().count() > 255 {
        return Err(AppError::Validation("Titulo no valido.".to_owned()));
    }
    for url in [&input.archivo_url, &input.video_url] {
        validate_url(url)?;
    }
    if !input.archivo_sha256.is_empty()
        && (input.archivo_sha256.len() != 64
            || !input.archivo_sha256.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        return Err(AppError::Validation("SHA-256 no vÃ¡lido.".to_owned()));
    }
    Ok(())
}

fn validate_material_patch(input: &MaterialPatch) -> Result<(), AppError> {
    if input
        .titulo
        .as_deref()
        .is_some_and(|value| value.trim().is_empty() || value.chars().count() > 255)
    {
        return Err(AppError::Validation("Título no válido.".into()));
    }
    for url in [&input.archivo_url, &input.video_url].into_iter().flatten() {
        validate_url(url)?;
    }
    if input.archivo_sha256.as_deref().is_some_and(|value| {
        !value.is_empty() && (value.len() != 64 || !value.bytes().all(|b| b.is_ascii_hexdigit()))
    }) {
        return Err(AppError::Validation("SHA-256 no válido.".into()));
    }
    Ok(())
}

fn validate_url(value: &str) -> Result<(), AppError> {
    if value.is_empty()
        || value.starts_with("/media/")
        || value.starts_with("/api/media/")
        || value.starts_with("https://")
        || value.starts_with("http://")
    {
        Ok(())
    } else {
        Err(AppError::Validation("URL no vÃ¡lida.".to_owned()))
    }
}
pub(crate) async fn ensure_file_scope(
    pool: &PgPool,
    claims: &Claims,
    path: &str,
    url: &str,
) -> Result<(), AppError> {
    // Check both references: a claimed path cannot mask a different private URL.
    let url_path = url::Url::parse(url)
        .ok()
        .map(|value| value.path().to_owned())
        .unwrap_or_else(|| url.to_owned());
    let url_relative = url_path
        .strip_prefix("/api/media/")
        .or_else(|| url_path.strip_prefix("/media/"))
        .unwrap_or("");
    for relative in [path, url_relative]
        .into_iter()
        .filter(|value| !value.is_empty())
    {
        if !crate::uploads::valid_private_path(relative) {
            return Err(AppError::Validation("Ruta privada no válida.".into()));
        }
        let owner: Option<Uuid> =
            sqlx::query_scalar("SELECT owner_id FROM upload_ownership WHERE storage_path=$1")
                .bind(relative)
                .fetch_optional(pool)
                .await?;
        if claims.role != "admin" {
            match owner {
                Some(id) if id == claims.profile_id => {}
                Some(_) => return Err(AppError::Forbidden),
                None => {
                    // Legacy files require an existing resource authored by this actor.
                    let owned: bool = sqlx::query_scalar(
                        "SELECT EXISTS(SELECT 1 FROM materiales_material WHERE subido_por_id=$2 AND \
                         (archivo_path=$1 OR regexp_replace(regexp_replace(split_part(archivo_url,'?',1),'^https?://[^/]+','','i'),'^(/api)?/media/','')=$1)) \
                         OR EXISTS(SELECT 1 FROM examenes_archivoexamen WHERE subido_por_id=$2 AND \
                         (archivo_path=$1 OR regexp_replace(regexp_replace(split_part(archivo_url,'?',1),'^https?://[^/]+','','i'),'^(/api)?/media/','')=$1))"
                    ).bind(relative).bind(claims.profile_id).fetch_one(pool).await?;
                    if !owned {
                        return Err(AppError::Forbidden);
                    }
                }
            }
        }
    }
    let statement = format!(
        "SELECT EXISTS(SELECT 1 FROM materiales_material m WHERE NOT {} AND \
         ((NULLIF($1::text,'') IS NOT NULL AND m.archivo_path=$1) OR \
          (regexp_replace(split_part($2::text,'?',1),'^https?://[^/]+','','i') ~ '^(/api)?/media/uploads/' AND \
           regexp_replace(regexp_replace(split_part(m.archivo_url,'?',1),'^https?://[^/]+','','i'),'^(/api)?/media/','')= \
           regexp_replace(regexp_replace(split_part($2,'?',1),'^https?://[^/]+','','i'),'^(/api)?/media/','')))) \
         OR EXISTS(SELECT 1 FROM examenes_archivoexamen a WHERE NOT {} AND \
         ((NULLIF($1::text,'') IS NOT NULL AND a.archivo_path=$1) OR \
          (regexp_replace(split_part($2::text,'?',1),'^https?://[^/]+','','i') ~ '^(/api)?/media/uploads/' AND \
           regexp_replace(regexp_replace(split_part(a.archivo_url,'?',1),'^https?://[^/]+','','i'),'^(/api)?/media/','')= \
           regexp_replace(regexp_replace(split_part($2,'?',1),'^https?://[^/]+','','i'),'^(/api)?/media/',''))))",
        crate::academic_scope::resource_scope("m", "subido_por_id", 3, 4),
        crate::academic_scope::resource_scope("a", "subido_por_id", 3, 4)
    );
    let foreign: bool = sqlx::query_scalar(&statement)
        .bind(path)
        .bind(url)
        .bind(&claims.role)
        .bind(claims.profile_id)
        .fetch_one(pool)
        .await?;
    if foreign {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

fn staff(state: &AppState, headers: &HeaderMap) -> Result<Claims, AppError> {
    let claims = authenticate(state, headers, "access")?;
    require_role(&claims, &["admin", "instructor"])?;
    Ok(claims)
}
async fn ensure_assigned_student(
    state: &AppState,
    claims: &Claims,
    student: Uuid,
) -> Result<(), AppError> {
    if claims.role == "admin" {
        return Ok(());
    }
    let allowed: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM accounts_userprofile WHERE id=$1 AND assigned_instructor_id=$2)")
        .bind(student).bind(claims.profile_id).fetch_one(pool(state)?).await?;
    allowed.then_some(()).ok_or(AppError::Forbidden)
}
fn pool(state: &AppState) -> Result<&PgPool, AppError> {
    state.pool.as_ref().ok_or(AppError::Unavailable)
}
fn limit(value: Option<i64>) -> i64 {
    value.unwrap_or(10_000).clamp(1, 10_000)
}
async fn delete(pool: &PgPool, table: &str, id: Uuid) -> Result<(), AppError> {
    let sql = match table {
        "materiales_material" => "DELETE FROM materiales_material WHERE id = $1",
        "materiales_publicacionboe" => "DELETE FROM materiales_publicacionboe WHERE id = $1",
        _ => return Err(AppError::Internal),
    };
    if sqlx::query(sql)
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected()
        == 0
    {
        return Err(AppError::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_url;
    #[test]
    fn rejects_active_url_schemes() {
        assert!(validate_url("javascript:alert(1)").is_err());
        assert!(validate_url("/media/file.pdf").is_ok());
        assert!(validate_url("/api/media/uploads/file.pdf").is_ok());
    }
}
