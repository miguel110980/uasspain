//! Independent operation history. Artifact identity and recovery metadata never
//! live here; only completed, explicitly selected history IDs can be cleared.
use super::*;

const RECOVERY_TABLES: [&str; 6] = [
    "backups_backupserver",
    "backups_backupconfig",
    "backups_backupjob",
    "backups_restoretestlog",
    "backups_operation",
    "core_auditlog",
];

pub async fn snapshot_catalog(pool: &PgPool) -> Result<Vec<(&'static str, Value)>, AppError> {
    let mut result = Vec::new();
    for table in RECOVERY_TABLES {
        let rows: Value = sqlx::query_scalar(&format!(
            "SELECT COALESCE(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM {table} t"
        ))
        .fetch_one(pool)
        .await?;
        result.push((table, rows));
    }
    Ok(result)
}

pub async fn preserve_catalog(pool: &PgPool, snapshot: &[(&str, Value)]) -> Result<(), AppError> {
    let mut tx = pool.begin().await?;
    for (table, rows) in snapshot {
        if !RECOVERY_TABLES.contains(table) {
            return Err(AppError::Internal);
        }
        let assignments:String=sqlx::query_scalar("SELECT string_agg(format('%I=EXCLUDED.%I',attname,attname),',') FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped AND attname<>'id'")
            .bind(table).fetch_one(&mut *tx).await?;
        sqlx::query(&format!("INSERT INTO {table} SELECT * FROM jsonb_populate_recordset(NULL::{table},$1) ON CONFLICT(id) DO UPDATE SET {assignments}"))
            .bind(rows).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}

#[derive(FromRow, Serialize)]
pub struct Operation {
    id: Uuid,
    backup_job_id: Option<Uuid>,
    operation_type: String,
    destination: String,
    status: String,
    started_at: DateTime<Utc>,
    finished_at: Option<DateTime<Utc>>,
    duration_milliseconds: Option<i64>,
    message: String,
    details: Value,
}

#[derive(Deserialize)]
pub struct ClearRequest {
    pub confirmed: bool,
    pub ids: Vec<Uuid>,
}

pub async fn history(pool: &PgPool, query: HistoryQuery) -> Result<Json<Vec<Operation>>, AppError> {
    Ok(Json(
        sqlx::query_as(
            "SELECT * FROM backups_operation ORDER BY started_at DESC,id DESC LIMIT $1 OFFSET $2",
        )
        .bind(query.limit.unwrap_or(50).clamp(1, 100))
        .bind(query.offset.unwrap_or(0).max(0))
        .fetch_all(pool)
        .await?,
    ))
}

pub async fn clear(
    pool: &PgPool,
    actor: Uuid,
    input: ClearRequest,
) -> Result<Json<Value>, AppError> {
    if !input.confirmed || input.ids.is_empty() || input.ids.len() > 100 {
        return Err(AppError::Validation(
            "Confirma los registros visibles que deseas limpiar (máximo 100).".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    let removed: Vec<Uuid> = sqlx::query_scalar(
        "DELETE FROM backups_operation WHERE id=ANY($1) AND finished_at IS NOT NULL RETURNING id",
    )
    .bind(&input.ids)
    .fetch_all(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO core_auditlog (id,created_date,updated_date,model_name,instance_id,action,extra,profile_id) VALUES ($1,NOW(),NOW(),'BackupOperation',$2,'backup_history_clear',$3,$4)")
        .bind(Uuid::new_v4()).bind(actor.to_string()).bind(json!({"removed_operation_ids":removed,"count":removed.len()})).bind(actor)
        .execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"cleared":removed.len(),"ids":removed})))
}

pub async fn begin(pool: &PgPool, kind: &str, job: Uuid, origin: &str) -> Result<Uuid, AppError> {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO backups_operation (id,backup_job_id,operation_type,destination,status,started_at) VALUES ($1,$2,$3,$4,'running',NOW())")
        .bind(id).bind(job).bind(kind).bind(origin).execute(pool).await?;
    Ok(id)
}

pub async fn finish(
    pool: &PgPool,
    id: Uuid,
    status: &str,
    message: &str,
    details: Value,
) -> Result<(), AppError> {
    sqlx::query("UPDATE backups_operation SET status=$2,finished_at=NOW(),duration_milliseconds=GREATEST(1,(EXTRACT(EPOCH FROM NOW()-started_at)*1000)::bigint),message=$3,details=$4 WHERE id=$1")
        .bind(id).bind(status).bind(message).bind(details).execute(pool).await?;
    Ok(())
}

pub async fn record_check(
    pool: &PgPool,
    job: Uuid,
    origin: &str,
    kind: &str,
    result: &Result<Json<Value>, AppError>,
) -> Result<(), AppError> {
    let success = result.as_ref().is_ok_and(|Json(v)| {
        v.get("valid")
            .or_else(|| v.get("success"))
            .and_then(Value::as_bool)
            == Some(true)
    });
    let errors = match result {
        Ok(Json(v)) => v.get("errors").cloned().unwrap_or(json!([])),
        Err(_) => json!(["artifact_unavailable_or_invalid"]),
    };
    sqlx::query("UPDATE backups_backupjob SET replica_checks=jsonb_set(replica_checks,ARRAY[$2],COALESCE(replica_checks->$2,'{}'::jsonb)||jsonb_build_object($3::text,jsonb_build_object('success',$4::boolean,'checked_at',NOW(),'errors',$5::jsonb)),true) WHERE id=$1")
        .bind(job).bind(origin).bind(kind).bind(success).bind(errors).execute(pool).await?;
    if kind == "integrity" {
        if origin != "auto" {
            sqlx::query(
                "UPDATE backups_backupjob SET replica_checks=replica_checks-'auto' WHERE id=$1",
            )
            .bind(job)
            .execute(pool)
            .await?;
        }
        sqlx::query("UPDATE backups_backupjob SET verified=EXISTS(SELECT 1 FROM jsonb_each(replica_checks) c WHERE c.value->'integrity'->>'success'='true'),verified_checksum=CASE WHEN EXISTS(SELECT 1 FROM jsonb_each(replica_checks) c WHERE c.value->'integrity'->>'success'='true') THEN checksum ELSE '' END WHERE id=$1")
            .bind(job).execute(pool).await?;
    }
    Ok(())
}
