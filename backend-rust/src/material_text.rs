//! Read-only, staff-scoped extraction. Extracted text is evidence, never a
//! verified question bank or an instruction to a generation engine.
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, OnceLock},
};

use axum::{
    Json,
    body::to_bytes,
    extract::{Path, State},
    http::HeaderMap,
};
use lopdf::{
    Dictionary, Document, LoadOptions, Object, ObjectId, Stream,
    content::{Content, Operation},
    dictionary,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::sync::Semaphore;
use uuid::Uuid;

use crate::{
    AppState,
    auth::{authenticate, require_role},
    error::AppError,
};

const MAX_PDF_BYTES: usize = 20 * 1024 * 1024;
const MAX_TEXT_BYTES: usize = 2 * 1024 * 1024;
const MAX_PAGES: usize = 500;
const MAX_DECODED_BYTES: usize = 64 * 1024 * 1024;
const MAX_OPERATIONS: usize = 1_000_000;
const MAX_FORM_CALLS: usize = 4096;
const MAX_FORM_DEPTH: usize = 32;
const MAX_FONTS_PER_PAGE: usize = 256;
static EXTRACTION: OnceLock<Arc<Semaphore>> = OnceLock::new();

pub async fn extract(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let claims = authenticate(&state, &headers, "access")?;
    require_role(&claims, &["admin", "instructor"])?;
    let Json(material) =
        crate::materials::material_detail(State(state.clone()), headers.clone(), Path(id)).await?;
    let path = material["archivo_path"]
        .as_str()
        .filter(|p| !p.is_empty())
        .map(str::to_owned)
        .or_else(|| {
            let url = material["archivo_url"].as_str()?;
            let parsed = reqwest::Url::parse(url)
                .or_else(|_| reqwest::Url::parse("https://localhost/")?.join(url))
                .ok()?;
            parsed
                .path()
                .strip_prefix("/api/media/")
                .or_else(|| parsed.path().strip_prefix("/media/"))
                .map(str::to_owned)
        })
        .ok_or(AppError::NotFound)?;
    if !crate::uploads::valid_private_path(&path) {
        return Err(AppError::NotFound);
    }
    if !path.to_ascii_lowercase().ends_with(".pdf") {
        return Err(AppError::Validation("El material no es un PDF.".into()));
    }
    let root =
        std::path::PathBuf::from(std::env::var("MEDIA_ROOT").unwrap_or_else(|_| "./media".into()));
    let size = tokio::fs::metadata(root.join(&path))
        .await
        .map_err(|_| AppError::NotFound)?
        .len();
    if size > MAX_PDF_BYTES as u64 {
        return Err(AppError::Validation(
            "El PDF supera el límite de extracción de 20 MiB.".into(),
        ));
    }
    let permit = EXTRACTION
        .get_or_init(|| Arc::new(Semaphore::new(1)))
        .clone()
        .try_acquire_owned()
        .map_err(|_| AppError::Unavailable)?;
    // Reuse the exact private-download authorization and canonical path guards.
    let response = crate::uploads::download(State(state), headers, Path(path)).await?;
    let data = to_bytes(response.into_body(), MAX_PDF_BYTES)
        .await
        .map_err(|_| {
            AppError::Validation("El PDF supera el límite de extracción de 20 MiB.".into())
        })?;
    let task = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        extract_pdf(&data)
    });
    let mut result = tokio::time::timeout(std::time::Duration::from_secs(30), task)
        .await
        .map_err(|_| AppError::Unavailable)?
        .map_err(|_| AppError::Internal)??;
    result["material_id"] = json!(id);
    result["categoria"] = material["categoria"].clone();
    Ok(Json(result))
}

#[derive(Default)]
struct ExtractionBudget {
    decoded_bytes: usize,
    operations: usize,
    form_calls: usize,
}

fn invalid_pdf(message: &str) -> AppError {
    AppError::Validation(message.into())
}

fn dictionary_value<'a>(doc: &'a Document, value: &'a Object) -> Result<&'a Dictionary, AppError> {
    doc.dereference(value)
        .and_then(|(_, object)| object.as_dict())
        .map_err(|_| invalid_pdf("Recursos PDF ilegibles o cíclicos."))
}

// Resources is inherited as a whole from the nearest page-tree ancestor.
fn page_resources(doc: &Document, page_id: ObjectId) -> Result<Dictionary, AppError> {
    let mut node_id = page_id;
    let mut visited = HashSet::new();
    for _ in 0..MAX_FORM_DEPTH {
        if !visited.insert(node_id) {
            return Err(invalid_pdf("Árbol de páginas PDF cíclico."));
        }
        let node = doc
            .get_dictionary(node_id)
            .map_err(|_| invalid_pdf("Árbol de páginas PDF ilegible."))?;
        if let Ok(resources) = node.get(b"Resources") {
            return dictionary_value(doc, resources).cloned();
        }
        let Ok(parent) = node.get(b"Parent") else {
            return Ok(Dictionary::new());
        };
        node_id = parent
            .as_reference()
            .map_err(|_| invalid_pdf("Referencia de página PDF ilegible."))?;
    }
    Err(invalid_pdf("Árbol de páginas PDF demasiado profundo."))
}

struct FlattenedPage<'a> {
    doc: &'a Document,
    budget: &'a mut ExtractionBudget,
    fonts: Dictionary,
    font_names: HashMap<(ObjectId, Vec<u8>), Vec<u8>>,
    operations: Vec<Operation>,
    active_forms: HashSet<ObjectId>,
    form_calls: usize,
}

impl<'a> FlattenedPage<'a> {
    fn new(doc: &'a Document, budget: &'a mut ExtractionBudget) -> Self {
        Self {
            doc,
            budget,
            fonts: Dictionary::new(),
            font_names: HashMap::new(),
            operations: Vec::new(),
            active_forms: HashSet::new(),
            form_calls: 0,
        }
    }

    fn font(
        &mut self,
        resources: &Dictionary,
        scope: ObjectId,
        name: &[u8],
    ) -> Result<Vec<u8>, AppError> {
        let key = (scope, name.to_vec());
        if let Some(existing) = self.font_names.get(&key) {
            return Ok(existing.clone());
        }
        if self.fonts.len() >= MAX_FONTS_PER_PAGE {
            return Err(invalid_pdf("Demasiadas fuentes PDF en una página."));
        }
        let font = self
            .doc
            .get_dict_in_dict(resources, b"Font")
            .and_then(|fonts| fonts.get(name))
            .map_err(|_| invalid_pdf("Fuente de texto PDF ausente o ilegible."))?;
        let dictionary = dictionary_value(self.doc, font)?;
        dictionary
            .get_font_encoding_with_limit(self.doc, MAX_PDF_BYTES)
            .map_err(|_| invalid_pdf("Codificación de texto PDF no compatible."))?;
        let renamed = format!("UASExtract{}", self.fonts.len()).into_bytes();
        self.fonts.set(renamed.clone(), font.clone());
        self.font_names.insert(key, renamed.clone());
        Ok(renamed)
    }

    fn visit(
        &mut self,
        bytes: &[u8],
        resources: &Dictionary,
        inherited_font: Option<Operation>,
        depth: usize,
        scope: ObjectId,
    ) -> Result<(), AppError> {
        self.budget.decoded_bytes = self
            .budget
            .decoded_bytes
            .checked_add(bytes.len())
            .filter(|total| *total <= MAX_DECODED_BYTES)
            .ok_or_else(|| invalid_pdf("Contenido PDF decodificado demasiado extenso."))?;
        let content = Content::decode_strict(bytes)
            .map_err(|_| invalid_pdf("Estructura de contenido PDF no compatible."))?;
        self.budget.operations = self
            .budget
            .operations
            .checked_add(content.operations.len())
            .filter(|total| *total <= MAX_OPERATIONS)
            .ok_or_else(|| invalid_pdf("Demasiadas operaciones de contenido PDF."))?;
        let mut current_font = inherited_font;
        let mut saved_fonts = Vec::new();
        for mut op in content.operations {
            match op.operator.as_str() {
                "Tf" => {
                    if op.operands.len() != 2 || !numeric(&op.operands[1]) {
                        return Err(invalid_pdf("Selección de fuente PDF no compatible."));
                    }
                    let name = op.operands[0]
                        .as_name()
                        .map_err(|_| invalid_pdf("Nombre de fuente PDF ilegible."))?;
                    op.operands[0] = Object::Name(self.font(resources, scope, name)?);
                    current_font = Some(op.clone());
                    self.operations.push(op);
                }
                "q" => {
                    if saved_fonts.len() >= MAX_FORM_DEPTH {
                        return Err(invalid_pdf("Estado gráfico PDF demasiado profundo."));
                    }
                    saved_fonts.push(current_font.clone());
                }
                "Q" => {
                    current_font = saved_fonts
                        .pop()
                        .ok_or_else(|| invalid_pdf("Estado gráfico PDF desequilibrado."))?;
                    if let Some(font) = &current_font {
                        self.operations.push(font.clone());
                    }
                }
                "Do" => {
                    self.form(&op, resources, current_font.clone(), depth, scope)?;
                    if let Some(font) = &current_font {
                        self.operations.push(font.clone());
                    }
                }
                "gs" => {
                    let name = op
                        .operands
                        .first()
                        .and_then(|v| v.as_name().ok())
                        .ok_or_else(|| invalid_pdf("Estado gráfico PDF ilegible."))?;
                    let state = self
                        .doc
                        .get_dict_in_dict(resources, b"ExtGState")
                        .and_then(|states| states.get(name))
                        .map_err(|_| invalid_pdf("Estado gráfico PDF ausente."))?;
                    if dictionary_value(self.doc, state)?.get(b"Font").is_ok() {
                        return Err(invalid_pdf(
                            "PDF con fuentes en estado gráfico: requiere extracción especializada.",
                        ));
                    }
                }
                "Tj" | "TJ" | "'" | "\"" => {
                    if current_font.is_none() || !valid_text_operation(&op) {
                        return Err(invalid_pdf(
                            "Texto PDF sin fuente o con operandos ilegibles.",
                        ));
                    }
                    self.operations.push(op);
                }
                "BT" | "ET" | "T*" => self.operations.push(op),
                _ => {}
            }
        }
        if !saved_fonts.is_empty() {
            return Err(invalid_pdf("Estado gráfico PDF desequilibrado."));
        }
        Ok(())
    }

    fn form(
        &mut self,
        op: &Operation,
        resources: &Dictionary,
        inherited_font: Option<Operation>,
        depth: usize,
        inherited_scope: ObjectId,
    ) -> Result<(), AppError> {
        if op.operands.len() != 1 {
            return Err(invalid_pdf("Invocación de objeto PDF no compatible."));
        }
        let name = op.operands[0]
            .as_name()
            .map_err(|_| invalid_pdf("Nombre de objeto PDF ilegible."))?;
        let value = self
            .doc
            .get_dict_in_dict(resources, b"XObject")
            .and_then(|objects| objects.get(name))
            .map_err(|_| invalid_pdf("Objeto PDF invocado ausente."))?;
        let (id, object) = self
            .doc
            .dereference(value)
            .map_err(|_| invalid_pdf("Referencia de objeto PDF ilegible o cíclica."))?;
        let stream = object
            .as_stream()
            .map_err(|_| invalid_pdf("Objeto PDF invocado ilegible."))?;
        match stream.dict.get(b"Subtype").and_then(Object::as_name) {
            Ok(b"Image") => return Ok(()),
            Ok(b"Form") => {}
            _ => return Err(invalid_pdf("Tipo de objeto PDF no compatible.")),
        }
        let id = id.ok_or_else(|| invalid_pdf("Objeto Form PDF sin referencia válida."))?;
        if depth >= MAX_FORM_DEPTH || !self.active_forms.insert(id) {
            return Err(invalid_pdf(
                "Objetos Form PDF cíclicos o demasiado profundos.",
            ));
        }
        self.budget.form_calls += 1;
        self.form_calls += 1;
        if self.budget.form_calls > MAX_FORM_CALLS {
            return Err(invalid_pdf("Demasiadas invocaciones de objetos Form PDF."));
        }
        let (form_resources, scope) = match stream.dict.get(b"Resources") {
            Ok(value) => (dictionary_value(self.doc, value)?, id),
            Err(_) => (resources, inherited_scope),
        };
        let bytes = stream
            .get_plain_content_with_limit(MAX_PDF_BYTES)
            .map_err(|_| invalid_pdf("Objeto Form PDF ilegible o demasiado extenso."))?;
        self.visit(&bytes, form_resources, inherited_font, depth + 1, scope)?;
        self.active_forms.remove(&id);
        Ok(())
    }
}

fn numeric(value: &Object) -> bool {
    match value {
        Object::Integer(_) => true,
        Object::Real(value) => value.is_finite(),
        _ => false,
    }
}

fn valid_text_operation(op: &Operation) -> bool {
    match op.operator.as_str() {
        "Tj" | "'" => op.operands.len() == 1 && op.operands[0].as_str().is_ok(),
        "TJ" => {
            op.operands.len() == 1
                && op.operands[0]
                    .as_array()
                    .is_ok_and(|values| values.iter().all(|v| v.as_str().is_ok() || numeric(v)))
        }
        "\"" => {
            op.operands.len() == 3
                && numeric(&op.operands[0])
                && numeric(&op.operands[1])
                && op.operands[2].as_str().is_ok()
        }
        _ => false,
    }
}

fn extract_page(
    doc: &mut Document,
    page_id: ObjectId,
    number: u32,
    budget: &mut ExtractionBudget,
) -> Result<(String, usize), AppError> {
    let resources = page_resources(doc, page_id)?;
    // Decode strictly: a failed filter must never fall back to compressed bytes.
    let mut bytes = Vec::new();
    let contents = doc.get_page_contents(page_id);
    let page = doc
        .get_dictionary(page_id)
        .map_err(|_| invalid_pdf("Página PDF ilegible."))?;
    if let Ok(value) = page.get(b"Contents") {
        let (_, value) = doc
            .dereference(value)
            .map_err(|_| invalid_pdf("Contenido de página PDF ilegible."))?;
        let expected = match value {
            Object::Stream(_) => 1,
            Object::Array(values) if values.iter().all(|v| v.as_reference().is_ok()) => {
                values.len()
            }
            _ => return Err(invalid_pdf("Contenido de página PDF no compatible.")),
        };
        if expected != contents.len() {
            return Err(invalid_pdf("Contenido de página PDF incompleto."));
        }
    }
    for id in contents {
        let content = doc
            .get_object(id)
            .and_then(Object::as_stream)
            .map_err(|_| invalid_pdf("Flujo de página PDF ilegible."))?
            .get_plain_content_with_limit(MAX_PDF_BYTES.saturating_sub(bytes.len()))
            .map_err(|_| invalid_pdf("Página PDF ilegible o demasiado extensa."))?;
        bytes.extend_from_slice(&content);
        bytes.push(b'\n');
        if bytes.len() > MAX_PDF_BYTES {
            return Err(invalid_pdf("Página PDF demasiado extensa."));
        }
    }
    let mut flattened = FlattenedPage::new(doc, budget);
    flattened.visit(&bytes, &resources, None, 0, page_id)?;
    let form_calls = flattened.form_calls;
    let content = Content {
        operations: flattened.operations,
    }
    .encode()
    .map_err(|_| invalid_pdf("No se pudo preparar el texto PDF."))?;
    if content.len() > MAX_PDF_BYTES {
        return Err(invalid_pdf("Texto de página PDF demasiado extenso."));
    }
    let fonts = flattened.fonts;
    let original = doc
        .get_dictionary(page_id)
        .map_err(|_| invalid_pdf("Página PDF ilegible."))?
        .clone();
    let content_id = doc.add_object(Stream::new(Dictionary::new(), content));
    let page = doc
        .get_dictionary_mut(page_id)
        .map_err(|_| invalid_pdf("Página PDF ilegible."))?;
    page.set("Contents", content_id);
    page.set("Resources", dictionary! {"Font"=>fonts});
    // Only the in-memory extraction page changes. Removing Parent prevents
    // unrelated ancestor fonts from shadowing the explicitly resolved scope.
    page.remove(b"Parent");
    let text = doc
        .extract_text_with_limit(&[number], MAX_PDF_BYTES)
        .map_err(|_| invalid_pdf("No se pudo extraer texto completo del PDF."));
    doc.objects.insert(page_id, Object::Dictionary(original));
    doc.objects.remove(&content_id);
    Ok((text?, form_calls))
}

fn extract_pdf(data: &[u8]) -> Result<Value, AppError> {
    let invalid = |message: &str| AppError::Validation(message.into());
    let mut doc = Document::load_mem_with_options(
        data,
        LoadOptions {
            strict: true,
            max_decompressed_size: Some(MAX_PDF_BYTES),
            ..Default::default()
        },
    )
    .map_err(|_| invalid("PDF corrupto, ilegible o demasiado extenso al descomprimir."))?;
    if doc.is_encrypted() || doc.was_encrypted() {
        return Err(invalid(
            "PDF cifrado: no se puede extraer sin autorización de apertura.",
        ));
    }
    let source_pages = doc.get_pages();
    if source_pages.is_empty() || source_pages.len() > MAX_PAGES {
        return Err(invalid("PDF vacío o con más de 500 páginas."));
    }
    let mut pages = Vec::new();
    let mut bytes = 0usize;
    let mut empty_pages = Vec::new();
    let mut budget = ExtractionBudget::default();
    for (number, page_id) in source_pages {
        let (text, forms) = extract_page(&mut doc, page_id, number, &mut budget)?;
        if text.contains('\u{fffd}') {
            return Err(invalid(
                "Caracteres PDF ilegibles: requiere revisión u OCR.",
            ));
        }
        bytes = bytes
            .checked_add(text.len())
            .ok_or_else(|| invalid("Texto demasiado extenso."))?;
        if bytes > MAX_TEXT_BYTES {
            return Err(invalid(
                "Texto extraído mayor de 2 MiB; no se devuelve contenido truncado.",
            ));
        }
        if text.trim().is_empty() {
            empty_pages.push(number);
        }
        pages.push(json!({"pagina":number,"texto":text,"objetos_form_procesados":forms}));
    }
    if empty_pages.len() == pages.len() {
        return Err(invalid(
            "PDF sin texto extraíble: puede estar vacío o escaneado. Requiere revisión u OCR; no es apto para generación automática.",
        ));
    }
    Ok(
        json!({"sha256":format!("{:x}",Sha256::digest(data)),"paginas":pages,
        "paginas_sin_texto":empty_pages,"bytes_texto":bytes,"motor":"lopdf",
        "objetos_form_procesados":budget.form_calls,
        "requiere_revision":true,"estructura_tablas_verificada":false,
        "advertencias":["La extracción textual no acredita el orden de columnas, tablas ni la suficiencia académica. Revisar el PDF antes de generar o publicar preguntas."]}),
    )
}

#[cfg(test)]
mod tests {
    use super::{MAX_FORM_CALLS, extract_pdf};
    use lopdf::{
        Document, Object, Stream,
        content::{Content, Operation},
        dictionary,
    };

    fn pdf(pages: &[&str]) -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font =
            doc.add_object(dictionary! {"Type"=>"Font","Subtype"=>"Type1","BaseFont"=>"Helvetica"});
        let resources = doc.add_object(dictionary! {"Font"=>dictionary!{"F1"=>font}});
        let mut kids = Vec::new();
        for text in pages {
            let content = Content {
                operations: vec![
                    Operation::new("BT", vec![]),
                    Operation::new("Tf", vec!["F1".into(), 12.into()]),
                    Operation::new("Tj", vec![Object::string_literal(*text)]),
                    Operation::new("ET", vec![]),
                ],
            };
            let content_id = doc.add_object(Stream::new(dictionary! {}, content.encode().unwrap()));
            let page = doc
                .add_object(dictionary! {"Type"=>"Page","Parent"=>pages_id,"Contents"=>content_id});
            kids.push(Object::Reference(page));
        }
        doc.objects.insert(pages_id,Object::Dictionary(dictionary!{"Type"=>"Pages","Kids"=>kids,"Count"=>pages.len() as i64,"Resources"=>resources,"MediaBox"=>vec![0.into(),0.into(),595.into(),842.into()]}));
        let catalog = doc.add_object(dictionary! {"Type"=>"Catalog","Pages"=>pages_id});
        doc.trailer.set("Root", catalog);
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();
        bytes
    }

    #[test]
    fn rejects_corrupt_pdf_without_fabricating_source() {
        assert!(extract_pdf(b"%PDF-1.4 invalid").is_err());
    }

    #[test]
    fn keeps_page_references_and_requires_semantic_review() {
        let result = extract_pdf(&pdf(&[
            "First paragraph.\nSecond paragraph.",
            "Different source page.",
        ]))
        .unwrap();
        assert_eq!(result["paginas"].as_array().unwrap().len(), 2);
        assert_eq!(result["paginas"][0]["pagina"], 1);
        assert!(
            result["paginas"][0]["texto"]
                .as_str()
                .unwrap()
                .contains("Second paragraph.")
        );
        assert_eq!(result["paginas"][1]["pagina"], 2);
        assert!(
            result["paginas"][1]["texto"]
                .as_str()
                .unwrap()
                .contains("Different source page.")
        );
        assert_eq!(result["requiere_revision"], true);
        assert_eq!(result["estructura_tablas_verificada"], false);
    }

    #[test]
    fn rejects_no_text_and_reports_partial_empty_pages() {
        assert!(extract_pdf(&pdf(&[""])).is_err());
        let result = extract_pdf(&pdf(&["Readable source", ""])).unwrap();
        assert_eq!(result["paginas_sin_texto"], serde_json::json!([2]));
    }

    fn save(mut doc: Document) -> Vec<u8> {
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();
        bytes
    }

    fn form(doc: &mut Document, text: &str) -> lopdf::ObjectId {
        let content = Content {
            operations: vec![
                Operation::new("BT", vec![]),
                Operation::new("Tf", vec!["F1".into(), 12.into()]),
                Operation::new("Tj", vec![Object::string_literal(text)]),
                Operation::new("ET", vec![]),
            ],
        };
        doc.add_object(Stream::new(
            dictionary! {"Type"=>"XObject","Subtype"=>"Form","BBox"=>vec![0.into(),0.into(),100.into(),100.into()]},
            content.encode().unwrap(),
        ))
    }

    fn invoke(doc: &mut Document, page_id: lopdf::ObjectId, name: &str, id: lopdf::ObjectId) {
        page_object(doc, page_id, name, id);
        doc.add_to_page_content(
            page_id,
            Content {
                operations: vec![Operation::new("Do", vec![name.into()])],
            },
        )
        .unwrap();
    }

    fn page_object(doc: &mut Document, page_id: lopdf::ObjectId, name: &str, id: lopdf::ObjectId) {
        // add_xobject creates a local Resources dictionary, so copy inherited
        // resources first; otherwise the fixture itself loses its page font.
        let resources = super::page_resources(doc, page_id).unwrap();
        doc.get_dictionary_mut(page_id)
            .unwrap()
            .set("Resources", resources);
        doc.add_xobject(page_id, name.as_bytes(), id).unwrap();
    }

    fn unicode_font(doc: &mut Document, code: u16) -> lopdf::ObjectId {
        let cmap = format!(
            "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Test def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfchar <41> <{code:04X}> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end"
        );
        let to_unicode = doc.add_object(Stream::new(dictionary! {}, cmap.into_bytes()));
        doc.add_object(dictionary! {"Type"=>"Font","Subtype"=>"Type1","BaseFont"=>"Helvetica","ToUnicode"=>to_unicode})
    }

    #[test]
    fn extracts_invoked_form_and_ignores_unreferenced_objects() {
        let mut doc = Document::load_mem(&pdf(&["Ordinary page text"])).unwrap();
        let page_id = doc.get_pages()[&1];
        let form_id = form(&mut doc, "Embedded table cell");
        let _unused = form(&mut doc, "Unreferenced content must never become source");
        invoke(&mut doc, page_id, "Embedded", form_id);
        let result = extract_pdf(&save(doc)).unwrap();
        let text = result["paginas"][0]["texto"].as_str().unwrap();
        assert!(text.contains("Ordinary page text"));
        assert!(text.contains("Embedded table cell"));
        assert!(!text.contains("Unreferenced"));
        assert_eq!(result["objetos_form_procesados"], 1);
        assert_eq!(result["paginas"][0]["objetos_form_procesados"], 1);
    }

    #[test]
    fn extracts_nested_repeated_forms_at_each_invocation_in_source_order() {
        let mut doc = Document::load_mem(&pdf(&["Page prefix"])).unwrap();
        let page_id = doc.get_pages()[&1];
        let child = form(&mut doc, "Nested cell");
        let outer = doc.add_object(Stream::new(
            dictionary! {"Type"=>"XObject","Subtype"=>"Form","Resources"=>dictionary!{"XObject"=>dictionary!{"Child"=>child},"Font"=>dictionary!{"F1"=>doc.get_page_fonts(page_id).unwrap()[b"F1".as_slice()].clone()}}},
            Content {
                operations: vec![Operation::new("Do", vec!["Child".into()])],
            }
            .encode()
            .unwrap(),
        ));
        invoke(&mut doc, page_id, "Outer", outer);
        invoke(&mut doc, page_id, "Outer", outer);
        let result = extract_pdf(&save(doc)).unwrap();
        let text = result["paginas"][0]["texto"].as_str().unwrap();
        assert!(text.starts_with("Page prefix"));
        assert_eq!(text.matches("Nested cell").count(), 2);
        assert_eq!(result["objetos_form_procesados"], 4);
    }

    #[test]
    fn scopes_form_fonts_and_restores_parent_font_including_graphics_state() {
        let mut doc = Document::load_mem(&pdf(&["Page prefix"])).unwrap();
        let page_id = doc.get_pages()[&1];
        let custom_font = unicode_font(&mut doc, 0x00F1);
        let embedded = form(&mut doc, "A");
        doc.get_object_mut(embedded)
            .unwrap()
            .as_stream_mut()
            .unwrap()
            .dict
            .set(
                "Resources",
                dictionary! {"Font"=>dictionary!{"F1"=>custom_font}},
            );
        page_object(&mut doc, page_id, "Embedded", embedded);
        doc.add_to_page_content(
            page_id,
            Content {
                operations: vec![
                    Operation::new("q", vec![]),
                    Operation::new("Do", vec!["Embedded".into()]),
                    Operation::new("Q", vec![]),
                    Operation::new("BT", vec![]),
                    // Font F1 was selected in the original page, before the Form.
                    Operation::new("Tj", vec![Object::string_literal("After A")]),
                    Operation::new("ET", vec![]),
                ],
            },
        )
        .unwrap();
        let result = extract_pdf(&save(doc)).unwrap();
        let text = result["paginas"][0]["texto"].as_str().unwrap();
        assert!(text.contains('ñ'), "Form must use its own Unicode font");
        assert!(
            text.contains("After A"),
            "Form font must not leak into parent"
        );
        assert!(!text.contains("After ñ"));
    }

    #[test]
    fn sibling_forms_with_same_font_name_keep_distinct_unicode_maps() {
        let mut doc = Document::load_mem(&pdf(&["Page prefix"])).unwrap();
        let page_id = doc.get_pages()[&1];
        for (name, code) in [("First", 0x00F1), ("Second", 0x00E9)] {
            let font = unicode_font(&mut doc, code);
            let form_id = form(&mut doc, "A");
            doc.get_object_mut(form_id)
                .unwrap()
                .as_stream_mut()
                .unwrap()
                .dict
                .set("Resources", dictionary! {"Font"=>dictionary!{"F1"=>font}});
            invoke(&mut doc, page_id, name, form_id);
        }
        let result = extract_pdf(&save(doc)).unwrap();
        let text = result["paginas"][0]["texto"].as_str().unwrap();
        assert_eq!(text.matches('ñ').count(), 1);
        assert_eq!(text.matches('é').count(), 1);
        assert!(text.find('ñ').unwrap() < text.find('é').unwrap());
    }

    #[test]
    fn restores_graphics_saved_font_inside_a_form() {
        let mut doc = Document::load_mem(&pdf(&["Page prefix"])).unwrap();
        let page_id = doc.get_pages()[&1];
        let ordinary = doc.get_page_fonts(page_id).unwrap()[b"F1".as_slice()].clone();
        let custom = unicode_font(&mut doc, 0x00F1);
        let form_id = doc.add_object(Stream::new(
            dictionary! {"Type"=>"XObject","Subtype"=>"Form","Resources"=>dictionary!{"Font"=>dictionary!{"F1"=>ordinary,"F2"=>custom}}},
            Content {
                operations: vec![
                    Operation::new("BT", vec![]),
                    Operation::new("Tf", vec!["F1".into(), 12.into()]),
                    Operation::new("q", vec![]),
                    Operation::new("Tf", vec!["F2".into(), 12.into()]),
                    Operation::new("Tj", vec![Object::string_literal("A")]),
                    Operation::new("Q", vec![]),
                    Operation::new("Tj", vec![Object::string_literal("Restored A")]),
                    Operation::new("ET", vec![]),
                ],
            }
            .encode()
            .unwrap(),
        ));
        invoke(&mut doc, page_id, "States", form_id);
        let result = extract_pdf(&save(doc)).unwrap();
        let text = result["paginas"][0]["texto"].as_str().unwrap();
        assert!(text.contains('ñ'));
        assert!(text.contains("Restored A"));
    }

    #[test]
    fn rejects_recursive_forms_without_returning_partial_page() {
        let mut doc = Document::load_mem(&pdf(&["Ordinary page text"])).unwrap();
        let page_id = doc.get_pages()[&1];
        let form_id = doc.new_object_id();
        let content = Content {
            operations: vec![Operation::new("Do", vec!["Self".into()])],
        };
        doc.objects.insert(
            form_id,
            Object::Stream(Stream::new(
                dictionary! {"Type"=>"XObject","Subtype"=>"Form","Resources"=>dictionary!{"XObject"=>dictionary!{"Self"=>form_id}}},
                content.encode().unwrap(),
            )),
        );
        invoke(&mut doc, page_id, "Recursive", form_id);
        let error = extract_pdf(&save(doc)).unwrap_err();
        assert!(error.to_string().contains("cíclicos"));
    }

    #[test]
    fn rejects_unknown_text_font_and_unbalanced_state() {
        for operations in [
            vec![
                Operation::new("Tf", vec!["Missing".into(), 12.into()]),
                Operation::new(
                    "Tj",
                    vec![Object::string_literal("Must not silently vanish")],
                ),
            ],
            vec![Operation::new("Q", vec![])],
        ] {
            let mut doc = Document::load_mem(&pdf(&["Ordinary page text"])).unwrap();
            let page_id = doc.get_pages()[&1];
            doc.add_to_page_content(page_id, Content { operations })
                .unwrap();
            assert!(extract_pdf(&save(doc)).is_err());
        }
    }

    #[test]
    fn form_budget_is_global_and_fails_closed() {
        let mut doc = Document::load_mem(&pdf(&["First page", "Second page"])).unwrap();
        let form_id = form(&mut doc, "Cell");
        for (number, page_id) in doc.get_pages() {
            let count = if number == 1 {
                MAX_FORM_CALLS / 2
            } else {
                MAX_FORM_CALLS - MAX_FORM_CALLS / 2 + 1
            };
            page_object(&mut doc, page_id, "Repeated", form_id);
            doc.add_to_page_content(
                page_id,
                Content {
                    operations: (0..count)
                        .map(|_| Operation::new("Do", vec!["Repeated".into()]))
                        .collect(),
                },
            )
            .unwrap();
        }
        // Each individual page is within budget; their total exceeds it.
        let error = extract_pdf(&save(doc)).unwrap_err();
        assert!(error.to_string().contains("Demasiadas invocaciones"));
    }

    #[test]
    fn rejects_missing_content_stream_instead_of_extracting_only_remaining_streams() {
        let mut doc = Document::load_mem(&pdf(&["Valid source prefix"])).unwrap();
        let page_id = doc.get_pages()[&1];
        let original = doc
            .get_dictionary(page_id)
            .unwrap()
            .get(b"Contents")
            .unwrap()
            .clone();
        let missing = Object::Reference((doc.max_id + 100, 0));
        doc.get_dictionary_mut(page_id)
            .unwrap()
            .set("Contents", vec![original, missing]);
        assert!(extract_pdf(&save(doc)).is_err());
    }
}
