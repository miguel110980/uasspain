use std::{
    io::Cursor,
    path::{Path, PathBuf},
    sync::Arc,
};

use axum::{
    Json,
    body::Body,
    extract::{Multipart, Path as AxumPath, State},
    http::{HeaderMap, StatusCode, header},
    response::Response,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::fs;
use uuid::Uuid;

use crate::{
    AppState,
    auth::{authenticate, require_role},
    error::AppError,
};

const GENERAL_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif", "pdf", "doc", "docx"];
const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif"];

pub async fn general(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    multipart: Multipart,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin", "instructor"])?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let uploaded = store(multipart, false).await?;
    let path = uploaded.1.0["path"].as_str().ok_or(AppError::Internal)?;
    if let Err(error) =
        sqlx::query("INSERT INTO upload_ownership(storage_path,owner_id) VALUES($1,$2)")
            .bind(path)
            .bind(claims.profile_id)
            .execute(pool)
            .await
    {
        // This path was minted by this request; no existing file is selected.
        let _ = fs::remove_file(media_root().await?.join(path)).await;
        return Err(error.into());
    }
    Ok(uploaded)
}

pub async fn avatar(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    multipart: Multipart,
) -> Result<(StatusCode, Json<Value>), AppError> {
    authenticate(&state, &headers, "access")?;
    store(multipart, true).await
}

pub async fn registration_avatar(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    multipart: Multipart,
) -> Result<(StatusCode, Json<Value>), AppError> {
    crate::auth::enforce_login_rate(&headers, "registration-avatar")?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(850529124)")
        .execute(&mut *tx)
        .await?;
    let root = media_root().await?;
    fs::create_dir_all(root.join("avatars"))
        .await
        .map_err(|_| AppError::Internal)?;
    let directory = fs::canonicalize(root.join("avatars"))
        .await
        .map_err(|_| AppError::Internal)?;
    if !directory.starts_with(&root) {
        return Err(AppError::Forbidden);
    }
    let expired:Vec<String>=sqlx::query_scalar("SELECT storage_path FROM registration_avatar_upload WHERE owner_id IS NULL AND expires_at<NOW() ORDER BY expires_at LIMIT 32 FOR UPDATE SKIP LOCKED")
        .fetch_all(&mut *tx).await?;
    for path in expired {
        if !valid_registration_avatar_path(&path) {
            continue;
        }
        match fs::remove_file(root.join(&path)).await {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => continue,
        }
        sqlx::query(
            "DELETE FROM registration_avatar_upload WHERE storage_path=$1 AND owner_id IS NULL",
        )
        .bind(path)
        .execute(&mut *tx)
        .await?;
    }
    let requester = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .unwrap_or("local")
        .trim();
    let lookup = state
        .cipher
        .blind_index(&format!("registration-avatar-ip:{requester}"))?;
    let (count,bytes):(i64,i64)=sqlx::query_as("SELECT count(*),COALESCE(sum(byte_size),0)::bigint FROM registration_avatar_upload WHERE requester_lookup=$1 AND created_at>NOW()-INTERVAL '24 hours'")
        .bind(&lookup).fetch_one(&mut *tx).await?;
    if count >= 20 || bytes + max_upload_bytes(true) as i64 > 20 * 1024 * 1024 {
        return Err(AppError::RateLimited);
    }
    let total: i64 = sqlx::query_scalar(
        "SELECT COALESCE(sum(byte_size),0)::bigint FROM registration_avatar_upload",
    )
    .fetch_one(&mut *tx)
    .await?;
    if total + max_upload_bytes(true) as i64 > 512 * 1024 * 1024 {
        return Err(invalid(
            "Cuota de fotos alcanzada. Puede registrarse sin fotografía.",
        ));
    }
    let mut uploaded = store(multipart, true).await?;
    let path = uploaded.1.0["path"]
        .as_str()
        .ok_or(AppError::Internal)?
        .to_owned();
    let ticket = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let ticket_lookup = state
        .cipher
        .blind_index(&format!("registration-avatar-ticket:{ticket}"))?;
    let size = uploaded.1.0["size"].as_i64().ok_or(AppError::Internal)?;
    let inserted=sqlx::query("INSERT INTO registration_avatar_upload(ticket_lookup,storage_path,requester_lookup,byte_size) VALUES($1,$2,$3,$4)")
        .bind(ticket_lookup).bind(&path).bind(lookup).bind(size).execute(&mut *tx).await;
    if let Err(error) = inserted {
        let _ = fs::remove_file(root.join(&path)).await;
        return Err(error.into());
    }
    if tx.commit().await.is_err() {
        let _ = fs::remove_file(root.join(&path)).await;
        return Err(AppError::Internal);
    }
    uploaded.1.0["avatar_upload_token"] = json!(ticket);
    Ok(uploaded)
}

fn valid_registration_avatar_path(path: &str) -> bool {
    path.strip_prefix("avatars/avatar_")
        .and_then(|name| name.split_once('.'))
        .is_some_and(|(id, ext)| Uuid::parse_str(id).is_ok() && IMAGE_EXTENSIONS.contains(&ext))
}

pub(crate) async fn claim_registration_avatar(
    state: &AppState,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    owner: Uuid,
    photo: &str,
    ticket: &str,
) -> Result<(), AppError> {
    if photo.is_empty() {
        return Ok(());
    }
    let url = url::Url::parse(photo).map_err(|_| invalid("Vuelva a subir la fotografía."))?;
    let origin =
        url::Url::parse(&std::env::var("FRONTEND_URL").map_err(|_| AppError::Unavailable)?)
            .map_err(|_| AppError::Unavailable)?;
    let path = url
        .path()
        .strip_prefix("/media/")
        .ok_or_else(|| invalid("Fotografía no autorizada."))?;
    if url.origin() != origin.origin()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !valid_registration_avatar_path(path)
        || ticket.len() != 64
        || !ticket.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(invalid(
            "Fotografía no autorizada. Súbala de nuevo o continúe sin foto.",
        ));
    }
    let lookup = state
        .cipher
        .blind_index(&format!("registration-avatar-ticket:{ticket}"))?;
    let changed=sqlx::query("UPDATE registration_avatar_upload SET owner_id=$1,consumed_at=NOW() WHERE ticket_lookup=$2 AND storage_path=$3 AND owner_id IS NULL AND expires_at>NOW()")
        .bind(owner).bind(lookup).bind(path).execute(&mut **tx).await?.rows_affected();
    if changed != 1 {
        return Err(invalid(
            "La fotografía ha caducado o ya se utilizó. Súbala de nuevo o continúe sin foto.",
        ));
    }
    Ok(())
}

async fn store(
    mut multipart: Multipart,
    image_only: bool,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let maximum = max_upload_bytes(image_only);
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| invalid("Formulario multipart no válido."))?
    {
        if field.name() != Some("file") {
            continue;
        }
        let original_name = field.file_name().unwrap_or("upload").to_owned();
        let content_type = field
            .content_type()
            .unwrap_or("application/octet-stream")
            .to_owned();
        let extension =
            extension(&original_name).ok_or_else(|| invalid("Tipo de archivo no permitido."))?;
        validate_type(&extension, &content_type, image_only)?;
        let data = field
            .bytes()
            .await
            .map_err(|_| invalid("No se pudo leer el archivo."))?;
        if data.is_empty() {
            return Err(invalid("Archivo vacío o ilegible."));
        }
        if data.len() > maximum {
            return Err(invalid("El archivo supera el tamaño máximo permitido."));
        }
        validate_magic(&extension, &data)?;
        if IMAGE_EXTENSIONS.contains(&extension.as_str()) {
            validate_decodable_image(&extension, &data).await?;
        }

        let root = media_root().await?;
        let directory = if image_only { "avatars" } else { "uploads" };
        let upload_dir = root.join(directory);
        fs::create_dir_all(&upload_dir)
            .await
            .map_err(|_| AppError::Internal)?;
        let prefix = if image_only { "avatar_" } else { "" };
        let stored_name = format!("{prefix}{}.{}", Uuid::new_v4().simple(), extension);
        let final_path = upload_dir.join(&stored_name);
        let temporary = upload_dir.join(format!(".{stored_name}.tmp"));
        fs::write(&temporary, &data)
            .await
            .map_err(|_| AppError::Internal)?;
        fs::rename(&temporary, &final_path)
            .await
            .map_err(|_| AppError::Internal)?;
        let relative_path = format!("{directory}/{stored_name}");
        let file_url = if image_only {
            format!("/media/{relative_path}")
        } else {
            format!("/api/media/{relative_path}")
        };
        let mut response = json!({
            "file_url": file_url,
            "path": relative_path,
            "absolute_url": absolute_url(&file_url),
            "size":data.len(),
        });
        if !image_only {
            response["original_name"] = json!(original_name);
            response["content_type"] = json!(content_type);
            response["size"] = json!(data.len());
            response["sha256"] = json!(hex_digest(&data));
        }
        return Ok((StatusCode::CREATED, Json(response)));
    }
    Err(invalid("No se envió ningún archivo."))
}

pub async fn download(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    AxumPath(path): AxumPath<String>,
) -> Result<Response, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    if !valid_private_path(&path) {
        return Err(AppError::NotFound);
    }
    require_role(&claims, &["admin", "instructor", "alumno"])?;
    if claims.role != "admin" {
        let statement = format!(
            "SELECT EXISTS(SELECT 1 FROM upload_ownership u WHERE u.storage_path=$1 AND u.owner_id=$2 AND $3::text IN ('admin','instructor')) OR EXISTS(SELECT 1 FROM materiales_material m WHERE (m.archivo_path=$1 OR (m.archivo_path='' AND regexp_replace(split_part(m.archivo_url,'?',1),'^https?://[^/]+','','i') IN ('/api/media/' || $1,'/media/' || $1))) AND {} AND {}) OR ($3::text<>'alumno' AND EXISTS(SELECT 1 FROM examenes_archivoexamen a WHERE (a.archivo_path=$1 OR (a.archivo_path='' AND regexp_replace(split_part(a.archivo_url,'?',1),'^https?://[^/]+','','i') IN ('/api/media/' || $1,'/media/' || $1))) AND {}))",
            crate::academic_scope::resource_scope("m", "subido_por_id", 3, 2),
            crate::academic_scope::material_access("m", 3, 2),
            crate::academic_scope::resource_scope("a", "subido_por_id", 3, 2)
        );
        let allowed: bool = sqlx::query_scalar(&statement)
            .bind(&path)
            .bind(claims.profile_id)
            .bind(&claims.role)
            .fetch_one(state.pool.as_ref().ok_or(AppError::Unavailable)?)
            .await?;
        if !allowed {
            return Err(AppError::NotFound);
        }
    }
    let root = media_root().await?;
    let canonical = fs::canonicalize(root.join(&path))
        .await
        .map_err(|_| AppError::NotFound)?;
    if !canonical.starts_with(&root) {
        return Err(AppError::NotFound);
    }
    let metadata = fs::symlink_metadata(&canonical)
        .await
        .map_err(|_| AppError::NotFound)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(AppError::NotFound);
    }
    let data = fs::read(&canonical).await.map_err(|_| AppError::NotFound)?;
    let mime = match canonical.extension().and_then(|value| value.to_str()) {
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("pdf") => "application/pdf",
        Some("doc") => "application/msword",
        Some("docx") => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        _ => "application/octet-stream",
    };
    let filename = canonical
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("download");
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{filename}\""),
        )
        .header(header::CACHE_CONTROL, "private, no-store")
        .header("x-content-type-options", "nosniff")
        .body(Body::from(data))
        .map_err(|_| AppError::Internal)
}

pub(crate) fn valid_private_path(path: &str) -> bool {
    path.starts_with("uploads/")
        && path.len() <= 160
        && !path.split('/').any(|part| {
            part.is_empty()
                || part == "."
                || part == ".."
                || !part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        })
}

pub(crate) async fn store_image_bytes(
    original_name: &str,
    content_type: &str,
    data: &[u8],
    directory: &str,
    prefix: &str,
) -> Result<(String, String), AppError> {
    let extension =
        extension(original_name).ok_or_else(|| invalid("Tipo de imagen no permitido."))?;
    validate_type(&extension, content_type, true)?;
    if data.is_empty() || data.len() > max_upload_bytes(true) {
        return Err(invalid(
            "La imagen está vacía o supera el tamaño máximo permitido.",
        ));
    }
    validate_magic(&extension, data)?;
    validate_decodable_image(&extension, data).await?;
    if !directory
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(invalid("Directorio de almacenamiento no válido."));
    }
    let root = media_root().await?;
    let upload_dir = root.join(directory);
    fs::create_dir_all(&upload_dir)
        .await
        .map_err(|_| AppError::Internal)?;
    let stored_name = format!("{prefix}{}.{}", Uuid::new_v4().simple(), extension);
    let final_path = upload_dir.join(&stored_name);
    let temporary = upload_dir.join(format!(".{stored_name}.tmp"));
    fs::write(&temporary, data)
        .await
        .map_err(|_| AppError::Internal)?;
    fs::rename(&temporary, &final_path)
        .await
        .map_err(|_| AppError::Internal)?;
    let storage_path = format!("{directory}/{stored_name}");
    Ok((storage_path.clone(), format!("/media/{storage_path}")))
}

pub(crate) async fn remove_managed_media(storage_path: &str) -> Result<(), AppError> {
    if storage_path.is_empty()
        || Path::new(storage_path).is_absolute()
        || storage_path
            .split('/')
            .any(|part| part == ".." || part.is_empty())
    {
        return Err(invalid("Ruta de imagen no válida."));
    }
    let root = media_root().await?;
    let candidate = root.join(storage_path);
    if let Ok(metadata) = fs::symlink_metadata(&candidate).await {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(invalid("Recurso de imagen no válido."));
        }
        fs::remove_file(candidate)
            .await
            .map_err(|_| AppError::Internal)?;
    }
    Ok(())
}

async fn media_root() -> Result<PathBuf, AppError> {
    let root = PathBuf::from(std::env::var("MEDIA_ROOT").unwrap_or_else(|_| "./media".into()));
    fs::create_dir_all(&root)
        .await
        .map_err(|_| AppError::Internal)?;
    fs::canonicalize(root).await.map_err(|_| AppError::Internal)
}

fn extension(name: &str) -> Option<String> {
    Path::new(name)
        .extension()?
        .to_str()
        .map(str::to_ascii_lowercase)
}

fn validate_type(extension: &str, content_type: &str, image_only: bool) -> Result<(), AppError> {
    let allowed = if image_only {
        IMAGE_EXTENSIONS
    } else {
        GENERAL_EXTENSIONS
    };
    if !allowed.contains(&extension) {
        return Err(invalid(if image_only {
            "Solo se permiten imágenes JPG, PNG, WEBP o GIF."
        } else {
            "Tipo de archivo no permitido."
        }));
    }
    let valid_mime = match extension {
        "jpg" | "jpeg" => content_type == "image/jpeg",
        "png" => content_type == "image/png",
        "webp" => content_type == "image/webp",
        "gif" => content_type == "image/gif",
        "pdf" => content_type == "application/pdf",
        "doc" => content_type == "application/msword",
        "docx" => {
            content_type
                == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        }
        _ => false,
    };
    if content_type != "application/octet-stream" && !valid_mime {
        return Err(invalid("Tipo MIME no permitido."));
    }
    Ok(())
}

fn validate_magic(extension: &str, data: &[u8]) -> Result<(), AppError> {
    let matches = match extension {
        "jpg" | "jpeg" => data.starts_with(&[0xff, 0xd8, 0xff]),
        "png" => data.starts_with(b"\x89PNG\r\n\x1a\n"),
        "gif" => data.starts_with(b"GIF8"),
        "webp" => data.starts_with(b"RIFF") && data.get(8..12) == Some(b"WEBP"),
        "pdf" => data.starts_with(b"%PDF"),
        "doc" => data.starts_with(&[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
        "docx" => data.starts_with(b"PK\x03\x04"),
        _ => false,
    };
    matches
        .then_some(())
        .ok_or_else(|| invalid("El contenido del archivo no coincide con su extensión."))
}

async fn validate_decodable_image(extension: &str, data: &[u8]) -> Result<(), AppError> {
    let format = match extension {
        "jpg" | "jpeg" => image::ImageFormat::Jpeg,
        "png" => image::ImageFormat::Png,
        "webp" => image::ImageFormat::WebP,
        "gif" => image::ImageFormat::Gif,
        _ => return Err(invalid("Tipo de imagen no permitido.")),
    };
    let owned = data.to_vec();
    let decoded = tokio::task::spawn_blocking(move || {
        image::ImageReader::with_format(Cursor::new(owned), format).decode()
    })
    .await
    .map_err(|_| AppError::Internal)?;
    decoded
        .map(|_| ())
        .map_err(|_| invalid("La imagen está corrupta o no se puede decodificar."))
}

fn max_upload_bytes(image_only: bool) -> usize {
    let fallback = if image_only {
        5 * 1024 * 1024
    } else {
        20 * 1024 * 1024
    };
    std::env::var("MAX_UPLOAD_BYTES")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(fallback)
}

fn absolute_url(file_url: &str) -> String {
    let base = std::env::var("FRONTEND_URL").unwrap_or_else(|_| "http://localhost:5173".to_owned());
    format!("{}{file_url}", base.trim_end_matches('/'))
}

fn hex_digest(data: &[u8]) -> String {
    let mut result = String::with_capacity(64);
    for byte in Sha256::digest(data) {
        use std::fmt::Write as _;
        let _ = write!(result, "{byte:02x}");
    }
    result
}
fn invalid(message: &str) -> AppError {
    AppError::Validation(message.to_owned())
}

#[cfg(test)]
mod tests {
    #[test]
    fn avatar_cleanup_only_selects_paths_minted_for_registration() {
        let id = uuid::Uuid::new_v4();
        assert!(super::valid_registration_avatar_path(&format!(
            "avatars/avatar_{id}.png"
        )));
        for path in [
            "avatars/legacy.png",
            "uploads/avatar_0000.png",
            "avatars/avatar_../secret.png",
            "avatars/avatar_not-a-uuid.png",
            "avatars/avatar_00000000-0000-0000-0000-000000000000.png/other",
            "avatars/avatar_00000000-0000-0000-0000-000000000000.exe",
        ] {
            assert!(
                !super::valid_registration_avatar_path(path),
                "cleanup accepted {path}"
            );
        }
    }
    use super::{
        extension, valid_private_path, validate_decodable_image, validate_magic, validate_type,
    };
    #[test]
    fn validates_extension_mime_and_magic_together() {
        assert_eq!(extension("document.PDF").as_deref(), Some("pdf"));
        assert!(validate_type("pdf", "application/pdf", false).is_ok());
        assert!(validate_magic("pdf", b"%PDF-1.7").is_ok());
        assert!(validate_magic("pdf", b"<script>").is_err());
    }

    #[test]
    fn private_download_paths_cannot_escape_media_root() {
        assert!(valid_private_path("uploads/a1b2.pdf"));
        assert!(!valid_private_path("avatars/a1b2.png"));
        assert!(!valid_private_path("uploads/../secret_key"));
        assert!(!valid_private_path("uploads/file%2f..%2fsecret"));
    }

    #[tokio::test]
    async fn rejects_truncated_images_after_magic_check() {
        let truncated = b"\x89PNG\r\n\x1a\ncorrupta";
        assert!(validate_magic("png", truncated).is_ok());
        assert!(validate_decodable_image("png", truncated).await.is_err());
    }
}
