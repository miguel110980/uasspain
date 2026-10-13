use std::sync::Arc;

use axum::{Json, extract::State, http::HeaderMap};
use serde_json::Value;

use crate::{
    AppState,
    auth::{authenticate, require_role},
    error::AppError,
};

// Aggregate the complete authorized population. Bounded lists remain useful
// for charts and activity feeds, but cannot stand in for global totals.
fn counts_sql() -> String {
    format!(
        r#"
WITH scope AS MATERIALIZED (
  SELECT id,status FROM accounts_userprofile
  WHERE (role='alumno' OR roles ? 'alumno')
    AND ($1='admin' OR ($1='instructor' AND assigned_instructor_id=$2 AND status<>'baja') OR ($1='alumno' AND id=$2))
), results AS MATERIALIZED (
  SELECT r.aprobado,r.nota FROM examenes_resultadoexamen r JOIN scope p ON p.id=r.alumno_id
)
SELECT jsonb_build_object(
 'students',(SELECT count(*) FROM scope),
 'active_students',(SELECT count(*) FROM scope WHERE status='activo'),
 'pending_students',(SELECT count(*) FROM scope WHERE status='pendiente'),
 'blocked_students',(SELECT count(*) FROM scope WHERE status='bloqueado'),
 'rejected_students',(SELECT count(*) FROM scope WHERE status='rechazado'),
 'results',(SELECT count(*) FROM results),
 'passed',(SELECT count(*) FROM results WHERE aprobado),
 'average_grade',(SELECT COALESCE(round(avg(nota),1),0) FROM results),
 'materials',(SELECT count(*) FROM materiales_material m WHERE {material_scope} AND ($1<>'alumno' OR (m.activo AND NOT EXISTS (
   SELECT 1 FROM materiales_permisoaccesomaterial p WHERE p.alumno_id=$2 AND NOT p.permitido AND (p.material_id=m.id OR (p.material_id IS NULL AND p.categoria=m.categoria)))))),
 'completed_materials',(SELECT count(*) FROM materiales_materialcompletado c JOIN scope p ON p.id=c.alumno_id WHERE c.completado),
 'exams',(SELECT count(*) FROM examenes_examen e WHERE {exam_scope} AND ($1<>'alumno' OR (e.activo AND NOT EXISTS (
   SELECT 1 FROM examenes_bloqueoexamen b WHERE b.alumno_id=$2 AND b.bloqueado AND (b.fecha_inicio IS NULL OR b.fecha_inicio<=NOW()) AND (b.fecha_fin IS NULL OR b.fecha_fin>NOW()) AND (b.examen_id=e.id OR (b.examen_id IS NULL AND b.categoria=e.categoria)))))),
 'messages',CASE WHEN $1='admin' THEN NULL ELSE (SELECT count(*) FROM conexiones_mensaje m JOIN scope p ON p.id=m.alumno_id) END,
 'connections',(SELECT count(*) FROM conexiones_registroconexion r WHERE $1='admin' OR r.profile_id=$2 OR r.profile_id IN(SELECT id FROM scope)),
 'active_sessions',(SELECT count(DISTINCT p.id) FROM conexiones_registroconexion r JOIN accounts_userprofile p ON p.id=r.profile_id JOIN auth_user u ON u.id=p.user_id
   WHERE r.estado_sesion='activa' AND r.estado_acceso='correcto' AND EXISTS(SELECT 1 FROM auth_tab_session ats WHERE ats.session_key=r.session_id AND ats.revoked_at IS NULL AND ats.expires_at>clock_timestamp() AND ats.last_activity_at>clock_timestamp()-({idle_timeout} * INTERVAL '1 second')) AND p.status='activo' AND p.otp_verified AND u.is_active
     AND r.ultima_actividad>NOW()-({idle_timeout} * INTERVAL '1 second') AND ($1='admin' OR p.id=$2 OR p.id IN(SELECT id FROM scope)))
)"#,
        idle_timeout = crate::auth::IDLE_TIMEOUT_SECONDS,
        material_scope = crate::academic_scope::resource_scope("m", "subido_por_id", 1, 2),
        exam_scope = crate::academic_scope::resource_scope("e", "creado_por_id", 1, 2)
    )
}

pub async fn counts(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin", "instructor", "alumno"])?;
    let value = sqlx::query_scalar(&counts_sql())
        .bind(&claims.role)
        .bind(claims.profile_id)
        .fetch_one(state.pool.as_ref().ok_or(AppError::Unavailable)?)
        .await?;
    Ok(Json(value))
}
