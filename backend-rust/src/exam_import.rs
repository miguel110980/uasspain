use std::{
    collections::BTreeMap,
    io::{Cursor, Read},
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
};

use axum::{Json, extract::State, http::HeaderMap};
use lopdf::{Document, LoadOptions, content::Content};
use quick_xml::{Reader, events::Event};
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

#[derive(Debug, Deserialize)]
pub struct ImportRequest {
    file_url: String,
    categoria: Option<String>,
    metadata: Option<Value>,
}
#[derive(Debug, Clone)]
struct Line {
    text: String,
    bold: bool,
}
#[derive(Debug)]
struct Question {
    statement: String,
    options: BTreeMap<char, String>,
    answer: char,
}
#[derive(Debug)]
struct PendingQuestion {
    number: usize,
    statement: String,
    options: BTreeMap<char, String>,
    answer: Option<char>,
    multiple_bold_answers: bool,
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
    let (questions, errors) = parse_questions(&lines);
    let detected = questions.len() + errors.len();
    let categoria = input.categoria.unwrap_or_else(|| "A1/A3".into());
    if categoria.len() > 50 {
        return Err(invalid("Categoría no válida."));
    }
    if questions.is_empty() {
        return Ok(Json(
            json!({"total_detectadas":detected,"total_validas":0,"total_errores":errors.len(),"examenes_creados":[],"errores":errors,"error":"No se encontraron preguntas válidas. Use preguntas numeradas con opciones A-D y la respuesta correcta en negrita."}),
        ));
    }
    let mut tx = pool.begin().await?;
    let base = Path::new(&name)
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("Examen");
    let chunks: Vec<&[Question]> = questions.chunks(40).collect();
    let mut created = Vec::new();
    let mut ids = Vec::new();
    for (index, chunk) in chunks.iter().enumerate() {
        let id = Uuid::new_v4();
        let title = if chunks.len() > 1 {
            format!("{base} — Examen {}", index + 1)
        } else {
            base.to_owned()
        };
        sqlx::query("INSERT INTO examenes_examen (id,created_date,updated_date,nombre,categoria,descripcion,activo,num_preguntas,creado_por_id) VALUES ($1,NOW(),NOW(),$2,$3,$4,TRUE,$5,$6)").bind(id).bind(title.chars().take(255).collect::<String>()).bind(&categoria).bind(format!("Importado desde {name}")).bind(i32::try_from(chunk.len()).unwrap_or(i32::MAX)).bind(claims.profile_id).execute(&mut *tx).await?;
        for (order, q) in chunk.iter().enumerate() {
            sqlx::query("INSERT INTO examenes_pregunta (id,created_date,updated_date,examen_id,enunciado,opcion_a,opcion_b,opcion_c,opcion_d,respuesta_correcta,orden,imagen_url) VALUES ($1,NOW(),NOW(),$2,$3,$4,$5,$6,$7,$8,$9,'')").bind(Uuid::new_v4()).bind(id).bind(&q.statement).bind(q.options.get(&'a').cloned().unwrap_or_default()).bind(q.options.get(&'b').cloned().unwrap_or_default()).bind(q.options.get(&'c').cloned().unwrap_or_default()).bind(q.options.get(&'d').cloned().unwrap_or_default()).bind(q.answer.to_string()).bind(i32::try_from(order+1).unwrap_or(i32::MAX)).execute(&mut *tx).await?;
        }
        ids.push(id.to_string());
        created.push(json!({"id":id,"nombre":title,"num_preguntas":chunk.len()}));
    }
    let meta = input.metadata.unwrap_or_else(|| json!({}));
    sqlx::query("INSERT INTO examenes_archivoexamen (id,created_date,updated_date,examen_id,nombre_archivo,archivo_url,archivo_path,archivo_content_type,archivo_tamano,archivo_sha256,descripcion,categoria,num_examenes,subido_por_id) VALUES ($1,NOW(),NOW(),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)").bind(Uuid::new_v4()).bind(ids.join(",")).bind(meta.get("original_name").and_then(Value::as_str).unwrap_or(&name)).bind(&input.file_url).bind(&relative).bind(meta.get("content_type").and_then(Value::as_str).unwrap_or("")).bind(size).bind(&checksum).bind(format!("Importación automática — {} preguntas",questions.len())).bind(&categoria).bind(i32::try_from(created.len()).unwrap_or(i32::MAX)).bind(claims.profile_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"total_detectadas":detected,"total_validas":questions.len(),"total_errores":errors.len(),"examenes_creados":created,"errores":errors}),
    ))
}

fn extract_lines(data: &[u8], extension: &str) -> Result<Vec<Line>, AppError> {
    validate_input_size(data.len())?;
    match extension {
        "docx" => docx_lines(data),
        "pdf" => pdf_lines(data),
        "doc" => Err(invalid(
            "Formato .doc no soportado. Convierta el archivo a PDF o DOCX.",
        )),
        _ => Err(invalid("Formato de archivo no soportado.")),
    }
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
    lines.push(Line { text, bold });
    Ok(())
}

fn docx_lines(data: &[u8]) -> Result<Vec<Line>, AppError> {
    let mut zip = ZipArchive::new(Cursor::new(data)).map_err(|_| invalid("DOCX no válido."))?;
    if zip.len() > 4096 {
        return Err(invalid("DOCX con demasiadas entradas."));
    }
    let mut xml = String::new();
    let index = (0..zip.len())
        .find(|index| {
            zip.by_index(*index)
                .ok()
                .is_some_and(|file| file.name().replace('\\', "/") == "word/document.xml")
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
    let mut reader = Reader::from_str(&xml);
    let mut lines = Vec::new();
    let mut text = String::new();
    let mut bold = false;
    let mut in_text = false;
    let mut bytes = 0;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => match e.name().as_ref() {
                "w:p" => {
                    text.clear();
                    bold = false
                }
                "w:t" => in_text = true,
                "w:b" => bold = true,
                _ => {}
            },
            Ok(Event::Empty(e)) if e.name().as_ref() == "w:b" => bold = true,
            Ok(Event::Text(e)) if in_text => text.push_str(&e.xml10_content()),
            Ok(Event::End(e)) => match e.name().as_ref() {
                "w:t" => in_text = false,
                "w:p" => {
                    let clean = text.trim();
                    if !clean.is_empty() {
                        push_line(&mut lines, &mut bytes, clean.to_owned(), bold)?;
                    }
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(_) => return Err(invalid("DOCX ilegible.")),
            _ => {}
        }
    }
    Ok(lines)
}
fn pdf_lines(data: &[u8]) -> Result<Vec<Line>, AppError> {
    let doc = Document::load_mem_with_options(
        data,
        LoadOptions {
            strict: true,
            max_decompressed_size: Some(MAX_IMPORT_BYTES),
            ..Default::default()
        },
    )
    .map_err(|_| invalid("PDF no válido o demasiado extenso al descomprimir."))?;
    let pages = doc.get_pages();
    if doc.is_encrypted() || doc.was_encrypted() || pages.is_empty() || pages.len() > 500 {
        return Err(invalid("PDF cifrado, vacío o con más de 500 páginas."));
    }
    let mut lines = Vec::new();
    let mut bytes = 0;
    let mut decoded_bytes = 0usize;
    let mut operations = 0usize;
    for (page_number, page_id) in pages {
        let fonts = doc
            .get_page_fonts(page_id)
            .map_err(|_| invalid("PDF ilegible."))?;
        if fonts.len() > 256 {
            return Err(invalid("Demasiadas fuentes en una página PDF."));
        }
        let bold_fonts: BTreeMap<Vec<u8>, bool> = fonts
            .into_iter()
            .map(|(name, dict)| {
                let base = dict
                    .get(b"BaseFont")
                    .ok()
                    .and_then(|value| value.as_name().ok())
                    .map(|value| String::from_utf8_lossy(value).to_ascii_lowercase())
                    .unwrap_or_default();
                (
                    name,
                    base.contains("bold") || base.contains("black") || base.contains("heavy"),
                )
            })
            .collect();
        let content_bytes = doc
            .get_page_content_with_limit(page_id, MAX_IMPORT_BYTES)
            .map_err(|_| invalid("PDF ilegible."))?;
        decoded_bytes = decoded_bytes
            .checked_add(content_bytes.len())
            .filter(|total| *total <= 64 * 1024 * 1024)
            .ok_or_else(|| invalid("Contenido PDF descomprimido demasiado extenso."))?;
        let content =
            Content::decode_strict(&content_bytes).map_err(|_| invalid("PDF ilegible."))?;
        operations = operations
            .checked_add(content.operations.len())
            .filter(|total| *total <= 1_000_000)
            .ok_or_else(|| invalid("Demasiadas operaciones en el PDF."))?;
        let mut flags = Vec::new();
        let mut current_bold = false;
        let mut has_text = false;
        for operation in content.operations {
            match operation.operator.as_str() {
                "Tf" => {
                    if has_text {
                        flags.push(current_bold);
                        has_text = false;
                    }
                    current_bold = operation
                        .operands
                        .first()
                        .and_then(|value| value.as_name().ok())
                        .and_then(|name| bold_fonts.get(name))
                        .copied()
                        .unwrap_or(false);
                }
                "Tj" | "TJ" => has_text = true,
                _ => {}
            }
        }
        if has_text {
            flags.push(current_bold);
        }
        for (index, chunk) in doc
            .extract_text_chunks_with_limit(&[page_number], MAX_IMPORT_BYTES)
            .into_iter()
            .enumerate()
        {
            let chunk = chunk.map_err(|_| invalid("No se pudo extraer texto del PDF."))?;
            let font_bold = flags.get(index).copied().unwrap_or(false);
            for raw in chunk.lines() {
                let clean = raw.trim();
                if !clean.is_empty() {
                    push_line(
                        &mut lines,
                        &mut bytes,
                        clean.trim_matches('*').trim().to_owned(),
                        font_bold || (clean.starts_with("**") && clean.ends_with("**")),
                    )?;
                }
            }
        }
    }
    Ok(lines)
}
fn parse_questions(lines: &[Line]) -> (Vec<Question>, Vec<Value>) {
    let mut good = Vec::new();
    let mut errors = Vec::new();
    let mut current: Option<PendingQuestion> = None;
    let flush = |current: &mut Option<PendingQuestion>,
                 good: &mut Vec<Question>,
                 errors: &mut Vec<Value>| {
        if let Some(pending) = current.take() {
            if let Some(answer) = pending
                .answer
                .filter(|_| pending.options.len() >= 2 && !pending.multiple_bold_answers)
            {
                good.push(Question {
                    statement: pending.statement,
                    options: pending.options,
                    answer,
                })
            } else {
                errors.push(json!({"numero":pending.number,"motivo":if pending.multiple_bold_answers {"Más de una respuesta en negrita."} else {"Faltan opciones o respuesta correcta en negrita."}}))
            }
        }
    };
    for line in lines {
        if let Some((number, statement)) = question_start(&line.text) {
            flush(&mut current, &mut good, &mut errors);
            current = Some(PendingQuestion {
                number,
                statement,
                options: BTreeMap::new(),
                answer: None,
                multiple_bold_answers: false,
            });
            continue;
        }
        if let Some(pending) = &mut current
            && let Some((letter, value)) = option_line(&line.text)
        {
            pending.options.insert(letter, value);
            if line.bold {
                if pending.answer.is_some_and(|old| old != letter) {
                    pending.multiple_bold_answers = true;
                } else {
                    pending.answer = Some(letter)
                }
            }
            continue;
        }
        if let Some(pending) = &mut current
            && pending.options.is_empty()
        {
            if !pending.statement.is_empty() {
                pending.statement.push(' ');
            }
            pending.statement.push_str(line.text.trim());
        }
    }
    flush(&mut current, &mut good, &mut errors);
    (good, errors)
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
    fn docx_keeps_three_options_and_bold_solution() {
        let bytes = docx(br#"<w:document><w:p><w:r><w:t>1. Question</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>A. Correct</w:t></w:r></w:p><w:p><w:r><w:t>B. Wrong</w:t></w:r></w:p><w:p><w:r><w:t>C. Other</w:t></w:r></w:p></w:document>"#);
        let lines = docx_lines(&bytes).unwrap();
        let (questions, errors) = parse_questions(&lines);
        assert!(errors.is_empty());
        assert_eq!(questions.len(), 1);
        assert_eq!(questions[0].options.len(), 3);
        assert_eq!(questions[0].answer, 'a');
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
            },
            Line {
                text: "A. Uno".into(),
                bold: true,
            },
            Line {
                text: "B. Dos".into(),
                bold: false,
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
                Operation::new("Tj", vec![Object::string_literal("1. Question\n")]),
                Operation::new("Tf", vec!["F2".into(), 12.into()]),
                Operation::new("Tj", vec![Object::string_literal("A. Correct\n")]),
                Operation::new("Tf", vec!["F1".into(), 12.into()]),
                Operation::new("Tj", vec![Object::string_literal("B. Wrong\n")]),
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
