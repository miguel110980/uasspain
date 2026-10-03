use std::sync::Arc;

use axum::{
    Json,
    extract::{
        Path, Query, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, StatusCode},
    response::Response,
};
use chrono::{DateTime, Utc};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{Executor, FromRow, Postgres};
use uuid::Uuid;

use crate::{
    AppState,
    auth::{Claims, authenticate, require_role, session_is_active},
    error::AppError,
};

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    alumno_id: Option<Uuid>,
    peer_id: Option<Uuid>,
    limit: Option<i64>,
    remitente: Option<String>,
    leido_alumno: Option<bool>,
    leido_instructor: Option<bool>,
    leido_destinatario: Option<bool>,
}
#[derive(Debug, Deserialize)]
pub struct DirectWrite {
    alumno_id: Option<Uuid>,
    contenido: String,
}
#[derive(Debug, Deserialize)]
pub struct DirectPatch {
    contenido: Option<String>,
    leido_alumno: Option<bool>,
    leido_instructor: Option<bool>,
}
#[derive(Debug, Deserialize)]
pub struct StudentAction {
    alumno_id: Option<Uuid>,
}
#[derive(Debug, Deserialize)]
pub struct StaffWrite {
    destinatario_id: Uuid,
    contenido: String,
}
#[derive(Debug, Deserialize)]
pub struct PeerAction {
    peer_id: Uuid,
}
#[derive(Debug, Deserialize)]
pub struct BroadcastWrite {
    recipient_ids: Vec<Uuid>,
    contenido: String,
}

#[derive(Debug, Deserialize)]
pub struct ConnectionQuery {
    alumno_id: Option<Uuid>,
    instructor_id: Option<Uuid>,
    estado: Option<String>,
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ConnectionWrite {
    alumno_id: Option<Uuid>,
    instructor_id: Option<Uuid>,
    estado: Option<String>,
    ultimo_mensaje: Option<String>,
    fecha_conexion: Option<DateTime<Utc>>,
    fecha_desconexion: Option<DateTime<Utc>>,
}

#[derive(Debug, FromRow, Serialize)]
pub struct ConnectionRecord {
    id: Uuid,
    alumno_id: Uuid,
    instructor_id: Option<Uuid>,
    alumno_nombre: String,
    estado: String,
    ultimo_mensaje: String,
    ultima_fecha: Option<DateTime<Utc>>,
    fecha_conexion: Option<DateTime<Utc>>,
    fecha_desconexion: Option<DateTime<Utc>>,
    created_date: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct AccessLogQuery {
    profile_id: Option<Uuid>,
    rol: Option<String>,
    estado_acceso: Option<String>,
    estado_sesion: Option<String>,
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct AccessLogPatch {
    id: Option<Uuid>,
    estado_sesion: Option<String>,
    ultima_actividad: Option<DateTime<Utc>>,
    fecha_cierre: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct BulkAccessLogPatch {
    items: Vec<AccessLogPatch>,
}

#[derive(Debug, Deserialize)]
pub struct DeleteManyRequest {
    query: DeleteManyQuery,
}

#[derive(Debug, Deserialize)]
pub struct DeleteManyQuery {
    ids: Option<Vec<Uuid>>,
    alumno_id: Option<Uuid>,
}

#[derive(Debug, FromRow, Serialize)]
pub struct AccessLogRecord {
    id: Uuid,
    profile_id: Option<Uuid>,
    usuario: String,
    nombre_completo: String,
    email: String,
    rol: String,
    fecha_hora: Option<DateTime<Utc>>,
    estado_acceso: String,
    motivo_fallo: String,
    metodo_autenticacion: String,
    ultima_actividad: Option<DateTime<Utc>>,
    direccion_ip: Option<String>,
    pais: String,
    ciudad: String,
    region: String,
    isp: String,
    hostname: String,
    zona_horaria: String,
    navegador: String,
    version_navegador: String,
    sistema_operativo: String,
    tipo_dispositivo: String,
    session_id: String,
    estado_sesion: String,
    tiempo_sesion: Option<i32>,
    fecha_cierre: Option<DateTime<Utc>>,
    created_date: DateTime<Utc>,
}

#[derive(Debug, FromRow, Serialize)]
pub struct DirectMessage {
    id: Uuid,
    alumno_id: Uuid,
    instructor_id: Option<Uuid>,
    conexion_id: Option<Uuid>,
    alumno_nombre: String,
    remitente: String,
    contenido: String,
    leido_alumno: bool,
    leido_instructor: bool,
    created_date: DateTime<Utc>,
}
#[derive(Debug, FromRow, Serialize)]
pub struct StaffMessage {
    id: Uuid,
    remitente_id: Uuid,
    destinatario_id: Uuid,
    contenido: String,
    sender_role: String,
    leido_destinatario: bool,
    created_date: DateTime<Utc>,
}
#[derive(Debug, FromRow)]
struct ContactRow {
    id: Uuid,
    user_id: Option<i32>,
    nombre: String,
    apellidos: String,
    role: String,
    roles: Value,
    status: String,
}

pub async fn list_connections(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<ConnectionQuery>,
) -> Result<Json<Vec<ConnectionRecord>>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let rows = sqlx::query_as::<_, ConnectionRecord>("SELECT id,alumno_id,instructor_id,alumno_nombre,estado,ultimo_mensaje,ultima_fecha,fecha_conexion,fecha_desconexion,created_date FROM conexiones_conexion WHERE ($1::uuid IS NULL OR alumno_id=$1) AND ($2::uuid IS NULL OR instructor_id=$2) AND ($3::text IS NULL OR estado=$3) ORDER BY ultima_fecha DESC NULLS LAST,created_date DESC LIMIT $4")
        .bind(if claims.role == "alumno" { Some(claims.profile_id) } else { query.alumno_id })
        .bind(if claims.role == "instructor" { Some(claims.profile_id) } else { query.instructor_id })
        .bind(query.estado)
        .bind(query.limit.unwrap_or(200).clamp(1, 500))
        .fetch_all(pool(&state)?).await?;
    decrypt_connections(rows, &state)
}

pub async fn create_connection(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<ConnectionWrite>,
) -> Result<(StatusCode, Json<ConnectionRecord>), AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let alumno = direct_student(&state, &claims, input.alumno_id).await?;
    let instructor: Option<Uuid> =
        sqlx::query_scalar("SELECT assigned_instructor_id FROM accounts_userprofile WHERE id=$1")
            .bind(alumno)
            .fetch_one(pool(&state)?)
            .await?;
    if let Some(requested) = input.instructor_id
        && Some(requested) != instructor
    {
        return Err(AppError::Forbidden);
    }
    let encrypted_name: String =
        sqlx::query_scalar("SELECT nombre FROM accounts_userprofile WHERE id=$1")
            .bind(alumno)
            .fetch_one(pool(&state)?)
            .await?;
    let id = Uuid::new_v4();
    let row = sqlx::query_as::<_, ConnectionRecord>("INSERT INTO conexiones_conexion (id,created_date,updated_date,alumno_id,instructor_id,alumno_nombre,estado,ultimo_mensaje,ultima_fecha,fecha_conexion,fecha_desconexion) VALUES ($1,NOW(),NOW(),$2,$3,$4,$5,$6,NULL,COALESCE($7,NOW()),$8) RETURNING id,alumno_id,instructor_id,alumno_nombre,estado,ultimo_mensaje,ultima_fecha,fecha_conexion,fecha_desconexion,created_date")
        .bind(id).bind(alumno).bind(instructor).bind(encrypted_name)
        .bind(input.estado.unwrap_or_else(|| "abierta".into()))
        .bind(state.cipher.encrypt(input.ultimo_mensaje.as_deref().unwrap_or_default())?)
        .bind(input.fecha_conexion).bind(input.fecha_desconexion)
        .fetch_one(pool(&state)?).await?;
    let row = decrypt_connections(vec![row], &state)?
        .0
        .pop()
        .ok_or(AppError::Internal)?;
    state
        .events
        .publish(
            "connections",
            json!({
                "type": "conexion",
                "action": "created",
                "id": row.id,
                "data": &row,
            }),
        )
        .await;
    Ok((StatusCode::CREATED, Json(row)))
}

pub async fn update_connection(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<ConnectionWrite>,
) -> Result<Json<ConnectionRecord>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let owner: Option<(Uuid, Option<Uuid>)> =
        sqlx::query_as("SELECT alumno_id,instructor_id FROM conexiones_conexion WHERE id=$1")
            .bind(id)
            .fetch_optional(pool(&state)?)
            .await?;
    let (alumno, instructor) = owner.ok_or(AppError::NotFound)?;
    if !connection_access(&claims, alumno, instructor) {
        return Err(AppError::Forbidden);
    }
    let encrypted_message = input
        .ultimo_mensaje
        .as_deref()
        .map(|value| state.cipher.encrypt(value))
        .transpose()?;
    let row = sqlx::query_as::<_, ConnectionRecord>("UPDATE conexiones_conexion SET estado=COALESCE($2,estado),ultimo_mensaje=COALESCE($3,ultimo_mensaje),ultima_fecha=CASE WHEN $3::text IS NULL THEN ultima_fecha ELSE NOW() END,fecha_conexion=COALESCE($4,fecha_conexion),fecha_desconexion=COALESCE($5,fecha_desconexion),updated_date=NOW() WHERE id=$1 RETURNING id,alumno_id,instructor_id,alumno_nombre,estado,ultimo_mensaje,ultima_fecha,fecha_conexion,fecha_desconexion,created_date")
        .bind(id).bind(input.estado).bind(encrypted_message).bind(input.fecha_conexion).bind(input.fecha_desconexion).fetch_one(pool(&state)?).await?;
    let row = decrypt_connections(vec![row], &state)?
        .0
        .pop()
        .ok_or(AppError::Internal)?;
    state
        .events
        .publish(
            "connections",
            json!({
                "type": "conexion",
                "action": "updated",
                "id": row.id,
                "data": &row,
            }),
        )
        .await;
    Ok(Json(row))
}

pub async fn delete_connection(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin", "instructor"])?;
    let result = if claims.role == "admin" {
        sqlx::query("DELETE FROM conexiones_conexion WHERE id=$1")
            .bind(id)
            .execute(pool(&state)?)
            .await?
    } else {
        sqlx::query("DELETE FROM conexiones_conexion WHERE id=$1 AND instructor_id=$2")
            .bind(id)
            .bind(claims.profile_id)
            .execute(pool(&state)?)
            .await?
    };
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    state
        .events
        .publish(
            "connections",
            json!({
                "type": "conexion",
                "action": "deleted",
                "id": id,
            }),
        )
        .await;
    Ok(StatusCode::NO_CONTENT)
}

/// Shared presence exposes identity and role, never access-log secrets or IP data.
pub async fn active_sessions(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<Value>>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin", "instructor", "alumno"])?;
    let rows = sqlx::query_scalar::<_, Value>("SELECT jsonb_build_object('id',r.id,'profile_id',p.id,'nombre_completo',r.nombre_completo,'rol',r.rol,'fecha_hora',r.fecha_hora,'ultima_actividad',r.ultima_actividad,'estado_sesion','activa') FROM conexiones_registroconexion r JOIN accounts_userprofile p ON p.id=r.profile_id JOIN auth_user u ON u.id=p.user_id WHERE r.estado_sesion='activa' AND r.estado_acceso='correcto' AND r.session_id=p.active_session_key AND p.status='activo' AND p.otp_verified AND u.is_active AND r.ultima_actividad > NOW()-INTERVAL '90 seconds' AND ($1 IN ('admin','instructor') OR p.id=$2 OR p.id=(SELECT assigned_instructor_id FROM accounts_userprofile WHERE id=$2)) ORDER BY r.fecha_hora DESC")
        .bind(&claims.role).bind(claims.profile_id).fetch_all(pool(&state)?).await?;
    let mut result = Vec::with_capacity(rows.len());
    for mut row in rows {
        row["nombre_completo"] = json!(
            state
                .cipher
                .decrypt(row["nombre_completo"].as_str().ok_or(AppError::Internal)?)?
        );
        result.push(row);
    }
    Ok(Json(result))
}

pub async fn list_access_logs(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<AccessLogQuery>,
) -> Result<Json<Vec<AccessLogRecord>>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin", "instructor"])?;
    let rows = sqlx::query_as::<_, AccessLogRecord>("SELECT id,profile_id,usuario,nombre_completo,email,rol,fecha_hora,estado_acceso,motivo_fallo,metodo_autenticacion,ultima_actividad,host(direccion_ip)::text AS direccion_ip,pais,ciudad,region,isp,hostname,zona_horaria,navegador,version_navegador,sistema_operativo,tipo_dispositivo,session_id,estado_sesion,tiempo_sesion::integer,fecha_cierre,created_date FROM conexiones_registroconexion WHERE ($1::text IS NULL OR rol=$1) AND ($2::text IS NULL OR estado_acceso=$2) AND ($3::text IS NULL OR estado_sesion=$3) AND ($5='admin' OR profile_id=$6 OR EXISTS (SELECT 1 FROM accounts_userprofile p WHERE p.id=profile_id AND p.assigned_instructor_id=$6)) AND ($7::uuid IS NULL OR profile_id=$7) ORDER BY fecha_hora DESC NULLS LAST,created_date DESC LIMIT $4")
        .bind(query.rol).bind(query.estado_acceso).bind(query.estado_sesion).bind(query.limit.unwrap_or(200).clamp(1,500)).bind(&claims.role).bind(claims.profile_id).bind(query.profile_id).fetch_all(pool(&state)?).await?;
    decrypt_access_logs(rows, &state)
}

pub async fn access_log_detail(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<AccessLogRecord>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin", "instructor"])?;
    let row = sqlx::query_as::<_, AccessLogRecord>("SELECT id,profile_id,usuario,nombre_completo,email,rol,fecha_hora,estado_acceso,motivo_fallo,metodo_autenticacion,ultima_actividad,host(direccion_ip)::text AS direccion_ip,pais,ciudad,region,isp,hostname,zona_horaria,navegador,version_navegador,sistema_operativo,tipo_dispositivo,session_id,estado_sesion,tiempo_sesion::integer,fecha_cierre,created_date FROM conexiones_registroconexion WHERE id=$1 AND ($2='admin' OR profile_id=$3 OR EXISTS (SELECT 1 FROM accounts_userprofile p WHERE p.id=profile_id AND p.assigned_instructor_id=$3))")
        .bind(id).bind(&claims.role).bind(claims.profile_id).fetch_optional(pool(&state)?).await?.ok_or(AppError::NotFound)?;
    let row = decrypt_access_logs(vec![row], &state)?
        .0
        .pop()
        .ok_or(AppError::Internal)?;
    Ok(Json(row))
}

pub async fn update_access_log(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<AccessLogPatch>,
) -> Result<Json<AccessLogRecord>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin"])?;
    validate_session_state(input.estado_sesion.as_deref())?;
    let row = update_access_row(pool(&state)?, id, &input).await?;
    let row = decrypt_access_logs(vec![row], &state)?
        .0
        .pop()
        .ok_or(AppError::Internal)?;
    state
        .events
        .publish(
            "connections",
            json!({"type":"conexion","action":"update","data":&row}),
        )
        .await;
    Ok(Json(row))
}

pub async fn bulk_update_access_logs(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<BulkAccessLogPatch>,
) -> Result<Json<Vec<AccessLogRecord>>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin"])?;
    if input.items.is_empty() || input.items.len() > 100 {
        return Err(AppError::Validation("Lote no válido.".into()));
    }
    let mut tx = pool(&state)?.begin().await?;
    let mut rows = Vec::with_capacity(input.items.len());
    for item in &input.items {
        validate_session_state(item.estado_sesion.as_deref())?;
        let id = item
            .id
            .ok_or_else(|| AppError::Validation("id es obligatorio.".into()))?;
        rows.push(update_access_row(&mut *tx, id, item).await?);
    }
    tx.commit().await?;
    let rows = decrypt_access_logs(rows, &state)?.0;
    state
        .events
        .publish(
            "connections",
            json!({"type":"conexion","action":"bulk_update","count":rows.len()}),
        )
        .await;
    Ok(Json(rows))
}

pub async fn delete_access_log(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin", "instructor"])?;
    let deleted = sqlx::query("DELETE FROM conexiones_registroconexion WHERE id=$1")
        .bind(id)
        .execute(pool(&state)?)
        .await?
        .rows_affected();
    if deleted == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete_access_logs_many(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<DeleteManyRequest>,
) -> Result<Json<Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin", "instructor"])?;
    let ids = bounded_ids(input.query.ids)?;
    let deleted = sqlx::query("DELETE FROM conexiones_registroconexion WHERE id = ANY($1)")
        .bind(&ids)
        .execute(pool(&state)?)
        .await?
        .rows_affected();
    state
        .events
        .publish(
            "connections",
            json!({"type":"conexion","action":"delete","count":deleted}),
        )
        .await;
    Ok(Json(json!({"deleted":deleted})))
}

pub async fn delete_connections_many(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<DeleteManyRequest>,
) -> Result<Json<Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin"])?;
    let student = input
        .query
        .alumno_id
        .ok_or_else(|| AppError::Validation("alumno_id es obligatorio.".into()))?;
    let deleted = sqlx::query("DELETE FROM conexiones_conexion WHERE alumno_id=$1")
        .bind(student)
        .execute(pool(&state)?)
        .await?
        .rows_affected();
    state
        .events
        .publish(
            "connections",
            json!({"type":"conexion","action":"delete","count":deleted}),
        )
        .await;
    Ok(Json(json!({"deleted":deleted})))
}

pub async fn delete_messages_many(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<DeleteManyRequest>,
) -> Result<Json<Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin"])?;
    let student = input
        .query
        .alumno_id
        .ok_or_else(|| AppError::Validation("alumno_id es obligatorio.".into()))?;
    let deleted = sqlx::query("DELETE FROM conexiones_mensaje WHERE alumno_id=$1")
        .bind(student)
        .execute(pool(&state)?)
        .await?
        .rows_affected();
    Ok(Json(json!({"deleted":deleted})))
}

pub async fn list_messages(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<ListQuery>,
) -> Result<Json<Vec<DirectMessage>>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    if query.alumno_id.is_some() {
        direct_student(&state, &claims, query.alumno_id).await?;
    }
    let rows = sqlx::query_as::<_, DirectMessage>("SELECT m.id,m.alumno_id,m.instructor_id,m.conexion_id,m.alumno_nombre,m.remitente,m.contenido,m.leido_alumno,m.leido_instructor,m.created_date FROM conexiones_mensaje m JOIN accounts_userprofile p ON p.id=m.alumno_id WHERE ($1='admin' OR ($1='alumno' AND m.alumno_id=$2) OR ($1='instructor' AND p.assigned_instructor_id=$2)) AND ($3::uuid IS NULL OR m.alumno_id=$3) AND ($4::text IS NULL OR m.remitente=$4) AND ($5::boolean IS NULL OR m.leido_alumno=$5) AND ($6::boolean IS NULL OR m.leido_instructor=$6) ORDER BY m.created_date ASC LIMIT $7")
        .bind(&claims.role).bind(claims.profile_id).bind(query.alumno_id).bind(query.remitente)
        .bind(query.leido_alumno).bind(query.leido_instructor).bind(query.limit.unwrap_or(500).clamp(1,1000))
        .fetch_all(pool(&state)?).await?;
    decrypt_direct(rows, &state)
}

pub async fn create_message(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<DirectWrite>,
) -> Result<(StatusCode, Json<DirectMessage>), AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    if claims.role == "admin" {
        return Err(AppError::Forbidden);
    }
    let alumno = direct_student(&state, &claims, input.alumno_id).await?;
    let content = message(&input.contenido)?;
    let instructor: Option<Uuid> =
        sqlx::query_scalar("SELECT assigned_instructor_id FROM accounts_userprofile WHERE id=$1")
            .bind(alumno)
            .fetch_one(pool(&state)?)
            .await?;
    if claims.role == "instructor" && instructor != Some(claims.profile_id) {
        return Err(AppError::Forbidden);
    }
    let id = Uuid::new_v4();
    let row=sqlx::query_as::<_,DirectMessage>("INSERT INTO conexiones_mensaje (id,created_date,updated_date,alumno_id,instructor_id,conexion_id,alumno_nombre,remitente,contenido,leido_alumno,leido_instructor) VALUES ($1,NOW(),NOW(),$2,$3,NULL,'',$4,$5,FALSE,FALSE) RETURNING id,alumno_id,instructor_id,conexion_id,alumno_nombre,remitente,contenido,leido_alumno,leido_instructor,created_date")
        .bind(id).bind(alumno).bind(instructor).bind(&claims.role).bind(state.cipher.encrypt(content)?).fetch_one(pool(&state)?).await?;
    let row = decrypt_direct(vec![row], &state)?
        .0
        .pop()
        .ok_or(AppError::Internal)?;
    state
        .events
        .publish(
            format!("chat:{alumno}"),
            json!({
                "type": "message",
                "room_id": alumno.to_string(),
                "sender_id": claims.profile_id,
                "content": &row.contenido,
            }),
        )
        .await;
    state
        .events
        .publish("connections", json!({"type":"mensaje", "action":"created"}))
        .await;
    Ok((StatusCode::CREATED, Json(row)))
}

pub async fn message_detail(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<DirectMessage>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let row=sqlx::query_as::<_,DirectMessage>("SELECT id,alumno_id,instructor_id,conexion_id,alumno_nombre,remitente,contenido,leido_alumno,leido_instructor,created_date FROM conexiones_mensaje WHERE id=$1").bind(id).fetch_optional(pool(&state)?).await?.ok_or(AppError::NotFound)?;
    direct_student(&state, &claims, Some(row.alumno_id)).await?;
    let row = decrypt_direct(vec![row], &state)?
        .0
        .pop()
        .ok_or(AppError::Internal)?;
    Ok(Json(row))
}

pub async fn update_message(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<DirectPatch>,
) -> Result<Json<DirectMessage>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let current: Option<(Uuid, String)> =
        sqlx::query_as("SELECT alumno_id,remitente FROM conexiones_mensaje WHERE id=$1")
            .bind(id)
            .fetch_optional(pool(&state)?)
            .await?;
    let (student, sender) = current.ok_or(AppError::NotFound)?;
    direct_student(&state, &claims, Some(student)).await?;
    if claims.role != "admin" && input.contenido.is_some() && sender != claims.role {
        return Err(AppError::Forbidden);
    }
    if (claims.role == "alumno" && input.leido_instructor.is_some())
        || (claims.role == "instructor" && input.leido_alumno.is_some())
    {
        return Err(AppError::Forbidden);
    }
    let content = input
        .contenido
        .as_deref()
        .map(message)
        .transpose()?
        .map(|v| state.cipher.encrypt(v))
        .transpose()?;
    let row=sqlx::query_as::<_,DirectMessage>("UPDATE conexiones_mensaje SET contenido=COALESCE($2,contenido),leido_alumno=COALESCE($3,leido_alumno),leido_instructor=COALESCE($4,leido_instructor),updated_date=NOW() WHERE id=$1 RETURNING id,alumno_id,instructor_id,conexion_id,alumno_nombre,remitente,contenido,leido_alumno,leido_instructor,created_date").bind(id).bind(content).bind(input.leido_alumno).bind(input.leido_instructor).fetch_one(pool(&state)?).await?;
    let row = decrypt_direct(vec![row], &state)?
        .0
        .pop()
        .ok_or(AppError::Internal)?;
    Ok(Json(row))
}

pub async fn delete_message(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let current: Option<(Uuid, String)> =
        sqlx::query_as("SELECT alumno_id,remitente FROM conexiones_mensaje WHERE id=$1")
            .bind(id)
            .fetch_optional(pool(&state)?)
            .await?;
    let (student, sender) = current.ok_or(AppError::NotFound)?;
    direct_student(&state, &claims, Some(student)).await?;
    if claims.role != "admin" && sender != claims.role {
        return Err(AppError::Forbidden);
    }
    sqlx::query("DELETE FROM conexiones_mensaje WHERE id=$1")
        .bind(id)
        .execute(pool(&state)?)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn direct_broadcast(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<BroadcastWrite>,
) -> Result<(StatusCode, Json<Vec<DirectMessage>>), AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["instructor"])?;
    if input.recipient_ids.is_empty() || input.recipient_ids.len() > 100 {
        return Err(AppError::Validation(
            "Lista de destinatarios no válida.".into(),
        ));
    }
    let content = message(&input.contenido)?;
    let mut created = Vec::with_capacity(input.recipient_ids.len());
    for student in input.recipient_ids {
        direct_student(&state, &claims, Some(student)).await?;
        let row=sqlx::query_as::<_,DirectMessage>("INSERT INTO conexiones_mensaje (id,created_date,updated_date,alumno_id,instructor_id,conexion_id,alumno_nombre,remitente,contenido,leido_alumno,leido_instructor) VALUES ($1,NOW(),NOW(),$2,$3,NULL,'','instructor',$4,FALSE,FALSE) RETURNING id,alumno_id,instructor_id,conexion_id,alumno_nombre,remitente,contenido,leido_alumno,leido_instructor,created_date").bind(Uuid::new_v4()).bind(student).bind(claims.profile_id).bind(state.cipher.encrypt(content)?).fetch_one(pool(&state)?).await?;
        created.push(
            decrypt_direct(vec![row], &state)?
                .0
                .pop()
                .ok_or(AppError::Internal)?,
        );
    }
    Ok((StatusCode::CREATED, Json(created)))
}

pub async fn mark_read(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<StudentAction>,
) -> Result<Json<Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let alumno = direct_student(&state, &claims, input.alumno_id).await?;
    let sql = if claims.role == "alumno" {
        "UPDATE conexiones_mensaje SET leido_alumno=TRUE,updated_date=NOW() WHERE alumno_id=$1 AND remitente='instructor' AND NOT leido_alumno"
    } else {
        "UPDATE conexiones_mensaje SET leido_instructor=TRUE,updated_date=NOW() WHERE alumno_id=$1 AND remitente='alumno' AND NOT leido_instructor"
    };
    let updated = sqlx::query(sql)
        .bind(alumno)
        .execute(pool(&state)?)
        .await?
        .rows_affected();
    Ok(Json(json!({"updated":updated})))
}
pub async fn clear_chat(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<StudentAction>,
) -> Result<Json<Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    let alumno = direct_student(&state, &claims, input.alumno_id).await?;
    let deleted = sqlx::query("DELETE FROM conexiones_mensaje WHERE alumno_id=$1")
        .bind(alumno)
        .execute(pool(&state)?)
        .await?
        .rows_affected();
    sqlx::query("UPDATE conexiones_conexion SET ultimo_mensaje='',ultima_fecha=NULL,updated_date=NOW() WHERE alumno_id=$1").bind(alumno).execute(pool(&state)?).await?;
    Ok(Json(
        json!({"detail":"Conversación limpiada correctamente.","deleted":deleted}),
    ))
}

pub async fn list_staff(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<ListQuery>,
) -> Result<Json<Vec<StaffMessage>>, AppError> {
    let claims = staff(&state, &headers)?;
    let peer = query.peer_id;
    let rows=sqlx::query_as::<_,StaffMessage>("SELECT id,remitente_id,destinatario_id,contenido,sender_role,leido_destinatario,created_date FROM conexiones_mensajestaff WHERE (remitente_id=$1 OR destinatario_id=$1) AND ($2::uuid IS NULL OR (remitente_id=$2 OR destinatario_id=$2)) AND ($4::boolean IS NULL OR (destinatario_id=$1 AND leido_destinatario=$4)) ORDER BY created_date,id LIMIT $3")
        .bind(claims.profile_id).bind(peer).bind(query.limit.unwrap_or(500).clamp(1,500)).bind(query.leido_destinatario).fetch_all(pool(&state)?).await?;
    decrypt_staff(rows, &state)
}
pub async fn create_staff(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<StaffWrite>,
) -> Result<(StatusCode, Json<StaffMessage>), AppError> {
    let claims = staff(&state, &headers)?;
    authorize_staff_pair(&state, &claims, input.destinatario_id).await?;
    let content = message(&input.contenido)?;
    let row = insert_staff(&state, &claims, input.destinatario_id, content).await?;
    Ok((StatusCode::CREATED, Json(row)))
}
pub async fn staff_detail(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<StaffMessage>, AppError> {
    let claims = staff(&state, &headers)?;
    let row=sqlx::query_as::<_,StaffMessage>("SELECT id,remitente_id,destinatario_id,contenido,sender_role,leido_destinatario,created_date FROM conexiones_mensajestaff WHERE id=$1 AND (remitente_id=$2 OR destinatario_id=$2)").bind(id).bind(claims.profile_id).fetch_optional(pool(&state)?).await?.ok_or(AppError::NotFound)?;
    let row = decrypt_staff(vec![row], &state)?
        .0
        .pop()
        .ok_or(AppError::Internal)?;
    Ok(Json(row))
}
pub async fn contacts(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<Value>>, AppError> {
    let claims = staff(&state, &headers)?;
    let rows=sqlx::query_as::<_,ContactRow>("SELECT id,user_id,nombre,apellidos,role,roles,status FROM accounts_userprofile WHERE id<>$1 AND status='activo' AND (role IN ('admin','instructor') OR roles ?| ARRAY['admin','instructor']) ORDER BY id").bind(claims.profile_id).fetch_all(pool(&state)?).await?;
    let values=rows.into_iter().map(|row|Ok(json!({"id":row.id,"user_id":row.user_id,"nombre":state.cipher.decrypt(&row.nombre)?,"apellidos":state.cipher.decrypt(&row.apellidos)?,"role":row.role,"roles":row.roles,"status":row.status}))).collect::<Result<Vec<_>,AppError>>()?;
    Ok(Json(values))
}
pub async fn staff_mark_read(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<PeerAction>,
) -> Result<Json<Value>, AppError> {
    let claims = staff(&state, &headers)?;
    let updated=sqlx::query("UPDATE conexiones_mensajestaff SET leido_destinatario=TRUE,updated_date=NOW() WHERE remitente_id=$1 AND destinatario_id=$2 AND NOT leido_destinatario").bind(input.peer_id).bind(claims.profile_id).execute(pool(&state)?).await?.rows_affected();
    Ok(Json(json!({"updated":updated})))
}
pub async fn staff_clear(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<PeerAction>,
) -> Result<Json<Value>, AppError> {
    let claims = staff(&state, &headers)?;
    authorize_staff_pair(&state, &claims, input.peer_id).await?;
    let deleted=sqlx::query("DELETE FROM conexiones_mensajestaff WHERE (remitente_id=$1 AND destinatario_id=$2) OR (remitente_id=$2 AND destinatario_id=$1)").bind(claims.profile_id).bind(input.peer_id).execute(pool(&state)?).await?.rows_affected();
    Ok(Json(
        json!({"detail":"Conversación limpiada correctamente.","deleted":deleted}),
    ))
}
pub async fn staff_broadcast(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<BroadcastWrite>,
) -> Result<(StatusCode, Json<Vec<StaffMessage>>), AppError> {
    let claims = staff(&state, &headers)?;
    require_role(&claims, &["admin"])?;
    if input.recipient_ids.is_empty() || input.recipient_ids.len() > 100 {
        return Err(AppError::Validation(
            "Lista de destinatarios no válida.".into(),
        ));
    }
    let content = message(&input.contenido)?;
    let mut created = Vec::new();
    for id in input.recipient_ids {
        authorize_staff_pair(&state, &claims, id).await?;
        created.push(insert_staff(&state, &claims, id, content).await?);
    }
    Ok((StatusCode::CREATED, Json(created)))
}

pub async fn staff_unread(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    let claims = staff(&state, &headers)?;
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM conexiones_mensajestaff WHERE destinatario_id=$1 AND NOT leido_destinatario")
        .bind(claims.profile_id).fetch_one(pool(&state)?).await?;
    Ok(Json(json!({"count": count})))
}

pub async fn staff_summaries(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<Value>>, AppError> {
    let claims = staff(&state, &headers)?;
    let rows = sqlx::query_as::<_, StaffMessage>("SELECT DISTINCT ON (CASE WHEN remitente_id=$1 THEN destinatario_id ELSE remitente_id END) id,remitente_id,destinatario_id,contenido,sender_role,leido_destinatario,created_date FROM conexiones_mensajestaff WHERE remitente_id=$1 OR destinatario_id=$1 ORDER BY CASE WHEN remitente_id=$1 THEN destinatario_id ELSE remitente_id END,created_date DESC,id DESC")
        .bind(claims.profile_id).fetch_all(pool(&state)?).await?;
    let messages = decrypt_staff(rows, &state)?.0;
    let mut result = Vec::with_capacity(messages.len());
    for message in messages {
        let peer = if message.remitente_id == claims.profile_id {
            message.destinatario_id
        } else {
            message.remitente_id
        };
        let unread: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM conexiones_mensajestaff WHERE remitente_id=$1 AND destinatario_id=$2 AND NOT leido_destinatario")
            .bind(peer).bind(claims.profile_id).fetch_one(pool(&state)?).await?;
        result.push(json!({"peer_id":peer,"last_message":message,"unread":unread}));
    }
    Ok(Json(result))
}

pub async fn connections_socket(
    upgrade: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    if !crate::chat::origin_allowed(&headers) {
        return Err(AppError::Forbidden);
    }
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin", "instructor", "alumno"])?;
    Ok(upgrade
        .max_message_size(16 * 1024)
        .on_upgrade(move |socket| run_connections_socket(socket, state, claims)))
}

async fn run_connections_socket(socket: WebSocket, state: Arc<AppState>, claims: Claims) {
    let (mut output, mut input) = socket.split();
    let mut events = state.events.subscribe();
    let mut heartbeat = tokio::time::interval(std::time::Duration::from_secs(25));
    loop {
        tokio::select! {
            incoming = input.next() => match incoming {
                Some(Ok(Message::Text(text))) if text.len() <= 16 * 1024 => {
                    if !session_is_active(&state, &claims).await.unwrap_or(false) { break; }
                    if serde_json::from_str::<Value>(&text).ok().and_then(|v| v.get("type").and_then(Value::as_str).map(str::to_owned)).as_deref() == Some("ping")
                        && output.send(Message::Text(json!({"type":"pong"}).to_string().into())).await.is_err() { break; }
                }
                Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                _ => {}
            },
            event = events.recv() => match event {
                Ok(event) if event.topic == "connections" => {
                    if !session_is_active(&state, &claims).await.unwrap_or(false) { break; }
                    // Personal data and access logs are only visible to administrators.
                    // Other roles receive an invalidation notice and re-fetch their scoped API.
                    let payload = if claims.role == "admin" { event.payload } else {
                        json!({"type":event.payload.get("type"), "action":event.payload.get("action")})
                    };
                    if output.send(Message::Text(payload.to_string().into())).await.is_err() { break; }
                },
                Ok(_) => {}
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    if output.send(Message::Text(json!({"type":"resync_required"}).to_string().into())).await.is_err() { break; }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            },
            _ = heartbeat.tick() => {
                if !session_is_active(&state, &claims).await.unwrap_or(false)
                    || output.send(Message::Ping(Vec::new().into())).await.is_err() { break; }
                if let Ok(pool) = pool(&state) {
                    let _ = sqlx::query("UPDATE conexiones_registroconexion SET ultima_actividad=NOW(),updated_date=NOW() WHERE profile_id=$1 AND session_id=$2 AND estado_sesion='activa'")
                        .bind(claims.profile_id).bind(&claims.session_key).execute(pool).await;
                }
            },
        }
    }
}

async fn insert_staff(
    state: &AppState,
    claims: &Claims,
    destination: Uuid,
    content: &str,
) -> Result<StaffMessage, AppError> {
    let row=sqlx::query_as::<_,StaffMessage>("INSERT INTO conexiones_mensajestaff (id,created_date,updated_date,remitente_id,destinatario_id,contenido,sender_role,leido_destinatario) VALUES ($1,NOW(),NOW(),$2,$3,$4,$5,FALSE) RETURNING id,remitente_id,destinatario_id,contenido,sender_role,leido_destinatario,created_date").bind(Uuid::new_v4()).bind(claims.profile_id).bind(destination).bind(state.cipher.encrypt(content)?).bind(&claims.role).fetch_one(pool(state)?).await?;
    let row = decrypt_staff(vec![row], state)?
        .0
        .pop()
        .ok_or(AppError::Internal)?;
    let room_id = crate::chat::staff_room(claims.profile_id, destination);
    state.events.publish(format!("chat:{room_id}"), json!({
        "type": "message", "room_id": room_id, "sender_id": claims.profile_id, "content": content
    })).await;
    state
        .events
        .publish(
            "connections",
            json!({"type":"mensaje_staff", "action":"created"}),
        )
        .await;
    Ok(row)
}
async fn direct_student(
    state: &AppState,
    claims: &Claims,
    requested: Option<Uuid>,
) -> Result<Uuid, AppError> {
    match claims.role.as_str() {
        "alumno" => {
            if requested.is_some_and(|id| id != claims.profile_id) {
                return Err(AppError::Forbidden);
            }
            Ok(claims.profile_id)
        }
        "instructor" => {
            let id = requested
                .ok_or_else(|| AppError::Validation("alumno_id es obligatorio.".into()))?;
            let ok:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM accounts_userprofile WHERE id=$1 AND assigned_instructor_id=$2)").bind(id).bind(claims.profile_id).fetch_one(pool(state)?).await?;
            ok.then_some(id).ok_or(AppError::Forbidden)
        }
        "admin" => {
            requested.ok_or_else(|| AppError::Validation("alumno_id es obligatorio.".into()))
        }
        _ => Err(AppError::Forbidden),
    }
}
async fn authorize_staff_pair(
    state: &AppState,
    claims: &Claims,
    peer: Uuid,
) -> Result<(), AppError> {
    let peer_role: Option<String> =
        sqlx::query_scalar("SELECT role FROM accounts_userprofile WHERE id=$1 AND status='activo'")
            .bind(peer)
            .fetch_optional(pool(state)?)
            .await?;
    matches!(
        (claims.role.as_str(), peer_role.as_deref()),
        ("admin", Some("instructor")) | ("instructor", Some("admin"))
    )
    .then_some(())
    .ok_or(AppError::Forbidden)
}
fn decrypt_direct(
    mut rows: Vec<DirectMessage>,
    state: &AppState,
) -> Result<Json<Vec<DirectMessage>>, AppError> {
    for row in &mut rows {
        row.contenido = state.cipher.decrypt(&row.contenido)?;
        row.alumno_nombre = state.cipher.decrypt(&row.alumno_nombre)?;
    }
    Ok(Json(rows))
}
fn decrypt_staff(
    mut rows: Vec<StaffMessage>,
    state: &AppState,
) -> Result<Json<Vec<StaffMessage>>, AppError> {
    for row in &mut rows {
        row.contenido = state.cipher.decrypt(&row.contenido)?;
    }
    Ok(Json(rows))
}
fn decrypt_connections(
    mut rows: Vec<ConnectionRecord>,
    state: &AppState,
) -> Result<Json<Vec<ConnectionRecord>>, AppError> {
    for row in &mut rows {
        row.alumno_nombre = state.cipher.decrypt(&row.alumno_nombre)?;
        row.ultimo_mensaje = state.cipher.decrypt(&row.ultimo_mensaje)?;
    }
    Ok(Json(rows))
}
fn decrypt_access_logs(
    mut rows: Vec<AccessLogRecord>,
    state: &AppState,
) -> Result<Json<Vec<AccessLogRecord>>, AppError> {
    for row in &mut rows {
        for field in [
            &mut row.usuario,
            &mut row.nombre_completo,
            &mut row.email,
            &mut row.motivo_fallo,
            &mut row.pais,
            &mut row.ciudad,
            &mut row.region,
            &mut row.isp,
            &mut row.hostname,
            &mut row.zona_horaria,
            &mut row.navegador,
            &mut row.version_navegador,
            &mut row.sistema_operativo,
            &mut row.tipo_dispositivo,
        ] {
            *field = state.cipher.decrypt(field)?;
        }
    }
    Ok(Json(rows))
}
fn connection_access(claims: &Claims, student: Uuid, instructor: Option<Uuid>) -> bool {
    claims.role == "admin"
        || (claims.role == "alumno" && claims.profile_id == student)
        || (claims.role == "instructor" && instructor == Some(claims.profile_id))
}
fn message(value: &str) -> Result<&str, AppError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 4000 {
        return Err(AppError::Validation(
            "El mensaje es obligatorio y no puede superar 4000 caracteres.".into(),
        ));
    }
    Ok(value)
}
async fn update_access_row<'e, E>(
    executor: E,
    id: Uuid,
    input: &AccessLogPatch,
) -> Result<AccessLogRecord, AppError>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query_as::<_, AccessLogRecord>("UPDATE conexiones_registroconexion SET estado_sesion=COALESCE($2,estado_sesion),ultima_actividad=COALESCE($3,ultima_actividad),fecha_cierre=COALESCE($4,fecha_cierre),updated_date=NOW() WHERE id=$1 RETURNING id,profile_id,usuario,nombre_completo,email,rol,fecha_hora,estado_acceso,motivo_fallo,metodo_autenticacion,ultima_actividad,host(direccion_ip)::text AS direccion_ip,pais,ciudad,region,isp,hostname,zona_horaria,navegador,version_navegador,sistema_operativo,tipo_dispositivo,session_id,estado_sesion,tiempo_sesion::integer,fecha_cierre,created_date")
        .bind(id)
        .bind(input.estado_sesion.as_deref())
        .bind(input.ultima_actividad)
        .bind(input.fecha_cierre)
        .fetch_optional(executor)
        .await?
        .ok_or(AppError::NotFound)
}
fn validate_session_state(value: Option<&str>) -> Result<(), AppError> {
    if value.is_some_and(|state| !matches!(state, "activa" | "finalizada" | "expirada")) {
        return Err(AppError::Validation("Estado de sesión no válido.".into()));
    }
    Ok(())
}
fn bounded_ids(ids: Option<Vec<Uuid>>) -> Result<Vec<Uuid>, AppError> {
    let mut ids = ids.unwrap_or_default();
    ids.sort_unstable();
    ids.dedup();
    if ids.is_empty() || ids.len() > 500 {
        return Err(AppError::Validation("Lista de ids no válida.".into()));
    }
    Ok(ids)
}
fn pool(state: &AppState) -> Result<&sqlx::PgPool, AppError> {
    state.pool.as_ref().ok_or(AppError::Unavailable)
}
fn staff(state: &AppState, headers: &HeaderMap) -> Result<Claims, AppError> {
    let claims = authenticate(state, headers, "access")?;
    require_role(&claims, &["admin", "instructor"])?;
    Ok(claims)
}

#[cfg(test)]
mod tests {
    use super::message;
    use crate::cache::EventBus;
    use serde_json::json;
    #[test]
    fn message_bounds() {
        assert!(message(" ").is_err());
        assert!(message("hola").is_ok());
        assert!(message(&"x".repeat(4001)).is_err());
    }

    #[tokio::test]
    async fn connection_events_are_fanned_out() {
        let hub = EventBus::default();
        let mut receiver = hub.subscribe();
        hub.publish("connections", json!({"type":"conexion","action":"updated"}))
            .await;
        let event = receiver.recv().await.expect("event");
        assert_eq!(event.payload["action"], "updated");
    }
}
