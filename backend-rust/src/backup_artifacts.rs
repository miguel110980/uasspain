//! Read the selected, registered replica, including historical disabled slots.
//! Paths and credentials remain server-side. Ancestors may use any registered
//! surviving replica; the selected recovery point never silently changes origin.
use super::*;

pub struct Staging(PathBuf);

pub struct TemporaryFile(PathBuf);
impl TemporaryFile {
    pub async fn create(path: &Path) -> Result<Self, String> {
        let mut options = fs::OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        options.mode(0o600);
        options
            .open(path)
            .await
            .map_err(|_| "No se pudo preparar el archivo temporal privado.")?;
        Ok(Self(path.to_path_buf()))
    }
}
impl Drop for TemporaryFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}
impl Staging {
    pub async fn create() -> Result<Self, AppError> {
        let path = backup_root()
            .await
            .map_err(|_| AppError::Internal)?
            .join(format!(".staging_{}", Uuid::new_v4()));
        fs::create_dir(&path)
            .await
            .map_err(|_| AppError::Internal)?;
        Ok(Self(path))
    }
    pub fn path(&self) -> &Path {
        &self.0
    }
    pub async fn clean(&self) -> Result<(), AppError> {
        fs::remove_dir_all(&self.0)
            .await
            .map_err(|_| AppError::Internal)
    }
}
impl Drop for Staging {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub async fn read(
    state: &AppState,
    job: &BackupJob,
    field: &str,
    origin: Option<&str>,
) -> Result<Vec<u8>, String> {
    let (raw, checksum, size) = match field {
        "manifest" => (&job.manifest_path, &job.manifest_checksum, None),
        "media" => (
            &job.media_path,
            &job.media_checksum,
            Some(job.media_size_bytes),
        ),
        _ => (&job.storage_path, &job.checksum, Some(job.size_bytes)),
    };
    let name = Path::new(raw)
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or("Archivo de backup no encontrado.")?;
    if !safe_artifact_filename(name) {
        return Err("Identidad de archivo no válida.".into());
    }
    let validate = |bytes: Vec<u8>| -> Result<Vec<u8>, String> {
        if !checksum_matches(&bytes, checksum) {
            return Err("Checksum de archivo de backup no válido.".into());
        }
        if size.is_some_and(|size| i64::try_from(bytes.len()).ok() != Some(size)) {
            return Err("Tamaño de archivo de backup no válido.".into());
        }
        Ok(bytes)
    };
    // Existing recovery artifacts are preserved. Explicit local selection may
    // only use a recorded local replica or legacy recovery storage.
    let mut last_error = "Archivo de backup no encontrado.".to_owned();
    if (origin.is_none() || origin == Some("local"))
        && let Some(path) = safe_job_path(raw).await
        && let Ok(bytes) = fs::read(path).await
    {
        match validate(bytes) {
            Ok(bytes) => return Ok(bytes),
            Err(error) if origin.is_some() => return Err(error),
            Err(error) => last_error = error,
        }
    }
    let servers = fetch_servers(pool(state).map_err(|_| "Base de datos no disponible.")?)
        .await
        .map_err(|_| "Destino no disponible.")?;
    for (role, destination) in job.destinations.as_object().into_iter().flatten() {
        if destination.get("status").and_then(Value::as_str) != Some("success") {
            continue;
        }
        let Some(server) = servers.iter().find(|s| {
            destination
                .get("server_id")
                .and_then(Value::as_str)
                .unwrap_or(role)
                == s.id.to_string()
        }) else {
            continue;
        };
        if origin.is_some_and(|selected| {
            if selected == "local" {
                server.role != "local"
            } else {
                selected != server.id.to_string()
            }
        }) {
            continue;
        }
        let stored_path = destination
            .get("path")
            .and_then(Value::as_str)
            .unwrap_or("");
        // Configuration changes must not redirect an old replica silently.
        let expected_database = if server.transfer_protocol == "sftp" {
            sftp_url(server, Path::new(&job.storage_path))?
        } else {
            Path::new(&server.smb_share)
                .join(
                    Path::new(&job.storage_path)
                        .file_name()
                        .ok_or("Archivo no encontrado.")?,
                )
                .to_string_lossy()
                .into_owned()
        };
        if stored_path != expected_database {
            last_error = "La configuración del destino histórico ha cambiado.".into();
            continue;
        }
        let result = download_remote_backup(server, name, checksum).await;
        match result {
            Ok(path) => {
                let bytes = fs::read(&path)
                    .await
                    .map_err(|_| "Archivo de backup no accesible.");
                fs::remove_file(&path)
                    .await
                    .map_err(|_| "No se pudo limpiar la descarga temporal.")?;
                match validate(bytes?) {
                    Ok(bytes) => return Ok(bytes),
                    Err(error) if origin.is_some() => return Err(error),
                    Err(error) => last_error = error,
                }
            }
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}
