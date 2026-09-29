use std::{collections::HashMap, sync::Arc};

use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
};
use chrono::{DateTime, Utc};
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
    let rows = sqlx::query_as::<_, ExamView>(
        "SELECT e.id, e.nombre, e.categoria, e.descripcion, e.activo, \
         e.num_preguntas::integer, e.created_date, e.updated_date \
         FROM examenes_examen e \
         WHERE ($1::text IS NULL OR e.categoria = $1) \
           AND ($2::boolean IS NULL OR e.activo = $2) \
           AND ($3::text IS NULL OR e.nombre = $3) \
           AND ($4::boolean = FALSE OR NOT EXISTS ( \
             SELECT 1 FROM examenes_bloqueoexamen b \
             WHERE b.alumno_id = $5 AND b.bloqueado = TRUE \
               AND (b.examen_id = e.id OR (b.examen_id IS NULL AND b.categoria = e.categoria)))) \
         ORDER BY e.categoria ASC, e.created_date DESC LIMIT $6",
    )
    .bind(query.categoria.as_deref())
    .bind(query.activo)
    .bind(query.nombre.as_deref())
    .bind(claims.role == "alumno")
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
    let row = sqlx::query_as::<_, ExamView>(
        "SELECT e.id, e.nombre, e.categoria, e.descripcion, e.activo, \
         e.num_preguntas::integer, e.created_date, e.updated_date \
         FROM examenes_examen e WHERE e.id = $1 \
           AND ($2::boolean = FALSE OR NOT EXISTS ( \
             SELECT 1 FROM examenes_bloqueoexamen b \
             WHERE b.alumno_id = $3 AND b.bloqueado = TRUE \
               AND (b.examen_id = e.id OR (b.examen_id IS NULL AND b.categoria = e.categoria))))",
    )
    .bind(id)
    .bind(claims.role == "alumno")
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

#[derive(Debug, FromRow)]
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
    let rows = sqlx::query_as::<_, QuestionRow>(
        "SELECT q.id, q.examen_id, q.enunciado, q.opcion_a, q.opcion_b, q.opcion_c, \
         q.opcion_d, q.respuesta_correcta, q.orden::integer, q.imagen_url, q.created_date \
         FROM examenes_pregunta q JOIN examenes_examen e ON e.id = q.examen_id \
         WHERE ($1::uuid IS NULL OR q.examen_id = $1) \
           AND ($2::boolean = FALSE OR NOT EXISTS ( \
             SELECT 1 FROM examenes_bloqueoexamen b \
             WHERE b.alumno_id = $3 AND b.bloqueado = TRUE \
               AND (b.examen_id = e.id OR (b.examen_id IS NULL AND b.categoria = e.categoria)))) \
         ORDER BY q.orden ASC, q.created_date ASC LIMIT $4",
    )
    .bind(exam_id)
    .bind(claims.role == "alumno")
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
    let row = sqlx::query_as::<_, QuestionRow>("SELECT q.id,q.examen_id,q.enunciado,q.opcion_a,q.opcion_b,q.opcion_c,q.opcion_d,q.respuesta_correcta,q.orden::integer,q.imagen_url,q.created_date FROM examenes_pregunta q JOIN examenes_examen e ON e.id=q.examen_id WHERE q.id=$1 AND ($2::boolean=FALSE OR NOT EXISTS (SELECT 1 FROM examenes_bloqueoexamen b WHERE b.alumno_id=$3 AND b.bloqueado=TRUE AND (b.examen_id=e.id OR (b.examen_id IS NULL AND b.categoria=e.categoria))))")
        .bind(id).bind(claims.role=="alumno").bind(claims.profile_id).fetch_optional(state.pool.as_ref().ok_or(AppError::Unavailable)?).await?.ok_or(AppError::NotFound)?;
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
    nota: String,
    porcentaje: String,
    tiempo_empleado: i32,
    aprobado: bool,
    fecha: Option<DateTime<Utc>>,
    created_date: DateTime<Utc>,
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
         r.nota::text AS nota, r.porcentaje::text AS porcentaje, r.tiempo_empleado::integer, \
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
    Ok(Json(rows))
}

pub async fn result_detail(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<ResultView>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let row = sqlx::query_as::<_, ResultView>("SELECT r.id,r.alumno_id,r.examen_id,r.examen_nombre,r.categoria,r.modalidad,r.respuestas,r.detalle_revision,r.aciertos::integer,r.errores::integer,r.nota::text AS nota,r.porcentaje::text AS porcentaje,r.tiempo_empleado::integer,r.aprobado,r.fecha,r.created_date FROM examenes_resultadoexamen r JOIN accounts_userprofile p ON p.id=r.alumno_id WHERE r.id=$1 AND ($2='admin' OR ($2='alumno' AND r.alumno_id=$3) OR ($2='instructor' AND p.assigned_instructor_id=$3))")
        .bind(id).bind(&claims.role).bind(claims.profile_id).fetch_optional(state.pool.as_ref().ok_or(AppError::Unavailable)?).await?.ok_or(AppError::NotFound)?;
    Ok(Json(row))
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
    #[serde(default)]
    modalidad: String,
    respuestas: HashMap<String, Value>,
    #[serde(default)]
    tiempo_empleado: u32,
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
    if input.modalidad.len() > 50 {
        return Err(AppError::Validation("Modalidad no vÃ¡lida.".to_owned()));
    }
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let mut transaction = pool.begin().await?;
    let exam = fetch_submittable_exam(&mut transaction, claims.profile_id, input.examen_id).await?;
    let questions = sqlx::query_as::<_, QuestionRow>(
        "SELECT id, examen_id, enunciado, opcion_a, opcion_b, opcion_c, opcion_d, \
         respuesta_correcta, orden::integer, imagen_url, created_date \
         FROM examenes_pregunta WHERE examen_id = $1 ORDER BY orden, created_date",
    )
    .bind(input.examen_id)
    .fetch_all(&mut *transaction)
    .await?;
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
            answer: answer_value(&input.respuestas, question.id),
        })
        .collect();
    let scored = score(&answer_keys)?;
    let revision = build_revision(&questions, &answer_keys);
    let result_id = Uuid::new_v4();
    let now = Utc::now();
    let respuestas = serde_json::to_value(&input.respuestas).map_err(|_| AppError::Internal)?;
    let aciertos = i32::try_from(scored.aciertos).map_err(|_| AppError::Internal)?;
    let errores = i32::try_from(scored.errores).map_err(|_| AppError::Internal)?;
    let tiempo_empleado = i32::try_from(input.tiempo_empleado)
        .map_err(|_| AppError::Validation("Tiempo empleado no vÃ¡lido.".to_owned()))?;
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
    .bind(&input.modalidad)
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
    transaction.commit().await?;

    Ok((
        StatusCode::CREATED,
        Json(ResultView {
            id: result_id,
            alumno_id: claims.profile_id,
            examen_id: Some(input.examen_id),
            examen_nombre: exam.nombre,
            categoria: exam.categoria,
            modalidad: input.modalidad,
            respuestas,
            detalle_revision: Some(revision),
            aciertos,
            errores,
            nota: format!("{:.1}", scored.nota),
            porcentaje: format!("{:.1}", scored.porcentaje),
            tiempo_empleado,
            aprobado: scored.aprobado,
            fecha: Some(now),
            created_date: now,
        }),
    ))
}

async fn fetch_submittable_exam(
    transaction: &mut Transaction<'_, Postgres>,
    profile_id: Uuid,
    exam_id: Uuid,
) -> Result<ExamIdentity, AppError> {
    let exam = sqlx::query_as::<_, ExamIdentity>(
        "SELECT id, nombre, categoria FROM examenes_examen WHERE id = $1",
    )
    .bind(exam_id)
    .fetch_optional(&mut **transaction)
    .await?
    .ok_or(AppError::NotFound)?;
    let blocked: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM examenes_bloqueoexamen b \
         WHERE b.alumno_id = $1 AND b.bloqueado = TRUE \
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
    Ok(exam)
}

#[derive(Debug, FromRow)]
struct ExamIdentity {
    id: Uuid,
    nombre: String,
    categoria: String,
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
    use super::{AnswerKey, ExamScore, score};
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
}
