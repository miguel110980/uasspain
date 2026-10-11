use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::{
    AppState,
    auth::{Claims, authenticate, require_role},
    error::AppError,
};

#[derive(Debug, Deserialize)]
pub struct ExamWrite {
    nombre: Option<String>,
    categoria: Option<String>,
    descripcion: Option<String>,
    activo: Option<bool>,
    num_preguntas: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct PracticalQuery {
    alumno_id: Option<Uuid>,
    limit: Option<i64>,
}
#[derive(Debug, Deserialize)]
pub struct PracticalWrite {
    alumno_id: Uuid,
    categoria: Option<String>,
    nota: f64,
    aprobado: Option<bool>,
    observaciones: Option<String>,
    fecha: Option<DateTime<Utc>>,
}
#[derive(Debug, Deserialize)]
pub struct PracticalUpdate {
    categoria: Option<String>,
    nota: Option<f64>,
    aprobado: Option<bool>,
    observaciones: Option<String>,
    fecha: Option<DateTime<Utc>>,
}
#[derive(Debug, FromRow, Serialize)]
pub struct PracticalRecord {
    id: Uuid,
    alumno_id: Uuid,
    instructor_id: Option<Uuid>,
    alumno_nombre: String,
    instructor_nombre: String,
    categoria: String,
    nota: f64,
    aprobado: bool,
    observaciones: String,
    fecha: Option<DateTime<Utc>>,
    created_date: DateTime<Utc>,
}

pub async fn list_practical(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<PracticalQuery>,
) -> Result<Json<Vec<PracticalRecord>>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let limit = query.limit.unwrap_or(200).clamp(1, 500);
    let rows=match claims.role.as_str(){"alumno"=>sqlx::query_as::<_,PracticalRecord>("SELECT id,alumno_id,instructor_id,alumno_nombre,instructor_nombre,categoria,nota::float8 AS nota,aprobado,observaciones,fecha,created_date FROM examenes_resultadopractico WHERE alumno_id=$1 ORDER BY fecha DESC NULLS LAST,created_date DESC LIMIT $2").bind(claims.profile_id).bind(limit).fetch_all(pool(&state)?).await?,"instructor"=>sqlx::query_as::<_,PracticalRecord>("SELECT r.id,r.alumno_id,r.instructor_id,r.alumno_nombre,r.instructor_nombre,r.categoria,r.nota::float8 AS nota,r.aprobado,r.observaciones,r.fecha,r.created_date FROM examenes_resultadopractico r JOIN accounts_userprofile p ON p.id=r.alumno_id WHERE p.assigned_instructor_id=$1 AND ($2::uuid IS NULL OR r.alumno_id=$2) ORDER BY r.fecha DESC NULLS LAST,r.created_date DESC LIMIT $3").bind(claims.profile_id).bind(query.alumno_id).bind(limit).fetch_all(pool(&state)?).await?,"admin"=>sqlx::query_as::<_,PracticalRecord>("SELECT id,alumno_id,instructor_id,alumno_nombre,instructor_nombre,categoria,nota::float8 AS nota,aprobado,observaciones,fecha,created_date FROM examenes_resultadopractico WHERE ($1::uuid IS NULL OR alumno_id=$1) ORDER BY fecha DESC NULLS LAST,created_date DESC LIMIT $2").bind(query.alumno_id).bind(limit).fetch_all(pool(&state)?).await?,_=>return Err(AppError::Forbidden)};
    Ok(Json(rows))
}

pub async fn create_practical(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<PracticalWrite>,
) -> Result<(StatusCode, Json<PracticalRecord>), AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin", "instructor"])?;
    if !input.nota.is_finite() || !(0.0..=10.0).contains(&input.nota) {
        return Err(AppError::Validation("Nota fuera de rango.".into()));
    }
    let assigned: Option<Uuid> = sqlx::query_scalar(
        "SELECT assigned_instructor_id FROM accounts_userprofile WHERE id=$1 AND (role='alumno' OR roles ? 'alumno')",
    )
    .bind(input.alumno_id)
    .fetch_optional(pool(&state)?)
    .await?
    .flatten();
    if claims.role == "instructor" && assigned != Some(claims.profile_id) {
        return Err(AppError::Forbidden);
    }
    let names:Option<(String,String,String,String)>=sqlx::query_as("SELECT a.nombre,a.apellidos,i.nombre,i.apellidos FROM accounts_userprofile a LEFT JOIN accounts_userprofile i ON i.id=$2 WHERE a.id=$1").bind(input.alumno_id).bind(claims.profile_id).fetch_optional(pool(&state)?).await?;
    let (an, aa, insn, insa) = names.ok_or(AppError::NotFound)?;
    let alumno = format!(
        "{} {}",
        state.cipher.decrypt(&an)?,
        state.cipher.decrypt(&aa)?
    )
    .trim()
    .to_owned();
    let instructor = format!(
        "{} {}",
        state.cipher.decrypt(&insn)?,
        state.cipher.decrypt(&insa)?
    )
    .trim()
    .to_owned();
    let categoria = input.categoria.unwrap_or_default();
    if categoria.len() > 50
        || input
            .observaciones
            .as_deref()
            .is_some_and(|v| v.len() > 10000)
    {
        return Err(AppError::Validation("Datos no válidos.".into()));
    }
    let row=sqlx::query_as::<_,PracticalRecord>("INSERT INTO examenes_resultadopractico (id,created_date,updated_date,alumno_id,instructor_id,alumno_nombre,instructor_nombre,categoria,nota,aprobado,observaciones,fecha) VALUES ($1,NOW(),NOW(),$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,NOW())) RETURNING id,alumno_id,instructor_id,alumno_nombre,instructor_nombre,categoria,nota::float8 AS nota,aprobado,observaciones,fecha,created_date").bind(Uuid::new_v4()).bind(input.alumno_id).bind(claims.profile_id).bind(alumno).bind(instructor).bind(categoria).bind(input.nota).bind(input.aprobado.unwrap_or(input.nota>=5.0)).bind(input.observaciones.unwrap_or_default()).bind(input.fecha).fetch_one(pool(&state)?).await?;
    Ok((StatusCode::CREATED, Json(row)))
}

pub async fn update_practical(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<PracticalUpdate>,
) -> Result<Json<PracticalRecord>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin", "instructor"])?;
    if input
        .nota
        .is_some_and(|nota| !nota.is_finite() || !(0.0..=10.0).contains(&nota))
        || input.categoria.as_deref().is_some_and(|v| v.len() > 50)
        || input
            .observaciones
            .as_deref()
            .is_some_and(|v| v.len() > 10_000)
    {
        return Err(AppError::Validation("Datos no válidos.".into()));
    }
    let owner: Option<Option<Uuid>> =
        sqlx::query_scalar("SELECT instructor_id FROM examenes_resultadopractico WHERE id=$1")
            .bind(id)
            .fetch_optional(pool(&state)?)
            .await?;
    let owner = owner.ok_or(AppError::NotFound)?;
    if claims.role == "instructor" && owner != Some(claims.profile_id) {
        return Err(AppError::Forbidden);
    }
    let row = sqlx::query_as::<_, PracticalRecord>(
        "UPDATE examenes_resultadopractico SET categoria=COALESCE($2,categoria),nota=COALESCE($3,nota),aprobado=COALESCE($4,aprobado),observaciones=COALESCE($5,observaciones),fecha=COALESCE($6,fecha),updated_date=NOW() WHERE id=$1 RETURNING id,alumno_id,instructor_id,alumno_nombre,instructor_nombre,categoria,nota::float8 AS nota,aprobado,observaciones,fecha,created_date",
    )
    .bind(id)
    .bind(input.categoria)
    .bind(input.nota)
    .bind(input.aprobado.or_else(|| input.nota.map(|nota| nota >= 5.0)))
    .bind(input.observaciones)
    .bind(input.fecha)
    .fetch_one(pool(&state)?)
    .await?;
    Ok(Json(row))
}

pub async fn delete_practical(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin", "instructor"])?;
    let result = if claims.role == "admin" {
        sqlx::query("DELETE FROM examenes_resultadopractico WHERE id=$1")
            .bind(id)
            .execute(pool(&state)?)
            .await?
    } else {
        sqlx::query("DELETE FROM examenes_resultadopractico WHERE id=$1 AND instructor_id=$2")
            .bind(id)
            .bind(claims.profile_id)
            .execute(pool(&state)?)
            .await?
    };
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, FromRow, Serialize)]
pub struct ExamRecord {
    id: Uuid,
    nombre: String,
    categoria: String,
    descripcion: String,
    activo: bool,
    num_preguntas: i32,
    created_date: DateTime<Utc>,
    updated_date: DateTime<Utc>,
}

pub async fn create_exam(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<ExamWrite>,
) -> Result<(StatusCode, Json<ExamRecord>), AppError> {
    let claims = staff(&state, &headers)?;
    let nombre = required_text(input.nombre, "Nombre obligatorio.", 255)?;
    let categoria = optional_text(input.categoria, 50)?;
    let descripcion = input.descripcion.unwrap_or_default();
    let count = positive_i32(input.num_preguntas.unwrap_or(0), "NÃºmero de preguntas")?;
    let pool = pool(&state)?;
    let row = sqlx::query_as::<_, ExamRecord>(
        "INSERT INTO examenes_examen (id, created_date, updated_date, nombre, categoria, \
         descripcion, activo, num_preguntas, creado_por_id) \
         VALUES ($1, NOW(), NOW(), $2, $3, $4, $5, $6, $7) \
         RETURNING id, nombre, categoria, descripcion, activo, num_preguntas::integer, \
         created_date, updated_date",
    )
    .bind(Uuid::new_v4())
    .bind(nombre)
    .bind(categoria)
    .bind(descripcion)
    .bind(input.activo.unwrap_or(true))
    .bind(count)
    .bind(claims.profile_id)
    .fetch_one(pool)
    .await?;
    Ok((StatusCode::CREATED, Json(row)))
}

pub async fn update_exam(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<ExamWrite>,
) -> Result<Json<ExamRecord>, AppError> {
    let claims = staff(&state, &headers)?;
    crate::academic_scope::staff_resource(pool(&state)?, &claims, "examen", id, false).await?;
    let has_nombre = input.nombre.is_some();
    let has_categoria = input.categoria.is_some();
    let nombre = optional_text(input.nombre, 255)?;
    let categoria = optional_text(input.categoria, 50)?;
    let count = input
        .num_preguntas
        .map(|value| positive_i32(value, "NÃºmero de preguntas"))
        .transpose()?;
    let row = sqlx::query_as::<_, ExamRecord>(
        "UPDATE examenes_examen SET \
         nombre = CASE WHEN $2 THEN $3 ELSE nombre END, \
         categoria = CASE WHEN $4 THEN $5 ELSE categoria END, \
         descripcion = CASE WHEN $6 THEN $7 ELSE descripcion END, \
         activo = CASE WHEN $8 THEN $9 ELSE activo END, \
         num_preguntas = CASE WHEN $10 THEN $11 ELSE num_preguntas END, updated_date = NOW() \
         WHERE id = $1 RETURNING id, nombre, categoria, descripcion, activo, \
         num_preguntas::integer, created_date, updated_date",
    )
    .bind(id)
    .bind(has_nombre)
    .bind(nombre)
    .bind(has_categoria)
    .bind(categoria)
    .bind(input.descripcion.is_some())
    .bind(input.descripcion.unwrap_or_default())
    .bind(input.activo.is_some())
    .bind(input.activo.unwrap_or(false))
    .bind(count.is_some())
    .bind(count.unwrap_or_default())
    .fetch_optional(pool(&state)?)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

pub async fn delete_exam(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let claims = staff(&state, &headers)?;
    crate::academic_scope::staff_resource(pool(&state)?, &claims, "examen", id, false).await?;
    delete_by_id(pool(&state)?, "examenes_examen", id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct QuestionWrite {
    examen_id: Option<Uuid>,
    enunciado: Option<String>,
    opcion_a: Option<String>,
    opcion_b: Option<String>,
    opcion_c: Option<String>,
    opcion_d: Option<String>,
    respuesta_correcta: Option<String>,
    orden: Option<u32>,
    imagen_url: Option<String>,
}

#[derive(Debug, FromRow, Serialize)]
pub struct QuestionRecord {
    id: Uuid,
    examen_id: Uuid,
    enunciado: String,
    opcion_a: String,
    opcion_b: String,
    opcion_c: String,
    opcion_d: String,
    respuesta_correcta: String,
    orden: i32,
    imagen_url: String,
    created_date: DateTime<Utc>,
}

pub async fn create_question(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<QuestionWrite>,
) -> Result<(StatusCode, Json<QuestionRecord>), AppError> {
    let claims = staff(&state, &headers)?;
    let exam_id = input
        .examen_id
        .ok_or_else(|| AppError::Validation("El examen es obligatorio.".to_owned()))?;
    crate::academic_scope::staff_resource(pool(&state)?, &claims, "examen", exam_id, false).await?;
    let statement = required_text(input.enunciado, "Enunciado obligatorio.", 10_000)?;
    let correct = answer_letter(input.respuesta_correcta.as_deref())?;
    let row = sqlx::query_as::<_, QuestionRecord>(
        "INSERT INTO examenes_pregunta (id, created_date, updated_date, examen_id, \
         enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, orden, imagen_url) \
         VALUES ($1, NOW(), NOW(), $2, $3, $4, $5, $6, $7, $8, $9, $10) \
         RETURNING id, examen_id, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, \
         respuesta_correcta, orden::integer, imagen_url, created_date",
    )
    .bind(Uuid::new_v4())
    .bind(exam_id)
    .bind(statement)
    .bind(input.opcion_a.unwrap_or_default())
    .bind(input.opcion_b.unwrap_or_default())
    .bind(input.opcion_c.unwrap_or_default())
    .bind(input.opcion_d.unwrap_or_default())
    .bind(correct)
    .bind(positive_i32(input.orden.unwrap_or(0), "Orden")?)
    .bind(optional_url(input.imagen_url)?)
    .fetch_one(pool(&state)?)
    .await?;
    Ok((StatusCode::CREATED, Json(row)))
}

pub async fn update_question(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<QuestionWrite>,
) -> Result<Json<QuestionRecord>, AppError> {
    let claims = staff(&state, &headers)?;
    let exam_id: Uuid = sqlx::query_scalar("SELECT examen_id FROM examenes_pregunta WHERE id=$1")
        .bind(id)
        .fetch_optional(pool(&state)?)
        .await?
        .ok_or(AppError::NotFound)?;
    crate::academic_scope::staff_resource(pool(&state)?, &claims, "examen", exam_id, false).await?;
    if let Some(target) = input.examen_id {
        crate::academic_scope::staff_resource(pool(&state)?, &claims, "examen", target, false)
            .await?;
    }
    let statement = input
        .enunciado
        .map(|value| required_text(Some(value), "Enunciado obligatorio.", 10_000))
        .transpose()?;
    let correct = input
        .respuesta_correcta
        .as_deref()
        .map(|value| answer_letter(Some(value)))
        .transpose()?;
    let order = input
        .orden
        .map(|value| positive_i32(value, "Orden"))
        .transpose()?;
    let image = input
        .imagen_url
        .map(|value| optional_url(Some(value)))
        .transpose()?;
    let row = sqlx::query_as::<_, QuestionRecord>(
        "UPDATE examenes_pregunta SET \
         examen_id = CASE WHEN $2 THEN $3 ELSE examen_id END, \
         enunciado = CASE WHEN $4 THEN $5 ELSE enunciado END, \
         opcion_a = CASE WHEN $6 THEN $7 ELSE opcion_a END, \
         opcion_b = CASE WHEN $8 THEN $9 ELSE opcion_b END, \
         opcion_c = CASE WHEN $10 THEN $11 ELSE opcion_c END, \
         opcion_d = CASE WHEN $12 THEN $13 ELSE opcion_d END, \
         respuesta_correcta = CASE WHEN $14 THEN $15 ELSE respuesta_correcta END, \
         orden = CASE WHEN $16 THEN $17 ELSE orden END, \
         imagen_url = CASE WHEN $18 THEN $19 ELSE imagen_url END, updated_date = NOW() \
         WHERE id = $1 RETURNING id, examen_id, enunciado, opcion_a, opcion_b, opcion_c, \
         opcion_d, respuesta_correcta, orden::integer, imagen_url, created_date",
    )
    .bind(id)
    .bind(input.examen_id.is_some())
    .bind(input.examen_id.unwrap_or(Uuid::nil()))
    .bind(statement.is_some())
    .bind(statement.unwrap_or_default())
    .bind(input.opcion_a.is_some())
    .bind(input.opcion_a.unwrap_or_default())
    .bind(input.opcion_b.is_some())
    .bind(input.opcion_b.unwrap_or_default())
    .bind(input.opcion_c.is_some())
    .bind(input.opcion_c.unwrap_or_default())
    .bind(input.opcion_d.is_some())
    .bind(input.opcion_d.unwrap_or_default())
    .bind(correct.is_some())
    .bind(correct.unwrap_or_default())
    .bind(order.is_some())
    .bind(order.unwrap_or_default())
    .bind(image.is_some())
    .bind(image.unwrap_or_default())
    .fetch_optional(pool(&state)?)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

pub async fn delete_question(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let claims = staff(&state, &headers)?;
    let exam_id: Uuid = sqlx::query_scalar("SELECT examen_id FROM examenes_pregunta WHERE id=$1")
        .bind(id)
        .fetch_optional(pool(&state)?)
        .await?
        .ok_or(AppError::NotFound)?;
    crate::academic_scope::staff_resource(pool(&state)?, &claims, "examen", exam_id, false).await?;
    delete_by_id(pool(&state)?, "examenes_pregunta", id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct BlockQuery {
    alumno_id: Option<Uuid>,
    examen_id: Option<Uuid>,
    categoria: Option<String>,
    bloqueado: Option<bool>,
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct BlockWrite {
    alumno_id: Option<Uuid>,
    examen_id: Option<Uuid>,
    categoria: Option<String>,
    motivo: Option<String>,
    bloqueado: Option<bool>,
    fecha_inicio: Option<DateTime<Utc>>,
    fecha_fin: Option<DateTime<Utc>>,
}

#[derive(Debug, FromRow, Serialize)]
pub struct BlockRecord {
    id: Uuid,
    alumno_id: Uuid,
    examen_id: Option<Uuid>,
    categoria: String,
    motivo: String,
    bloqueado: bool,
    fecha_inicio: Option<DateTime<Utc>>,
    fecha_fin: Option<DateTime<Utc>>,
    created_date: DateTime<Utc>,
}

pub async fn list_blocks(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<BlockQuery>,
) -> Result<Json<Vec<BlockRecord>>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let rows = sqlx::query_as::<_, BlockRecord>(
        "SELECT b.id, b.alumno_id, b.examen_id, b.categoria, b.motivo, b.bloqueado, \
         b.fecha_inicio, b.fecha_fin, b.created_date FROM examenes_bloqueoexamen b \
         LEFT JOIN accounts_userprofile p ON p.id = b.alumno_id \
         WHERE ($1::text = 'admin' OR ($1 = 'alumno' AND b.alumno_id = $2) OR \
                ($1 = 'instructor' AND p.assigned_instructor_id = $2)) \
           AND ($3::uuid IS NULL OR b.alumno_id = $3) \
           AND ($4::uuid IS NULL OR b.examen_id = $4) \
           AND ($5::text IS NULL OR b.categoria = $5) \
           AND ($6::boolean IS NULL OR b.bloqueado = $6) \
         ORDER BY b.created_date DESC LIMIT $7",
    )
    .bind(&claims.role)
    .bind(claims.profile_id)
    .bind(query.alumno_id)
    .bind(query.examen_id)
    .bind(query.categoria.as_deref())
    .bind(query.bloqueado)
    .bind(query.limit.unwrap_or(10_000).clamp(1, 10_000))
    .fetch_all(pool(&state)?)
    .await?;
    Ok(Json(rows))
}

pub async fn create_block(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<BlockWrite>,
) -> Result<(StatusCode, Json<BlockRecord>), AppError> {
    let claims = staff(&state, &headers)?;
    let student = input
        .alumno_id
        .ok_or_else(|| AppError::Validation("Alumno obligatorio.".to_owned()))?;
    ensure_assigned_student(pool(&state)?, &claims, student).await?;
    if let Some(exam_id) = input.examen_id {
        crate::academic_scope::staff_resource(pool(&state)?, &claims, "examen", exam_id, false)
            .await?;
    }
    let row = sqlx::query_as::<_, BlockRecord>(
        "INSERT INTO examenes_bloqueoexamen (id, created_date, updated_date, alumno_id, \
         examen_id, categoria, motivo, bloqueado, fecha_inicio, fecha_fin, creado_por_id) \
         VALUES ($1, NOW(), NOW(), $2, $3, $4, $5, $6, $7, $8, $9) \
         RETURNING id, alumno_id, examen_id, categoria, motivo, bloqueado, fecha_inicio, \
         fecha_fin, created_date",
    )
    .bind(Uuid::new_v4())
    .bind(student)
    .bind(input.examen_id)
    .bind(optional_text(input.categoria, 50)?)
    .bind(input.motivo.unwrap_or_default())
    .bind(input.bloqueado.unwrap_or(true))
    .bind(input.fecha_inicio)
    .bind(input.fecha_fin)
    .bind(claims.profile_id)
    .fetch_one(pool(&state)?)
    .await?;
    Ok((StatusCode::CREATED, Json(row)))
}

pub async fn update_block(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<BlockWrite>,
) -> Result<Json<BlockRecord>, AppError> {
    let claims = staff(&state, &headers)?;
    ensure_block_scope(pool(&state)?, &claims, id).await?;
    if let Some(exam_id) = input.examen_id {
        crate::academic_scope::staff_resource(pool(&state)?, &claims, "examen", exam_id, false)
            .await?;
    }
    let has_categoria = input.categoria.is_some();
    let categoria = optional_text(input.categoria, 50)?;
    let row = sqlx::query_as::<_, BlockRecord>(
        "UPDATE examenes_bloqueoexamen SET \
         examen_id = CASE WHEN $2 THEN $3 ELSE examen_id END, \
         categoria = CASE WHEN $4 THEN $5 ELSE categoria END, \
         motivo = CASE WHEN $6 THEN $7 ELSE motivo END, \
         bloqueado = CASE WHEN $8 THEN $9 ELSE bloqueado END, \
         fecha_inicio = COALESCE($10, fecha_inicio), fecha_fin = COALESCE($11, fecha_fin), \
         updated_date = NOW() WHERE id = $1 \
         RETURNING id, alumno_id, examen_id, categoria, motivo, bloqueado, fecha_inicio, \
         fecha_fin, created_date",
    )
    .bind(id)
    .bind(input.examen_id.is_some())
    .bind(input.examen_id)
    .bind(has_categoria)
    .bind(categoria)
    .bind(input.motivo.is_some())
    .bind(input.motivo.unwrap_or_default())
    .bind(input.bloqueado.is_some())
    .bind(input.bloqueado.unwrap_or(false))
    .bind(input.fecha_inicio)
    .bind(input.fecha_fin)
    .fetch_optional(pool(&state)?)
    .await?
    .ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

pub async fn delete_block(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let claims = staff(&state, &headers)?;
    ensure_block_scope(pool(&state)?, &claims, id).await?;
    delete_by_id(pool(&state)?, "examenes_bloqueoexamen", id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct ArchiveQuery {
    categoria: Option<String>,
    examen_id: Option<String>,
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ArchiveWrite {
    examen_id: Option<String>,
    nombre_archivo: Option<String>,
    archivo_url: Option<String>,
    descripcion: Option<String>,
    categoria: Option<String>,
    num_examenes: Option<u32>,
}

#[derive(Debug, FromRow, Serialize)]
pub struct ArchiveRecord {
    id: Uuid,
    examen_id: String,
    nombre_archivo: String,
    archivo_url: String,
    archivo_path: String,
    archivo_content_type: String,
    archivo_tamano: Option<i64>,
    archivo_sha256: String,
    descripcion: String,
    categoria: String,
    num_examenes: i32,
    created_date: DateTime<Utc>,
    updated_date: DateTime<Utc>,
}

pub async fn list_archives(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<ArchiveQuery>,
) -> Result<Json<Vec<ArchiveRecord>>, AppError> {
    let claims = staff(&state, &headers)?;
    let statement = format!(
        "SELECT id, examen_id, nombre_archivo, archivo_url, archivo_path, \
         archivo_content_type, archivo_tamano::bigint, archivo_sha256, descripcion, \
         categoria, num_examenes::integer, created_date, updated_date \
         FROM examenes_archivoexamen a WHERE ($1::text IS NULL OR categoria = $1) \
           AND ($2::text IS NULL OR examen_id = $2) AND {} ORDER BY created_date DESC LIMIT $3",
        crate::academic_scope::resource_scope("a", "subido_por_id", 4, 5)
    );
    let rows = sqlx::query_as::<_, ArchiveRecord>(&statement)
        .bind(query.categoria.as_deref())
        .bind(query.examen_id.as_deref())
        .bind(query.limit.unwrap_or(10_000).clamp(1, 10_000))
        .bind(&claims.role)
        .bind(claims.profile_id)
        .fetch_all(pool(&state)?)
        .await?;
    Ok(Json(rows))
}

pub async fn create_archive(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<ArchiveWrite>,
) -> Result<(StatusCode, Json<ArchiveRecord>), AppError> {
    let claims = staff(&state, &headers)?;
    let name = required_text(input.nombre_archivo, "Nombre de archivo obligatorio.", 255)?;
    let exam_ids = optional_text(input.examen_id, 500)?;
    let url = optional_url(input.archivo_url)?;
    crate::materials::ensure_file_scope(pool(&state)?, &claims, "", &url).await?;
    let description = optional_text(input.descripcion, 10_000)?;
    let category = optional_text(input.categoria, 50)?;
    let count = positive_i32(input.num_examenes.unwrap_or(0), "Número de exámenes")?;
    let row = sqlx::query_as::<_,ArchiveRecord>("INSERT INTO examenes_archivoexamen (id,created_date,updated_date,examen_id,nombre_archivo,archivo_url,archivo_path,archivo_content_type,archivo_tamano,archivo_sha256,descripcion,categoria,num_examenes,subido_por_id) VALUES ($1,NOW(),NOW(),$2,$3,$4,'','',NULL,'',$5,$6,$7,$8) RETURNING id,examen_id,nombre_archivo,archivo_url,archivo_path,archivo_content_type,archivo_tamano::bigint,archivo_sha256,descripcion,categoria,num_examenes::integer,created_date,updated_date")
        .bind(Uuid::new_v4()).bind(exam_ids).bind(name).bind(url).bind(description).bind(category).bind(count).bind(claims.profile_id).fetch_one(pool(&state)?).await?;
    Ok((StatusCode::CREATED, Json(row)))
}

pub async fn archive_detail(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<ArchiveRecord>, AppError> {
    let claims = staff(&state, &headers)?;
    ensure_archive_scope(pool(&state)?, &claims, id).await?;
    let row=sqlx::query_as::<_,ArchiveRecord>("SELECT id,examen_id,nombre_archivo,archivo_url,archivo_path,archivo_content_type,archivo_tamano::bigint,archivo_sha256,descripcion,categoria,num_examenes::integer,created_date,updated_date FROM examenes_archivoexamen WHERE id=$1").bind(id).fetch_optional(pool(&state)?).await?.ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

pub async fn update_archive(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<ArchiveWrite>,
) -> Result<Json<ArchiveRecord>, AppError> {
    let claims = staff(&state, &headers)?;
    ensure_archive_scope(pool(&state)?, &claims, id).await?;
    if let Some(url) = input.archivo_url.as_deref() {
        crate::materials::ensure_file_scope(pool(&state)?, &claims, "", url).await?;
    }
    let name = input
        .nombre_archivo
        .map(|v| required_text(Some(v), "Nombre de archivo obligatorio.", 255))
        .transpose()?;
    let exam_ids = input
        .examen_id
        .map(|v| optional_text(Some(v), 500))
        .transpose()?;
    let url = input
        .archivo_url
        .map(|v| optional_url(Some(v)))
        .transpose()?;
    let description = input
        .descripcion
        .map(|v| optional_text(Some(v), 10_000))
        .transpose()?;
    let category = input
        .categoria
        .map(|v| optional_text(Some(v), 50))
        .transpose()?;
    let count = input
        .num_examenes
        .map(|v| positive_i32(v, "Número de exámenes"))
        .transpose()?;
    let row=sqlx::query_as::<_,ArchiveRecord>("UPDATE examenes_archivoexamen SET examen_id=COALESCE($2,examen_id),nombre_archivo=COALESCE($3,nombre_archivo),archivo_url=COALESCE($4,archivo_url),descripcion=COALESCE($5,descripcion),categoria=COALESCE($6,categoria),num_examenes=COALESCE($7,num_examenes),updated_date=NOW() WHERE id=$1 RETURNING id,examen_id,nombre_archivo,archivo_url,archivo_path,archivo_content_type,archivo_tamano::bigint,archivo_sha256,descripcion,categoria,num_examenes::integer,created_date,updated_date").bind(id).bind(exam_ids).bind(name).bind(url).bind(description).bind(category).bind(count).fetch_optional(pool(&state)?).await?.ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

pub async fn delete_archive(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let claims = staff(&state, &headers)?;
    ensure_archive_scope(pool(&state)?, &claims, id).await?;
    delete_by_id(pool(&state)?, "examenes_archivoexamen", id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct DeleteManyRequest {
    query: Option<Value>,
}

pub async fn delete_results_many(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<DeleteManyRequest>,
) -> Result<Json<Value>, AppError> {
    let claims = staff(&state, &headers)?;
    let student = query_uuid(input.query.as_ref(), "alumno_id")?;
    let exam = query_uuid(input.query.as_ref(), "examen_id")?;
    if student.is_none() && exam.is_none() {
        return Err(AppError::Validation(
            "El borrado requiere alumno_id o examen_id.".to_owned(),
        ));
    }
    let result = sqlx::query(
        "DELETE FROM examenes_resultadoexamen r USING accounts_userprofile p \
         WHERE p.id=r.alumno_id AND ($3='admin' OR p.assigned_instructor_id=$4) \
         AND ($1::uuid IS NULL OR r.alumno_id = $1) AND ($2::uuid IS NULL OR r.examen_id = $2)",
    )
    .bind(student)
    .bind(exam)
    .bind(&claims.role)
    .bind(claims.profile_id)
    .execute(pool(&state)?)
    .await?;
    Ok(Json(json!({"deleted": result.rows_affected()})))
}

pub async fn delete_blocks_many(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<DeleteManyRequest>,
) -> Result<Json<Value>, AppError> {
    let claims = staff(&state, &headers)?;
    let student = query_uuid(input.query.as_ref(), "alumno_id")?;
    let exam = query_uuid(input.query.as_ref(), "examen_id")?;
    if student.is_none() && exam.is_none() {
        return Err(AppError::Validation(
            "El borrado requiere alumno_id o examen_id.".to_owned(),
        ));
    }
    let result = sqlx::query(
        "DELETE FROM examenes_bloqueoexamen b USING accounts_userprofile p \
         WHERE p.id=b.alumno_id AND ($3='admin' OR p.assigned_instructor_id=$4) \
         AND ($1::uuid IS NULL OR b.alumno_id = $1) AND ($2::uuid IS NULL OR b.examen_id = $2)",
    )
    .bind(student)
    .bind(exam)
    .bind(&claims.role)
    .bind(claims.profile_id)
    .execute(pool(&state)?)
    .await?;
    Ok(Json(json!({"deleted": result.rows_affected()})))
}

async fn ensure_archive_scope(pool: &PgPool, claims: &Claims, id: Uuid) -> Result<(), AppError> {
    let statement = format!(
        "SELECT a.id FROM examenes_archivoexamen a WHERE a.id=$1 AND {}",
        crate::academic_scope::resource_scope("a", "subido_por_id", 2, 3)
    );
    sqlx::query_scalar::<_, Uuid>(&statement)
        .bind(id)
        .bind(&claims.role)
        .bind(claims.profile_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(())
}

fn staff(state: &AppState, headers: &HeaderMap) -> Result<Claims, AppError> {
    let claims = authenticate(state, headers, "access")?;
    require_role(&claims, &["admin", "instructor"])?;
    Ok(claims)
}

fn pool(state: &AppState) -> Result<&PgPool, AppError> {
    state.pool.as_ref().ok_or(AppError::Unavailable)
}

fn required_text(value: Option<String>, message: &str, max: usize) -> Result<String, AppError> {
    let value = value.unwrap_or_default().trim().to_owned();
    if value.is_empty() || value.chars().count() > max {
        return Err(AppError::Validation(message.to_owned()));
    }
    Ok(value)
}

fn optional_text(value: Option<String>, max: usize) -> Result<String, AppError> {
    let value = value.unwrap_or_default().trim().to_owned();
    if value.chars().count() > max {
        return Err(AppError::Validation("Texto demasiado largo.".to_owned()));
    }
    Ok(value)
}

fn positive_i32(value: u32, label: &str) -> Result<i32, AppError> {
    i32::try_from(value).map_err(|_| AppError::Validation(format!("{label} no vÃ¡lido.")))
}

fn answer_letter(value: Option<&str>) -> Result<String, AppError> {
    let value = value.unwrap_or_default().trim().to_lowercase();
    if value.is_empty() || matches!(value.as_str(), "a" | "b" | "c" | "d") {
        Ok(value)
    } else {
        Err(AppError::Validation(
            "Respuesta correcta no vÃ¡lida.".to_owned(),
        ))
    }
}

fn optional_url(value: Option<String>) -> Result<String, AppError> {
    let value = value.unwrap_or_default().trim().to_owned();
    if value.len() > 500
        || (!value.is_empty()
            && !value.starts_with("/media/")
            && !value.starts_with("/api/media/")
            && !value.starts_with("https://")
            && !value.starts_with("http://"))
    {
        return Err(AppError::Validation("URL no vÃ¡lida.".to_owned()));
    }
    Ok(value)
}

async fn ensure_assigned_student(pool: &PgPool, claims: &Claims, id: Uuid) -> Result<(), AppError> {
    let valid: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM accounts_userprofile WHERE id = $1 AND \
         (role = 'alumno' OR roles @> '[\"alumno\"]'::jsonb) \
         AND ($2='admin' OR assigned_instructor_id=$3))",
    )
    .bind(id)
    .bind(&claims.role)
    .bind(claims.profile_id)
    .fetch_one(pool)
    .await?;
    if valid {
        Ok(())
    } else {
        Err(AppError::Validation("Alumno no vÃ¡lido.".to_owned()))
    }
}

async fn ensure_block_scope(pool: &PgPool, claims: &Claims, id: Uuid) -> Result<(), AppError> {
    let (student, exam): (Uuid, Option<Uuid>) =
        sqlx::query_as("SELECT alumno_id,examen_id FROM examenes_bloqueoexamen WHERE id=$1")
            .bind(id)
            .fetch_optional(pool)
            .await?
            .ok_or(AppError::NotFound)?;
    ensure_assigned_student(pool, claims, student).await?;
    if let Some(exam) = exam {
        crate::academic_scope::staff_resource(pool, claims, "examen", exam, false).await?;
    }
    Ok(())
}

async fn delete_by_id(pool: &PgPool, table: &str, id: Uuid) -> Result<(), AppError> {
    let sql = match table {
        "examenes_examen" => "DELETE FROM examenes_examen WHERE id = $1",
        "examenes_pregunta" => "DELETE FROM examenes_pregunta WHERE id = $1",
        "examenes_bloqueoexamen" => "DELETE FROM examenes_bloqueoexamen WHERE id = $1",
        "examenes_archivoexamen" => "DELETE FROM examenes_archivoexamen WHERE id = $1",
        _ => return Err(AppError::Internal),
    };
    let result = sqlx::query(sql).bind(id).execute(pool).await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

fn query_uuid(query: Option<&Value>, key: &str) -> Result<Option<Uuid>, AppError> {
    query
        .and_then(|value| value.get(key))
        .and_then(Value::as_str)
        .map(|value| {
            Uuid::parse_str(value).map_err(|_| AppError::Validation(format!("{key} no vÃ¡lido.")))
        })
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::{answer_letter, optional_url};

    #[test]
    fn correct_answer_is_limited_to_known_letters() {
        assert_eq!(answer_letter(Some(" A ")).unwrap(), "a");
        assert!(answer_letter(Some("x")).is_err());
    }

    #[test]
    fn media_url_rejects_active_schemes() {
        assert!(optional_url(Some("javascript:alert(1)".to_owned())).is_err());
        assert!(optional_url(Some("/media/question.png".to_owned())).is_ok());
    }
}
