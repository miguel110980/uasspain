use std::{
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Instant,
};

use axum::{
    Json,
    extract::{Path as AxumPath, Query, State},
    http::{HeaderMap, StatusCode},
};
use chrono::{DateTime, Datelike, Local, Timelike, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, PgPool};
use tokio::{
    fs,
    process::Command,
    time::{Duration, timeout},
};
use uuid::Uuid;

use crate::{
    AppState,
    auth::{Claims, authenticate, require_role},
    error::AppError,
};

const BACKUP_LOCK_KEY: i64 = 20_260_925;

#[derive(Clone, Debug, FromRow, Serialize)]
pub struct BackupJob {
    id: Uuid,
    job_type: String,
    status: String,
    started_at: DateTime<Utc>,
    finished_at: Option<DateTime<Utc>>,
    duration_seconds: i32,
    size_bytes: i64,
    encrypted: bool,
    checksum: String,
    storage_path: String,
    media_path: String,
    media_checksum: String,
    media_size_bytes: i64,
    remote_paths: Value,
    destinations: Value,
    verified: bool,
    verified_at: Option<DateTime<Utc>>,
    verified_checksum: String,
    restore_tested: bool,
    restore_tested_at: Option<DateTime<Utc>>,
    restore_test_result: String,
    initiated_by: String,
    restored_by: String,
    restored_at: Option<DateTime<Utc>>,
    data_loss_window_seconds: i32,
    error: String,
    created_date: DateTime<Utc>,
    parent_backup_id: Option<Uuid>,
    base_full_id: Option<Uuid>,
    chain_index: i32,
    manifest: Value,
    manifest_checksum: String,
    manifest_path: String,
    backup_format_version: i32,
    encryption_key_id: String,
}

#[derive(Debug, FromRow, Serialize)]
pub struct BackupServer {
    id: Uuid,
    name: String,
    role: String,
    ip_address: String,
    vpn_ip: Option<String>,
    vpn_port: i32,
    vpn_status: String,
    vpn_last_handshake: Option<DateTime<Utc>>,
    smb_share: String,
    transfer_protocol: String,
    sftp_host: String,
    sftp_port: i32,
    sftp_user: String,
    sftp_remote_path: String,
    sftp_key_path: String,
    sftp_known_hosts: String,
    is_offsite: bool,
    status: String,
    is_active: bool,
    last_seen: Option<DateTime<Utc>>,
    last_backup: Option<DateTime<Utc>>,
    last_backup_status: String,
    disk_total_bytes: i64,
    disk_used_bytes: i64,
    error: String,
    created_date: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateRequest {
    #[serde(rename = "type")]
    job_type: Option<String>,
    encrypt: Option<bool>,
}
#[derive(Debug, Deserialize)]
pub struct IdRequest {
    job_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct DeleteRequest {
    confirmed: bool,
}

#[derive(Clone, Debug)]
struct ChainContext {
    effective_kind: String,
    parent_backup_id: Option<Uuid>,
    base_full_id: Option<Uuid>,
    chain_index: i32,
    promoted_to_full: bool,
}

#[derive(Clone, Debug)]
struct ManifestArtifact {
    path: PathBuf,
    checksum: String,
    value: Value,
    key_id: String,
}
#[derive(Debug, Deserialize)]
pub struct RestoreRequest {
    origin: String,
    confirmed: bool,
    job_id: Option<Uuid>,
    filename: Option<String>,
}
#[derive(Debug, Deserialize)]
pub struct RestoreQuery {
    restore_id: Uuid,
}
#[derive(Debug, Deserialize)]
pub struct ServerIdRequest {
    server_id: Option<Uuid>,
}
#[derive(Debug, Deserialize)]
pub struct OriginQuery {
    origin: Option<String>,
}
#[derive(Debug, Deserialize)]
pub struct ConfigWrite {
    key: Option<String>,
    value: Value,
}
#[derive(Debug, Deserialize)]
pub struct ServerWrite {
    name: Option<String>,
    role: Option<String>,
    ip_address: Option<String>,
    vpn_ip: Option<String>,
    vpn_port: Option<i32>,
    smb_share: Option<String>,
    transfer_protocol: Option<String>,
    sftp_host: Option<String>,
    sftp_port: Option<i32>,
    sftp_user: Option<String>,
    sftp_remote_path: Option<String>,
    sftp_key_path: Option<String>,
    sftp_known_hosts: Option<String>,
    is_offsite: Option<bool>,
    is_active: Option<bool>,
}

pub async fn status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    admin(&state, &headers)?;
    let pool = pool(&state)?;
    let latest = fetch_job(pool, None).await?;
    let config = config_value(pool).await?;
    let servers = fetch_servers(pool).await?;
    let pg_dump_available = pg_dump_path().is_file();
    let active: Vec<&BackupServer> = servers.iter().filter(|server| server.is_active).collect();
    let total_disk: i64 = active.iter().map(|server| server.disk_total_bytes).sum();
    let used_disk: i64 = active.iter().map(|server| server.disk_used_bytes).sum();
    let last_successful: Option<DateTime<Utc>> = sqlx::query_scalar(
        "SELECT MAX(created_date) FROM backups_backupjob WHERE status IN ('completed','partial') AND verified=TRUE",
    )
    .fetch_one(pool)
    .await?;
    let last_verified: Option<DateTime<Utc>> =
        sqlx::query_scalar("SELECT MAX(verified_at) FROM backups_backupjob WHERE verified=TRUE")
            .fetch_one(pool)
            .await?;
    let last_restore: Option<DateTime<Utc>> = sqlx::query_scalar(
        "SELECT MAX(restored_at) FROM backups_backupjob WHERE restored_at IS NOT NULL",
    )
    .fetch_one(pool)
    .await?;
    let local_free = match backup_root().await {
        Ok(root) => local_free_bytes(&root).await.ok(),
        Err(_) => None,
    };
    Ok(Json(json!({
        "system_status": if pg_dump_available { "ok" } else { "error" },
        "pg_dump_available": pg_dump_available,
        "server2_ip": std::env::var("VPN_SERVER2_IP").unwrap_or_else(|_| "10.50.0.2".into()),
        "last_backup": latest.as_ref().map(|job| job.created_date),
        "last_backup_type": latest.as_ref().map_or("none", |job| &job.job_type),
        "last_backup_status": latest.as_ref().map_or("none", |job| &job.status),
        "backup_size_bytes": latest.as_ref().map_or(0, |job| job.size_bytes),
        "backup_checksum": latest.as_ref().map_or("", |job| &job.checksum),
        "next_backup": config.get("next_backup").and_then(Value::as_str).unwrap_or("03:00"),
        "last_successful_backup": last_successful,
        "last_verification": last_verified,
        "last_restore": last_restore,
        "integrity_status": if latest.as_ref().is_some_and(|job| job.verified) { "ok" } else { "unknown" },
        "encryption_enabled": env_bool("BACKUP_ENCRYPTION_ENABLED", true),
        "backup_servers": active,
        "total_disk_bytes": total_disk,
        "used_disk_bytes": used_disk,
        "servers_online": active.iter().filter(|server| server.status == "online").count(),
        "servers_total": active.len(),
        "remote_available": active.iter().any(|server| server.status == "online"),
        "local_free_bytes": local_free,
        "scheduler_enabled": env_bool("BACKUP_SCHEDULER_ENABLED", true),
        "schedule": &config,
        "retention_full": config.get("retention_full").and_then(Value::as_i64).unwrap_or(4),
        "retention_incremental": config.get("retention_incremental").and_then(Value::as_i64).unwrap_or(30)
    })))
}

pub async fn test_connection(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<ServerIdRequest>,
) -> Result<Json<Value>, AppError> {
    let claims = admin(&state, &headers)?;
    crate::runtime_config::audit(&state, claims.profile_id, "backup_connection_test").await?;
    let id = input
        .server_id
        .ok_or_else(|| AppError::Validation("server_id es requerido.".into()))?;
    let server = fetch_server(pool(&state)?, id)
        .await?
        .ok_or(AppError::NotFound)?;
    if server.transfer_protocol != "sftp" {
        let path = std::path::Path::new(&server.smb_share);
        let mut ok = path.is_absolute()
            && !server.smb_share.contains("..")
            && tokio::fs::metadata(path).await.is_ok_and(|m| m.is_dir());
        if ok {
            let probe = path.join(format!(".uasspain-probe-{}", Uuid::new_v4()));
            match tokio::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&probe)
                .await
            {
                Ok(file) => {
                    drop(file);
                    ok = tokio::fs::remove_file(&probe).await.is_ok();
                }
                Err(_) => ok = false,
            }
        }
        return Ok(Json(
            json!({"ok":ok,"detail":if ok {"Directorio del destino accesible en el contenedor."}else{"Destino no montado o no accesible desde el contenedor."}}),
        ));
    }
    enforce_vpn_destination(&server)?;
    if server.sftp_host.trim().is_empty() || server.sftp_user.trim().is_empty() {
        return Err(AppError::Validation("SFTP host/user incompletos.".into()));
    }
    let key = PathBuf::from(&server.sftp_key_path);
    let known_hosts = PathBuf::from(&server.sftp_known_hosts);
    if !key.is_absolute() || !key.is_file() || !known_hosts.is_absolute() || !known_hosts.is_file()
    {
        return Ok(Json(
            json!({"ok":false,"detail":"Configuración SFTP incompleta: sftp_key_path, sftp_known_hosts"}),
        ));
    }
    let batch = std::env::temp_dir().join(format!("uasspain-sftp-probe-{}.batch", Uuid::new_v4()));
    tokio::fs::write(&batch, b"ls /\n")
        .await
        .map_err(|_| AppError::Internal)?;
    let mut command = tokio::process::Command::new("sftp");
    command
        .kill_on_drop(true)
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("StrictHostKeyChecking=yes")
        .arg("-o")
        .arg(format!("UserKnownHostsFile={}", known_hosts.display()))
        .arg("-o")
        .arg("PasswordAuthentication=no")
        .arg("-i")
        .arg(&key)
        .arg("-P")
        .arg(server.sftp_port.to_string())
        .arg("-b")
        .arg(&batch)
        .arg(format!("{}@{}", server.sftp_user, server.sftp_host));
    let outcome = tokio::time::timeout(std::time::Duration::from_secs(30), command.output()).await;
    let _ = tokio::fs::remove_file(&batch).await;
    let (ok, detail, error) = match outcome {
        Ok(Ok(output)) if output.status.success() => (
            true,
            format!(
                "Conexión SFTP verificada a {}:{}.",
                server.sftp_host, server.sftp_port
            ),
            String::new(),
        ),
        Ok(Ok(output)) => {
            let message = String::from_utf8_lossy(if output.stderr.is_empty() {
                &output.stdout
            } else {
                &output.stderr
            })
            .trim()
            .chars()
            .take(500)
            .collect::<String>();
            (false, format!("Conexión SFTP fallida: {message}"), message)
        }
        Ok(Err(error)) => (false, format!("Error SFTP: {error}"), error.to_string()),
        Err(_) => (
            false,
            "Conexión SFTP agotó el tiempo de espera.".into(),
            "timeout".into(),
        ),
    };
    sqlx::query("UPDATE backups_backupserver SET status=$2,last_seen=CASE WHEN $2='online' THEN NOW() ELSE last_seen END,error=$3 WHERE id=$1")
        .bind(id).bind(if ok {"online"} else {"offline"}).bind(error).execute(pool(&state)?).await?;
    Ok(Json(json!({"ok":ok,"detail":detail})))
}

pub async fn history(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<BackupJob>>, AppError> {
    admin(&state, &headers)?;
    let jobs = sqlx::query_as::<_, BackupJob>(&job_select("ORDER BY created_date DESC LIMIT 50"))
        .fetch_all(pool(&state)?)
        .await?;
    Ok(Json(jobs))
}

pub async fn delete_backup(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<Uuid>,
    Json(input): Json<DeleteRequest>,
) -> Result<Json<Value>, AppError> {
    let claims = admin(&state, &headers)?;
    if !input.confirmed {
        return Err(AppError::Validation(
            "La eliminación requiere confirmación explícita.".into(),
        ));
    }
    let mut connection = pool(&state)?.acquire().await?;
    let locked: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock($1)")
        .bind(BACKUP_LOCK_KEY)
        .fetch_one(&mut *connection)
        .await?;
    if !locked {
        return Err(AppError::Validation(
            "Hay una operación de backup o restore en curso.".into(),
        ));
    }
    let result = async {
        let job = fetch_job_connection(&mut connection, id)
            .await?
            .ok_or(AppError::NotFound)?;
        let dependents: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM backups_backupjob WHERE parent_backup_id=$1 OR base_full_id=$1",
        )
        .bind(id)
        .fetch_one(&mut *connection)
        .await?;
        if dependents > 0 {
            return Err(AppError::Validation(
                "No se puede eliminar un backup con incrementales dependientes.".into(),
            ));
        }
        let good_points: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM backups_backupjob WHERE verified=TRUE AND status IN ('completed','partial')",
        )
        .fetch_one(&mut *connection)
        .await?;
        if job.verified && good_points <= 1 {
            return Err(AppError::Validation(
                "No se puede eliminar el último punto de recuperación válido.".into(),
            ));
        }
        sqlx::query("DELETE FROM backups_backupjob WHERE id=$1")
            .bind(id)
            .execute(&mut *connection)
            .await?;
        audit_event_connection(
            &mut connection,
            claims.profile_id,
            "backup_delete",
            id,
            json!({"job_type":job.job_type,"chain_index":job.chain_index,"result":"success"}),
        )
        .await?;
        for raw in [&job.storage_path, &job.media_path, &job.manifest_path] {
            if let Some(path) = safe_job_path(raw).await {
                let _ = fs::remove_file(path).await;
            }
        }
        Ok(Json(json!({"deleted":true,"backup_id":id})))
    }
    .await;
    let _ = sqlx::query("SELECT pg_advisory_unlock($1)")
        .bind(BACKUP_LOCK_KEY)
        .execute(&mut *connection)
        .await;
    result
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<CreateRequest>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let claims = admin(&state, &headers)?;
    let kind = input.job_type.unwrap_or_else(|| "incremental".into());
    if !matches!(kind.as_str(), "full" | "incremental") {
        return Err(AppError::Validation("Tipo de backup no válido.".into()));
    }
    let encrypt = input
        .encrypt
        .unwrap_or_else(|| env_bool("BACKUP_ENCRYPTION_ENABLED", true));
    let encrypted_email: String =
        sqlx::query_scalar("SELECT email FROM accounts_userprofile WHERE id=$1")
            .bind(claims.profile_id)
            .fetch_one(pool(&state)?)
            .await?;
    let initiated_by = state.cipher.decrypt(&encrypted_email)?;
    let mut connection = pool(&state)?.acquire().await?;
    let locked: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock($1)")
        .bind(BACKUP_LOCK_KEY)
        .fetch_one(&mut *connection)
        .await?;
    if !locked {
        return Ok((
            StatusCode::CONFLICT,
            Json(
                json!({"detail":"Ya hay un backup en curso.","error":"otro backup ya está en curso"}),
            ),
        ));
    }
    let result = create_locked(&state, &mut connection, &initiated_by, &kind, encrypt).await;
    if let Ok((status, Json(value))) = &result {
        let instance_id = value
            .pointer("/job/id")
            .and_then(Value::as_str)
            .and_then(|value| Uuid::parse_str(value).ok())
            .unwrap_or_else(Uuid::new_v4);
        let _ = audit_event_connection(
            &mut connection,
            claims.profile_id,
            "backup_create",
            instance_id,
            json!({"requested_type":kind,"http_status":status.as_u16(),"result":if status.is_success(){"success"}else{"failure"}}),
        )
        .await;
    }
    let _ = sqlx::query("SELECT pg_advisory_unlock($1)")
        .bind(BACKUP_LOCK_KEY)
        .execute(&mut *connection)
        .await;
    result
}

async fn create_locked(
    state: &AppState,
    connection: &mut sqlx::pool::PoolConnection<sqlx::Postgres>,
    initiated_by: &str,
    kind: &str,
    encrypt: bool,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let id = Uuid::new_v4();
    let chain = resolve_chain_context(connection, kind).await?;
    sqlx::query("INSERT INTO backups_backupjob (id,job_type,status,started_at,duration_seconds,size_bytes,encrypted,checksum,storage_path,media_path,media_checksum,media_size_bytes,remote_paths,destinations,verified,verified_checksum,restore_tested,restore_test_result,initiated_by,restored_by,data_loss_window_seconds,error,created_date,parent_backup_id,base_full_id,chain_index) VALUES ($1,$2,'creating',NOW(),0,0,false,'','','','',0,'[]'::jsonb,'{}'::jsonb,false,'',false,'',$3,'',0,'',NOW(),$4,$5,$6)")
        .bind(id)
        .bind(&chain.effective_kind)
        .bind(initiated_by)
        .bind(chain.parent_backup_id)
        .bind(chain.base_full_id)
        .bind(chain.chain_index)
        .execute(&mut **connection)
        .await?;
    let started = Instant::now();
    match dump_to_disk(state, &chain.effective_kind, encrypt).await {
        Ok((path, checksum, size, media)) => {
            let elapsed = i32::try_from(started.elapsed().as_secs()).unwrap_or(i32::MAX);
            let manifest = create_manifest(
                state,
                id,
                &chain,
                encrypt,
                (&path, &checksum, size),
                media.as_ref(),
            )
            .await
            .map_err(AppError::Validation)?;
            let manifest_transfer = (
                manifest.path.clone(),
                manifest.checksum.clone(),
                std::fs::metadata(&manifest.path)
                    .map(|m| m.len())
                    .unwrap_or(0),
            );
            let transfers = transfer_to_servers(
                state,
                &path,
                &checksum,
                media.as_ref(),
                Some(&manifest_transfer),
            )
            .await;
            let (media_path, media_checksum, media_size) = media.map_or_else(
                || (String::new(), String::new(), 0_i64),
                |(path, checksum, size)| {
                    (
                        path.to_string_lossy().into_owned(),
                        checksum,
                        i64::try_from(size).unwrap_or(i64::MAX),
                    )
                },
            );
            sqlx::query("UPDATE backups_backupjob SET status=$2,finished_at=NOW(),duration_seconds=$3,size_bytes=$4,encrypted=$5,checksum=$6,storage_path=$7,media_path=$8,media_checksum=$9,media_size_bytes=$10,remote_paths=$11,destinations=$12,verified=true,verified_at=NOW(),verified_checksum=$6,error=$13,manifest=$14,manifest_checksum=$15,manifest_path=$16,encryption_key_id=$17,backup_format_version=2 WHERE id=$1")
                .bind(id).bind(&transfers.status).bind(elapsed).bind(i64::try_from(size).unwrap_or(i64::MAX)).bind(encrypt).bind(&checksum).bind(path.to_string_lossy().as_ref()).bind(media_path).bind(media_checksum).bind(media_size).bind(&transfers.remote_paths).bind(&transfers.destinations).bind(&transfers.error).bind(&manifest.value).bind(&manifest.checksum).bind(manifest.path.to_string_lossy().as_ref()).bind(&manifest.key_id).execute(&mut **connection).await?;
            let job = fetch_job_connection(connection, id)
                .await?
                .ok_or(AppError::Internal)?;
            let response_status = if transfers.status == "connection_failed" {
                StatusCode::BAD_GATEWAY
            } else {
                StatusCode::OK
            };
            Ok((
                response_status,
                Json(
                    json!({"detail":if chain.promoted_to_full {"No existía una base FULL válida; se creó automáticamente el FULL base."} else if transfers.status == "completed" {"Punto de recuperación creado y verificado."} else {"Punto local creado con incidencias remotas."},"promoted_to_full":chain.promoted_to_full,"job":job}),
                ),
            ))
        }
        Err(message) => {
            let elapsed = i32::try_from(started.elapsed().as_secs()).unwrap_or(i32::MAX);
            sqlx::query("UPDATE backups_backupjob SET status='failed',finished_at=NOW(),duration_seconds=$2,error=$3 WHERE id=$1")
                .bind(id).bind(elapsed).bind(&message).execute(&mut **connection).await?;
            Ok((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"detail":"Backup fallido.","error":message})),
            ))
        }
    }
}

async fn resolve_chain_context(
    connection: &mut sqlx::pool::PoolConnection<sqlx::Postgres>,
    requested_kind: &str,
) -> Result<ChainContext, AppError> {
    if requested_kind == "full" {
        return Ok(ChainContext {
            effective_kind: "full".into(),
            parent_backup_id: None,
            base_full_id: None,
            chain_index: 0,
            promoted_to_full: false,
        });
    }
    let latest: Option<(Uuid, String, Option<Uuid>, i32)> = sqlx::query_as(
        "SELECT id,job_type,base_full_id,chain_index FROM backups_backupjob \
         WHERE status IN ('completed','partial') AND verified=TRUE \
           AND manifest_checksum <> '' AND job_type IN ('full','incremental') \
         ORDER BY created_date DESC LIMIT 1",
    )
    .fetch_optional(&mut **connection)
    .await?;
    let Some((parent_id, parent_kind, parent_base, parent_index)) = latest else {
        return Ok(ChainContext {
            effective_kind: "full".into(),
            parent_backup_id: None,
            base_full_id: None,
            chain_index: 0,
            promoted_to_full: true,
        });
    };
    let base_full_id = if parent_kind == "full" {
        parent_id
    } else {
        parent_base.ok_or_else(|| {
            AppError::Validation("La cadena incremental no tiene base FULL válida.".into())
        })?
    };
    let base_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM backups_backupjob WHERE id=$1 AND job_type='full' \
         AND status IN ('completed','partial') AND verified=TRUE AND manifest_checksum <> '')",
    )
    .bind(base_full_id)
    .fetch_one(&mut **connection)
    .await?;
    if !base_exists {
        return Err(AppError::Validation(
            "La base FULL de la cadena incremental no está disponible.".into(),
        ));
    }
    Ok(ChainContext {
        effective_kind: "incremental".into(),
        parent_backup_id: Some(parent_id),
        base_full_id: Some(base_full_id),
        chain_index: parent_index.saturating_add(1),
        promoted_to_full: false,
    })
}

async fn create_manifest(
    state: &AppState,
    backup_id: Uuid,
    chain: &ChainContext,
    encrypted: bool,
    database: (&Path, &str, u64),
    media: Option<&(PathBuf, String, u64)>,
) -> Result<ManifestArtifact, String> {
    let (database_path, database_checksum, database_size) = database;
    let database_name = database_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Nombre de backup no válido.".to_owned())?;
    let database_version: String = sqlx::query_scalar("SHOW server_version")
        .fetch_one(pool(state).map_err(|_| "Base de datos no disponible.".to_owned())?)
        .await
        .map_err(|error| format!("No se pudo consultar la versión PostgreSQL: {error}"))?;
    let migration_version: Option<i64> =
        sqlx::query_scalar("SELECT MAX(version) FROM _sqlx_migrations WHERE success=TRUE")
            .fetch_one(pool(state).map_err(|_| "Base de datos no disponible.".to_owned())?)
            .await
            .map_err(|error| format!("No se pudo consultar la versión de esquema: {error}"))?;
    let key_id = if encrypted {
        state
            .cipher
            .backup_key_id()
            .map_err(|_| "No se pudo identificar la clave de backup activa.".to_owned())?
    } else {
        "none".to_owned()
    };
    let media_entry = media.map(|(path, checksum, size)| {
        json!({
            "name": path.file_name().and_then(|name| name.to_str()).unwrap_or("media"),
            "size_bytes": size,
            "checksum": checksum,
        })
    });
    let value = json!({
        "format_version": 2,
        "backup_id": backup_id,
        "type": chain.effective_kind.to_ascii_uppercase(),
        "created_at": Utc::now(),
        "source": {
            "application": "UASSpain",
            "app_version": std::env::var("APP_VERSION").unwrap_or_else(|_| env!("CARGO_PKG_VERSION").to_owned()),
            "rust_backend_version": env!("CARGO_PKG_VERSION"),
            "postgresql_version": database_version,
            "migration_version": migration_version,
        },
        "chain": {
            "parent_backup_id": chain.parent_backup_id,
            "base_full_id": chain.base_full_id,
            "chain_index": chain.chain_index,
        },
        "files": {
            "database": {"name": database_name, "size_bytes": database_size, "checksum": database_checksum},
            "media": media_entry,
        },
        "encryption": {
            "scheme": if encrypted {"AES-256-GCM"} else {"NONE"},
            "key_id": key_id,
        },
        "status": "READY",
    });
    let bytes = serde_json::to_vec_pretty(&value)
        .map_err(|error| format!("No se pudo serializar el manifest: {error}"))?;
    let path = database_path.with_file_name(format!("{database_name}.manifest.json"));
    atomic_write(&path, &bytes).await?;
    Ok(ManifestArtifact {
        path,
        checksum: sha256(&bytes),
        value,
        key_id,
    })
}

async fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Ruta de salida no válida.".to_owned())?;
    let partial = path.with_file_name(format!(".{file_name}.{}.partial", Uuid::new_v4()));
    fs::write(&partial, bytes)
        .await
        .map_err(|error| format!("No se pudo escribir el archivo temporal: {error}"))?;
    if let Err(error) = fs::rename(&partial, path).await {
        let _ = fs::remove_file(&partial).await;
        return Err(format!(
            "No se pudo finalizar atómicamente el archivo: {error}"
        ));
    }
    Ok(())
}

async fn check_local_capacity(state: &AppState, root: &Path) -> Result<(), String> {
    let database_bytes: i64 = sqlx::query_scalar("SELECT pg_database_size(current_database())")
        .fetch_one(pool(state).map_err(|_| "Base de datos no disponible.".to_owned())?)
        .await
        .map_err(|error| format!("No se pudo estimar el tamaño de la base: {error}"))?;
    let reserve = std::env::var("BACKUP_MIN_FREE_BYTES")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(256 * 1024 * 1024);
    let needed = u64::try_from(database_bytes.max(0))
        .unwrap_or(u64::MAX)
        .saturating_mul(2)
        .saturating_add(reserve);
    let free = local_free_bytes(root).await?;
    if free < needed {
        return Err(format!(
            "Espacio local insuficiente: libres={free} bytes, requeridos={needed} bytes."
        ));
    }
    Ok(())
}

#[cfg(unix)]
async fn local_free_bytes(root: &Path) -> Result<u64, String> {
    let output = Command::new("df")
        .args(["-Pk", "--"])
        .arg(root)
        .output()
        .await
        .map_err(|error| format!("No se pudo consultar espacio libre: {error}"))?;
    if !output.status.success() {
        return Err("La consulta de espacio libre falló.".into());
    }
    let line = String::from_utf8_lossy(&output.stdout)
        .lines()
        .last()
        .ok_or_else(|| "Respuesta de espacio libre no válida.".to_owned())?
        .to_owned();
    let kib = line
        .split_whitespace()
        .nth(3)
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or_else(|| "No se pudo interpretar el espacio libre.".to_owned())?;
    Ok(kib.saturating_mul(1024))
}

#[cfg(windows)]
async fn local_free_bytes(root: &Path) -> Result<u64, String> {
    let canonical = std::fs::canonicalize(root)
        .map_err(|error| format!("No se pudo resolver el destino: {error}"))?;
    let drive = canonical
        .components()
        .next()
        .and_then(|component| component.as_os_str().to_str())
        .ok_or_else(|| "Unidad de backup no válida.".to_owned())?;
    let script = format!(
        "[Console]::Write((Get-PSDrive -Name '{}').Free)",
        drive.trim_end_matches([':', '\\'])
    );
    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .await
        .map_err(|error| format!("No se pudo consultar espacio libre: {error}"))?;
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<u64>()
        .map_err(|_| "No se pudo interpretar el espacio libre.".to_owned())
}

/// Starts the in-process backup scheduler. PostgreSQL advisory locking keeps it
/// single-writer when several Rust instances reach the same scheduled minute.
pub fn spawn_scheduler(state: Arc<AppState>) {
    if !env_bool("BACKUP_SCHEDULER_ENABLED", true) || state.pool.is_none() {
        return;
    }
    tokio::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_secs(30));
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            timer.tick().await;
            if let Err(error) = scheduler_tick(&state).await {
                tracing::error!(%error, "backup scheduler tick failed");
            }
        }
    });
}

async fn scheduler_tick(state: &AppState) -> Result<(), AppError> {
    let pool = pool(state)?;
    let config = config_value(pool).await?;
    let now = Local::now();
    let last_scheduled: Option<DateTime<Utc>> = sqlx::query_scalar(
        "SELECT MAX(created_date) FROM backups_backupjob WHERE initiated_by='scheduler'",
    )
    .fetch_one(pool)
    .await?;
    if !schedule_due(&config, now, last_scheduled) {
        return Ok(());
    }

    let mut connection = pool.acquire().await?;
    let locked: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock($1)")
        .bind(BACKUP_LOCK_KEY)
        .fetch_one(&mut *connection)
        .await?;
    if !locked {
        return Ok(());
    }
    // Recheck under the lock so two application replicas cannot both run.
    let last_scheduled: Option<DateTime<Utc>> = sqlx::query_scalar(
        "SELECT MAX(created_date) FROM backups_backupjob WHERE initiated_by='scheduler'",
    )
    .fetch_one(&mut *connection)
    .await?;
    if schedule_due(&config, now, last_scheduled) {
        let kind = config
            .get("job_type")
            .and_then(Value::as_str)
            .filter(|kind| matches!(*kind, "full" | "incremental"))
            .unwrap_or("incremental");
        let encrypt = config
            .get("encrypt")
            .and_then(Value::as_bool)
            .unwrap_or_else(|| env_bool("BACKUP_ENCRYPTION_ENABLED", true));
        let outcome = create_locked(state, &mut connection, "scheduler", kind, encrypt).await;
        match outcome {
            Ok((status, _)) if status.is_success() => {
                tracing::info!(backup_type = kind, "scheduled backup completed");
            }
            Ok((status, _)) => {
                tracing::error!(%status, backup_type = kind, "scheduled backup failed");
            }
            Err(error) => tracing::error!(%error, backup_type = kind, "scheduled backup failed"),
        }
    }
    let _ = sqlx::query("SELECT pg_advisory_unlock($1)")
        .bind(BACKUP_LOCK_KEY)
        .execute(&mut *connection)
        .await;
    Ok(())
}

fn schedule_due(
    config: &Value,
    now: DateTime<Local>,
    last_scheduled: Option<DateTime<Utc>>,
) -> bool {
    let frequency = config
        .get("frequency")
        .and_then(Value::as_str)
        .unwrap_or("daily");
    if !matches!(
        frequency,
        "manual" | "daily" | "every_n_days" | "weekly" | "monthly" | "custom"
    ) || frequency == "manual"
    {
        return false;
    }
    let Some((hour, minute)) = config
        .get("hour")
        .and_then(Value::as_str)
        .and_then(parse_time)
    else {
        return false;
    };
    if now.hour() != hour || now.minute() != minute {
        return false;
    }
    if frequency == "weekly" {
        let wanted = config
            .get("day")
            .and_then(Value::as_str)
            .and_then(|value| value.parse::<u32>().ok());
        if wanted != Some(now.weekday().num_days_from_sunday()) {
            return false;
        }
    }
    if frequency == "monthly" {
        let wanted = config
            .get("day")
            .and_then(Value::as_str)
            .and_then(|value| value.parse::<u32>().ok());
        if wanted != Some(now.day()) {
            return false;
        }
    }
    if frequency == "every_n_days" {
        let interval = config
            .get("interval_days")
            .and_then(Value::as_u64)
            .unwrap_or(3)
            .clamp(1, 3650);
        if last_scheduled.is_some_and(|last| {
            now.signed_duration_since(last.with_timezone(&Local))
                .num_days()
                < i64::try_from(interval).unwrap_or(i64::MAX)
        }) {
            return false;
        }
    }
    !last_scheduled.is_some_and(|last| {
        let local = last.with_timezone(&Local);
        local.date_naive() == now.date_naive()
            && local.hour() == now.hour()
            && local.minute() == now.minute()
    })
}

fn parse_time(value: &str) -> Option<(u32, u32)> {
    let (hour, minute) = value.split_once(':')?;
    let hour = hour.parse().ok()?;
    let minute = minute.parse().ok()?;
    (hour < 24 && minute < 60).then_some((hour, minute))
}

async fn dump_to_disk(
    state: &AppState,
    kind: &str,
    encrypt: bool,
) -> Result<(PathBuf, String, u64, Option<(PathBuf, String, u64)>), String> {
    let root = backup_root().await?;
    check_local_capacity(state, &root).await?;
    let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
    let plain = root.join(format!(".tmp_{kind}_{timestamp}.dump"));
    let final_path = root.join(format!(
        "uasspain_{kind}_{timestamp}.sql.gz{}",
        if encrypt { ".enc" } else { "" }
    ));
    let database_url = backup_database_url()?;
    let mut command = Command::new(pg_dump_path());
    command
        .args(["-F", "c", "-Z", "6", "-f"])
        .arg(&plain)
        .arg(database_url)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let output = timeout(Duration::from_secs(600), command.output())
        .await
        .map_err(|_| "pg_dump excedió 600 segundos".to_owned())?
        .map_err(|error| format!("No se pudo ejecutar pg_dump: {error}"))?;
    if !output.status.success() {
        let _ = fs::remove_file(&plain).await;
        return Err(format!(
            "pg_dump falló: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let bytes = fs::read(&plain)
        .await
        .map_err(|error| format!("No se pudo leer el dump: {error}"))?;
    if bytes.is_empty() {
        let _ = fs::remove_file(&plain).await;
        return Err("pg_dump generó un archivo vacío".into());
    }
    let final_bytes = if encrypt {
        state
            .cipher
            .encrypt_backup(&bytes)
            .map_err(|_| "No se pudo cifrar el backup".to_owned())?
    } else {
        bytes
    };
    atomic_write(&final_path, &final_bytes).await?;
    let _ = fs::remove_file(&plain).await;
    let checksum = sha256(&final_bytes);
    let media = create_media_archive(state, &root, &timestamp.to_string(), encrypt).await?;
    Ok((final_path, checksum, final_bytes.len() as u64, media))
}

async fn create_media_archive(
    state: &AppState,
    backup_root: &Path,
    timestamp: &str,
    encrypt: bool,
) -> Result<Option<(PathBuf, String, u64)>, String> {
    let media_root =
        PathBuf::from(std::env::var("MEDIA_ROOT").unwrap_or_else(|_| "./media".to_owned()));
    if !media_root.is_dir() {
        return Ok(None);
    }
    let media_root = std::fs::canonicalize(&media_root)
        .map_err(|error| format!("MEDIA_ROOT no es accesible: {error}"))?;
    if media_root == backup_root {
        return Err("MEDIA_ROOT y BACKUP_STORAGE_PATH no pueden ser iguales.".into());
    }
    let temporary = backup_root.join(format!(".tmp_media_{timestamp}.zip"));
    let source = media_root.clone();
    let excluded = backup_root.to_path_buf();
    let output = temporary.clone();
    tokio::task::spawn_blocking(move || zip_directory(&source, &excluded, &output))
        .await
        .map_err(|_| "La tarea de archivo multimedia terminó inesperadamente.".to_owned())??;
    let plain = fs::read(&temporary)
        .await
        .map_err(|error| format!("No se pudo leer el backup de media: {error}"))?;
    if plain.is_empty() {
        let _ = fs::remove_file(&temporary).await;
        return Ok(None);
    }
    let payload = if encrypt {
        state
            .cipher
            .encrypt_backup(&plain)
            .map_err(|_| "No se pudo cifrar el backup de media".to_owned())?
    } else {
        plain
    };
    let final_path = backup_root.join(format!(
        "uasspain_media_{timestamp}.zip{}",
        if encrypt { ".enc" } else { "" }
    ));
    atomic_write(&final_path, &payload).await?;
    let _ = fs::remove_file(&temporary).await;
    Ok(Some((final_path, sha256(&payload), payload.len() as u64)))
}

fn zip_directory(source: &Path, excluded: &Path, output: &Path) -> Result<(), String> {
    let file = std::fs::File::create(output)
        .map_err(|error| format!("No se pudo crear el archivo de media: {error}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let mut pending = vec![source.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let entries = std::fs::read_dir(&directory)
            .map_err(|error| format!("No se pudo leer MEDIA_ROOT: {error}"))?;
        for entry in entries {
            let entry = entry.map_err(|error| format!("Entrada de media no válida: {error}"))?;
            let path = entry.path();
            let metadata = entry
                .file_type()
                .map_err(|error| format!("No se pudo inspeccionar media: {error}"))?;
            if metadata.is_symlink() || path.starts_with(excluded) {
                continue;
            }
            if metadata.is_dir() {
                pending.push(path);
                continue;
            }
            if !metadata.is_file() {
                continue;
            }
            let relative = path
                .strip_prefix(source)
                .map_err(|_| "Ruta de media fuera de MEDIA_ROOT.".to_owned())?;
            let archive_name = relative.to_string_lossy().replace('\\', "/");
            zip.start_file(archive_name, options)
                .map_err(|error| format!("No se pudo añadir media al ZIP: {error}"))?;
            let mut input = std::fs::File::open(&path)
                .map_err(|error| format!("No se pudo abrir media: {error}"))?;
            let mut buffer = [0_u8; 64 * 1024];
            loop {
                let read = input
                    .read(&mut buffer)
                    .map_err(|error| format!("No se pudo leer media: {error}"))?;
                if read == 0 {
                    break;
                }
                zip.write_all(&buffer[..read])
                    .map_err(|error| format!("No se pudo comprimir media: {error}"))?;
            }
        }
    }
    zip.finish()
        .map_err(|error| format!("No se pudo cerrar el ZIP de media: {error}"))?;
    Ok(())
}

struct TransferSummary {
    status: String,
    destinations: Value,
    remote_paths: Value,
    error: String,
}

async fn transfer_to_servers(
    state: &AppState,
    database_path: &Path,
    database_checksum: &str,
    media: Option<&(PathBuf, String, u64)>,
    manifest: Option<&(PathBuf, String, u64)>,
) -> TransferSummary {
    let Ok(pool) = pool(state) else {
        return TransferSummary {
            status: "completed".into(),
            destinations: json!({"local":{"status":"NOT_CONFIGURED"},"external_1":{"status":"NOT_CONFIGURED"},"external_2":{"status":"NOT_CONFIGURED"}}),
            remote_paths: json!([]),
            error: String::new(),
        };
    };
    let servers = fetch_servers(pool).await.unwrap_or_default();
    let active: Vec<_> = servers
        .into_iter()
        .filter(|server| server.is_active)
        .collect();
    if active.is_empty() {
        return TransferSummary {
            status: "partial".into(),
            destinations: json!({"local":{"status":"NOT_CONFIGURED"},"external_1":{"status":"NOT_CONFIGURED"},"external_2":{"status":"NOT_CONFIGURED"}}),
            remote_paths: json!([]),
            error: String::new(),
        };
    }
    let mut results = serde_json::Map::new();
    for role in ["local", "external_1", "external_2"] {
        results.insert(role.into(), json!({"status":"NOT_CONFIGURED"}));
    }
    let mut remote_paths = Vec::new();
    let mut successes = 0_usize;
    for server in &active {
        let outcome = if server.transfer_protocol == "sftp" {
            transfer_sftp(server, database_path, database_checksum, media, manifest).await
        } else if server.transfer_protocol == "copy" || server.transfer_protocol == "smb" {
            transfer_copy(server, database_path, database_checksum, media, manifest).await
        } else {
            Err("Protocolo de transferencia no soportado.".to_owned())
        };
        let (status, path, error) = match outcome {
            Ok(paths) => {
                successes += 1;
                remote_paths.extend(paths.iter().cloned().map(Value::String));
                (
                    "success",
                    paths.first().cloned().unwrap_or_default(),
                    String::new(),
                )
            }
            Err(error) => ("failed", String::new(), error),
        };
        results.insert(
            server.role.clone(),
            json!({
                "server_id": server.id,
                "server_name": server.name,
                "status": status,
                "path": path,
                "error": error,
                "protocol": server.transfer_protocol,
                "offsite": server.is_offsite,
            }),
        );
        let _ = sqlx::query("UPDATE backups_backupserver SET status=$2,last_backup=CASE WHEN $2='online' THEN NOW() ELSE last_backup END,last_seen=CASE WHEN $2='online' THEN NOW() ELSE last_seen END,last_backup_status=$3,error=$4 WHERE id=$1")
            .bind(server.id)
            .bind(if status == "success" { "online" } else { "offline" })
            .bind(status)
            .bind(&error)
            .execute(pool)
            .await;
    }
    let status = if successes == active.len()
        && ["local", "external_1", "external_2"]
            .iter()
            .all(|role| active.iter().any(|s| s.role == *role))
    {
        "completed"
    } else if successes > 0 {
        "partial"
    } else {
        "connection_failed"
    };
    TransferSummary {
        status: status.into(),
        destinations: Value::Object(results),
        remote_paths: Value::Array(remote_paths),
        error: if successes == active.len() {
            String::new()
        } else {
            format!(
                "Solo {successes}/{} destinos recibieron el backup; la copia local se conserva.",
                active.len()
            )
        },
    }
}

async fn transfer_copy(
    server: &BackupServer,
    database_path: &Path,
    database_checksum: &str,
    media: Option<&(PathBuf, String, u64)>,
    manifest: Option<&(PathBuf, String, u64)>,
) -> Result<Vec<String>, String> {
    let destination = PathBuf::from(&server.smb_share);
    if !destination.is_absolute() || server.smb_share.contains("..") {
        return Err("Destino copy/SMB no válido.".into());
    }
    fs::create_dir_all(&destination)
        .await
        .map_err(|error| format!("No se pudo abrir el destino: {error}"))?;
    let mut paths = Vec::new();
    copy_with_checksum(database_path, database_checksum, &destination, &mut paths).await?;
    if let Some((path, checksum, _)) = media {
        copy_with_checksum(path, checksum, &destination, &mut paths).await?;
    }
    if let Some((path, checksum, _)) = manifest {
        copy_with_checksum(path, checksum, &destination, &mut paths).await?;
    }
    Ok(paths)
}

async fn copy_with_checksum(
    source: &Path,
    checksum: &str,
    destination: &Path,
    paths: &mut Vec<String>,
) -> Result<(), String> {
    let name = source
        .file_name()
        .ok_or_else(|| "Archivo de backup sin nombre.".to_owned())?;
    let target = destination.join(name);
    let partial = destination.join(format!(
        ".{}.{}.partial",
        name.to_string_lossy(),
        Uuid::new_v4()
    ));
    fs::copy(source, &partial)
        .await
        .map_err(|error| format!("Copia remota falló: {error}"))?;
    let copied = fs::read(&partial)
        .await
        .map_err(|error| format!("No se pudo verificar la copia temporal: {error}"))?;
    if !checksum_matches(&copied, checksum) {
        let _ = fs::remove_file(&partial).await;
        return Err("Checksum remoto no válido; copia temporal eliminada.".into());
    }
    fs::rename(&partial, &target)
        .await
        .map_err(|error| format!("No se pudo finalizar la copia remota: {error}"))?;
    let sidecar = target.with_file_name(format!("{}.sha256", name.to_string_lossy()));
    atomic_write(
        &sidecar,
        format!("{checksum}  {}\n", name.to_string_lossy()).as_bytes(),
    )
    .await?;
    paths.push(target.to_string_lossy().into_owned());
    Ok(())
}

async fn transfer_sftp(
    server: &BackupServer,
    database_path: &Path,
    database_checksum: &str,
    media: Option<&(PathBuf, String, u64)>,
    manifest: Option<&(PathBuf, String, u64)>,
) -> Result<Vec<String>, String> {
    enforce_vpn_destination_string(server)?;
    if !valid_sftp_identity(&server.sftp_host, &server.sftp_user)
        || !safe_remote_path(&server.sftp_remote_path)
    {
        return Err("Identidad o ruta SFTP no válida.".into());
    }
    let key = PathBuf::from(&server.sftp_key_path);
    let known_hosts = PathBuf::from(&server.sftp_known_hosts);
    if !key.is_absolute() || !key.is_file() || !known_hosts.is_absolute() || !known_hosts.is_file()
    {
        return Err("SFTP requiere clave privada y known_hosts absolutos existentes.".into());
    }
    let batch = std::env::temp_dir().join(format!("uasspain-sftp-{}.batch", Uuid::new_v4()));
    let database_checksum_file =
        std::env::temp_dir().join(format!("uasspain-{}.sha256", Uuid::new_v4()));
    let mut checksum_files = vec![database_checksum_file.clone()];
    let mut commands = String::new();
    append_sftp_put(
        &mut commands,
        database_path,
        database_checksum,
        &database_checksum_file,
        &server.sftp_remote_path,
    )
    .await?;
    if let Some((path, checksum, _)) = media {
        let media_checksum_file =
            std::env::temp_dir().join(format!("uasspain-{}.sha256", Uuid::new_v4()));
        append_sftp_put(
            &mut commands,
            path,
            checksum,
            &media_checksum_file,
            &server.sftp_remote_path,
        )
        .await?;
        checksum_files.push(media_checksum_file);
    }
    if let Some((path, checksum, _)) = manifest {
        let manifest_checksum_file =
            std::env::temp_dir().join(format!("uasspain-{}.sha256", Uuid::new_v4()));
        append_sftp_put(
            &mut commands,
            path,
            checksum,
            &manifest_checksum_file,
            &server.sftp_remote_path,
        )
        .await?;
        checksum_files.push(manifest_checksum_file);
    }
    fs::write(&batch, commands)
        .await
        .map_err(|error| format!("No se pudo preparar SFTP: {error}"))?;
    let outcome = timeout(
        Duration::from_secs(300),
        Command::new("sftp")
            .arg("-o")
            .arg("BatchMode=yes")
            .arg("-o")
            .arg("StrictHostKeyChecking=yes")
            .arg("-o")
            .arg(format!("UserKnownHostsFile={}", known_hosts.display()))
            .arg("-o")
            .arg("PasswordAuthentication=no")
            .arg("-i")
            .arg(&key)
            .arg("-P")
            .arg(server.sftp_port.to_string())
            .arg("-b")
            .arg(&batch)
            .arg(format!("{}@{}", server.sftp_user, server.sftp_host))
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output(),
    )
    .await;
    let _ = fs::remove_file(&batch).await;
    for checksum_file in checksum_files {
        let _ = fs::remove_file(checksum_file).await;
    }
    let output = outcome
        .map_err(|_| "SFTP excedió 300 segundos.".to_owned())?
        .map_err(|error| format!("No se pudo ejecutar SFTP: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "SFTP falló: {}",
            String::from_utf8_lossy(&output.stderr)
                .trim()
                .chars()
                .take(500)
                .collect::<String>()
        ));
    }
    let mut paths = vec![sftp_url(server, database_path)?];
    if let Some((path, _, _)) = media {
        paths.push(sftp_url(server, path)?);
    }
    if let Some((path, _, _)) = manifest {
        paths.push(sftp_url(server, path)?);
    }
    Ok(paths)
}

async fn append_sftp_put(
    batch: &mut String,
    source: &Path,
    checksum: &str,
    checksum_file: &Path,
    remote_root: &str,
) -> Result<(), String> {
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Nombre local no válido para SFTP.".to_owned())?;
    fs::write(checksum_file, format!("{checksum}  {name}\n"))
        .await
        .map_err(|error| format!("No se pudo preparar checksum: {error}"))?;
    let remote = remote_root.trim_end_matches('/');
    let token = Uuid::new_v4();
    let partial = format!("{remote}/.{name}.{token}.partial");
    let checksum_partial = format!("{remote}/.{name}.{token}.sha256.partial");
    batch.push_str(&format!(
        "put \"{}\" \"{partial}\"\nrename \"{partial}\" \"{remote}/{name}\"\nput \"{}\" \"{checksum_partial}\"\nrename \"{checksum_partial}\" \"{remote}/{name}.sha256\"\n",
        source.display(),
        checksum_file.display()
    ));
    Ok(())
}

fn sftp_url(server: &BackupServer, path: &Path) -> Result<String, String> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Nombre remoto no válido.".to_owned())?;
    Ok(format!(
        "sftp://{}:{}/{}{}",
        server.sftp_host,
        server.sftp_port,
        server.sftp_remote_path.trim_matches('/'),
        format_args!("/{name}")
    ))
}

fn valid_sftp_identity(host: &str, user: &str) -> bool {
    !host.is_empty()
        && !user.is_empty()
        && host
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || ".:-_".contains(character))
        && user
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._-".contains(character))
}

fn safe_remote_path(path: &str) -> bool {
    path.starts_with('/')
        && !path.contains("..")
        && !path.contains(['\n', '\r', '"', ';', '|', '&', '`'])
}

fn enforce_vpn_destination(server: &BackupServer) -> Result<(), AppError> {
    enforce_vpn_destination_string(server).map_err(AppError::Validation)
}

fn enforce_vpn_destination_string(server: &BackupServer) -> Result<(), String> {
    if !env_bool("BACKUP_REQUIRE_VPN", true) {
        return Ok(());
    }
    let vpn_ip = server
        .vpn_ip
        .as_deref()
        .ok_or_else(|| "El destino remoto no tiene una IP VPN configurada.".to_owned())?;
    let configured: std::net::IpAddr = vpn_ip
        .parse()
        .map_err(|_| "La IP VPN configurada no es válida.".to_owned())?;
    let host: std::net::IpAddr = server.sftp_host.parse().map_err(|_| {
        "Con VPN obligatoria, sftp_host debe ser la IP privada del peer.".to_owned()
    })?;
    let private = match host {
        std::net::IpAddr::V4(ip) => ip.is_private() || ip.is_loopback(),
        std::net::IpAddr::V6(ip) => (ip.segments()[0] & 0xfe00) == 0xfc00 || ip.is_loopback(),
    };
    if host != configured || !private {
        return Err("El destino SFTP no coincide con la IP privada del peer VPN.".into());
    }
    Ok(())
}

pub async fn verify(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<IdRequest>,
) -> Result<Json<Value>, AppError> {
    let claims = admin(&state, &headers)?;
    let job = fetch_job(pool(&state)?, input.job_id)
        .await?
        .ok_or(AppError::NotFound)?;
    let path = safe_job_path(&job.storage_path)
        .await
        .ok_or_else(|| AppError::Validation("Archivo no encontrado".into()))?;
    let actual = sha256(&fs::read(path).await.map_err(|_| AppError::NotFound)?);
    let mut errors = Vec::new();
    if actual != job.checksum {
        errors.push("database_checksum_mismatch");
    }
    if !job.media_path.is_empty() {
        let media_path = safe_job_path(&job.media_path)
            .await
            .ok_or_else(|| AppError::Validation("Archivo de media no encontrado".into()))?;
        let media_actual = sha256(&fs::read(media_path).await.map_err(|_| AppError::NotFound)?);
        if media_actual != job.media_checksum {
            errors.push("media_checksum_mismatch");
        }
    }
    let manifest_path = safe_job_path(&job.manifest_path)
        .await
        .ok_or_else(|| AppError::Validation("Manifest no encontrado".into()))?;
    let manifest_bytes = fs::read(manifest_path)
        .await
        .map_err(|_| AppError::NotFound)?;
    if sha256(&manifest_bytes) != job.manifest_checksum {
        errors.push("manifest_checksum_mismatch");
    }
    let parsed: Value = serde_json::from_slice(&manifest_bytes)
        .map_err(|_| AppError::Validation("Manifest JSON no válido.".into()))?;
    if parsed.get("backup_id").and_then(Value::as_str) != Some(job.id.to_string().as_str())
        || parsed
            .pointer("/files/database/checksum")
            .and_then(Value::as_str)
            != Some(job.checksum.as_str())
        || parsed.get("format_version").and_then(Value::as_i64)
            != Some(i64::from(job.backup_format_version))
    {
        errors.push("manifest_content_mismatch");
    }
    if job.job_type == "incremental" {
        let chain_valid: bool = sqlx::query_scalar(
            "SELECT $1::uuid IS NOT NULL AND $2::uuid IS NOT NULL AND $3 > 0 \
             AND EXISTS(SELECT 1 FROM backups_backupjob WHERE id=$1 AND verified=TRUE) \
             AND EXISTS(SELECT 1 FROM backups_backupjob WHERE id=$2 AND job_type='full' AND verified=TRUE)",
        )
        .bind(job.parent_backup_id)
        .bind(job.base_full_id)
        .bind(job.chain_index)
        .fetch_one(pool(&state)?)
        .await?;
        if !chain_valid {
            errors.push("incremental_chain_broken");
        }
    }
    let valid = errors.is_empty();
    sqlx::query("UPDATE backups_backupjob SET verified=$2,verified_at=NOW(),verified_checksum=$3,status=CASE WHEN $2 THEN status ELSE 'verify_failed' END WHERE id=$1")
        .bind(job.id).bind(valid).bind(&actual).execute(pool(&state)?).await?;
    audit_event(
        pool(&state)?,
        claims.profile_id,
        "backup_verify",
        job.id,
        json!({"result":if valid {"success"} else {"failure"},"errors":&errors}),
    )
    .await?;
    Ok(Json(
        json!({"valid":valid,"job_id":job.id,"checksum":job.checksum,"verified_checksum":actual,"manifest_checksum":job.manifest_checksum,"chain_index":job.chain_index,"errors":errors}),
    ))
}

pub async fn origins(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<OriginQuery>,
) -> Result<Json<Value>, AppError> {
    admin(&state, &headers)?;
    let origin = query.origin.unwrap_or_else(|| "local".into());
    let jobs = sqlx::query_as::<_, BackupJob>(&job_select(
        "WHERE status IN ('completed','partial') ORDER BY created_date DESC LIMIT 100",
    ))
    .fetch_all(pool(&state)?)
    .await?;
    if origin == "local" {
        let available: Vec<Value> = jobs
            .iter()
            .filter_map(|job| {
                let mut value = serde_json::to_value(job).ok()?;
                value.as_object_mut()?.insert(
                    "filename".into(),
                    json!(
                        Path::new(&job.storage_path)
                            .file_name()
                            .and_then(|name| name.to_str())
                            .unwrap_or("")
                    ),
                );
                Some(value)
            })
            .collect();
        return Ok(Json(
            json!({"ok":true,"origin":"local","available":available}),
        ));
    }
    let server_id = Uuid::parse_str(&origin)
        .map_err(|_| AppError::Validation("Origen remoto no válido.".into()))?;
    let server = fetch_servers(pool(&state)?)
        .await?
        .into_iter()
        .find(|server| server.id == server_id && server.is_active)
        .ok_or(AppError::NotFound)?;
    let mut available = Vec::new();
    for job in jobs {
        let Some(destination) = destination_for_origin(&job.destinations, &origin) else {
            continue;
        };
        if destination.get("status").and_then(Value::as_str) != Some("success") {
            continue;
        }
        let Some(path) = destination.get("path").and_then(Value::as_str) else {
            continue;
        };
        let Some(filename) = remote_filename(path) else {
            continue;
        };
        let physically_available = if matches!(server.transfer_protocol.as_str(), "copy" | "smb") {
            PathBuf::from(&server.smb_share).join(&filename).is_file()
        } else {
            true
        };
        if physically_available {
            available.push(json!({
                "id": job.id,
                "filename": filename,
                "job_type": job.job_type,
                "created_date": job.created_date,
                "size_bytes": job.size_bytes,
                "checksum": job.checksum,
            }));
        }
    }
    Ok(Json(
        json!({"ok":true,"origin":origin,"available":available}),
    ))
}

pub async fn retention(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    admin(&state, &headers)?;
    let cfg = config_value(pool(&state)?).await?;
    let mut deleted = 0_u64;
    let mut errors = Vec::new();
    for kind in ["full", "incremental"] {
        let days = cfg
            .get(format!("retention_{kind}"))
            .and_then(Value::as_i64)
            .unwrap_or(if kind == "full" { 4 } else { 30 })
            .clamp(1, 3650);
        let jobs = sqlx::query_as::<_, BackupJob>(&job_select("WHERE job_type=$1 AND created_date < NOW() - ($2 * INTERVAL '1 day') AND id <> (SELECT id FROM backups_backupjob WHERE verified=TRUE AND status IN ('completed','partial') ORDER BY created_date DESC LIMIT 1) AND NOT EXISTS (SELECT 1 FROM backups_backupjob child WHERE child.parent_backup_id=backups_backupjob.id OR child.base_full_id=backups_backupjob.id)"))
            .bind(kind).bind(days).fetch_all(pool(&state)?).await?;
        for job in jobs {
            let removed = sqlx::query("DELETE FROM backups_backupjob WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM backups_backupjob child WHERE child.parent_backup_id=$1 OR child.base_full_id=$1)")
                .bind(job.id)
                .execute(pool(&state)?)
                .await?;
            if removed.rows_affected() == 0 {
                errors.push(format!("{}: protegido por cadena incremental", job.id));
                continue;
            }
            for raw in [&job.storage_path, &job.media_path, &job.manifest_path] {
                if let Some(path) = safe_job_path(raw).await
                    && let Err(error) = fs::remove_file(&path).await
                    && error.kind() != std::io::ErrorKind::NotFound
                {
                    errors.push(format!("{}: {error}", job.id));
                }
            }
            deleted += 1;
        }
    }
    Ok(Json(
        json!({"detail":format!("Eliminados {deleted} backups antiguos."),"deleted":deleted,"errors":errors}),
    ))
}

pub async fn restore(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<RestoreRequest>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let claims = admin(&state, &headers)?;
    if !env_bool("PRODUCTION_RESTORE_ENABLED", false) {
        return Err(AppError::Unavailable);
    }
    if !input.confirmed {
        return Err(AppError::Validation(
            "La restauración requiere confirmación explícita.".into(),
        ));
    }
    if input.origin == "local" && input.filename.is_some() {
        return Err(AppError::Validation(
            "filename solo es válido para orígenes remotos.".into(),
        ));
    }
    let (job, server, filename) = if input.origin == "local" {
        (
            fetch_job(pool(&state)?, input.job_id)
                .await?
                .ok_or(AppError::NotFound)?,
            None,
            None,
        )
    } else {
        let server_id = Uuid::parse_str(&input.origin)
            .map_err(|_| AppError::Validation("Origen remoto no válido.".into()))?;
        let server = fetch_servers(pool(&state)?)
            .await?
            .into_iter()
            .find(|server| server.id == server_id && server.is_active)
            .ok_or(AppError::NotFound)?;
        let filename = input
            .filename
            .as_deref()
            .filter(|name| safe_backup_filename(name))
            .ok_or_else(|| AppError::Validation("Nombre de backup remoto no válido.".into()))?
            .to_owned();
        let jobs = sqlx::query_as::<_, BackupJob>(&job_select(
            "WHERE status IN ('completed','partial') ORDER BY created_date DESC LIMIT 500",
        ))
        .fetch_all(pool(&state)?)
        .await?;
        let job = jobs
            .into_iter()
            .find(|job| remote_job_matches(job, &input.origin, &filename))
            .ok_or(AppError::NotFound)?;
        (job, Some(server), Some(filename))
    };
    if job.status != "completed" && job.status != "partial" {
        return Err(AppError::Validation(
            "Solo se puede restaurar un backup completado.".into(),
        ));
    }
    validate_restore_metadata(&state, &job).await?;
    let mut lock_connection = pool(&state)?.acquire().await?;
    let locked: bool = sqlx::query_scalar("SELECT pg_try_advisory_lock($1)")
        .bind(BACKUP_LOCK_KEY)
        .fetch_one(&mut *lock_connection)
        .await?;
    if !locked {
        return Ok((
            StatusCode::CONFLICT,
            Json(json!({"detail":"Hay otra operación de backup o restore en curso."})),
        ));
    }
    audit_event(
        pool(&state)?,
        claims.profile_id,
        "backup_restore_queued",
        job.id,
        json!({"origin":input.origin,"result":"queued"}),
    )
    .await?;
    let restore_id = Uuid::new_v4();
    state.restores.write().await.insert(
        restore_id,
        json!({
            "restore_id": restore_id,
            "state": "queued",
            "origin": input.origin,
            "filename": filename.as_deref().unwrap_or_else(|| Path::new(&job.storage_path).file_name().and_then(|name| name.to_str()).unwrap_or("")),
            "checksum_verified": false,
            "rolled_back": false,
        }),
    );
    let task_state = Arc::clone(&state);
    let restored_profile = claims.profile_id.to_string();
    let encrypted_email: String =
        sqlx::query_scalar("SELECT email FROM accounts_userprofile WHERE id=$1")
            .bind(claims.profile_id)
            .fetch_one(pool(&state)?)
            .await?;
    let restored_by = state.cipher.decrypt(&encrypted_email)?;
    let restored_session = claims.session_key;
    let origin = input.origin;
    tokio::spawn(async move {
        if let (Some(server), Some(filename)) = (server, filename) {
            execute_remote_restore(
                task_state,
                restore_id,
                job,
                server,
                filename,
                origin,
                (restored_profile, restored_by, restored_session),
            )
            .await;
        } else {
            let display_filename = Path::new(&job.storage_path)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("")
                .to_owned();
            let audit_storage_path = job.storage_path.clone();
            execute_production_restore(
                task_state,
                restore_id,
                job,
                RestoreContext {
                    profile_id: restored_profile,
                    actor_email: restored_by,
                    session_key: restored_session,
                    origin,
                    display_filename,
                    audit_storage_path,
                },
            )
            .await;
        }
        let _ = sqlx::query("SELECT pg_advisory_unlock($1)")
            .bind(BACKUP_LOCK_KEY)
            .execute(&mut *lock_connection)
            .await;
    });
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({"restore_id":restore_id,"state":"queued"})),
    ))
}

pub async fn restore_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<RestoreQuery>,
) -> Result<Json<Value>, AppError> {
    admin(&state, &headers)?;
    let value = state
        .restores
        .read()
        .await
        .get(&query.restore_id)
        .cloned()
        .ok_or(AppError::NotFound)?;
    Ok(Json(value))
}

pub async fn restore_unavailable(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<(StatusCode, Json<Value>), AppError> {
    admin(&state, &headers)?;
    Ok((
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({
            "detail":"Restauración deshabilitada hasta completar una prueba destructiva sobre una base desechable.",
            "code":"restore_not_validated"
        })),
    ))
}

struct SafetySnapshot {
    id: Uuid,
    path: PathBuf,
    checksum: String,
    encrypted: bool,
}

struct RestoreContext {
    profile_id: String,
    actor_email: String,
    session_key: String,
    origin: String,
    display_filename: String,
    audit_storage_path: String,
}

fn safe_backup_filename(filename: &str) -> bool {
    filename.starts_with("uasspain_")
        && filename.ends_with(".enc")
        && filename.len() <= 180
        && filename
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._-".contains(character))
}

fn remote_filename(path: &str) -> Option<String> {
    let filename = path.rsplit(['/', '\\']).next()?;
    safe_backup_filename(filename).then(|| filename.to_owned())
}

fn destination_for_origin<'a>(destinations: &'a Value, origin: &str) -> Option<&'a Value> {
    // Read historical UUID-keyed manifests and the new stable slot model.
    destinations.get(origin).or_else(|| {
        destinations.as_object()?.values().find(|destination| {
            destination.get("server_id").and_then(Value::as_str) == Some(origin)
        })
    })
}

fn remote_job_matches(job: &BackupJob, origin: &str, filename: &str) -> bool {
    destination_for_origin(&job.destinations, origin)
        .filter(|destination| destination.get("status").and_then(Value::as_str) == Some("success"))
        .and_then(|destination| destination.get("path"))
        .and_then(Value::as_str)
        .and_then(remote_filename)
        .is_some_and(|candidate| candidate == filename)
}

async fn validate_restore_metadata(state: &AppState, job: &BackupJob) -> Result<(), AppError> {
    if !job.verified || job.manifest_checksum.is_empty() || !job.manifest.is_object() {
        return Err(AppError::Validation(
            "El punto de recuperación no tiene un manifest verificado.".into(),
        ));
    }
    if job.manifest.get("backup_id").and_then(Value::as_str) != Some(job.id.to_string().as_str())
        || job
            .manifest
            .pointer("/files/database/checksum")
            .and_then(Value::as_str)
            != Some(job.checksum.as_str())
    {
        return Err(AppError::Validation(
            "El manifest no corresponde al backup seleccionado.".into(),
        ));
    }
    if job.job_type == "incremental" {
        let valid: bool = sqlx::query_scalar(
            "SELECT $1::uuid IS NOT NULL AND $2::uuid IS NOT NULL AND $3 > 0 \
             AND EXISTS(SELECT 1 FROM backups_backupjob WHERE id=$1 AND verified=TRUE) \
             AND EXISTS(SELECT 1 FROM backups_backupjob WHERE id=$2 AND job_type='full' AND verified=TRUE)",
        )
        .bind(job.parent_backup_id)
        .bind(job.base_full_id)
        .bind(job.chain_index)
        .fetch_one(pool(state)?)
        .await?;
        if !valid {
            return Err(AppError::Validation(
                "La cadena incremental está incompleta o dañada.".into(),
            ));
        }
    }
    Ok(())
}

async fn execute_remote_restore(
    state: Arc<AppState>,
    restore_id: Uuid,
    mut job: BackupJob,
    server: BackupServer,
    filename: String,
    origin: String,
    restored: (String, String, String),
) {
    let (restored_profile, restored_by, restored_session) = restored;
    state.restores.write().await.insert(
        restore_id,
        json!({
            "restore_id": restore_id,
            "state": "downloading",
            "origin": origin,
            "filename": filename,
            "checksum_verified": false,
            "rolled_back": false,
        }),
    );
    let downloaded = match download_remote_backup(&server, &filename, &job.checksum).await {
        Ok(path) => path,
        Err(error) => {
            state.restores.write().await.insert(
                restore_id,
                json!({
                    "restore_id": restore_id,
                    "state": "failed",
                    "origin": origin,
                    "filename": filename,
                    "checksum_verified": false,
                    "rolled_back": false,
                    "error": error,
                    "verify_errors": ["No se pudo descargar y verificar el origen remoto."],
                }),
            );
            return;
        }
    };
    let audit_storage_path = job.storage_path.clone();
    job.storage_path = downloaded.to_string_lossy().into_owned();
    execute_production_restore(
        Arc::clone(&state),
        restore_id,
        job,
        RestoreContext {
            profile_id: restored_profile,
            actor_email: restored_by,
            session_key: restored_session,
            origin,
            display_filename: filename,
            audit_storage_path,
        },
    )
    .await;
    let _ = fs::remove_file(downloaded).await;
}

async fn download_remote_backup(
    server: &BackupServer,
    filename: &str,
    expected_checksum: &str,
) -> Result<PathBuf, String> {
    let checksum_hex = expected_checksum
        .strip_prefix("sha256:")
        .unwrap_or_default();
    if !safe_backup_filename(filename)
        || checksum_hex.len() != 64
        || !checksum_hex
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("Identidad de backup remoto no válida.".into());
    }
    let root = backup_root().await?;
    let destination = root.join(format!(
        ".remote_restore_{}_{}",
        Uuid::new_v4().simple(),
        filename
    ));
    let sidecar = destination.with_file_name(format!(
        "{}.sha256",
        destination
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "Ruta temporal no válida.".to_owned())?
    ));
    let result = if matches!(server.transfer_protocol.as_str(), "copy" | "smb") {
        download_copy_backup(server, filename, &destination, &sidecar).await
    } else if server.transfer_protocol == "sftp" {
        download_sftp_backup(server, filename, &destination, &sidecar).await
    } else {
        Err("Protocolo remoto no soportado.".into())
    };
    if let Err(error) = result {
        let _ = fs::remove_file(&destination).await;
        let _ = fs::remove_file(&sidecar).await;
        return Err(error);
    }
    let data = fs::read(&destination)
        .await
        .map_err(|error| format!("No se pudo leer la descarga remota: {error}"))?;
    let sidecar_text = fs::read_to_string(&sidecar)
        .await
        .map_err(|error| format!("No se pudo leer el checksum remoto: {error}"))?;
    let _ = fs::remove_file(&sidecar).await;
    let declared = sidecar_text.split_whitespace().next().unwrap_or_default();
    let actual = sha256(&data);
    if !declared.eq_ignore_ascii_case(expected_checksum) || actual != expected_checksum {
        let _ = fs::remove_file(&destination).await;
        return Err("Checksum remoto inválido; restauración cancelada.".into());
    }
    Ok(destination)
}

async fn download_copy_backup(
    server: &BackupServer,
    filename: &str,
    destination: &Path,
    sidecar: &Path,
) -> Result<(), String> {
    let root = PathBuf::from(&server.smb_share);
    if !root.is_absolute() || server.smb_share.contains("..") {
        return Err("Destino copy/SMB no válido.".into());
    }
    let canonical_root = fs::canonicalize(&root)
        .await
        .map_err(|error| format!("No se pudo abrir el origen remoto: {error}"))?;
    for (source, target) in [
        (root.join(filename), destination.to_path_buf()),
        (
            root.join(format!("{filename}.sha256")),
            sidecar.to_path_buf(),
        ),
    ] {
        let canonical_source = fs::canonicalize(&source)
            .await
            .map_err(|error| format!("Archivo remoto no disponible: {error}"))?;
        if !canonical_source.starts_with(&canonical_root) {
            return Err("Ruta remota fuera del destino autorizado.".into());
        }
        fs::copy(canonical_source, target)
            .await
            .map_err(|error| format!("No se pudo copiar el backup remoto: {error}"))?;
    }
    Ok(())
}

async fn download_sftp_backup(
    server: &BackupServer,
    filename: &str,
    destination: &Path,
    sidecar: &Path,
) -> Result<(), String> {
    enforce_vpn_destination_string(server)?;
    if !valid_sftp_identity(&server.sftp_host, &server.sftp_user)
        || !safe_remote_path(&server.sftp_remote_path)
    {
        return Err("Identidad o ruta SFTP no válida.".into());
    }
    let key = PathBuf::from(&server.sftp_key_path);
    let known_hosts = PathBuf::from(&server.sftp_known_hosts);
    if !key.is_absolute() || !key.is_file() || !known_hosts.is_absolute() || !known_hosts.is_file()
    {
        return Err("SFTP requiere clave privada y known_hosts absolutos existentes.".into());
    }
    let batch = std::env::temp_dir().join(format!("uasspain-sftp-get-{}.batch", Uuid::new_v4()));
    let remote = server.sftp_remote_path.trim_end_matches('/');
    fs::write(
        &batch,
        format!(
            "get \"{remote}/{filename}\" \"{}\"\nget \"{remote}/{filename}.sha256\" \"{}\"\n",
            destination.display(),
            sidecar.display()
        ),
    )
    .await
    .map_err(|error| format!("No se pudo preparar la descarga SFTP: {error}"))?;
    let outcome = timeout(
        Duration::from_secs(300),
        Command::new("sftp")
            .arg("-o")
            .arg("BatchMode=yes")
            .arg("-o")
            .arg("StrictHostKeyChecking=yes")
            .arg("-o")
            .arg(format!("UserKnownHostsFile={}", known_hosts.display()))
            .arg("-o")
            .arg("PasswordAuthentication=no")
            .arg("-i")
            .arg(&key)
            .arg("-P")
            .arg(server.sftp_port.to_string())
            .arg("-b")
            .arg(&batch)
            .arg(format!("{}@{}", server.sftp_user, server.sftp_host))
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output(),
    )
    .await;
    let _ = fs::remove_file(&batch).await;
    let output = outcome
        .map_err(|_| "Descarga SFTP excedió 300 segundos.".to_owned())?
        .map_err(|error| format!("No se pudo ejecutar SFTP: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Descarga SFTP falló: {}",
            String::from_utf8_lossy(&output.stderr)
                .trim()
                .chars()
                .take(500)
                .collect::<String>()
        ));
    }
    Ok(())
}

async fn execute_production_restore(
    state: Arc<AppState>,
    restore_id: Uuid,
    job: BackupJob,
    context: RestoreContext,
) {
    state.restores.write().await.insert(
        restore_id,
        json!({
            "restore_id": restore_id,
            "state": "running",
            "origin": context.origin,
            "filename": context.display_filename,
            "checksum_verified": false,
            "rolled_back": false,
        }),
    );
    let result = production_restore(&state, &job).await;
    match result {
        Ok((tables, safety)) => {
            for _ in 0..10 {
                let Some(pool) = state.pool.as_ref() else {
                    break;
                };
                let update = if !context.session_key.is_empty() {
                    sqlx::query("UPDATE accounts_userprofile SET active_session_key=$1 WHERE id=$2")
                        .bind(&context.session_key)
                        .bind(context.profile_id.parse::<Uuid>().ok())
                        .execute(pool)
                        .await
                        .map(|_| ())
                } else {
                    Ok(())
                };
                if update.is_ok() {
                    // El dump se toma antes de poder finalizar su propia fila de
                    // catálogo. Tras restaurarlo, rehidratamos desde el manifest
                    // ya validado toda la identidad inmutable del recovery point;
                    // de lo contrario una segunda restauración perdería la cadena.
                    let _ = sqlx::query(
                        "UPDATE backups_backupjob SET status=$3,finished_at=COALESCE(finished_at,NOW()),verified=TRUE,verified_at=COALESCE(verified_at,NOW()),verified_checksum=$4,checksum=$4,storage_path=$5,restored_by=$2,restored_at=NOW(),destinations=$6,remote_paths=$7,initiated_by=$8,encrypted=$9,size_bytes=$10,media_path=$11,media_checksum=$12,media_size_bytes=$13,parent_backup_id=$14,base_full_id=$15,chain_index=$16,manifest=$17,manifest_checksum=$18,manifest_path=$19,backup_format_version=$20,encryption_key_id=$21 WHERE id=$1",
                    )
                    .bind(job.id)
                    .bind(&context.actor_email)
                    .bind(&job.status)
                    .bind(&job.checksum)
                    .bind(&context.audit_storage_path)
                    .bind(&job.destinations)
                    .bind(&job.remote_paths)
                    .bind(&job.initiated_by)
                    .bind(job.encrypted)
                    .bind(job.size_bytes)
                    .bind(&job.media_path)
                    .bind(&job.media_checksum)
                    .bind(job.media_size_bytes)
                    .bind(job.parent_backup_id)
                    .bind(job.base_full_id)
                    .bind(job.chain_index)
                    .bind(&job.manifest)
                    .bind(&job.manifest_checksum)
                    .bind(&job.manifest_path)
                    .bind(job.backup_format_version)
                    .bind(&job.encryption_key_id)
                    .execute(pool)
                    .await;
                    break;
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
            state.restores.write().await.insert(
                restore_id,
                json!({
                    "restore_id": restore_id,
                    "state": "done",
                    "origin": context.origin,
                    "filename": context.display_filename,
                    "checksum_verified": true,
                    "rolled_back": false,
                    "tables": tables,
                    "safety_backup_id": safety.id,
                    "detail": "Restauración completada y verificada correctamente.",
                    "warnings": [],
                }),
            );
        }
        Err((error, rolled_back, safety_id)) => {
            state.restores.write().await.insert(
                restore_id,
                json!({
                    "restore_id": restore_id,
                    "state": "failed",
                    "origin": context.origin,
                    "filename": context.display_filename,
                    "checksum_verified": true,
                    "rolled_back": rolled_back,
                    "safety_backup_id": safety_id,
                    "error": error,
                    "verify_errors": [],
                }),
            );
        }
    }
}

async fn production_restore(
    state: &AppState,
    job: &BackupJob,
) -> Result<(i64, SafetySnapshot), (String, bool, Option<Uuid>)> {
    let source = safe_job_path(&job.storage_path)
        .await
        .ok_or_else(|| ("Archivo de backup no encontrado.".into(), false, None))?;
    let stored = fs::read(&source)
        .await
        .map_err(|error| (format!("No se pudo leer el backup: {error}"), false, None))?;
    if !checksum_matches(&stored, &job.checksum) {
        return Err((
            "Checksum inválido; restauración cancelada.".into(),
            false,
            None,
        ));
    }
    let dump = if job.encrypted {
        state
            .cipher
            .decrypt_backup(&stored)
            .map_err(|_| ("No se pudo descifrar el backup.".into(), false, None))?
    } else {
        stored
    };
    let safety = create_safety_snapshot(state).await.map_err(|error| {
        (
            format!("No se creó el backup de seguridad: {error}"),
            false,
            None,
        )
    })?;
    let root = backup_root()
        .await
        .map_err(|error| (error, false, Some(safety.id)))?;
    let temporary = root.join(format!(".tmp_production_restore_{}.dump", Uuid::new_v4()));
    if let Err(error) = fs::write(&temporary, dump).await {
        return Err((
            format!("No se pudo preparar la restauración: {error}"),
            false,
            Some(safety.id),
        ));
    }
    let restored = replace_database(&temporary).await;
    let _ = fs::remove_file(&temporary).await;
    match restored {
        Ok(tables) => match restore_media_for_job(state, job).await {
            Ok(_) => Ok((tables, safety)),
            Err(error) => {
                let rolled_back = rollback_database(state, &safety, &root).await;
                Err((error, rolled_back, Some(safety.id)))
            }
        },
        Err(error) => {
            let rolled_back = rollback_database(state, &safety, &root).await;
            Err((error, rolled_back, Some(safety.id)))
        }
    }
}

async fn rollback_database(state: &AppState, safety: &SafetySnapshot, root: &Path) -> bool {
    let Ok(bytes) = load_snapshot_dump(state, safety).await else {
        return false;
    };
    let rollback_path = root.join(format!(".tmp_rollback_{}.dump", Uuid::new_v4()));
    if fs::write(&rollback_path, bytes).await.is_err() {
        return false;
    }
    let result = replace_database(&rollback_path).await.is_ok();
    let _ = fs::remove_file(rollback_path).await;
    result
}

async fn restore_media_for_job(state: &AppState, job: &BackupJob) -> Result<usize, String> {
    if job.media_path.is_empty() {
        return Ok(0);
    }
    let path = safe_job_path(&job.media_path)
        .await
        .ok_or_else(|| "Archivo de media no encontrado.".to_owned())?;
    let stored = fs::read(path)
        .await
        .map_err(|error| format!("No se pudo leer media: {error}"))?;
    if !checksum_matches(&stored, &job.media_checksum) {
        return Err("Checksum de media inválido; restore cancelado.".into());
    }
    let archive = if job.encrypted {
        state
            .cipher
            .decrypt_backup(&stored)
            .map_err(|_| "No se pudo descifrar media.".to_owned())?
    } else {
        stored
    };
    let media_root =
        PathBuf::from(std::env::var("MEDIA_ROOT").unwrap_or_else(|_| "./media".to_owned()));
    fs::create_dir_all(&media_root)
        .await
        .map_err(|error| format!("No se pudo preparar MEDIA_ROOT: {error}"))?;
    let max_bytes = std::env::var("BACKUP_MAX_MEDIA_RESTORE_BYTES")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(20 * 1024 * 1024 * 1024);
    tokio::task::spawn_blocking(move || replace_media_contents(&media_root, &archive, max_bytes))
        .await
        .map_err(|_| "La tarea de restore de media terminó inesperadamente.".to_owned())?
}

fn replace_media_contents(root: &Path, archive: &[u8], max_bytes: u64) -> Result<usize, String> {
    let root = std::fs::canonicalize(root)
        .map_err(|error| format!("MEDIA_ROOT no es accesible: {error}"))?;
    let token = Uuid::new_v4();
    let stage = root.join(format!(".restore-stage-{token}"));
    let rollback = root.join(format!(".restore-rollback-{token}"));
    std::fs::create_dir(&stage)
        .map_err(|error| format!("No se pudo crear staging de media: {error}"))?;
    std::fs::create_dir(&rollback)
        .map_err(|error| format!("No se pudo crear rollback de media: {error}"))?;
    let mut activated = Vec::new();
    let result = (|| {
        let mut zip = zip::ZipArchive::new(Cursor::new(archive))
            .map_err(|error| format!("ZIP de media no válido: {error}"))?;
        if zip.len() > 100_000 {
            return Err("ZIP de media excede el máximo de entradas.".into());
        }
        let mut total = 0_u64;
        let mut files = 0_usize;
        for index in 0..zip.len() {
            let mut entry = zip
                .by_index(index)
                .map_err(|error| format!("Entrada ZIP no válida: {error}"))?;
            let relative = entry
                .enclosed_name()
                .ok_or_else(|| "ZIP de media contiene path traversal.".to_owned())?
                .to_owned();
            if entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
            {
                return Err("ZIP de media contiene enlaces simbólicos.".into());
            }
            total = total.saturating_add(entry.size());
            if total > max_bytes {
                return Err("ZIP de media excede el tamaño máximo permitido.".into());
            }
            let target = stage.join(relative);
            if entry.is_dir() {
                std::fs::create_dir_all(&target)
                    .map_err(|error| format!("No se pudo crear directorio de media: {error}"))?;
                continue;
            }
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|error| format!("No se pudo crear ruta de media: {error}"))?;
            }
            let mut output = std::fs::File::create(&target)
                .map_err(|error| format!("No se pudo crear media restaurada: {error}"))?;
            std::io::copy(&mut entry, &mut output)
                .map_err(|error| format!("No se pudo extraer media: {error}"))?;
            files += 1;
        }
        for entry in std::fs::read_dir(&root)
            .map_err(|error| format!("No se pudo inventariar MEDIA_ROOT: {error}"))?
        {
            let entry = entry.map_err(|error| format!("Entrada de media no válida: {error}"))?;
            let path = entry.path();
            if path == stage || path == rollback {
                continue;
            }
            std::fs::rename(&path, rollback.join(entry.file_name()))
                .map_err(|error| format!("No se pudo preservar media existente: {error}"))?;
        }
        for entry in std::fs::read_dir(&stage)
            .map_err(|error| format!("No se pudo leer staging de media: {error}"))?
        {
            let entry = entry.map_err(|error| format!("Entrada restaurada no válida: {error}"))?;
            let target = root.join(entry.file_name());
            std::fs::rename(entry.path(), &target)
                .map_err(|error| format!("No se pudo activar media restaurada: {error}"))?;
            activated.push(target);
        }
        Ok(files)
    })();
    if result.is_err() {
        for path in activated {
            if path.is_dir() {
                let _ = std::fs::remove_dir_all(path);
            } else {
                let _ = std::fs::remove_file(path);
            }
        }
        for entry in std::fs::read_dir(&rollback).into_iter().flatten().flatten() {
            let _ = std::fs::rename(entry.path(), root.join(entry.file_name()));
        }
    }
    let _ = std::fs::remove_dir_all(&stage);
    let _ = std::fs::remove_dir_all(&rollback);
    result
}

async fn create_safety_snapshot(state: &AppState) -> Result<SafetySnapshot, String> {
    let root = backup_root().await?;
    let id = Uuid::new_v4();
    let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
    let temporary = root.join(format!(".tmp_restore_safety_{id}.dump"));
    let output = timeout(
        Duration::from_secs(600),
        Command::new(pg_dump_path())
            .args(["-F", "c", "-Z", "6", "-f"])
            .arg(&temporary)
            .arg(backup_database_url()?)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output(),
    )
    .await
    .map_err(|_| "pg_dump de seguridad excedió 600 segundos".to_owned())?
    .map_err(|error| format!("No se pudo ejecutar pg_dump de seguridad: {error}"))?;
    if !output.status.success() {
        let _ = fs::remove_file(&temporary).await;
        return Err(format!(
            "pg_dump de seguridad falló: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let plain = fs::read(&temporary)
        .await
        .map_err(|error| format!("No se pudo leer el backup de seguridad: {error}"))?;
    let _ = fs::remove_file(&temporary).await;
    let encrypted = env_bool("BACKUP_ENCRYPTION_ENABLED", true);
    let payload = if encrypted {
        state
            .cipher
            .encrypt_backup(&plain)
            .map_err(|_| "No se pudo cifrar el backup de seguridad.".to_owned())?
    } else {
        plain
    };
    let path = root.join(format!(
        "uasspain_restore_safety_{timestamp}.dump{}",
        if encrypted { ".enc" } else { "" }
    ));
    fs::write(&path, &payload)
        .await
        .map_err(|error| format!("No se pudo guardar el backup de seguridad: {error}"))?;
    let checksum = sha256(&payload);
    sqlx::query("INSERT INTO backups_backupjob (id,job_type,status,started_at,finished_at,duration_seconds,size_bytes,encrypted,checksum,storage_path,media_path,media_checksum,media_size_bytes,remote_paths,destinations,verified,verified_at,verified_checksum,restore_tested,restore_test_result,initiated_by,restored_by,data_loss_window_seconds,error,created_date) VALUES ($1,'full','completed',NOW(),NOW(),0,$2,$3,$4,$5,'','',0,'[]'::jsonb,'{}'::jsonb,true,NOW(),$4,false,'','restore-safety','',0,'',NOW())")
        .bind(id)
        .bind(i64::try_from(payload.len()).unwrap_or(i64::MAX))
        .bind(encrypted)
        .bind(&checksum)
        .bind(path.to_string_lossy().as_ref())
        .execute(pool(state).map_err(|_| "Base de datos no disponible.".to_owned())?)
        .await
        .map_err(|error| format!("No se pudo registrar el backup de seguridad: {error}"))?;
    Ok(SafetySnapshot {
        id,
        path,
        checksum,
        encrypted,
    })
}

async fn load_snapshot_dump(
    state: &AppState,
    snapshot: &SafetySnapshot,
) -> Result<Vec<u8>, String> {
    let stored = fs::read(&snapshot.path)
        .await
        .map_err(|error| format!("No se pudo leer el rollback: {error}"))?;
    if sha256(&stored) != snapshot.checksum {
        return Err("Checksum del rollback no válido.".into());
    }
    if snapshot.encrypted {
        state
            .cipher
            .decrypt_backup(&stored)
            .map_err(|_| "No se pudo descifrar el rollback.".to_owned())
    } else {
        Ok(stored)
    }
}

async fn replace_database(dump: &Path) -> Result<i64, String> {
    let database_url = restore_database_url()?;
    let database = database_name_from_url(&database_url)?;
    if matches!(database.as_str(), "postgres" | "template0" | "template1") {
        return Err("La base de mantenimiento no se puede restaurar.".into());
    }
    let maintenance_url = std::env::var("RESTORE_MAINTENANCE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map_or_else(|| database_url_with_name(&database_url, "postgres"), Ok)?;
    let drop = timeout(
        Duration::from_secs(60),
        Command::new(pg_tool_path("dropdb"))
            .arg("--maintenance-db")
            .arg(&maintenance_url)
            .arg("--force")
            .arg(&database)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output(),
    )
    .await
    .map_err(|_| "dropdb excedió 60 segundos".to_owned())?
    .map_err(|error| format!("No se pudo ejecutar dropdb: {error}"))?;
    if !drop.status.success() {
        return Err(format!(
            "dropdb falló: {}",
            String::from_utf8_lossy(&drop.stderr).trim()
        ));
    }
    let create = timeout(
        Duration::from_secs(60),
        Command::new(pg_tool_path("createdb"))
            .arg("--maintenance-db")
            .arg(&maintenance_url)
            .arg(&database)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output(),
    )
    .await
    .map_err(|_| "createdb excedió 60 segundos".to_owned())?
    .map_err(|error| format!("No se pudo ejecutar createdb: {error}"))?;
    if !create.status.success() {
        return Err(format!(
            "createdb falló: {}",
            String::from_utf8_lossy(&create.stderr).trim()
        ));
    }
    let restore = timeout(
        Duration::from_secs(600),
        Command::new(pg_tool_path("pg_restore"))
            .args([
                "--exit-on-error",
                "--no-owner",
                "--no-privileges",
                "--dbname",
            ])
            .arg(&database_url)
            .arg(dump)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output(),
    )
    .await
    .map_err(|_| "pg_restore excedió 600 segundos".to_owned())?
    .map_err(|error| format!("No se pudo ejecutar pg_restore: {error}"))?;
    if !restore.status.success() {
        return Err(format!(
            "pg_restore falló: {}",
            String::from_utf8_lossy(&restore.stderr).trim()
        ));
    }
    let verified = timeout(
        Duration::from_secs(30),
        Command::new(pg_tool_path("psql"))
            .arg(&database_url)
            .args([
                "-tAc",
                "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'",
            ])
            .stderr(Stdio::piped())
            .output(),
    )
    .await
    .map_err(|_| "La verificación SQL excedió 30 segundos".to_owned())?
    .map_err(|error| format!("No se pudo ejecutar psql: {error}"))?;
    if !verified.status.success() {
        return Err(format!(
            "Verificación SQL falló: {}",
            String::from_utf8_lossy(&verified.stderr).trim()
        ));
    }
    let tables = String::from_utf8_lossy(&verified.stdout)
        .trim()
        .parse::<i64>()
        .map_err(|_| "La verificación no devolvió un recuento válido.".to_owned())?;
    (tables > 0)
        .then_some(tables)
        .ok_or_else(|| "La base restaurada no contiene tablas públicas.".to_owned())
}

fn database_name_from_url(url: &str) -> Result<String, String> {
    let query = url.find('?').unwrap_or(url.len());
    let slash = url[..query]
        .rfind('/')
        .ok_or_else(|| "DATABASE_URL no válida.".to_owned())?;
    let name = &url[slash + 1..query];
    if name.is_empty()
        || !name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_')
    {
        return Err("Nombre de base de datos no válido.".into());
    }
    Ok(name.to_owned())
}

pub async fn restore_test(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<IdRequest>,
) -> Result<Json<Value>, AppError> {
    admin(&state, &headers)?;
    let job = fetch_job(pool(&state)?, input.job_id)
        .await?
        .ok_or(AppError::NotFound)?;
    validate_restore_metadata(&state, &job).await?;
    let source = safe_job_path(&job.storage_path)
        .await
        .ok_or_else(|| AppError::Validation("Archivo de backup no encontrado.".into()))?;
    let stored = fs::read(&source).await.map_err(|_| AppError::NotFound)?;
    if sha256(&stored) != job.checksum {
        return Err(AppError::Validation(
            "Checksum inválido; restauración cancelada.".into(),
        ));
    }
    let dump = if job.encrypted {
        state.cipher.decrypt_backup(&stored)?
    } else {
        stored
    };
    let root = backup_root().await.map_err(|_| AppError::Internal)?;
    let suffix = Uuid::new_v4().simple().to_string();
    let database = format!("uasspain_restore_test_{}", &suffix[..12]);
    let temporary = root.join(format!(".tmp_restore_{suffix}.dump"));
    fs::write(&temporary, &dump)
        .await
        .map_err(|_| AppError::Internal)?;
    let media_files = drill_media_restore(&state, &job, &root).await?;
    let result = run_restore_drill(&database, &temporary).await;
    let _ = fs::remove_file(&temporary).await;
    match result {
        Ok(tables) => {
            sqlx::query("UPDATE backups_backupjob SET restore_tested=TRUE,restore_tested_at=NOW(),restore_test_result=$2 WHERE id=$1")
                .bind(job.id)
                .bind(format!("success:{tables}"))
                .execute(pool(&state)?)
                .await?;
            Ok(Json(
                json!({"success":true,"status":"success","tables":tables,"media_files":media_files,"job_id":job.id}),
            ))
        }
        Err(error) => {
            sqlx::query("UPDATE backups_backupjob SET restore_tested=FALSE,restore_tested_at=NOW(),restore_test_result=$2 WHERE id=$1")
                .bind(job.id)
                .bind(&error)
                .execute(pool(&state)?)
                .await?;
            Err(AppError::Validation(error))
        }
    }
}

async fn drill_media_restore(
    state: &AppState,
    job: &BackupJob,
    backup_root: &Path,
) -> Result<usize, AppError> {
    if job.media_path.is_empty() {
        return Ok(0);
    }
    let source = safe_job_path(&job.media_path)
        .await
        .ok_or_else(|| AppError::Validation("Archivo de media no encontrado.".into()))?;
    let stored = fs::read(source).await.map_err(|_| AppError::NotFound)?;
    if !checksum_matches(&stored, &job.media_checksum) {
        return Err(AppError::Validation(
            "Checksum de media inválido; drill cancelado.".into(),
        ));
    }
    let archive = if job.encrypted {
        state.cipher.decrypt_backup(&stored)?
    } else {
        stored
    };
    let drill = backup_root.join(format!(".media-restore-drill-{}", Uuid::new_v4()));
    fs::create_dir(&drill)
        .await
        .map_err(|_| AppError::Internal)?;
    let max_bytes = std::env::var("BACKUP_MAX_MEDIA_RESTORE_BYTES")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(20 * 1024 * 1024 * 1024);
    let result = tokio::task::spawn_blocking({
        let drill = drill.clone();
        move || replace_media_contents(&drill, &archive, max_bytes)
    })
    .await
    .map_err(|_| AppError::Internal)?
    .map_err(AppError::Validation);
    let _ = fs::remove_dir_all(&drill).await;
    result
}

async fn run_restore_drill(database: &str, dump: &Path) -> Result<i64, String> {
    if !database.chars().all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '_'
    }) {
        return Err("Nombre de base temporal no válido.".into());
    }
    let base_url = restore_database_url()?;
    let test_url = database_url_with_name(&base_url, database)?;
    let create = timeout(
        Duration::from_secs(30),
        Command::new(pg_tool_path("createdb"))
            .arg("--maintenance-db")
            .arg(&base_url)
            .arg(database)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output(),
    )
    .await
    .map_err(|_| "createdb excedió 30 segundos".to_owned())
    .and_then(|result| result.map_err(|error| format!("No se pudo ejecutar createdb: {error}")))?;
    if !create.status.success() {
        return Err(format!(
            "createdb falló: {}",
            String::from_utf8_lossy(&create.stderr).trim()
        ));
    }
    let restore = timeout(
        Duration::from_secs(600),
        Command::new(pg_tool_path("pg_restore"))
            .args([
                "--exit-on-error",
                "--no-owner",
                "--no-privileges",
                "--dbname",
            ])
            .arg(&test_url)
            .arg(dump)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output(),
    )
    .await
    .map_err(|_| "pg_restore excedió 600 segundos".to_owned())
    .and_then(|result| {
        result.map_err(|error| format!("No se pudo ejecutar pg_restore: {error}"))
    })?;
    let table_count = if restore.status.success() {
        timeout(
            Duration::from_secs(30),
            Command::new(pg_tool_path("psql"))
                .arg(&test_url)
                .args([
                    "-tAc",
                    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'",
                ])
                .stderr(Stdio::piped())
                .output(),
        )
        .await
        .map_err(|_| "La verificación psql excedió 30 segundos".to_owned())
        .and_then(|result| result.map_err(|error| format!("No se pudo ejecutar psql: {error}")))?
    } else {
        let error = String::from_utf8_lossy(&restore.stderr).trim().to_owned();
        drop_restore_database(&base_url, database).await;
        return Err(format!("pg_restore falló: {error}"));
    };
    drop_restore_database(&base_url, database).await;
    if !table_count.status.success() {
        return Err(format!(
            "Verificación SQL falló: {}",
            String::from_utf8_lossy(&table_count.stderr).trim()
        ));
    }
    let tables = String::from_utf8_lossy(&table_count.stdout)
        .trim()
        .parse::<i64>()
        .map_err(|_| "La verificación no devolvió un recuento válido.".to_owned())?;
    (tables > 0)
        .then_some(tables)
        .ok_or_else(|| "El restore temporal no contiene tablas públicas.".to_owned())
}

async fn drop_restore_database(base_url: &str, database: &str) {
    let _ = timeout(
        Duration::from_secs(30),
        Command::new(pg_tool_path("dropdb"))
            .arg("--maintenance-db")
            .arg(base_url)
            .arg("--force")
            .arg(database)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status(),
    )
    .await;
}

fn database_url_with_name(url: &str, database: &str) -> Result<String, String> {
    let query = url.find('?').unwrap_or(url.len());
    let slash = url[..query]
        .rfind('/')
        .ok_or_else(|| "DATABASE_URL no válida.".to_owned())?;
    Ok(format!("{}{database}{}", &url[..=slash], &url[query..]))
}

pub async fn get_config(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, AppError> {
    admin(&state, &headers)?;
    let value = config_value(pool(&state)?).await?;
    Ok(Json(json!({"key":"backups","value":value})))
}

pub async fn put_config(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<ConfigWrite>,
) -> Result<Json<Value>, AppError> {
    let claims = admin(&state, &headers)?;
    if input.key.as_deref().is_some_and(|key| key != "backups") || !input.value.is_object() {
        return Err(AppError::Validation("Configuración no válida.".into()));
    }
    validate_config(&input.value)?;
    sqlx::query("INSERT INTO backups_backupconfig (key,value) VALUES ('backups',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value")
        .bind(&input.value).execute(pool(&state)?).await?;
    audit_event(
        pool(&state)?,
        claims.profile_id,
        "backup_schedule_change",
        Uuid::new_v4(),
        json!({"frequency":input.value.get("frequency"),"job_type":input.value.get("job_type"),"result":"success"}),
    )
    .await?;
    Ok(Json(json!({"key":"backups","value":input.value})))
}

pub async fn list_servers(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<BackupServer>>, AppError> {
    admin(&state, &headers)?;
    Ok(Json(fetch_servers(pool(&state)?).await?))
}

pub async fn create_server(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(mut input): Json<ServerWrite>,
) -> Result<(StatusCode, Json<BackupServer>), AppError> {
    admin(&state, &headers)?;
    if input.ip_address.is_none() {
        let host = input.sftp_host.as_deref().unwrap_or_default();
        let mut addresses = tokio::time::timeout(
            std::time::Duration::from_secs(3),
            tokio::net::lookup_host((host, 22)),
        )
        .await
        .map_err(|_| AppError::Validation("No se pudo resolver el hostname.".into()))?
        .map_err(|_| AppError::Validation("Hostname no valido.".into()))?;
        input.ip_address = Some(
            addresses
                .next()
                .ok_or_else(|| AppError::Validation("Hostname sin direccion IP.".into()))?
                .ip()
                .to_string(),
        );
    }
    if let Some(role) = &input.role {
        input.is_offsite = Some(role != "local");
    }
    validate_server(&input, true)?;
    let name = input
        .name
        .ok_or_else(|| AppError::Validation("El nombre es obligatorio.".into()))?;
    let ip_address = input
        .ip_address
        .ok_or_else(|| AppError::Validation("La direccion IP es obligatoria.".into()))?;
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO backups_backupserver (id,name,role,ip_address,vpn_ip,vpn_port,vpn_status,smb_share,transfer_protocol,sftp_host,sftp_port,sftp_user,sftp_remote_path,sftp_key_path,sftp_known_hosts,is_offsite,status,is_active,last_backup_status,disk_total_bytes,disk_used_bytes,error,created_date) VALUES ($1,$2,$3,$4::inet,NULLIF($5,'')::inet,$6,'unknown',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'',0,0,'',NOW())")
        .bind(id).bind(name).bind(input.role.unwrap_or_else(|| "local".into())).bind(ip_address).bind(input.vpn_ip.unwrap_or_default()).bind(input.vpn_port.unwrap_or(51820)).bind(input.smb_share.unwrap_or_default()).bind(input.transfer_protocol.unwrap_or_else(|| "copy".into())).bind(input.sftp_host.unwrap_or_default()).bind(input.sftp_port.unwrap_or(22)).bind(input.sftp_user.unwrap_or_default()).bind(input.sftp_remote_path.unwrap_or_default()).bind(input.sftp_key_path.unwrap_or_default()).bind(input.sftp_known_hosts.unwrap_or_default()).bind(input.is_offsite.unwrap_or(false)).bind("unknown").bind(input.is_active.unwrap_or(true)).execute(pool(&state)?).await?;
    crate::runtime_config::audit(
        &state,
        admin(&state, &headers)?.profile_id,
        "backup_destination_create",
    )
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(
            fetch_server(pool(&state)?, id)
                .await?
                .ok_or(AppError::Internal)?,
        ),
    ))
}

pub async fn get_server(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<Uuid>,
) -> Result<Json<BackupServer>, AppError> {
    admin(&state, &headers)?;
    Ok(Json(
        fetch_server(pool(&state)?, id)
            .await?
            .ok_or(AppError::NotFound)?,
    ))
}

pub async fn update_server(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<Uuid>,
    Json(mut input): Json<ServerWrite>,
) -> Result<Json<BackupServer>, AppError> {
    admin(&state, &headers)?;
    if let Some(role) = &input.role {
        input.is_offsite = Some(role != "local");
    }
    validate_server(&input, false)?;
    let result = sqlx::query("UPDATE backups_backupserver SET name=COALESCE($2,name),role=COALESCE($3,role),ip_address=COALESCE($4::inet,ip_address),vpn_ip=CASE WHEN $5::text IS NULL THEN vpn_ip ELSE NULLIF($5,'')::inet END,vpn_port=COALESCE($6,vpn_port),smb_share=COALESCE($7,smb_share),transfer_protocol=COALESCE($8,transfer_protocol),sftp_host=COALESCE($9,sftp_host),sftp_port=COALESCE($10,sftp_port),sftp_user=COALESCE($11,sftp_user),sftp_remote_path=COALESCE($12,sftp_remote_path),sftp_key_path=COALESCE($13,sftp_key_path),sftp_known_hosts=COALESCE($14,sftp_known_hosts),is_offsite=COALESCE($15,is_offsite),status=COALESCE($16,status),is_active=COALESCE($17,is_active) WHERE id=$1")
        .bind(id).bind(input.name).bind(input.role).bind(input.ip_address).bind(input.vpn_ip).bind(input.vpn_port).bind(input.smb_share).bind(input.transfer_protocol).bind(input.sftp_host).bind(input.sftp_port).bind(input.sftp_user).bind(input.sftp_remote_path).bind(input.sftp_key_path).bind(input.sftp_known_hosts).bind(input.is_offsite).bind(Some("unknown")).bind(input.is_active).execute(pool(&state)?).await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    crate::runtime_config::audit(
        &state,
        admin(&state, &headers)?.profile_id,
        "backup_destination_update",
    )
    .await?;
    Ok(Json(
        fetch_server(pool(&state)?, id)
            .await?
            .ok_or(AppError::NotFound)?,
    ))
}

pub async fn delete_server(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<Uuid>,
) -> Result<StatusCode, AppError> {
    admin(&state, &headers)?;
    let result = sqlx::query("DELETE FROM backups_backupserver WHERE id=$1")
        .bind(id)
        .execute(pool(&state)?)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn config_value(pool: &PgPool) -> Result<Value, AppError> {
    let default = json!({"frequency":"daily","day":"*","hour":"03:00","interval_days":3,"job_type":"incremental","retention_full":4,"retention_incremental":30,"compressed":true,"encrypt":env_bool("BACKUP_ENCRYPTION_ENABLED",true)});
    Ok(sqlx::query_scalar::<_, Value>("INSERT INTO backups_backupconfig (key,value) VALUES ('backups',$1) ON CONFLICT (key) DO UPDATE SET key=EXCLUDED.key RETURNING value")
        .bind(default).fetch_one(pool).await?)
}

fn server_select(suffix: &str) -> String {
    format!(
        "SELECT id,name,role,host(ip_address)::text AS ip_address,host(vpn_ip)::text AS vpn_ip,vpn_port::integer,vpn_status,vpn_last_handshake,smb_share,transfer_protocol,sftp_host,sftp_port::integer,sftp_user,sftp_remote_path,sftp_key_path,sftp_known_hosts,is_offsite,status,is_active,last_seen,last_backup,last_backup_status,disk_total_bytes::bigint,disk_used_bytes::bigint,error,created_date FROM backups_backupserver {suffix}"
    )
}
async fn fetch_servers(pool: &PgPool) -> Result<Vec<BackupServer>, AppError> {
    Ok(sqlx::query_as(&server_select("ORDER BY name"))
        .fetch_all(pool)
        .await?)
}
async fn fetch_server(pool: &PgPool, id: Uuid) -> Result<Option<BackupServer>, AppError> {
    Ok(sqlx::query_as(&server_select("WHERE id=$1"))
        .bind(id)
        .fetch_optional(pool)
        .await?)
}
fn job_select(suffix: &str) -> String {
    format!(
        "SELECT id,job_type,status,started_at,finished_at,duration_seconds::integer,size_bytes::bigint,encrypted,checksum,storage_path,media_path,media_checksum,media_size_bytes::bigint,remote_paths,destinations,verified,verified_at,verified_checksum,restore_tested,restore_tested_at,restore_test_result,initiated_by,restored_by,restored_at,data_loss_window_seconds::integer,error,created_date,parent_backup_id,base_full_id,chain_index::integer,manifest,manifest_checksum,manifest_path,backup_format_version::integer,encryption_key_id FROM backups_backupjob {suffix}"
    )
}
async fn fetch_job(pool: &PgPool, id: Option<Uuid>) -> Result<Option<BackupJob>, AppError> {
    if let Some(id) = id {
        Ok(sqlx::query_as(&job_select("WHERE id=$1"))
            .bind(id)
            .fetch_optional(pool)
            .await?)
    } else {
        Ok(
            sqlx::query_as(&job_select("ORDER BY created_date DESC LIMIT 1"))
                .fetch_optional(pool)
                .await?,
        )
    }
}
async fn fetch_job_connection(
    connection: &mut sqlx::pool::PoolConnection<sqlx::Postgres>,
    id: Uuid,
) -> Result<Option<BackupJob>, AppError> {
    Ok(sqlx::query_as(&job_select("WHERE id=$1"))
        .bind(id)
        .fetch_optional(&mut **connection)
        .await?)
}
async fn backup_root() -> Result<PathBuf, String> {
    let root =
        PathBuf::from(std::env::var("BACKUP_STORAGE_PATH").unwrap_or_else(|_| "./backups".into()));
    fs::create_dir_all(&root)
        .await
        .map_err(|error| format!("No se pudo crear BACKUP_STORAGE_PATH: {error}"))?;
    fs::canonicalize(root)
        .await
        .map_err(|error| format!("BACKUP_STORAGE_PATH no es accesible: {error}"))
}
async fn safe_job_path(raw: &str) -> Option<PathBuf> {
    if raw.is_empty() {
        return None;
    }
    let root = backup_root().await.ok()?;
    let path = fs::canonicalize(raw).await.ok()?;
    path.starts_with(root).then_some(path)
}
fn pg_dump_path() -> PathBuf {
    pg_tool_path("pg_dump")
}

fn pg_tool_path(tool: &str) -> PathBuf {
    let name = if cfg!(windows) {
        format!("{tool}.exe")
    } else {
        tool.to_owned()
    };
    match std::env::var("PG_BIN") {
        Ok(dir) => Path::new(&dir).join(name),
        Err(_) => PathBuf::from(name),
    }
}
fn backup_database_url() -> Result<String, String> {
    database_url_for_role("BACKUP")
}

fn restore_database_url() -> Result<String, String> {
    database_url_for_role("RESTORE")
}

fn database_url_for_role(role: &str) -> Result<String, String> {
    if let Ok(url) = std::env::var(format!("{role}_DATABASE_URL"))
        && !url.trim().is_empty()
    {
        return Ok(url);
    }
    let role_user = std::env::var(format!("DB_{role}_USER")).ok();
    let role_password = read_database_secret(
        &format!("DB_{role}_PASSWORD"),
        &format!("DB_{role}_PASSWORD_FILE"),
    );
    if role_user.is_none()
        && role_password.is_none()
        && let Ok(url) = std::env::var("DATABASE_URL")
    {
        return Ok(url);
    }
    let host = std::env::var("DB_HOST").unwrap_or_else(|_| "postgres".into());
    let port = std::env::var("DB_PORT").unwrap_or_else(|_| "5432".into());
    let name = std::env::var("DB_NAME").unwrap_or_else(|_| "uasspain".into());
    let user =
        role_user.unwrap_or_else(|| std::env::var("DB_USER").unwrap_or_else(|_| "uasspain".into()));
    let password = role_password
        .or_else(|| read_database_secret("DB_PASSWORD", "DB_PASSWORD_FILE"))
        .unwrap_or_default();
    let user = url_component(&user);
    let auth = if password.is_empty() {
        user
    } else {
        format!("{user}:{}", url_component(&password))
    };
    let sslmode = std::env::var("DB_SSLMODE").unwrap_or_else(|_| "require".into());
    Ok(format!(
        "postgresql://{auth}@{host}:{port}/{}?sslmode={sslmode}",
        url_component(&name)
    ))
}

fn read_database_secret(value_name: &str, file_name: &str) -> Option<String> {
    std::env::var(value_name)
        .ok()
        .filter(|value| !value.is_empty())
        .or_else(|| {
            std::env::var(file_name)
                .ok()
                .and_then(|path| std::fs::read_to_string(path).ok())
                .map(|value| value.trim().to_owned())
        })
}
fn url_component(value: &str) -> String {
    let mut output = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            output.push(char::from(byte));
        } else {
            use std::fmt::Write as _;
            let _ = write!(output, "%{byte:02X}");
        }
    }
    output
}
fn sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut value = String::from("sha256:");
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(value, "{byte:02x}");
    }
    value
}

fn checksum_matches(bytes: &[u8], expected: &str) -> bool {
    sha256(bytes) == expected
}
fn env_bool(name: &str, default: bool) -> bool {
    std::env::var(name)
        .ok()
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(default)
}
fn pool(state: &AppState) -> Result<&PgPool, AppError> {
    state.pool.as_ref().ok_or(AppError::Unavailable)
}
fn admin(state: &AppState, headers: &HeaderMap) -> Result<Claims, AppError> {
    let claims = authenticate(state, headers, "access")?;
    require_role(&claims, &["admin"])?;
    Ok(claims)
}

async fn audit_event_connection(
    connection: &mut sqlx::pool::PoolConnection<sqlx::Postgres>,
    profile_id: Uuid,
    action: &str,
    instance_id: Uuid,
    extra: Value,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO core_auditlog \
         (id,created_date,updated_date,model_name,instance_id,action,extra,profile_id) \
         VALUES ($1,NOW(),NOW(),'BackupJob',$2,$3,$4,$5)",
    )
    .bind(Uuid::new_v4())
    .bind(instance_id.to_string())
    .bind(action)
    .bind(extra)
    .bind(profile_id)
    .execute(&mut **connection)
    .await?;
    Ok(())
}

async fn audit_event(
    pool: &PgPool,
    profile_id: Uuid,
    action: &str,
    instance_id: Uuid,
    extra: Value,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO core_auditlog \
         (id,created_date,updated_date,model_name,instance_id,action,extra,profile_id) \
         VALUES ($1,NOW(),NOW(),'BackupJob',$2,$3,$4,$5)",
    )
    .bind(Uuid::new_v4())
    .bind(instance_id.to_string())
    .bind(action)
    .bind(extra)
    .bind(profile_id)
    .execute(pool)
    .await?;
    Ok(())
}
fn validate_config(value: &Value) -> Result<(), AppError> {
    let frequency = value
        .get("frequency")
        .and_then(Value::as_str)
        .unwrap_or("daily");
    if !matches!(
        frequency,
        "manual" | "daily" | "every_n_days" | "weekly" | "monthly" | "custom"
    ) {
        return Err(AppError::Validation("Frecuencia no válida.".into()));
    }
    let hour = value.get("hour").and_then(Value::as_str).unwrap_or("03:00");
    if parse_time(hour).is_none() {
        return Err(AppError::Validation("Hora no válida.".into()));
    }
    if frequency == "weekly"
        && !value
            .get("day")
            .and_then(Value::as_str)
            .and_then(|day| day.parse::<u32>().ok())
            .is_some_and(|day| day <= 6)
    {
        return Err(AppError::Validation("Día semanal no válido.".into()));
    }
    if frequency == "monthly"
        && !value
            .get("day")
            .and_then(Value::as_str)
            .and_then(|day| day.parse::<u32>().ok())
            .is_some_and(|day| (1..=31).contains(&day))
    {
        return Err(AppError::Validation("Día mensual no válido.".into()));
    }
    if frequency == "every_n_days"
        && !value
            .get("interval_days")
            .and_then(Value::as_u64)
            .is_some_and(|days| (1..=3650).contains(&days))
    {
        return Err(AppError::Validation("Intervalo de días no válido.".into()));
    }
    if let Some(kind) = value.get("job_type").and_then(Value::as_str)
        && !matches!(kind, "full" | "incremental")
    {
        return Err(AppError::Validation("Tipo programado no válido.".into()));
    }
    for key in ["retention_full", "retention_incremental"] {
        if let Some(value) = value.get(key)
            && !value
                .as_i64()
                .is_some_and(|number| (1..=3650).contains(&number))
        {
            return Err(AppError::Validation(format!("{key} fuera de rango.")));
        }
    }
    Ok(())
}
fn validate_server(input: &ServerWrite, create: bool) -> Result<(), AppError> {
    if input
        .role
        .as_deref()
        .is_some_and(|role| !matches!(role, "local" | "external_1" | "external_2"))
    {
        return Err(AppError::Validation("Destino de backup no valido.".into()));
    }
    if create && input.role.is_none() {
        return Err(AppError::Validation(
            "El slot del destino es obligatorio.".into(),
        ));
    }

    if create
        && (input.name.as_deref().unwrap_or("").is_empty()
            || input
                .ip_address
                .as_deref()
                .unwrap_or("")
                .parse::<std::net::IpAddr>()
                .is_err())
    {
        return Err(AppError::Validation(
            "Nombre e IP válidos son obligatorios.".into(),
        ));
    }
    if let Some(name) = &input.name
        && (name.is_empty()
            || name.len() > 100
            || !name
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || " ._-".contains(character)))
    {
        return Err(AppError::Validation("Nombre no válido.".into()));
    }
    if let Some(ip) = &input.ip_address {
        ip.parse::<std::net::IpAddr>()
            .map_err(|_| AppError::Validation("IP no válida.".into()))?;
    }
    if let Some(protocol) = input.transfer_protocol.as_deref()
        && !matches!(protocol, "copy" | "smb" | "sftp")
    {
        return Err(AppError::Validation(
            "Protocolo de transferencia no válido.".into(),
        ));
    }
    if input
        .sftp_host
        .as_deref()
        .is_some_and(|host| !valid_sftp_identity(host, "probe"))
        || input
            .sftp_user
            .as_deref()
            .is_some_and(|user| !valid_sftp_identity("localhost", user))
        || input
            .sftp_remote_path
            .as_deref()
            .is_some_and(|path| !safe_remote_path(path))
    {
        return Err(AppError::Validation(
            "Identidad o ruta SFTP no válida.".into(),
        ));
    }
    if input.transfer_protocol.as_deref() == Some("sftp")
        && input.is_active.unwrap_or(true)
        && (!valid_sftp_identity(
            input.sftp_host.as_deref().unwrap_or_default(),
            input.sftp_user.as_deref().unwrap_or_default(),
        ) || !safe_remote_path(input.sftp_remote_path.as_deref().unwrap_or_default()))
    {
        return Err(AppError::Validation("Configuración SFTP no válida.".into()));
    }
    for port in [input.sftp_port, input.vpn_port].into_iter().flatten() {
        if !(1..=65535).contains(&port) {
            return Err(AppError::Validation("Puerto fuera de rango.".into()));
        }
    }
    for path in [
        &input.sftp_remote_path,
        &input.sftp_key_path,
        &input.sftp_known_hosts,
    ] {
        if path.as_deref().is_some_and(|value| {
            value.contains("..") || value.contains(['\n', '\r', '"', ';', '|', '&', '`'])
        }) {
            return Err(AppError::Validation("Ruta no válida.".into()));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn destination_catalog_reads_old_and_new_manifests_without_crossing_servers() {
        let id = uuid::Uuid::new_v4().to_string();
        let old = serde_json::json!({id.clone(): {"status":"success"}});
        let new = serde_json::json!({"external_1":{"server_id":id,"status":"success"}});
        assert!(super::destination_for_origin(&old, &id).is_some());
        assert!(super::destination_for_origin(&new, &id).is_some());
        assert!(super::destination_for_origin(&new, &uuid::Uuid::new_v4().to_string()).is_none());
    }
    use super::{
        ServerWrite, checksum_matches, parse_time, replace_media_contents, safe_backup_filename,
        sha256, validate_config, validate_server,
    };
    use serde_json::json;
    use std::io::{Cursor, Write};

    #[test]
    fn checksum_contract() {
        assert_eq!(
            sha256(b"abc"),
            "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn corrupted_backup_payload_is_rejected() {
        let expected = sha256(b"backup payload intacto");
        assert!(checksum_matches(b"backup payload intacto", &expected));
        assert!(!checksum_matches(b"backup payload alterado", &expected));
    }

    #[test]
    fn rejects_unsafe_values() {
        assert!(validate_config(&json!({"retention_full":0})).is_err());
        assert!(validate_config(&json!({"frequency":"weekly","day":"9"})).is_err());
        assert!(validate_config(&json!({"frequency":"monthly","day":"0"})).is_err());
        assert!(validate_config(&json!({"frequency":"every_n_days","interval_days":0})).is_err());
        assert!(validate_config(&json!({"frequency":"hourly"})).is_err());
        assert!(validate_config(&json!({"job_type":"differential"})).is_err());
        assert!(
            validate_config(&json!({"frequency":"monthly","day":"31","job_type":"full"})).is_ok()
        );
        assert!(validate_config(&json!({"hour":"24:00"})).is_err());
        assert_eq!(parse_time("03:15"), Some((3, 15)));
        let server = ServerWrite {
            name: Some("bad;name".into()),
            role: None,
            ip_address: Some("127.0.0.1".into()),
            vpn_ip: None,
            vpn_port: None,
            smb_share: None,
            transfer_protocol: None,
            sftp_host: None,
            sftp_port: None,
            sftp_user: None,
            sftp_remote_path: None,
            sftp_key_path: None,
            sftp_known_hosts: None,
            is_offsite: None,
            is_active: None,
        };
        assert!(validate_server(&server, true).is_err());
    }

    #[test]
    fn remote_restore_filename_is_deny_by_default() {
        assert!(safe_backup_filename(
            "uasspain_full_20260928_120000.sql.gz.enc"
        ));
        assert!(!safe_backup_filename("../../secrets.enc"));
        assert!(!safe_backup_filename("uasspain_full_20260928;touch.enc"));
        assert!(!safe_backup_filename("other_backup.sql.gz.enc"));
    }

    #[test]
    fn media_restore_rejects_path_traversal() {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file("../escape.txt", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"forbidden").unwrap();
        let bytes = zip.finish().unwrap().into_inner();
        let root =
            std::env::temp_dir().join(format!("uasspain-media-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        assert!(replace_media_contents(&root, &bytes, 1024).is_err());
        assert!(!root.parent().unwrap().join("escape.txt").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn media_restore_extracts_valid_archive() {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file(
            "courses/resource.txt",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        zip.write_all(b"validated").unwrap();
        let bytes = zip.finish().unwrap().into_inner();
        let root =
            std::env::temp_dir().join(format!("uasspain-media-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        assert_eq!(replace_media_contents(&root, &bytes, 1024).unwrap(), 1);
        assert_eq!(
            std::fs::read(root.join("courses/resource.txt")).unwrap(),
            b"validated"
        );
        let _ = std::fs::remove_dir_all(root);
    }
}
