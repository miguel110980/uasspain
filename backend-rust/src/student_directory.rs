//! Authorised, paginated student history. Search indexes contain keyed tokens only.
use crate::{
    AppState, account_lifecycle as lifecycle,
    auth::{authenticate, require_role},
    error::AppError,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, header},
    response::{IntoResponse, Response},
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{Postgres, Transaction};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Filters {
    group: Option<String>,
    q: Option<String>,
    registered_from: Option<NaiveDate>,
    registered_to: Option<NaiveDate>,
    deactivated_from: Option<NaiveDate>,
    deactivated_to: Option<NaiveDate>,
    course: Option<Uuid>,
    instructor: Option<Uuid>,
    status: Option<String>,
    sort: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
}
impl Filters {
    fn validate(&self) -> Result<(), AppError> {
        if !matches!(
            self.group.as_deref().unwrap_or("active"),
            "active" | "deactivated" | "history"
        ) || !matches!(
            self.sort.as_deref().unwrap_or("newest"),
            "newest" | "oldest" | "name" | "last_access"
        ) || self.q.as_ref().is_some_and(|q| {
            q.chars().count() > 100 || (!q.trim().is_empty() && q.trim().chars().count() < 2)
        }) || self.status.as_deref().is_some_and(|v| {
            !matches!(
                v,
                "activo" | "pendiente" | "bloqueado" | "rechazado" | "baja"
            )
        }) || matches!((self.registered_from,self.registered_to),(Some(a),Some(b)) if a>b)
            || matches!((self.deactivated_from,self.deactivated_to),(Some(a),Some(b)) if a>b)
            || self.offset.is_some_and(|v| v < 0)
            || self.limit.is_some_and(|v| !(1..=100).contains(&v))
        {
            return Err(AppError::Validation(
                "Filtros no válidos: revise fechas, estado y búsqueda (entre 2 y 100 caracteres)."
                    .into(),
            ));
        }
        Ok(())
    }
}

const SCOPE: &str = r#"FROM student_membership m JOIN accounts_userprofile p ON p.id=m.profile_id
LEFT JOIN auth_user u ON u.id=p.user_id LEFT JOIN account_lifecycle l ON l.profile_id=p.id
WHERE (($1='active' AND m.current_member AND p.status<>'baja') OR ($1='deactivated' AND l.deactivated_at IS NOT NULL AND p.status='baja') OR $1='history')
AND ($2::date IS NULL OR m.account_registered_at >= ($2::date::timestamp AT TIME ZONE 'UTC'))
AND ($3::date IS NULL OR m.account_registered_at < (($3::date+1)::timestamp AT TIME ZONE 'UTC'))
AND ($4::date IS NULL OR l.deactivated_at >= ($4::date::timestamp AT TIME ZONE 'UTC'))
AND ($5::date IS NULL OR l.deactivated_at < (($5::date+1)::timestamp AT TIME ZONE 'UTC'))
AND ($6::uuid IS NULL OR EXISTS(SELECT 1 FROM student_course_registration c WHERE c.profile_id=p.id AND c.course_id=$6))
AND ($7::uuid IS NULL OR p.assigned_instructor_id=$7)
AND ($8::text IS NULL OR p.status=$8)
AND ($9::uuid[] IS NULL OR p.id=ANY($9))"#;

macro_rules! bind_scope {
    ($query:expr,$filter:expr,$ids:expr) => {
        $query
            .bind($filter.group.as_deref().unwrap_or("active"))
            .bind($filter.registered_from)
            .bind($filter.registered_to)
            .bind($filter.deactivated_from)
            .bind($filter.deactivated_to)
            .bind($filter.course)
            .bind($filter.instructor)
            .bind($filter.status.as_deref())
            .bind($ids)
    };
}

async fn selection(
    state: &AppState,
    tx: &mut Transaction<'_, Postgres>,
    filters: &Filters,
) -> Result<Option<Vec<Uuid>>, AppError> {
    let q = filters.q.as_deref().unwrap_or("").trim().to_lowercase();
    let named = filters.sort.as_deref() == Some("name");
    if q.is_empty() && !named {
        return Ok(None);
    }
    if !q.is_empty() {
        let pending: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM student_membership WHERE indexed_source IS NULL)",
        )
        .fetch_one(&mut **tx)
        .await?;
        if pending {
            return Err(AppError::Unavailable);
        }
    }
    let tokens = crate::account_lifecycle::query_tokens(state, &q)?;
    let sql = format!(
        "SELECT p.id,p.nombre,p.apellidos,p.email {SCOPE} AND ($10::integer=0 OR (SELECT count(*) FROM student_search_token t WHERE t.profile_id=p.id AND t.token=ANY($11))=$10) ORDER BY p.id LIMIT 10001"
    );
    let rows: Vec<(Uuid, String, String, String)> =
        bind_scope!(sqlx::query_as(&sql), filters, Option::<Vec<Uuid>>::None)
            .bind(i32::try_from(tokens.len()).map_err(|_| AppError::Internal)?)
            .bind(tokens)
            .fetch_all(&mut **tx)
            .await?;
    if rows.len() > 10000 {
        return Err(AppError::Validation(
            "Acote los filtros para buscar u ordenar por nombre en más de 10.000 alumnos.".into(),
        ));
    }
    let mut selected = Vec::new();
    for (id, nombre, apellidos, email) in rows {
        let name = format!(
            "{} {}",
            state.cipher.decrypt(&nombre)?,
            state.cipher.decrypt(&apellidos)?
        )
        .to_lowercase();
        let searchable = format!("{name} {} {id}", state.cipher.decrypt(&email)?).to_lowercase();
        if q.is_empty() || searchable.contains(&q) {
            selected.push((id, name));
        }
    }
    if named {
        selected.sort_by(|a, b| a.1.cmp(&b.1).then(a.0.cmp(&b.0)));
    }
    Ok(Some(selected.into_iter().map(|v| v.0).collect()))
}

async fn page(
    state: &AppState,
    tx: &mut Transaction<'_, Postgres>,
    filters: &Filters,
    selected: &Option<Vec<Uuid>>,
    offset: i64,
    limit: i64,
) -> Result<Vec<Value>, AppError> {
    let order = match filters.sort.as_deref().unwrap_or("newest") {
        "name" => "array_position($9,p.id),p.id",
        "oldest" => "m.account_registered_at ASC,p.id",
        "last_access" => {
            "GREATEST(u.last_login,(SELECT max(r.fecha_hora) FROM conexiones_registroconexion r WHERE r.profile_id=p.id AND r.estado_acceso='correcto')) DESC NULLS LAST,p.id"
        }
        _ => "m.account_registered_at DESC,p.id",
    };
    let sql = format!(
        r#"SELECT jsonb_build_object('id',p.id,'nombre',p.nombre,'apellidos',p.apellidos,'email',p.email,
      'registered_at',m.account_registered_at,'status',p.status,'role',p.role,'roles',p.roles,'current_student',m.current_member,
      'access_suspended',NOT COALESCE(u.is_active,false),'otp_verified',p.otp_verified,'last_access',GREATEST(u.last_login,(SELECT max(r.fecha_hora) FROM conexiones_registroconexion r WHERE r.profile_id=p.id AND r.estado_acceso='correcto')),
      'deactivated_at',l.deactivated_at,'deactivation_type',l.deactivation_type,'reactivated_at',l.reactivated_at,'revision',COALESCE(l.revision,0),
      'instructor_id',p.assigned_instructor_id,'instructor',COALESCE((SELECT jsonb_build_object('nombre',i.nombre,'apellidos',i.apellidos,'status',i.status) FROM accounts_userprofile i WHERE i.id=p.assigned_instructor_id),'null'::jsonb),
      'courses',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'registered_at',r.registered_at,'ended_at',r.ended_at) ORDER BY c.name,c.id) FROM student_course_registration r JOIN courses c ON c.id=r.course_id WHERE r.profile_id=p.id),'[]'::jsonb))
      {SCOPE} ORDER BY {order} LIMIT $10 OFFSET $11"#
    );
    let mut rows: Vec<Value> = bind_scope!(sqlx::query_scalar(&sql), filters, selected.as_deref())
        .bind(limit)
        .bind(offset)
        .fetch_all(&mut **tx)
        .await?;
    for row in &mut rows {
        for field in ["nombre", "apellidos", "email"] {
            row[field] = Value::String(state.cipher.decrypt(row[field].as_str().unwrap_or(""))?);
        }
        if row["instructor"].is_object() {
            for field in ["nombre", "apellidos"] {
                row["instructor"][field] = Value::String(
                    state
                        .cipher
                        .decrypt(row["instructor"][field].as_str().unwrap_or(""))?,
                );
            }
        }
    }
    Ok(rows)
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(filters): Query<Filters>,
) -> Result<Json<Value>, AppError> {
    let actor = authenticate(&state, &headers, "access")?;
    require_role(&actor, &["admin"])?;
    filters.validate()?;
    auth_rate(&headers, actor.profile_id, "directory")?;
    if filters.q.as_deref().is_some_and(|q| !q.trim().is_empty()) {
        lifecycle::index_pending(&state).await?;
    }
    let mut tx = state
        .pool
        .as_ref()
        .ok_or(AppError::Unavailable)?
        .begin()
        .await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .execute(&mut *tx)
        .await?;
    let selected = selection(&state, &mut tx, &filters).await?;
    let total: i64 = bind_scope!(
        sqlx::query_scalar(&format!("SELECT count(*) {SCOPE}")),
        filters,
        selected.as_deref()
    )
    .fetch_one(&mut *tx)
    .await?;
    let counts:Value=sqlx::query_scalar("SELECT jsonb_build_object('active',count(*) FILTER(WHERE m.current_member AND p.status<>'baja'),'deactivated',count(*) FILTER(WHERE p.status='baja' AND l.deactivated_at IS NOT NULL),'historical',count(*)) FROM student_membership m JOIN accounts_userprofile p ON p.id=m.profile_id LEFT JOIN account_lifecycle l ON l.profile_id=p.id").fetch_one(&mut *tx).await?;
    let limit = filters.limit.unwrap_or(25);
    let offset = filters.offset.unwrap_or(0);
    let rows = page(&state, &mut tx, &filters, &selected, offset, limit).await?;
    let courses:Value=sqlx::query_scalar("SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name) ORDER BY c.name),'[]'::jsonb) FROM courses c WHERE c.status<>'deleted'").fetch_one(&mut *tx).await?;
    let assignment_reviews:Value=sqlx::query_scalar("SELECT COALESCE(jsonb_agg(jsonb_build_object('instructor_id',i.id,'dependent_students',(SELECT count(*) FROM accounts_userprofile p WHERE p.assigned_instructor_id=i.id AND p.status<>'baja'))),'[]'::jsonb) FROM accounts_userprofile i WHERE i.status='baja' AND (i.role='instructor' OR i.roles ? 'instructor') AND EXISTS(SELECT 1 FROM accounts_userprofile p WHERE p.assigned_instructor_id=i.id AND p.status<>'baja')").fetch_one(&mut *tx).await?;
    let instructors:Vec<(Uuid,String,String)>=sqlx::query_as("SELECT DISTINCT i.id,i.nombre,i.apellidos FROM accounts_userprofile i JOIN accounts_userprofile p ON p.assigned_instructor_id=i.id JOIN student_membership m ON m.profile_id=p.id ORDER BY i.id").fetch_all(&mut *tx).await?;
    let instructors=instructors.into_iter().map(|(id,n,a)|Ok(json!({"id":id,"name":format!("{} {}",state.cipher.decrypt(&n)?,state.cipher.decrypt(&a)?)}))).collect::<Result<Vec<Value>,AppError>>()?;
    lifecycle::event(&mut tx,actor.profile_id,Some(actor.profile_id),"student_directory_read","PASS",json!({"group":filters.group.as_deref().unwrap_or("active"),"returned":rows.len(),"searched":filters.q.is_some()}),None).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"results":rows,"count":total,"counts":counts,"limit":limit,"offset":offset,"courses":courses,"instructors":instructors,"assignment_reviews":assignment_reviews,"retention_policy":"PENDING_APPROVED_POLICY"}),
    ))
}

pub async fn detail(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let actor = authenticate(&state, &headers, "access")?;
    require_role(&actor, &["admin"])?;
    auth_rate(&headers, actor.profile_id, "directory-detail")?;
    let mut tx = state
        .pool
        .as_ref()
        .ok_or(AppError::Unavailable)?
        .begin()
        .await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .execute(&mut *tx)
        .await?;
    let filters = Filters {
        group: Some("history".into()),
        ..Default::default()
    };
    let mut rows = page(&state, &mut tx, &filters, &Some(vec![id]), 0, 1).await?;
    let mut row = rows.pop().ok_or(AppError::NotFound)?;
    row["history"]=sqlx::query_scalar("SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'actor_id',actor_id,'operation',operation,'result',result,'created_at',created_at,'correlation_id',correlation_id,'context',context) ORDER BY created_at DESC,id),'[]'::jsonb) FROM (SELECT * FROM account_lifecycle_event WHERE profile_id=$1 ORDER BY created_at DESC,id LIMIT 200) e").bind(id).fetch_one(&mut *tx).await?;
    row["academic_summary"]=sqlx::query_scalar("SELECT jsonb_build_object('exams',(SELECT count(*) FROM examenes_resultadoexamen WHERE alumno_id=$1),'practical_results',(SELECT count(*) FROM examenes_resultadopractico WHERE alumno_id=$1),'attempts',(SELECT count(*) FROM examenes_intento WHERE alumno_id=$1),'completed_materials',(SELECT count(*) FROM materiales_materialcompletado WHERE alumno_id=$1))").bind(id).fetch_one(&mut *tx).await?;
    row["exam_results"]=sqlx::query_scalar("SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'category',categoria,'date',fecha,'grade',nota,'passed',aprobado) ORDER BY fecha DESC,id),'[]'::jsonb) FROM (SELECT * FROM examenes_resultadoexamen WHERE alumno_id=$1 ORDER BY fecha DESC,id LIMIT 100) e").bind(id).fetch_one(&mut *tx).await?;
    lifecycle::event(
        &mut tx,
        id,
        Some(actor.profile_id),
        "student_details_read",
        "PASS",
        json!({}),
        None,
    )
    .await?;
    tx.commit().await?;
    Ok(Json(row))
}

fn auth_rate(headers: &HeaderMap, actor: Uuid, kind: &str) -> Result<(), AppError> {
    if kind == "export" {
        crate::auth::enforce_login_rate(headers, &format!("students:{kind}:{actor}"))
    } else {
        crate::auth::enforce_operation_rate(headers, &format!("students:{kind}:{actor}"))
    }
}
fn csv_cell(value: &str) -> String {
    let safe = if value.trim_start().starts_with(['=', '+', '-', '@'])
        || value.starts_with(['\t', '\r', '\n'])
    {
        format!("'{value}")
    } else {
        value.to_owned()
    };
    format!("\"{}\"", safe.replace('"', "\"\""))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CourseRegistration {
    course_id: Uuid,
    confirm: bool,
}
pub async fn register_course(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<CourseRegistration>,
) -> Result<Json<Value>, AppError> {
    let actor = authenticate(&state, &headers, "access")?;
    require_role(&actor, &["admin"])?;
    auth_rate(&headers, actor.profile_id, "course-registration")?;
    if !input.confirm {
        return Err(AppError::Validation(
            "Confirme la asociación del alumno al curso desde hoy.".into(),
        ));
    }
    let mut tx = state
        .pool
        .as_ref()
        .ok_or(AppError::Unavailable)?
        .begin()
        .await?;
    lifecycle::lock(&mut tx).await?;
    lifecycle::actor_active(&mut tx, &actor).await?;
    let valid:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM student_membership m JOIN accounts_userprofile p ON p.id=m.profile_id WHERE p.id=$1 AND m.current_member AND p.status<>'baja') AND EXISTS(SELECT 1 FROM courses WHERE id=$2)")
        .bind(id).bind(input.course_id).fetch_one(&mut *tx).await?;
    if !valid {
        return Err(AppError::Validation(
            "El alumno debe conservar un registro vigente y el curso debe existir.".into(),
        ));
    }
    let created=sqlx::query("INSERT INTO student_course_registration(profile_id,course_id,registered_at) VALUES($1,$2,clock_timestamp()) ON CONFLICT(profile_id,course_id) DO NOTHING").bind(id).bind(input.course_id).execute(&mut *tx).await?.rows_affected()==1;
    if created {
        lifecycle::event(
            &mut tx,
            id,
            Some(actor.profile_id),
            "course_registered",
            "PASS",
            json!({"course_id":input.course_id,"historic_date_inferred":false}),
            None,
        )
        .await?;
    }
    tx.commit().await?;
    Ok(Json(
        json!({"created":created,"profile_id":id,"course_id":input.course_id}),
    ))
}
pub async fn export(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(filters): Query<Filters>,
) -> Result<Response, AppError> {
    let actor = authenticate(&state, &headers, "access")?;
    require_role(&actor, &["admin"])?;
    filters.validate()?;
    auth_rate(&headers, actor.profile_id, "export")?;
    if filters.q.as_deref().is_some_and(|q| !q.trim().is_empty()) {
        lifecycle::index_pending(&state).await?;
    }
    let mut tx = state
        .pool
        .as_ref()
        .ok_or(AppError::Unavailable)?
        .begin()
        .await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .execute(&mut *tx)
        .await?;
    let selected = selection(&state, &mut tx, &filters).await?;
    let total: i64 = bind_scope!(
        sqlx::query_scalar(&format!("SELECT count(*) {SCOPE}")),
        filters,
        selected.as_deref()
    )
    .fetch_one(&mut *tx)
    .await?;
    if total > 5000 {
        return Err(AppError::Validation(
            "La exportación está limitada a 5.000 registros; acote los filtros.".into(),
        ));
    }
    let mut csv = "\u{feff}ID;Nombre;Apellidos;Email;Registro UTC;Baja UTC;Estado\r\n".to_owned();
    let mut offset = 0;
    loop {
        let rows = page(&state, &mut tx, &filters, &selected, offset, 100).await?;
        let size = rows.len();
        for row in rows {
            csv.push_str(
                &[
                    "id",
                    "nombre",
                    "apellidos",
                    "email",
                    "registered_at",
                    "deactivated_at",
                    "status",
                ]
                .map(|field| csv_cell(row[field].as_str().unwrap_or("")))
                .join(";"),
            );
            csv.push_str("\r\n");
        }
        offset += i64::try_from(size).map_err(|_| AppError::Internal)?;
        if size < 100 {
            break;
        }
    }
    lifecycle::event(&mut tx,actor.profile_id,Some(actor.profile_id),"students_exported","PASS",json!({"rows":offset,"group":filters.group.as_deref().unwrap_or("active"),"searched":filters.q.is_some()}),None).await?;
    tx.commit().await?;
    Ok((
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=alumnos.csv",
            ),
            (header::CACHE_CONTROL, "no-store"),
        ],
        csv,
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn spreadsheet_formulas_are_inert() {
        for v in ["=1+1", " +SUM(A1)", "@SUM(A1)", "\t=1"] {
            assert!(csv_cell(v).starts_with("\"'"));
        }
        assert_eq!(csv_cell("Muñoz, Ana"), "\"Muñoz, Ana\"");
    }
    #[test]
    fn filters_fail_closed() {
        assert!(
            Filters {
                group: Some("all OR true".into()),
                ..Default::default()
            }
            .validate()
            .is_err()
        );
        assert!(
            Filters {
                limit: Some(1000),
                ..Default::default()
            }
            .validate()
            .is_err()
        );
    }
}
