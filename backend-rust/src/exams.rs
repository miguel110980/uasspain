use std::{collections::HashMap, sync::Arc};

use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
};
use chrono::{DateTime, Utc};
use rand::seq::SliceRandom;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use crate::{AppState, auth::authenticate, error::AppError};

#[derive(Debug, Deserialize)]
pub struct AnswerKey {
    pub question_id: Uuid,
    pub correct: String,
    pub answer: Option<String>,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct ExamScore {
    pub aciertos: u32,
    pub errores: u32,
    pub porcentaje: f64,
    pub nota: f64,
    pub aprobado: bool,
}

pub fn score(answers: &[AnswerKey]) -> Result<ExamScore, AppError> {
    if answers.is_empty() {
        return Err(AppError::Validation(
            "El examen no tiene preguntas.".to_owned(),
        ));
    }
    if answers.iter().any(|item| {
        !matches!(
            item.correct.to_ascii_lowercase().as_str(),
            "a" | "b" | "c" | "d"
        )
    }) {
        return Err(AppError::Validation(
            "El examen contiene una clave de respuestas no válida.".into(),
        ));
    }
    let aciertos = answers
        .iter()
        .filter(|item| {
            item.answer
                .as_deref()
                .is_some_and(|answer| answer.eq_ignore_ascii_case(&item.correct))
        })
        .count() as u32;
    let errores = answers
        .iter()
        .filter(|item| {
            item.answer.as_deref().is_some_and(|answer| {
                !answer.is_empty() && !answer.eq_ignore_ascii_case(&item.correct)
            })
        })
        .count() as u32;
    let porcentaje = f64::from(aciertos) * 100.0 / answers.len() as f64;
    let nota = (f64::from(aciertos) * 10.0 / answers.len() as f64 * 10.0).round() / 10.0;
    Ok(ExamScore {
        aciertos,
        errores,
        porcentaje: (porcentaje * 10.0).round() / 10.0,
        nota,
        aprobado: nota >= 7.0,
    })
}

#[derive(Debug, Deserialize)]
pub struct ExamQuery {
    categoria: Option<String>,
    activo: Option<bool>,
    nombre: Option<String>,
    limit: Option<i64>,
}

#[derive(Debug, FromRow, Serialize)]
pub struct ExamView {
    id: Uuid,
    nombre: String,
    categoria: String,
    descripcion: String,
    activo: bool,
    num_preguntas: i32,
    created_date: DateTime<Utc>,
    updated_date: DateTime<Utc>,
}

pub async fn list_exams(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<ExamQuery>,
) -> Result<Json<Vec<ExamView>>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let statement = format!(
        "SELECT e.id, e.nombre, e.categoria, e.descripcion, e.activo, \
         e.num_preguntas::integer, e.created_date, e.updated_date \
         FROM examenes_examen e \
         WHERE ($1::text IS NULL OR e.categoria = $1) \
           AND ($2::boolean IS NULL OR e.activo = $2) \
           AND ($3::text IS NULL OR e.nombre = $3) \
           AND {} AND {} ORDER BY e.categoria ASC, e.created_date DESC LIMIT $6",
        crate::academic_scope::resource_scope("e", "creado_por_id", 4, 5),
        crate::academic_scope::exam_access("e", 4, 5)
    );
    let rows = sqlx::query_as::<_, ExamView>(&statement)
        .bind(query.categoria.as_deref())
        .bind(query.activo)
        .bind(query.nombre.as_deref())
        .bind(&claims.role)
        .bind(claims.profile_id)
        .bind(safe_limit(query.limit))
        .fetch_all(pool)
        .await?;
    Ok(Json(rows))
}

pub async fn exam_detail(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<ExamView>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let statement = format!(
        "SELECT e.id, e.nombre, e.categoria, e.descripcion, e.activo, \
         e.num_preguntas::integer, e.created_date, e.updated_date \
         FROM examenes_examen e WHERE e.id = $1 \
           AND {} AND {}",
        crate::academic_scope::resource_scope("e", "creado_por_id", 2, 3),
        crate::academic_scope::exam_access("e", 2, 3)
    );
    let row = sqlx::query_as::<_, ExamView>(&statement)
        .bind(id)
        .bind(&claims.role)
        .bind(claims.profile_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

#[derive(Debug, Deserialize)]
pub struct QuestionQuery {
    examen_id: Option<Uuid>,
    examen: Option<Uuid>,
    limit: Option<i64>,
}

#[derive(Debug, FromRow, Serialize, Deserialize)]
struct QuestionRow {
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

#[derive(Debug, Serialize)]
pub struct QuestionView {
    id: Uuid,
    examen_id: Uuid,
    enunciado: String,
    opcion_a: String,
    opcion_b: String,
    opcion_c: String,
    opcion_d: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    respuesta_correcta: Option<String>,
    orden: i32,
    imagen_url: String,
    created_date: DateTime<Utc>,
}

pub async fn list_questions(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<QuestionQuery>,
) -> Result<Json<Vec<QuestionView>>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let exam_id = query.examen_id.or(query.examen);
    let statement = format!(
        "SELECT q.id, q.examen_id, q.enunciado, q.opcion_a, q.opcion_b, q.opcion_c, \
         q.opcion_d, q.respuesta_correcta, q.orden::integer, q.imagen_url, q.created_date \
         FROM examenes_pregunta q JOIN examenes_examen e ON e.id = q.examen_id \
         WHERE ($1::uuid IS NULL OR q.examen_id = $1) \
           AND {} AND {} ORDER BY q.orden ASC, q.created_date ASC LIMIT $4",
        crate::academic_scope::resource_scope("e", "creado_por_id", 2, 3),
        crate::academic_scope::exam_access("e", 2, 3)
    );
    let rows = sqlx::query_as::<_, QuestionRow>(&statement)
        .bind(exam_id)
        .bind(&claims.role)
        .bind(claims.profile_id)
        .bind(safe_limit(query.limit))
        .fetch_all(pool)
        .await?;
    let expose_answers = claims.role != "alumno";
    Ok(Json(
        rows.into_iter()
            .map(|row| QuestionView {
                id: row.id,
                examen_id: row.examen_id,
                enunciado: row.enunciado,
                opcion_a: row.opcion_a,
                opcion_b: row.opcion_b,
                opcion_c: row.opcion_c,
                opcion_d: row.opcion_d,
                respuesta_correcta: expose_answers.then_some(row.respuesta_correcta),
                orden: row.orden,
                imagen_url: row.imagen_url,
                created_date: row.created_date,
            })
            .collect(),
    ))
}

pub async fn question_detail(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<QuestionView>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let statement = format!(
        "SELECT q.id,q.examen_id,q.enunciado,q.opcion_a,q.opcion_b,q.opcion_c,q.opcion_d,q.respuesta_correcta,q.orden::integer,q.imagen_url,q.created_date FROM examenes_pregunta q JOIN examenes_examen e ON e.id=q.examen_id WHERE q.id=$1 AND {} AND {}",
        crate::academic_scope::resource_scope("e", "creado_por_id", 2, 3),
        crate::academic_scope::exam_access("e", 2, 3)
    );
    let row = sqlx::query_as::<_, QuestionRow>(&statement)
        .bind(id)
        .bind(&claims.role)
        .bind(claims.profile_id)
        .fetch_optional(state.pool.as_ref().ok_or(AppError::Unavailable)?)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(QuestionView {
        id: row.id,
        examen_id: row.examen_id,
        enunciado: row.enunciado,
        opcion_a: row.opcion_a,
        opcion_b: row.opcion_b,
        opcion_c: row.opcion_c,
        opcion_d: row.opcion_d,
        respuesta_correcta: (claims.role != "alumno").then_some(row.respuesta_correcta),
        orden: row.orden,
        imagen_url: row.imagen_url,
        created_date: row.created_date,
    }))
}

#[derive(Debug, Deserialize)]
pub struct ResultQuery {
    alumno_id: Option<Uuid>,
    examen_id: Option<Uuid>,
    categoria: Option<String>,
    aprobado: Option<bool>,
    limit: Option<i64>,
}

#[derive(Debug, FromRow, Serialize)]
pub struct ResultView {
    id: Uuid,
    alumno_id: Uuid,
    examen_id: Option<Uuid>,
    examen_nombre: String,
    categoria: String,
    modalidad: String,
    respuestas: Value,
    detalle_revision: Option<Value>,
    aciertos: i32,
    errores: i32,
    nota: f64,
    porcentaje: f64,
    tiempo_empleado: i32,
    aprobado: bool,
    fecha: Option<DateTime<Utc>>,
    created_date: DateTime<Utc>,
}

impl ResultView {
    fn for_role(mut self, role: &str) -> Self {
        // Keep the complete grading evidence at rest and for authorised staff.
        // A student's result, including retries and history, must not reveal
        // the solution bank for a subsequent attempt or another student.
        if !matches!(role, "admin" | "instructor")
            && let Some(revision) = &mut self.detalle_revision
        {
            redact_solution(revision);
        }
        self
    }
}

fn redact_solution(value: &mut Value) {
    match value {
        Value::Object(fields) => {
            fields.remove("respuesta_correcta");
            for child in fields.values_mut() {
                redact_solution(child);
            }
        }
        Value::Array(children) => {
            for child in children {
                redact_solution(child);
            }
        }
        _ => {}
    }
}

pub async fn list_results(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<ResultQuery>,
) -> Result<Json<Vec<ResultView>>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let rows = sqlx::query_as::<_, ResultView>(
        "SELECT r.id, r.alumno_id, r.examen_id, r.examen_nombre, r.categoria, r.modalidad, r.respuestas, \
         r.detalle_revision, r.aciertos::integer, r.errores::integer, \
         r.nota::float8 AS nota, r.porcentaje::float8 AS porcentaje, r.tiempo_empleado::integer, \
         r.aprobado, r.fecha, r.created_date FROM examenes_resultadoexamen r JOIN accounts_userprofile p ON p.id=r.alumno_id \
         WHERE ($1 = 'admin' OR ($1 = 'alumno' AND r.alumno_id = $2) OR ($1 = 'instructor' AND p.assigned_instructor_id=$2)) \
           AND ($3::uuid IS NULL OR r.alumno_id = $3) \
           AND ($4::uuid IS NULL OR r.examen_id = $4) \
           AND ($5::text IS NULL OR r.categoria = $5) \
           AND ($6::boolean IS NULL OR r.aprobado = $6) \
         ORDER BY r.fecha DESC NULLS LAST, r.created_date DESC LIMIT $7",
    )
    .bind(&claims.role)
    .bind(claims.profile_id)
    .bind(if claims.role == "alumno" {
        None
    } else {
        query.alumno_id
    })
    .bind(query.examen_id)
    .bind(query.categoria.as_deref())
    .bind(query.aprobado)
    .bind(safe_limit(query.limit))
    .fetch_all(pool)
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(|row| row.for_role(&claims.role))
            .collect(),
    ))
}

pub async fn result_detail(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<ResultView>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let row = sqlx::query_as::<_, ResultView>("SELECT r.id,r.alumno_id,r.examen_id,r.examen_nombre,r.categoria,r.modalidad,r.respuestas,r.detalle_revision,r.aciertos::integer,r.errores::integer,r.nota::float8 AS nota,r.porcentaje::float8 AS porcentaje,r.tiempo_empleado::integer,r.aprobado,r.fecha,r.created_date FROM examenes_resultadoexamen r JOIN accounts_userprofile p ON p.id=r.alumno_id WHERE r.id=$1 AND ($2='admin' OR ($2='alumno' AND r.alumno_id=$3) OR ($2='instructor' AND p.assigned_instructor_id=$3))")
        .bind(id).bind(&claims.role).bind(claims.profile_id).fetch_optional(state.pool.as_ref().ok_or(AppError::Unavailable)?).await?.ok_or(AppError::NotFound)?;
    Ok(Json(row.for_role(&claims.role)))
}

pub async fn delete_result(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    if claims.role == "alumno" {
        return Err(AppError::Forbidden);
    }
    let deleted = sqlx::query("DELETE FROM examenes_resultadoexamen r USING accounts_userprofile p WHERE r.id=$1 AND p.id=r.alumno_id AND ($2='admin' OR ($2='instructor' AND p.assigned_instructor_id=$3))")
        .bind(id).bind(&claims.role).bind(claims.profile_id).execute(state.pool.as_ref().ok_or(AppError::Unavailable)?).await?.rows_affected();
    if deleted == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct SubmitResult {
    examen_id: Uuid,
    attempt_id: Uuid,
    #[serde(default)]
    modalidad: String,
    respuestas: HashMap<String, Value>,
}

#[derive(Debug, Deserialize)]
pub struct StartAttempt {
    modalidad: String,
}

#[derive(Debug, FromRow)]
struct AttemptRow {
    id: Uuid,
    alumno_id: Uuid,
    examen_id: Uuid,
    modalidad: String,
    started_at: DateTime<Utc>,
    expires_at: Option<DateTime<Utc>>,
    preguntas: Value,
    respuestas: Value,
    submitted_at: Option<DateTime<Utc>>,
    result_id: Option<Uuid>,
}

fn attempt_view(row: AttemptRow, now: DateTime<Utc>) -> Result<Value, AppError> {
    let mut questions = row.preguntas;
    for question in questions.as_array_mut().ok_or(AppError::Internal)? {
        question
            .as_object_mut()
            .ok_or(AppError::Internal)?
            .remove("respuesta_correcta");
    }
    Ok(json!({
        "id": row.id, "examen_id": row.examen_id, "alumno_id": row.alumno_id,
        "modalidad": row.modalidad, "started_at": row.started_at,
        "expires_at": row.expires_at, "server_now": now,
        "preguntas": questions, "respuestas": row.respuestas,
    }))
}

pub async fn start_attempt(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(exam_id): Path<Uuid>,
    Json(input): Json<StartAttempt>,
) -> Result<Json<Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    if claims.role != "alumno" {
        return Err(AppError::Forbidden);
    }
    if !matches!(input.modalidad.as_str(), "libre" | "tiempo") {
        return Err(AppError::Validation("Modalidad no válida.".to_owned()));
    }
    let mut transaction = state
        .pool
        .as_ref()
        .ok_or(AppError::Unavailable)?
        .begin()
        .await?;
    // Serialize starts for this student, including concurrent tabs and retries.
    sqlx::query("SELECT id FROM accounts_userprofile WHERE id=$1 FOR UPDATE")
        .bind(claims.profile_id)
        .execute(&mut *transaction)
        .await?;
    let exam = fetch_submittable_exam(&mut transaction, claims.profile_id, exam_id).await?;
    let existing = sqlx::query_as::<_, AttemptRow>(
        "SELECT * FROM examenes_intento WHERE alumno_id=$1 AND examen_id=$2 AND modalidad=$3 AND submitted_at IS NULL",
    ).bind(claims.profile_id).bind(exam_id).bind(&input.modalidad)
        .fetch_optional(&mut *transaction).await?;
    let attempt = if let Some(row) = existing {
        row
    } else {
        let mut questions = sqlx::query_as::<_, QuestionRow>(
            "SELECT id, examen_id, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, respuesta_correcta, orden::integer, imagen_url, created_date FROM examenes_pregunta WHERE examen_id=$1 ORDER BY orden, created_date",
        ).bind(exam_id).fetch_all(&mut *transaction).await?;
        if questions.is_empty() {
            return Err(AppError::Validation(
                "El examen no tiene preguntas.".to_owned(),
            ));
        }
        questions.shuffle(&mut rand::rng());
        let count = question_count(questions.len(), exam.num_preguntas)?;
        questions.truncate(count);
        validate_question_bank(&questions)?;
        let snapshot = serde_json::to_value(questions).map_err(|_| AppError::Internal)?;
        sqlx::query_as::<_, AttemptRow>(
            "INSERT INTO examenes_intento (id, alumno_id, examen_id, modalidad, expires_at, preguntas) VALUES ($1,$2,$3,$4,CASE WHEN $4='tiempo' THEN NOW()+INTERVAL '40 minutes' ELSE NULL END,$5) RETURNING *",
        ).bind(Uuid::new_v4()).bind(claims.profile_id).bind(exam_id).bind(&input.modalidad).bind(snapshot)
            .fetch_one(&mut *transaction).await?
    };
    let now = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(Json(attempt_view(attempt, now)?))
}

#[derive(Debug, Deserialize)]
pub struct SaveAnswers {
    respuestas: HashMap<String, Value>,
}

pub async fn save_answers(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<SaveAnswers>,
) -> Result<StatusCode, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    if claims.role != "alumno" {
        return Err(AppError::Forbidden);
    }
    let mut transaction = state
        .pool
        .as_ref()
        .ok_or(AppError::Unavailable)?
        .begin()
        .await?;
    let attempt = sqlx::query_as::<_, AttemptRow>(
        "SELECT * FROM examenes_intento WHERE id=$1 AND alumno_id=$2 FOR UPDATE",
    )
    .bind(id)
    .bind(claims.profile_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or(AppError::NotFound)?;
    let now: DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&mut *transaction)
        .await?;
    if attempt.submitted_at.is_some() || attempt.expires_at.is_some_and(|end| now >= end) {
        return Err(AppError::Validation("El intento ha finalizado.".to_owned()));
    }
    fetch_submittable_exam(&mut transaction, claims.profile_id, attempt.examen_id).await?;
    let questions = serde_json::from_value::<Vec<QuestionRow>>(attempt.preguntas)
        .map_err(|_| AppError::Internal)?;
    validate_answers(&input.respuestas, &questions)?;
    sqlx::query("UPDATE examenes_intento SET respuestas=$2 WHERE id=$1")
        .bind(id)
        .bind(serde_json::to_value(input.respuestas).map_err(|_| AppError::Internal)?)
        .execute(&mut *transaction)
        .await?;
    transaction.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

fn validate_answers(
    answers: &HashMap<String, Value>,
    questions: &[QuestionRow],
) -> Result<(), AppError> {
    let by_id: HashMap<String, &QuestionRow> = questions
        .iter()
        .map(|question| (question.id.to_string(), question))
        .collect();
    for (id, value) in answers {
        if !by_id.contains_key(id)
            || !(value.is_null()
                || value.as_str().is_some_and(|answer| {
                    answer.is_empty()
                        || by_id
                            .get(id)
                            .is_some_and(|question| question_option(question, answer).is_some())
                }))
        {
            return Err(AppError::Validation(
                "Respuesta o pregunta no válida.".to_owned(),
            ));
        }
    }
    Ok(())
}

fn question_option<'a>(question: &'a QuestionRow, answer: &str) -> Option<&'a str> {
    match answer.to_ascii_lowercase().as_str() {
        "a" => Some(question.opcion_a.as_str()),
        "b" => Some(question.opcion_b.as_str()),
        "c" => Some(question.opcion_c.as_str()),
        "d" => Some(question.opcion_d.as_str()),
        _ => None,
    }
    .filter(|text| !text.trim().is_empty())
}

fn validate_question_bank(questions: &[QuestionRow]) -> Result<(), AppError> {
    if questions
        .iter()
        .any(|question| question_option(question, &question.respuesta_correcta).is_none())
    {
        return Err(AppError::Validation(
            "El examen contiene preguntas sin una opción correcta válida.".into(),
        ));
    }
    Ok(())
}

fn question_count(available: usize, requested: i32) -> Result<usize, AppError> {
    let count = usize::try_from(requested).map_err(|_| AppError::Internal)?;
    if count == 0 {
        return Err(AppError::Validation(
            "Número de preguntas no válido.".into(),
        ));
    }
    if available < count {
        return Err(AppError::Validation(
            "El examen no tiene suficientes preguntas para iniciar un intento completo.".into(),
        ));
    }
    Ok(count)
}

pub async fn submit_result(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<SubmitResult>,
) -> Result<(StatusCode, Json<ResultView>), AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    if claims.role != "alumno" {
        return Err(AppError::Forbidden);
    }
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let mut transaction = pool.begin().await?;
    let attempt = sqlx::query_as::<_, AttemptRow>(
        "SELECT * FROM examenes_intento WHERE id=$1 AND alumno_id=$2 AND examen_id=$3 FOR UPDATE",
    )
    .bind(input.attempt_id)
    .bind(claims.profile_id)
    .bind(input.examen_id)
    .fetch_optional(&mut *transaction)
    .await?
    .ok_or(AppError::NotFound)?;
    if attempt.submitted_at.is_some() {
        let id = attempt.result_id.ok_or(AppError::NotFound)?;
        transaction.commit().await?;
        return Ok((
            StatusCode::CREATED,
            result_detail(State(state), headers, Path(id)).await?,
        ));
    }
    if !input.modalidad.is_empty() && input.modalidad != attempt.modalidad {
        return Err(AppError::Validation(
            "La modalidad no coincide con el intento.".to_owned(),
        ));
    }
    let exam = fetch_submittable_exam(&mut transaction, claims.profile_id, input.examen_id).await?;
    let questions: Vec<QuestionRow> =
        serde_json::from_value(attempt.preguntas.clone()).map_err(|_| AppError::Internal)?;
    let now: DateTime<Utc> = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&mut *transaction)
        .await?;
    // Late submissions can only grade answers saved before the deadline.
    let respuestas: HashMap<String, Value> = if attempt.expires_at.is_some_and(|end| now >= end) {
        serde_json::from_value(attempt.respuestas).map_err(|_| AppError::Internal)?
    } else {
        validate_answers(&input.respuestas, &questions)?;
        input.respuestas
    };
    if questions.is_empty() {
        return Err(AppError::Validation(
            "El examen no tiene preguntas.".to_owned(),
        ));
    }

    let answer_keys: Vec<AnswerKey> = questions
        .iter()
        .map(|question| AnswerKey {
            question_id: question.id,
            correct: question.respuesta_correcta.to_lowercase(),
            answer: answer_value(&respuestas, question.id),
        })
        .collect();
    let scored = score(&answer_keys)?;
    let revision = build_revision(&questions, &answer_keys);
    let result_id = Uuid::new_v4();
    let respuestas = serde_json::to_value(&respuestas).map_err(|_| AppError::Internal)?;
    let aciertos = i32::try_from(scored.aciertos).map_err(|_| AppError::Internal)?;
    let errores = i32::try_from(scored.errores).map_err(|_| AppError::Internal)?;
    let ended_at = attempt.expires_at.map_or(now, |end| end.min(now));
    let tiempo_empleado = (ended_at - attempt.started_at)
        .num_seconds()
        .clamp(0, i64::from(i32::MAX)) as i32;
    sqlx::query(
        "INSERT INTO examenes_resultadoexamen \
         (id, created_date, updated_date, alumno_id, examen_id, examen_nombre, categoria, \
          modalidad, respuestas, detalle_revision, aciertos, errores, nota, porcentaje, \
          tiempo_empleado, aprobado, fecha) \
         VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, \
                 CAST($12 AS numeric), CAST($13 AS numeric), $14, $15, $2)",
    )
    .bind(result_id)
    .bind(now)
    .bind(claims.profile_id)
    .bind(input.examen_id)
    .bind(&exam.nombre)
    .bind(&exam.categoria)
    .bind(&attempt.modalidad)
    .bind(&respuestas)
    .bind(&revision)
    .bind(aciertos)
    .bind(errores)
    .bind(format!("{:.1}", scored.nota))
    .bind(format!("{:.1}", scored.porcentaje))
    .bind(tiempo_empleado)
    .bind(scored.aprobado)
    .execute(&mut *transaction)
    .await?;
    sqlx::query(
        "UPDATE examenes_intento SET submitted_at=$2, result_id=$3, respuestas=$4 WHERE id=$1",
    )
    .bind(attempt.id)
    .bind(now)
    .bind(result_id)
    .bind(&respuestas)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;

    Ok((
        StatusCode::CREATED,
        Json(
            ResultView {
                id: result_id,
                alumno_id: claims.profile_id,
                examen_id: Some(input.examen_id),
                examen_nombre: exam.nombre,
                categoria: exam.categoria,
                modalidad: attempt.modalidad,
                respuestas,
                detalle_revision: Some(revision),
                aciertos,
                errores,
                nota: scored.nota,
                porcentaje: scored.porcentaje,
                tiempo_empleado,
                aprobado: scored.aprobado,
                fecha: Some(now),
                created_date: now,
            }
            .for_role(&claims.role),
        ),
    ))
}

async fn fetch_submittable_exam(
    transaction: &mut Transaction<'_, Postgres>,
    profile_id: Uuid,
    exam_id: Uuid,
) -> Result<ExamIdentity, AppError> {
    let statement = format!(
        "SELECT e.id,e.nombre,e.categoria,e.num_preguntas::integer FROM examenes_examen e WHERE e.id=$1 AND e.activo AND {}",
        crate::academic_scope::resource_scope("e", "creado_por_id", 2, 3)
    );
    let exam = sqlx::query_as::<_, ExamIdentity>(&statement)
        .bind(exam_id)
        .bind("alumno")
        .bind(profile_id)
        .fetch_optional(&mut **transaction)
        .await?
        .ok_or(AppError::NotFound)?;
    let blocked: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM examenes_bloqueoexamen b \
         WHERE b.alumno_id = $1 AND b.bloqueado = TRUE \
           AND (b.fecha_inicio IS NULL OR b.fecha_inicio<=NOW()) \
           AND (b.fecha_fin IS NULL OR b.fecha_fin>NOW()) \
           AND (b.examen_id = $2 OR (b.examen_id IS NULL AND b.categoria = $3)))",
    )
    .bind(profile_id)
    .bind(exam.id)
    .bind(&exam.categoria)
    .fetch_one(&mut **transaction)
    .await?;
    if blocked {
        return Err(AppError::Validation(
            "Este examen estÃ¡ bloqueado para su cuenta.".to_owned(),
        ));
    }
    let prerequisite = match exam.categoria.as_str() {
        "A2" => Some("A1/A3"),
        "STS" | "STS-01" | "STS-02" => Some("A2"),
        _ => None,
    };
    if let Some(category) = prerequisite {
        let passed: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM examenes_resultadoexamen WHERE alumno_id=$1 AND categoria=$2 AND aprobado=TRUE)")
            .bind(profile_id).bind(category).fetch_one(&mut **transaction).await?;
        if !passed {
            return Err(AppError::Forbidden);
        }
    }
    Ok(exam)
}

#[derive(Debug, FromRow)]
struct ExamIdentity {
    id: Uuid,
    nombre: String,
    categoria: String,
    num_preguntas: i32,
}

fn answer_value(answers: &HashMap<String, Value>, question_id: Uuid) -> Option<String> {
    answers.get(&question_id.to_string()).and_then(|value| {
        if value.is_null() {
            None
        } else if let Some(text) = value.as_str() {
            Some(text.to_lowercase())
        } else {
            Some(value.to_string().to_lowercase())
        }
    })
}

fn build_revision(questions: &[QuestionRow], answers: &[AnswerKey]) -> Value {
    let mut revision = Map::new();
    for (question, answer) in questions.iter().zip(answers) {
        revision.insert(
            question.id.to_string(),
            json!({
                "respuesta_alumno": answer.answer,
                "respuesta_correcta": answer.correct,
                "acerto": answer.answer.as_deref().is_some_and(|value| value.eq_ignore_ascii_case(&answer.correct)),
                "enunciado": question.enunciado,
                "opcion_a": question.opcion_a,
                "opcion_b": question.opcion_b,
                "opcion_c": question.opcion_c,
                "opcion_d": question.opcion_d,
            }),
        );
    }
    Value::Object(revision)
}

fn safe_limit(limit: Option<i64>) -> i64 {
    limit.unwrap_or(10_000).clamp(1, 10_000)
}

#[cfg(test)]
mod tests {
    use super::{
        AnswerKey, AttemptRow, ExamScore, QuestionRow, ResultView, attempt_view, question_count,
        redact_solution, score, validate_answers, validate_question_bank,
    };
    use chrono::Utc;
    use serde_json::json;
    use uuid::Uuid;

    fn answer(correct: &str, supplied: Option<&str>) -> AnswerKey {
        AnswerKey {
            question_id: Uuid::new_v4(),
            correct: correct.to_owned(),
            answer: supplied.map(ToOwned::to_owned),
        }
    }

    #[test]
    fn scoring_is_backend_authoritative() {
        let answers = vec![answer("A", Some("a")), answer("B", Some("C"))];
        assert_eq!(
            score(&answers).unwrap(),
            ExamScore {
                aciertos: 1,
                errores: 1,
                porcentaje: 50.0,
                nota: 5.0,
                aprobado: false
            }
        );
    }

    #[test]
    fn unanswered_questions_are_not_errors() {
        let answers = vec![
            answer("a", Some("a")),
            answer("b", None),
            answer("c", Some("")),
        ];
        let result = score(&answers).unwrap();
        assert_eq!(result.aciertos, 1);
        assert_eq!(result.errores, 0);
        assert_eq!(result.porcentaje, 33.3);
    }

    #[test]
    fn seven_out_of_ten_passes() {
        let answers: Vec<_> = (0..10)
            .map(|index| answer("a", (index < 7).then_some("a")))
            .collect();
        assert!(score(&answers).unwrap().aprobado);
    }

    #[test]
    fn empty_exam_is_rejected() {
        assert!(score(&[]).is_err());
    }

    #[test]
    fn an_empty_answer_key_cannot_award_a_blank_answer() {
        assert!(score(&[answer("", Some(""))]).is_err());
        assert!(score(&[answer("invalid", Some("a"))]).is_err());
    }

    #[test]
    fn invalid_question_options_cannot_start_or_receive_answers() {
        let mut question = question();
        question.opcion_d.clear();
        assert!(
            validate_answers(&[(question.id.to_string(), json!("d"))].into(), &[question]).is_err()
        );
        let mut missing = self::question();
        missing.respuesta_correcta.clear();
        assert!(validate_question_bank(&[missing]).is_err());
        let mut missing = self::question();
        missing.respuesta_correcta = "d".into();
        missing.opcion_d = " ".into();
        assert!(validate_question_bank(&[missing]).is_err());
        assert!(validate_question_bank(&[self::question()]).is_ok());
    }

    fn result() -> ResultView {
        ResultView {
            id: Uuid::new_v4(),
            alumno_id: Uuid::new_v4(),
            examen_id: Some(Uuid::new_v4()),
            examen_nombre: "Synthetic result".into(),
            categoria: "test".into(),
            modalidad: "libre".into(),
            respuestas: json!({"q1":"a"}),
            detalle_revision: Some(
                json!({"q1":{"respuesta_alumno":"a","respuesta_correcta":"b","acerto":false,"enunciado":"Synthetic question","opcion_a":"A","opcion_b":"B","opcion_c":"C"}}),
            ),
            aciertos: 0,
            errores: 1,
            nota: 0.0,
            porcentaje: 0.0,
            tiempo_empleado: 1,
            aprobado: false,
            fecha: Some(Utc::now()),
            created_date: Utc::now(),
        }
    }

    #[test]
    fn student_results_never_serialize_the_solution() {
        for role in ["alumno", "unknown"] {
            let view = serde_json::to_value(result().for_role(role)).unwrap();
            let revision = &view["detalle_revision"]["q1"];
            assert!(
                revision.get("respuesta_correcta").is_none(),
                "solution exposed to {role}"
            );
            assert_eq!(revision["respuesta_alumno"], "a");
            assert_eq!(revision["acerto"], false);
            assert_eq!(view["errores"], 1);
        }
        for role in ["instructor", "admin"] {
            let view = serde_json::to_value(result().for_role(role)).unwrap();
            assert_eq!(view["detalle_revision"]["q1"]["respuesta_correcta"], "b");
        }
    }

    #[test]
    fn attempts_require_the_full_configured_question_bank() {
        assert!(question_count(39, 40).is_err());
        assert!(question_count(0, 40).is_err());
        assert!(question_count(40, 0).is_err());
        assert!(question_count(40, -1).is_err());
        assert_eq!(question_count(40, 40).unwrap(), 40);
        assert_eq!(question_count(60, 40).unwrap(), 40);
    }

    #[test]
    fn legacy_nested_result_shapes_do_not_bypass_solution_redaction() {
        let mut revision = json!({"legacy":[{"respuesta_correcta":"c","respuesta_alumno":"a","acerto":false}],"missing":null});
        redact_solution(&mut revision);
        assert!(revision["legacy"][0].get("respuesta_correcta").is_none());
        assert_eq!(revision["legacy"][0]["respuesta_alumno"], "a");
        assert_eq!(revision["legacy"][0]["acerto"], false);
        assert!(revision["missing"].is_null());
        assert!(result().for_role("alumno").detalle_revision.is_some());
    }

    fn question() -> QuestionRow {
        QuestionRow {
            id: Uuid::new_v4(),
            examen_id: Uuid::new_v4(),
            enunciado: "Question".into(),
            opcion_a: "A".into(),
            opcion_b: "B".into(),
            opcion_c: "C".into(),
            opcion_d: "D".into(),
            respuesta_correcta: "a".into(),
            orden: 1,
            imagen_url: String::new(),
            created_date: Utc::now(),
        }
    }

    #[test]
    fn attempt_never_serializes_the_answer_key() {
        let question = question();
        let now = Utc::now();
        let view = attempt_view(
            AttemptRow {
                id: Uuid::new_v4(),
                alumno_id: Uuid::new_v4(),
                examen_id: question.examen_id,
                modalidad: "libre".into(),
                started_at: now,
                expires_at: None,
                preguntas: json!([question]),
                respuestas: json!({}),
                submitted_at: None,
                result_id: None,
            },
            now,
        )
        .unwrap();
        assert!(view["preguntas"][0].get("respuesta_correcta").is_none());
        assert_eq!(view["preguntas"][0]["opcion_a"], "A");
    }

    #[test]
    fn answers_reject_foreign_questions_and_invalid_values() {
        let question = question();
        let id = question.id.to_string();
        let questions = [question];
        for value in [json!(["a"]), json!({"correct": "a"}), json!(1), json!("e")] {
            assert!(validate_answers(&[(id.clone(), value)].into(), &questions).is_err());
        }
        assert!(
            validate_answers(
                &[(Uuid::new_v4().to_string(), json!("a"))].into(),
                &questions
            )
            .is_err()
        );
        assert!(validate_answers(&[(id, json!("A"))].into(), &questions).is_ok());
    }
}
