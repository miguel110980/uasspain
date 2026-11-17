//! Preserve physical lines and answer formatting without introducing an OCR path.
use super::{AppError, Line, MAX_IMPORT_BYTES, invalid, push_line};
use lopdf::{Document, LoadOptions, Object, content::Content};
use quick_xml::{Reader, events::Event};
use std::collections::BTreeMap;

#[derive(Default)]
struct StyledLine {
    text: String,
    visible: usize,
    bold: usize,
    colors: BTreeMap<String, usize>,
    prefix: Vec<(bool, Option<String>)>,
}
impl StyledLine {
    fn append(&mut self, text: &str, bold: bool, color: Option<&str>) {
        self.text.push_str(text);
        for _ in text
            .chars()
            .filter(|c| !c.is_whitespace())
            .take(2usize.saturating_sub(self.prefix.len()))
        {
            self.prefix.push((bold, color.map(str::to_owned)));
        }
        let count = text.chars().filter(|c| !c.is_whitespace()).count();
        self.visible += count;
        if bold {
            self.bold += count;
        }
        if let Some(color) = color {
            *self.colors.entry(color.to_owned()).or_default() += count;
        }
    }
    fn finish(mut self, lines: &mut Vec<Line>, bytes: &mut usize) -> Result<(), AppError> {
        if self.text.trim().is_empty() {
            return Ok(());
        }
        // The option label may be regular even when its entire answer is bold.
        // Conversely, a bold A./B./C./D. label alone is decorative.
        if super::option_line(self.text.trim()).is_some() {
            for (bold, color) in &self.prefix {
                self.visible = self.visible.saturating_sub(1);
                if *bold {
                    self.bold = self.bold.saturating_sub(1);
                }
                if let Some(color) = color
                    && let Some(count) = self.colors.get_mut(color)
                {
                    *count = count.saturating_sub(1);
                }
            }
        }
        let color = self
            .colors
            .into_iter()
            .find(|(_, count)| count * 5 >= self.visible * 4)
            .map(|(value, _)| value);
        push_line(
            lines,
            bytes,
            self.text.trim().to_owned(),
            self.visible > 0 && self.bold * 5 >= self.visible * 4,
        )?;
        lines.last_mut().expect("line just appended").color = color;
        Ok(())
    }
}
fn normalized_color(value: &str) -> Option<String> {
    let value = value.trim_start_matches('#').to_ascii_uppercase();
    (value.len() == 6 && value.chars().all(|c| c.is_ascii_hexdigit()) && value != "000000")
        .then_some(value)
}

pub(super) fn docx_xml(xml: &str) -> Result<Vec<Line>, AppError> {
    let mut reader = Reader::from_str(xml);
    let mut lines = Vec::new();
    let mut paragraph = StyledLine::default();
    let (mut in_text, mut bold, mut color, mut bytes) = (false, false, None, 0);
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => match e.name().as_ref() {
                "w:p" => paragraph = StyledLine::default(),
                "w:r" => {
                    bold = false;
                    color = None;
                }
                "w:t" => in_text = true,
                "w:b" => {
                    bold = !e.attributes().flatten().any(|a| {
                        a.key.as_ref() == "w:val"
                            && matches!(a.value.as_ref(), "0" | "false" | "off")
                    });
                }
                "w:color" => {
                    color = e
                        .attributes()
                        .flatten()
                        .find(|a| a.key.as_ref() == "w:val")
                        .and_then(|a| normalized_color(&a.value));
                }
                "w:tab" | "w:br" => paragraph.append(" ", bold, color.as_deref()),
                _ => {}
            },
            Ok(Event::Text(e)) if in_text => {
                let text = e.xml10_content();
                let text = quick_xml::escape::unescape(&text)
                    .map_err(|_| invalid("Entidad DOCX no válida."))?;
                paragraph.append(&text, bold, color.as_deref());
            }
            Ok(Event::GeneralRef(e)) if in_text => {
                let text = if let Some(c) = e
                    .resolve_char_ref()
                    .map_err(|_| invalid("Referencia DOCX no válida."))?
                {
                    c.to_string()
                } else {
                    quick_xml::escape::resolve_predefined_entity(e.as_ref())
                        .ok_or_else(|| invalid("Entidad DOCX no permitida."))?
                        .to_owned()
                };
                paragraph.append(&text, bold, color.as_deref());
            }
            Ok(Event::End(e)) => match e.name().as_ref() {
                "w:t" => in_text = false,
                "w:p" => std::mem::take(&mut paragraph).finish(&mut lines, &mut bytes)?,
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(_) => return Err(invalid("XML DOCX no válido.")),
            _ => {}
        }
    }
    Ok(lines)
}

#[derive(Clone)]
struct PdfState {
    font: Vec<u8>,
    x: f32,
    y: f32,
    line_x: f32,
    leading: f32,
    color: Option<String>,
}
impl Default for PdfState {
    fn default() -> Self {
        Self {
            font: Vec::new(),
            x: 0.,
            y: 0.,
            line_x: 0.,
            leading: 14.,
            color: None,
        }
    }
}
struct Fragment {
    x: f32,
    y: f32,
    text: String,
    bold: bool,
    color: Option<String>,
}
fn number(value: &Object) -> f32 {
    value.as_float().unwrap_or(0.)
}
fn pdf_color(values: &[Object], kind: &str) -> Option<String> {
    let v: Vec<f32> = values.iter().map(number).collect();
    let rgb = match (kind, v.as_slice()) {
        ("g", [g]) => [*g, *g, *g],
        ("rg", [r, g, b]) => [*r, *g, *b],
        ("k", [c, m, y, k]) => [
            (1. - c) * (1. - k),
            (1. - m) * (1. - k),
            (1. - y) * (1. - k),
        ],
        _ => return None,
    };
    normalized_color(
        &rgb.map(|v| format!("{:02X}", (v.clamp(0., 1.) * 255.).round() as u8))
            .join(""),
    )
}
pub(super) fn pdf(data: &[u8]) -> Result<Vec<Line>, AppError> {
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
    let (mut lines, mut bytes, mut expanded, mut operations) = (Vec::new(), 0, 0usize, 0usize);
    for (_, page_id) in pages {
        let fonts = doc
            .get_page_fonts(page_id)
            .map_err(|_| invalid("PDF ilegible."))?;
        if fonts.len() > 256 {
            return Err(invalid("Demasiadas fuentes en una página PDF."));
        }
        let mut encodings = BTreeMap::new();
        for (name, font) in &fonts {
            let base = font
                .get(b"BaseFont")
                .ok()
                .and_then(|v| v.as_name().ok())
                .map(|s| String::from_utf8_lossy(s).to_ascii_lowercase())
                .unwrap_or_default();
            let encoding = font
                .get_font_encoding_with_limit(&doc, MAX_IMPORT_BYTES)
                .map_err(|_| invalid("Codificación de fuente PDF no válida."))?;
            encodings.insert(
                name.clone(),
                (
                    encoding,
                    base.contains("bold") || base.contains("black") || base.contains("heavy"),
                ),
            );
        }
        let content = doc
            .get_page_content_with_limit(page_id, MAX_IMPORT_BYTES)
            .map_err(|_| invalid("PDF ilegible."))?;
        expanded = expanded
            .checked_add(content.len())
            .filter(|n| *n <= 64 * 1024 * 1024)
            .ok_or_else(|| invalid("Contenido PDF descomprimido demasiado extenso."))?;
        let content = Content::decode_strict(&content).map_err(|_| invalid("PDF ilegible."))?;
        operations = operations
            .checked_add(content.operations.len())
            .filter(|n| *n <= 1_000_000)
            .ok_or_else(|| invalid("Demasiadas operaciones en el PDF."))?;
        let (mut state, mut stack, mut fragments) = (PdfState::default(), Vec::new(), Vec::new());
        for op in content.operations {
            match op.operator.as_str() {
                "q" => {
                    if stack.len() >= 256 {
                        return Err(invalid("PDF con demasiados estados gráficos."));
                    }
                    stack.push(state.clone());
                }
                "Q" => {
                    if let Some(saved) = stack.pop() {
                        state = saved;
                    }
                }
                "Tf" => {
                    state.font = op
                        .operands
                        .first()
                        .and_then(|v| v.as_name().ok())
                        .unwrap_or_default()
                        .to_vec();
                }
                "Tm" if op.operands.len() == 6 => {
                    state.x = number(&op.operands[4]);
                    state.y = number(&op.operands[5]);
                    state.line_x = state.x;
                }
                "Td" | "TD" if op.operands.len() == 2 => {
                    state.line_x += number(&op.operands[0]);
                    state.x = state.line_x;
                    state.y += number(&op.operands[1]);
                    if op.operator == "TD" {
                        state.leading = -number(&op.operands[1]);
                    }
                }
                "TL" => {
                    state.leading = op.operands.first().map(number).unwrap_or(14.);
                }
                "T*" => {
                    state.x = state.line_x;
                    state.y -= state.leading;
                }
                "g" | "rg" | "k" => state.color = pdf_color(&op.operands, &op.operator),
                "Tj" | "TJ" | "'" | "\"" => {
                    if op.operator == "'" || op.operator == "\"" {
                        state.y -= state.leading;
                        state.x = state.line_x;
                    }
                    let (encoding, bold) = encodings
                        .get(&state.font)
                        .ok_or_else(|| invalid("Texto PDF sin fuente interpretable."))?;
                    let mut text = String::new();
                    let operands: &[Object] = if op.operator == "\"" {
                        op.operands.get(2..).unwrap_or_default()
                    } else {
                        &op.operands
                    };
                    let mut pending: Vec<&Object> = operands.iter().rev().collect();
                    while let Some(value) = pending.pop() {
                        match value {
                            Object::String(raw, _) => text.push_str(
                                &Document::decode_text(encoding, raw)
                                    .map_err(|_| invalid("No se pudo decodificar texto PDF."))?,
                            ),
                            Object::Array(values) => pending.extend(values.iter().rev()),
                            Object::Integer(n) if *n < -100 => text.push(' '),
                            Object::Real(n) if *n < -100. => text.push(' '),
                            _ => {}
                        }
                    }
                    for (index, part) in text.split('\n').enumerate() {
                        if index > 0 {
                            state.y -= state.leading;
                            state.x = state.line_x;
                        }
                        fragments.push(Fragment {
                            x: state.x,
                            y: state.y,
                            text: part.to_owned(),
                            bold: *bold,
                            color: state.color.clone(),
                        });
                    }
                    if fragments.len() > super::MAX_TEXT_BYTES {
                        return Err(invalid("Demasiados fragmentos PDF."));
                    }
                }
                _ => {}
            }
        }
        fragments.sort_by(|a, b| b.y.total_cmp(&a.y).then_with(|| a.x.total_cmp(&b.x)));
        let mut current = StyledLine::default();
        let mut y = None;
        for fragment in fragments {
            if y.is_some_and(|last: f32| (last - fragment.y).abs() > 1.5) {
                std::mem::take(&mut current).finish(&mut lines, &mut bytes)?;
            }
            current.append(&fragment.text, fragment.bold, fragment.color.as_deref());
            y = Some(fragment.y);
        }
        current.finish(&mut lines, &mut bytes)?;
    }
    if lines.is_empty() {
        return Err(invalid(
            "PDF sin capa de texto. No se han generado preguntas; OCR no disponible.",
        ));
    }
    Ok(lines)
}
