use std::{
    collections::BTreeMap,
    io::{Cursor, Read},
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
};

use axum::{Json, extract::State, http::HeaderMap};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::fs;
use tokio::{io::AsyncReadExt, sync::Semaphore};
use uuid::Uuid;
use zip::ZipArchive;

use crate::{
    AppState,
    auth::{authenticate, require_role},
    error::AppError,
};

const MAX_DOCX_XML_BYTES: usize = 8 * 1024 * 1024;
const MAX_IMPORT_BYTES: usize = 20 * 1024 * 1024;
const MAX_TEXT_BYTES: usize = 2 * 1024 * 1024;
const MAX_LINES: usize = 20_000;
static IMPORT_SLOTS: OnceLock<Arc<Semaphore>> = OnceLock::new();
mod questions;
mod rich_text;

#[derive(Debug, Deserialize)]
pub struct ImportRequest {
    file_url: String,
    categoria: Option<String>,
    metadata: Option<Value>,
    #[serde(default)]
    confirm: bool,
    #[serde(default)]
    preview_token: String,
}
#[derive(Debug, Clone, Deserialize, serde::Serialize)]
struct Line {
    text: String,
    bold: bool,
    #[serde(default)]
    color: Option<String>,
}
#[derive(Debug)]
struct Question {
    number: usize,
    statement: String,
    options: BTreeMap<char, String>,
    answer: char,
}

pub async fn import(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<ImportRequest>,
) -> Result<Json<Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin", "instructor"])?;
    let path = resolve_media(&input.file_url).await?;
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let relative = relative_media_path(&path).await.ok_or(AppError::NotFound)?;
    crate::materials::ensure_file_scope(pool, &claims, &relative, &input.file_url).await?;
    // Bound parsing work before reading or expanding an untrusted document.
    // The parser retains its permit even when the HTTP request is cancelled.
    let _permit = Arc::new(
        IMPORT_SLOTS
            .get_or_init(|| Arc::new(Semaphore::new(2)))
            .clone()
            .try_acquire_owned()
            .map_err(|_| AppError::Unavailable)?,
    );
    let name = path
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or_else(|| invalid("Nombre de archivo no válido."))?
        .to_owned();
    let mut data = Vec::new();
    fs::File::open(&path)
        .await
        .map_err(|_| AppError::NotFound)?
        .take((MAX_IMPORT_BYTES + 1) as u64)
        .read_to_end(&mut data)
        .await
        .map_err(|_| invalid("No se pudo leer el documento."))?;
    validate_input_size(data.len())?;
    let size = i64::try_from(data.len()).map_err(|_| AppError::Internal)?;
    let checksum = hex(&Sha256::digest(&data));
    let extension = path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let parsing_permit = Arc::clone(&_permit);
    let lines = tokio::task::spawn_blocking(move || {
        let _permit = parsing_permit;
        extract_lines(&data, &extension)
    })
    .await
    .map_err(|_| AppError::Internal)??;
    let (mut questions, mut errors) = parse_questions(&lines);
    let mut seen = std::collections::HashSet::new();
    questions.retain(|question| {
        let key = question
            .statement
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();
        if seen.insert(key) {
            true
        } else {
            errors.push(json!({"motivo":"Pregunta duplicada en el documento."}));
            false
        }
    });
    let detected = questions.len() + errors.len();
    if input.confirm && !errors.is_empty() {
        return Err(invalid(
            "La importación contiene preguntas con errores o respuestas ambiguas. Corrija el documento y vuelva a previsualizarlo; no se ha guardado ningún examen.",
        ));
    }
    let categoria = input.categoria.unwrap_or_else(|| "A1/A3".into());
    if !matches!(
        categoria.as_str(),
        "A1/A3" | "A2" | "STS" | "STS-01" | "STS-02"
    ) {
        return Err(invalid("Categoría no válida."));
    }
    if questions.is_empty() {
        return Ok(Json(
            json!({"total_detectadas":detected,"total_validas":0,"total_errores":errors.len(),"examenes_creados":[],"errores":errors,"error":"No se encontraron preguntas válidas. Use preguntas numeradas con opciones A-D y la respuesta correcta en negrita."}),
        ));
    }
    let proof = state.cipher.blind_index(&format!(
        "exam-import-preview:{}:{checksum}:{categoria}",
        claims.profile_id
    ))?;
    if !input.confirm {
        let preview:Vec<Value>=questions.iter().map(|question|json!({"numero":question.number,"enunciado":question.statement,"opciones":question.options,"respuesta_correcta":question.answer})).collect();
        return Ok(Json(
            json!({"total_detectadas":detected,"total_validas":questions.len(),"total_errores":errors.len(),"preguntas":preview,"errores":errors,"examenes_creados":[],"preview_token":proof}),
        ));
    }
    if input.preview_token.len() != proof.len()
        || !bool::from(subtle::ConstantTimeEq::ct_eq(
            input.preview_token.as_bytes(),
            proof.as_bytes(),
        ))
    {
        return Err(invalid(
            "La previsualización no corresponde a este archivo y categoría. Analice el documento de nuevo.",
        ));
    }
    let mut tx = pool.begin().await?;
    crate::account_lifecycle::lock(&mut tx).await?;
    crate::account_lifecycle::actor_active(&mut tx, &claims).await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(&checksum)
        .execute(&mut *tx)
        .await?;
    let duplicate: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM examenes_archivoexamen WHERE archivo_sha256=$1)",
    )
    .bind(&checksum)
    .fetch_one(&mut *tx)
    .await?;
    if duplicate {
        return Err(invalid("El contenido de este archivo ya se importó."));
    }
    let meta = input.metadata.unwrap_or_else(|| json!({}));
    let original_name = meta
        .get("original_name")
        .and_then(Value::as_str)
        .filter(|value| {
            !value.trim().is_empty() && value.len() <= 255 && !value.chars().any(char::is_control)
        })
        .unwrap_or(&name);
    let filename = original_name.rsplit(['/', '\\']).next().unwrap_or(&name);
    let base = Path::new(filename)
        .file_stem()
        .and_then(|v| v.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("Examen");
    let chunks: Vec<&[Question]> = questions
        .chunks(if categoria == "A2" { 30 } else { 40 })
        .collect();
    let mut created = Vec::new();
    let mut ids = Vec::new();
    for (index, chunk) in chunks.iter().enumerate() {
        let id = Uuid::new_v4();
        let title = if chunks.len() > 1 {
            format!("{base} — Examen {}", index + 1)
        } else {
            base.to_owned()
        };
        sqlx::query("INSERT INTO examenes_examen (id,created_date,updated_date,nombre,categoria,descripcion,activo,num_preguntas,creado_por_id,duration_seconds,passing_percent) VALUES ($1,NOW(),NOW(),$2,$3,$4,FALSE,$5,$6,$7,75)").bind(id).bind(title.chars().take(255).collect::<String>()).bind(&categoria).bind(format!("Importado desde {filename}")).bind(i32::try_from(chunk.len()).unwrap_or(i32::MAX)).bind(claims.profile_id).bind(if categoria=="A2" {1800} else {2400}).execute(&mut *tx).await?;
        for (order, q) in chunk.iter().enumerate() {
            sqlx::query("INSERT INTO examenes_pregunta (id,created_date,updated_date,examen_id,enunciado,opcion_a,opcion_b,opcion_c,opcion_d,respuesta_correcta,orden,imagen_url) VALUES ($1,NOW(),NOW(),$2,$3,$4,$5,$6,$7,$8,$9,'')").bind(Uuid::new_v4()).bind(id).bind(&q.statement).bind(q.options.get(&'a').cloned().unwrap_or_default()).bind(q.options.get(&'b').cloned().unwrap_or_default()).bind(q.options.get(&'c').cloned().unwrap_or_default()).bind(q.options.get(&'d').cloned().unwrap_or_default()).bind(q.answer.to_string()).bind(i32::try_from(order+1).unwrap_or(i32::MAX)).execute(&mut *tx).await?;
        }
        ids.push(id.to_string());
        created.push(json!({"id":id,"nombre":title,"num_preguntas":chunk.len()}));
    }
    sqlx::query("INSERT INTO examenes_archivoexamen (id,created_date,updated_date,examen_id,nombre_archivo,archivo_url,archivo_path,archivo_content_type,archivo_tamano,archivo_sha256,descripcion,categoria,num_examenes,subido_por_id) VALUES ($1,NOW(),NOW(),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)").bind(Uuid::new_v4()).bind(ids.join(",")).bind(meta.get("original_name").and_then(Value::as_str).unwrap_or(&name)).bind(&input.file_url).bind(&relative).bind(meta.get("content_type").and_then(Value::as_str).unwrap_or("")).bind(size).bind(&checksum).bind(format!("Importación automática — {} preguntas",questions.len())).bind(&categoria).bind(i32::try_from(created.len()).unwrap_or(i32::MAX)).bind(claims.profile_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"total_detectadas":detected,"total_validas":questions.len(),"total_errores":errors.len(),"examenes_creados":created,"errores":errors}),
    ))
}

fn extract_lines(data: &[u8], extension: &str) -> Result<Vec<Line>, AppError> {
    validate_input_size(data.len())?;
    let signature_matches = match extension {
        "pdf" => data.starts_with(b"%PDF-"),
        "docx" => data.starts_with(b"PK\x03\x04"),
        "doc" => data.starts_with(&[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
        _ => false,
    };
    if !signature_matches {
        return Err(invalid(
            "El contenido no corresponde al formato del documento.",
        ));
    }
    match extension {
        "docx" => docx_lines(data),
        "pdf" => pdf_lines(data),
        "doc" => legacy_doc_lines(data),
        _ => Err(invalid("Formato de archivo no soportado.")),
    }
}

#[cfg(not(target_os = "linux"))]
fn legacy_doc_lines(_data: &[u8]) -> Result<Vec<Line>, AppError> {
    Err(invalid(
        "La lectura aislada de DOC requiere el runtime Linux de la aplicación.",
    ))
}

#[cfg(target_os = "linux")]
fn legacy_doc_lines(data: &[u8]) -> Result<Vec<Line>, AppError> {
    use std::{
        io::Write,
        process::{Command, Stdio},
        thread,
        time::{Duration, Instant},
    };
    let mut child = Command::new("/usr/bin/prlimit")
        .args([
            "--as=268435456",
            "--cpu=10",
            "--fsize=0",
            "--nofile=16",
            "--nproc=1",
            "--",
            "/usr/local/bin/uasspain-document-converter",
        ])
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| invalid("No está disponible el lector aislado de DOC."))?;
    let mut input = child.stdin.take().ok_or(AppError::Internal)?;
    let output = child.stdout.take().ok_or(AppError::Internal)?;
    let owned = data.to_vec();
    let writer = thread::spawn(move || input.write_all(&owned));
    let reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        output
            .take(3 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let deadline = Instant::now() + Duration::from_secs(15);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    let written = writer.join().ok().and_then(Result::ok).is_some();
    let bytes = reader
        .join()
        .ok()
        .and_then(Result::ok)
        .ok_or_else(|| invalid("Salida DOC no válida."))?;
    if !written || !status.is_some_and(|status| status.success()) || bytes.len() > 3 * 1024 * 1024 {
        return Err(invalid(
            "DOC rechazado, demasiado complejo o fuera de los límites de conversión.",
        ));
    }
    let parsed: Vec<Line> =
        serde_json::from_slice(&bytes).map_err(|_| invalid("Salida DOC no válida."))?;
    let mut lines = Vec::new();
    let mut total = 0;
    for line in parsed {
        push_line(&mut lines, &mut total, line.text, line.bold)?;
        lines.last_mut().expect("line just appended").color = line.color;
    }
    Ok(lines)
}

fn validate_input_size(size: usize) -> Result<(), AppError> {
    if size == 0 || size > MAX_IMPORT_BYTES {
        return Err(invalid("Documento vacío o mayor de 20 MiB."));
    }
    Ok(())
}

fn push_line(
    lines: &mut Vec<Line>,
    bytes: &mut usize,
    text: String,
    bold: bool,
) -> Result<(), AppError> {
    *bytes = bytes
        .checked_add(text.len())
        .filter(|total| *total <= MAX_TEXT_BYTES)
        .ok_or_else(|| invalid("Texto del documento mayor de 2 MiB."))?;
    if lines.len() >= MAX_LINES {
        return Err(invalid("Demasiadas líneas en el documento."));
    }
    lines.push(Line {
        text,
        bold,
        color: None,
    });
    Ok(())
}

fn docx_lines(data: &[u8]) -> Result<Vec<Line>, AppError> {
    let mut zip = ZipArchive::new(Cursor::new(data)).map_err(|_| invalid("DOCX no válido."))?;
    if zip.len() > 4096 {
        return Err(invalid("DOCX con demasiadas entradas."));
    }
    let mut expanded = 0_u64;
    for index in 0..zip.len() {
        let entry = zip
            .by_index(index)
            .map_err(|_| invalid("DOCX no válido."))?;
        let name = entry
            .name()
            .map_err(|_| invalid("Nombre ZIP no válido."))?
            .replace('\\', "/")
            .to_lowercase();
        expanded = expanded
            .checked_add(entry.size())
            .ok_or_else(|| invalid("DOCX demasiado grande."))?;
        if expanded > 32 * 1024 * 1024
            || name.starts_with('/')
            || name.contains(':')
            || name.split('/').any(|part| part == "..")
            || name.contains("vba")
            || name.contains("macros")
            || name.starts_with("word/embeddings/")
        {
            return Err(invalid(
                "DOCX con contenido activo, ruta no válida o expansión excesiva.",
            ));
        }
    }
    let mut xml = String::new();
    let index = (0..zip.len())
        .find(|index| {
            zip.by_index(*index).ok().is_some_and(|file| {
                file.name()
                    .ok()
                    .is_some_and(|name| name.replace('\\', "/") == "word/document.xml")
            })
        })
        .ok_or_else(|| invalid("DOCX sin documento."))?;
    let file = zip
        .by_index(index)
        .map_err(|_| invalid("DOCX sin documento."))?;
    if file.size() > MAX_DOCX_XML_BYTES as u64 {
        return Err(invalid("Contenido DOCX descomprimido mayor de 8 MiB."));
    }
    file.take((MAX_DOCX_XML_BYTES + 1) as u64)
        .read_to_string(&mut xml)
        .map_err(|_| invalid("DOCX ilegible."))?;
    if xml.len() > MAX_DOCX_XML_BYTES {
        return Err(invalid("Contenido DOCX descomprimido mayor de 8 MiB."));
    }
    rich_text::docx_xml(&xml)
}

fn pdf_lines(data: &[u8]) -> Result<Vec<Line>, AppError> {
    rich_text::pdf(data)
}

fn parse_questions(lines: &[Line]) -> (Vec<Question>, Vec<Value>) {
    questions::parse(lines)
}

fn question_start(text: &str) -> Option<(usize, String)> {
    let trimmed = text.trim();
    let split = trimmed.find(|c: char| !c.is_ascii_digit())?;
    let number = trimmed[..split].parse().ok()?;
    let delimiter = trimmed.as_bytes().get(split)?;
    matches!(*delimiter, b'.' | b')' | b':' | b'-')
        .then(|| (number, trimmed[split + 1..].trim().to_owned()))
}
fn option_line(text: &str) -> Option<(char, String)> {
    let value = text.trim().trim_matches('*').trim();
    let mut chars = value.chars();
    let letter = chars.next()?.to_ascii_lowercase();
    if !('a'..='d').contains(&letter) {
        return None;
    }
    let delimiter = chars.next()?;
    matches!(delimiter, ')' | '.' | ':' | '-').then(|| (letter, chars.as_str().trim().to_owned()))
}
async fn resolve_media(url: &str) -> Result<PathBuf, AppError> {
    let relative = url
        .strip_prefix("/media/")
        .or_else(|| url.strip_prefix("media/"))
        .or_else(|| url.strip_prefix("/api/media/"))
        .ok_or_else(|| invalid("URL de archivo no válida."))?;
    if relative.contains("..") || relative.contains(['\0', '\r', '\n']) {
        return Err(invalid("Ruta de archivo no válida."));
    }
    let root = media_root().await?;
    let path = fs::canonicalize(root.join(relative))
        .await
        .map_err(|_| AppError::NotFound)?;
    path.starts_with(&root)
        .then_some(path)
        .ok_or_else(|| invalid("Ruta de archivo no válida."))
}
async fn media_root() -> Result<PathBuf, AppError> {
    let root = PathBuf::from(std::env::var("MEDIA_ROOT").unwrap_or_else(|_| "./media".into()));
    fs::canonicalize(root)
        .await
        .map_err(|_| AppError::Unavailable)
}
async fn relative_media_path(path: &Path) -> Option<String> {
    let root = media_root().await.ok()?;
    path.strip_prefix(root)
        .ok()?
        .to_str()
        .map(|v| v.replace('\\', "/"))
}
fn hex(bytes: &[u8]) -> String {
    let mut value = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        let _ = write!(value, "{byte:02x}");
    }
    value
}
fn invalid(message: &str) -> AppError {
    AppError::Validation(message.to_owned())
}

#[cfg(test)]
mod tests {
    use super::{
        Line, MAX_DOCX_XML_BYTES, MAX_IMPORT_BYTES, MAX_TEXT_BYTES, docx_lines, extract_lines,
        parse_questions, pdf_lines,
    };
    use lopdf::{
        Document, Object, Stream,
        content::{Content, Operation},
        dictionary,
    };

    #[test]
    #[ignore = "requires the three owner-provided STS PDFs via UASSPAIN_STS_DIRECTORY"]
    fn owner_desktop_sts_pdfs_preserve_questions_and_identify_unmarked_source() {
        let root =
            std::env::var("UASSPAIN_STS_DIRECTORY").expect("explicit STS directory required");
        let mut complete = true;
        for index in 1..=3 {
            let path = std::path::Path::new(&root).join(format!("EXAMEN STS {index}.pdf"));
            let bytes = std::fs::read(path).expect("owner-provided PDF must exist");
            let lines = pdf_lines(&bytes).expect("PDF extraction must succeed");
            let (questions, errors) = parse_questions(&lines);
            eprintln!(
                "STS_DOCUMENT_{index}: lines={}, valid={}, errors={}",
                lines.len(),
                questions.len(),
                errors.len()
            );
            eprintln!("STS_DOCUMENT_{index}_DIAGNOSTICS: {errors:?}");
            if index < 3 {
                complete &= questions.len() == 40 && errors.is_empty();
            } else {
                complete &= questions.len() == 36
                    && errors.len() == 4
                    && errors
                        .iter()
                        .filter_map(|error| error["numero"].as_u64())
                        .collect::<Vec<_>>()
                        == vec![5, 7, 21, 22];
            }
        }
        assert!(
            complete,
            "STS1/2 must retain all 40 valid questions; STS3 must explicitly diagnose its four independently verified unmarked questions"
        );
    }

    fn docx(xml: &[u8]) -> Vec<u8> {
        use std::io::{Cursor, Write};
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("word/document.xml", options).unwrap();
        zip.write_all(xml).unwrap();
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn docx_rejects_oversized_expansion() {
        let xml = format!(
            "<w:document><w:p><w:t>{}</w:t></w:p></w:document>",
            "x".repeat(MAX_DOCX_XML_BYTES)
        );
        let compressed = docx(xml.as_bytes());
        assert!(compressed.len() < MAX_DOCX_XML_BYTES / 100);
        assert!(
            docx_lines(&compressed).is_err(),
            "compressed DOCX bypassed the expanded-content budget"
        );
    }

    #[test]
    fn docx_rejects_three_options_even_with_bold_solution() {
        let bytes = docx(br#"<w:document><w:p><w:r><w:t>1. Question</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>A. Correct</w:t></w:r></w:p><w:p><w:r><w:t>B. Wrong</w:t></w:r></w:p><w:p><w:r><w:t>C. Other</w:t></w:r></w:p></w:document>"#);
        let lines = docx_lines(&bytes).unwrap();
        let (questions, errors) = parse_questions(&lines);
        assert!(questions.is_empty());
        assert_eq!(errors.len(), 1);
    }

    #[test]
    fn docx_keeps_four_options_and_bold_solution() {
        let bytes=docx(br#"<w:document><w:p><w:r><w:t>1. Question</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>A. Correct</w:t></w:r></w:p><w:p><w:r><w:t>B. Wrong</w:t></w:r></w:p><w:p><w:r><w:t>C. Other</w:t></w:r></w:p><w:p><w:r><w:t>D. Last</w:t></w:r></w:p></w:document>"#);
        let (questions, errors) = parse_questions(&docx_lines(&bytes).unwrap());
        assert!(errors.is_empty());
        assert_eq!(questions.len(), 1);
        assert_eq!(questions[0].options.len(), 4);
        assert_eq!(questions[0].answer, 'a');
    }

    #[test]
    fn docx_preserves_entities_color_and_disabled_bold() {
        let bytes=docx(br#"<w:document><w:p><w:r><w:t>1. A &amp; B &#x2713;</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>A. Primera</w:t></w:r></w:p><w:p><w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>B. Correcta</w:t></w:r></w:p><w:p><w:r><w:t>C. Tercera</w:t></w:r></w:p><w:p><w:r><w:t>D. Cuarta</w:t></w:r></w:p></w:document>"#);
        let (questions, errors) = parse_questions(&docx_lines(&bytes).unwrap());
        assert!(errors.is_empty());
        assert_eq!(questions[0].answer, 'b');
        assert_eq!(questions[0].statement, "A & B ✓");
    }

    #[test]
    fn docx_regular_option_label_does_not_hide_a_short_bold_answer() {
        let bytes=docx(br#"<w:document><w:p><w:r><w:t>1. Distancia</w:t></w:r></w:p><w:p><w:r><w:t>A. </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>2m</w:t></w:r></w:p><w:p><w:r><w:t>B. 3m</w:t></w:r></w:p><w:p><w:r><w:t>C. 4m</w:t></w:r></w:p><w:p><w:r><w:t>D. 5m</w:t></w:r></w:p></w:document>"#);
        let (questions, errors) = parse_questions(&docx_lines(&bytes).unwrap());
        assert!(errors.is_empty());
        assert_eq!(questions[0].answer, 'a');
    }

    #[test]
    fn docx_bold_option_labels_alone_do_not_select_an_answer() {
        let mut xml = "<w:document><w:p><w:r><w:t>1. Pregunta</w:t></w:r></w:p>".to_owned();
        for letter in ['A', 'B', 'C', 'D'] {
            xml.push_str(&format!("<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>{letter}. </w:t></w:r><w:r><w:t>Respuesta</w:t></w:r></w:p>"));
        }
        xml.push_str("</w:document>");
        let (questions, errors) = parse_questions(&docx_lines(&docx(xml.as_bytes())).unwrap());
        assert!(questions.is_empty());
        assert_eq!(errors.len(), 1);
    }

    #[test]
    fn document_input_and_extracted_text_are_bounded() {
        assert!(extract_lines(&vec![b'x'; MAX_IMPORT_BYTES + 1], "docx").is_err());
        assert!(extract_lines(&[], "pdf").is_err());
        let xml = format!(
            "<w:document><w:p><w:t>{}</w:t></w:p></w:document>",
            "x".repeat(MAX_TEXT_BYTES + 1)
        );
        assert!(xml.len() < MAX_DOCX_XML_BYTES);
        assert!(docx_lines(&docx(xml.as_bytes())).is_err());
    }

    #[test]
    fn pdf_rejects_oversized_expanded_page() {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let mut stream = Stream::new(dictionary! {}, vec![b' '; MAX_IMPORT_BYTES + 1]);
        stream.compress().unwrap();
        let content_id = doc.add_object(stream);
        let page =
            doc.add_object(dictionary! {"Type"=>"Page","Parent"=>pages_id,"Contents"=>content_id});
        doc.objects.insert(pages_id, Object::Dictionary(dictionary! {"Type"=>"Pages","Kids"=>vec![Object::Reference(page)],"Count"=>1,"Resources"=>dictionary!{},"MediaBox"=>vec![0.into(),0.into(),595.into(),842.into()]}));
        let catalog = doc.add_object(dictionary! {"Type"=>"Catalog","Pages"=>pages_id});
        doc.trailer.set("Root", catalog);
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();
        assert!(bytes.len() < MAX_IMPORT_BYTES / 100);
        assert!(pdf_lines(&bytes).is_err());
    }
    #[test]
    fn parses_numbered_questions_and_bold_answer() {
        let lines = vec![
            Line {
                text: "1. Pregunta".into(),
                bold: false,
                color: None,
            },
            Line {
                text: "A. Uno".into(),
                bold: true,
                color: None,
            },
            Line {
                text: "B. Dos".into(),
                bold: false,
                color: None,
            },
            Line {
                text: "C. Tres".into(),
                bold: false,
                color: None,
            },
            Line {
                text: "D. Cuatro".into(),
                bold: false,
                color: None,
            },
        ];
        let (q, e) = parse_questions(&lines);
        assert_eq!(q.len(), 1);
        assert!(e.is_empty());
        assert_eq!(q[0].answer, 'a');
    }

    #[test]
    fn detects_bold_answer_in_pdf_font() {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let regular =
            doc.add_object(dictionary! {"Type"=>"Font","Subtype"=>"Type1","BaseFont"=>"Helvetica"});
        let bold = doc.add_object(
            dictionary! {"Type"=>"Font","Subtype"=>"Type1","BaseFont"=>"Helvetica-Bold"},
        );
        let resources = doc.add_object(dictionary! {"Font"=>dictionary!{"F1"=>regular,"F2"=>bold}});
        let content = Content {
            operations: vec![
                Operation::new("BT", vec![]),
                Operation::new("Tf", vec!["F1".into(), 12.into()]),
                Operation::new("TL", vec![14.into()]),
                Operation::new("Td", vec![50.into(), 750.into()]),
                Operation::new("Tj", vec![Object::string_literal("1. Question\n")]),
                Operation::new("T*", vec![]),
                Operation::new("Tf", vec!["F2".into(), 12.into()]),
                Operation::new("Tj", vec![Object::string_literal("A. Correct\n")]),
                Operation::new("T*", vec![]),
                Operation::new("Tf", vec!["F1".into(), 12.into()]),
                Operation::new("Tj", vec![Object::string_literal("B. Wrong\n")]),
                Operation::new("T*", vec![]),
                Operation::new("Tj", vec![Object::string_literal("C. Other\n")]),
                Operation::new("T*", vec![]),
                Operation::new("Tj", vec![Object::string_literal("D. Last\n")]),
                Operation::new("ET", vec![]),
            ],
        };
        let content_id = doc.add_object(Stream::new(dictionary! {}, content.encode().unwrap()));
        let page =
            doc.add_object(dictionary! {"Type"=>"Page","Parent"=>pages_id,"Contents"=>content_id});
        doc.objects.insert(pages_id,Object::Dictionary(dictionary!{"Type"=>"Pages","Kids"=>vec![Object::Reference(page)],"Count"=>1,"Resources"=>resources,"MediaBox"=>vec![0.into(),0.into(),595.into(),842.into()]}));
        let catalog = doc.add_object(dictionary! {"Type"=>"Catalog","Pages"=>pages_id});
        doc.trailer.set("Root", catalog);
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();
        let lines = pdf_lines(&bytes).unwrap();
        let (q, e) = parse_questions(&lines);
        assert_eq!(q.len(), 1, "lines={lines:?} errors={e:?}");
        assert_eq!(q[0].answer, 'a');
    }
}
