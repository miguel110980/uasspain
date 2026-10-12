use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::Html,
};
use serde_json::{Value, json};

use crate::{AppState, error::AppError};

pub(crate) fn origin() -> Result<String, AppError> {
    let configured = std::env::var("SITE_URL").unwrap_or_else(|_| "https://uas-spain.com".into());
    let url = reqwest::Url::parse(&configured).map_err(|_| AppError::Unavailable)?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(AppError::Unavailable);
    }
    Ok(url.origin().ascii_serialization())
}

pub(crate) fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

pub(crate) fn text<'a>(course: &'a Value, key: &str) -> &'a str {
    course.get(key).and_then(Value::as_str).unwrap_or("")
}

async fn public_course_record(state: Arc<AppState>, slug: String) -> Result<Value, AppError> {
    let Json(course) = crate::content::public_course(State(state), Path(slug))
        .await
        .map_err(|error| match error {
            AppError::Validation(_) => AppError::NotFound,
            other => other,
        })?;
    Ok(course)
}

pub async fn course_route(
    State(state): State<Arc<AppState>>,
    Path(slug): Path<String>,
) -> Result<StatusCode, AppError> {
    public_course_record(state, slug).await?;
    Ok(StatusCode::OK)
}

pub async fn service_route(
    State(state): State<Arc<AppState>>,
    Path(slug): Path<String>,
) -> Result<StatusCode, AppError> {
    let _ = crate::services::public_detail(State(state), Path(slug)).await?;
    Ok(StatusCode::OK)
}

pub async fn service_head(
    State(state): State<Arc<AppState>>,
    Path(slug): Path<String>,
) -> Result<Html<String>, AppError> {
    let Json(service) = crate::services::public_detail(State(state), Path(slug)).await?;
    let site = origin()?;
    let seo = &service["seo"];
    let title = if text(seo, "title").is_empty() {
        format!("{} | UASSPAIN", text(&service, "title"))
    } else {
        text(seo, "title").to_owned()
    };
    let description = if text(seo, "description").is_empty() {
        text(&service, "short_description")
    } else {
        text(seo, "description")
    };
    let url = format!("{site}/servicios/{}", text(&service, "slug"));
    let schema=json!({"@context":"https://schema.org","@type":"Service","name":text(&service,"title"),"description":description,"url":url,"provider":{"@type":"Organization","name":"UASSPAIN"}}).to_string().replace('<',"\\u003c");
    let title = escape(&title);
    let description = escape(description);
    let keywords = escape(text(seo, "keywords"));
    let url = escape(&url);
    let image = escape(&format!("{site}/images/hero_claro.webp"));
    Ok(Html(format!(
        "<title>{title}</title><meta name=\"description\" content=\"{description}\"><meta name=\"keywords\" content=\"{keywords}\"><meta name=\"robots\" content=\"index, follow, max-image-preview:large\"><link rel=\"canonical\" href=\"{url}\"><meta property=\"og:title\" content=\"{title}\"><meta property=\"og:description\" content=\"{description}\"><meta property=\"og:url\" content=\"{url}\"><meta property=\"og:type\" content=\"website\"><meta property=\"og:image\" content=\"{image}\"><meta name=\"twitter:card\" content=\"summary_large_image\"><meta name=\"twitter:title\" content=\"{title}\"><meta name=\"twitter:description\" content=\"{description}\"><meta name=\"twitter:image\" content=\"{image}\"><script id=\"seo-org-jsonld\" type=\"application/ld+json\">{schema}</script>"
    )))
}

pub async fn service_body(
    State(state): State<Arc<AppState>>,
    Path(slug): Path<String>,
) -> Result<Html<String>, AppError> {
    let Json(service) = crate::services::public_detail(State(state), Path(slug)).await?;
    let mut html = "<main class=\"public-content\">".to_owned();
    html.push_str(&service_template(&service));
    html.push_str("</main>");
    Ok(Html(html))
}

fn service_nodes<'a>(node: &'a Value, tag: &str, depth: usize) -> Vec<&'a Value> {
    if depth > 30 {
        return Vec::new();
    }
    let node_tag = text(node, "tag");
    let mut found = if node_tag == tag || node_tag.strip_prefix("motion.") == Some(tag) {
        vec![node]
    } else {
        Vec::new()
    };
    if let Some(children) = node.as_array().or_else(|| node["children"].as_array()) {
        for child in children {
            found.extend(service_nodes(child, tag, depth + 1));
        }
    }
    found
}

fn service_template(service: &Value) -> String {
    // Use the same fixed scene/sections for imported and future records. Layout
    // data supplies only headings, cards and an optional call-to-action.
    let layout = &service["presentation"]["layout"];
    let title = service_nodes(layout, "h1", 0)
        .first()
        .map(|n| service_node(&n["children"], service, 0));
    let title = if text(service, "title") == text(&service["presentation"], "original_title") {
        title.unwrap_or_else(|| escape(text(service, "title")))
    } else {
        escape(text(service, "title"))
    };
    let sections = layout.as_array().map(Vec::as_slice).unwrap_or(&[]);
    let content: Vec<_> = sections
        .iter()
        .filter(|n| {
            text(n, "tag") == "section"
                && service_nodes(n, "h1", 0).is_empty()
                && !text(&n["props"], "className").contains("py-16 bg-card")
        })
        .collect();
    let cards: Vec<_> = content
        .iter()
        .flat_map(|n| service_nodes(n, "div", 0))
        .filter(|n| {
            text(&n["props"], "className")
                .split_whitespace()
                .any(|c| c == "glass-card")
        })
        .collect();
    let content_value = Value::Array(content.iter().map(|v| (*v).clone()).collect());
    let cards_after_intro = service_nodes(&content_value, "div", 0)
        .iter()
        .any(|n| text(&n["props"], "className") == "grid md:grid-cols-2 gap-8");
    let heading = service_nodes(&content_value,"h2",0).first().map(|n| format!("<h2 class=\"font-heading text-3xl md:text-4xl font-bold text-foreground tracking-tight mb-6\">{}</h2>",service_node(&n["children"],service,0))).unwrap_or_default();
    let description = text(service, "description")
        .replace("\r\n", "\n")
        .split("\n\n")
        .filter(|p| !p.trim().is_empty())
        .map(|p| {
            format!(
                "<p class=\"text-muted-foreground leading-relaxed whitespace-pre-wrap\">{}</p>",
                escape(p)
            )
        })
        .collect::<String>();
    let summary = if text(service, "short_description").is_empty() {
        String::new()
    } else {
        format!(
            "<p class=\"text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed\">{}</p>",
            escape(text(service, "short_description"))
        )
    };
    let grid = if cards.is_empty() || cards_after_intro {
        ""
    } else {
        "grid lg:grid-cols-2 gap-16 items-start"
    };
    let intro_class = if cards_after_intro {
        "max-w-3xl mx-auto text-center mb-16"
    } else {
        ""
    };
    let cards_class = if cards_after_intro {
        "grid md:grid-cols-2 gap-8"
    } else {
        "space-y-8"
    };
    let cards_html = cards
        .iter()
        .map(|card| service_node(card, service, 0))
        .collect::<String>();
    let mut html = format!(
        "<section data-service-template=\"hero\" class=\"relative min-h-[55vh] flex items-center justify-center overflow-hidden bg-background pt-24\"><div class=\"absolute inset-0 pointer-events-none\" aria-hidden=\"true\"><div class=\"absolute inset-0 bg-gradient-to-b from-background/60 via-background/40 to-background\"></div><div class=\"absolute inset-0 scanline opacity-10\"></div><div class=\"absolute w-[600px] h-[600px] border border-primary/5 rounded-full left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2\"></div></div><div class=\"relative z-10 max-w-7xl mx-auto px-6 text-center flex flex-col items-center\"><a href=\"/#servicios\" class=\"inline-flex items-center gap-2 mb-8 text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors\">Volver a Servicios</a><div class=\"inline-flex items-center gap-2 mb-6 px-3 py-1.5 border border-primary/20 bg-primary/5 text-primary text-xs font-mono uppercase tracking-widest\">{}</div><h1 class=\"font-heading text-4xl sm:text-5xl md:text-6xl font-bold text-foreground tracking-tight mb-6\">{title}</h1>{summary}</div></section><section data-service-template=\"content\" class=\"py-20 md:py-24 bg-background\"><div class=\"max-w-7xl mx-auto px-6\"><div class=\"{grid}\"><div class=\"{intro_class}\">{heading}<div class=\"space-y-4\">{description}</div></div><div class=\"{cards_class}\">{cards_html}</div></div>",
        escape(text(service, "title"))
    );
    for section in content.iter().skip(1) {
        html.push_str("<div class=\"mt-16\">");
        for tag in ["h2", "p"] {
            for node in service_nodes(section, tag, 0) {
                html.push_str(&service_node(node, service, 0));
            }
        }
        html.push_str("</div>");
    }
    html.push_str("</div></section>");
    for cta in sections
        .iter()
        .filter(|n| text(&n["props"], "className").contains("py-16 bg-card"))
    {
        html.push_str(&service_node(cta, service, 0));
    }
    if !text(service, "image_url").is_empty() {
        html.push_str(&format!("<div class=\"max-w-7xl mx-auto px-6 pb-16\"><img src=\"{}\" alt=\"{}\" class=\"w-full max-h-[600px] object-cover\"></div>",escape(text(service,"image_url")),escape(text(service,"title"))));
    }
    html
}

fn service_node(node: &Value, service: &Value, depth: usize) -> String {
    if depth > 30 {
        return String::new();
    }
    if let Some(nodes) = node.as_array() {
        return nodes
            .iter()
            .map(|n| service_node(n, service, depth + 1))
            .collect();
    }
    if let Some(value) = node.as_str() {
        let presentation = &service["presentation"];
        if let Some(index) = text(presentation, "original_description")
            .replace("\r\n", "\n")
            .split("\n\n")
            .position(|p| p == value)
        {
            return escape(
                text(service, "description")
                    .replace("\r\n", "\n")
                    .split("\n\n")
                    .nth(index)
                    .unwrap_or(""),
            );
        }
        if value == text(presentation, "original_summary") {
            return escape(text(service, "short_description"));
        }
        let original = text(presentation, "original_title");
        return escape(&if original.is_empty() {
            value.to_owned()
        } else {
            value.replace(original, text(service, "title"))
        });
    }
    let tag = match text(node, "tag") {
        "motion.div" => "div",
        "motion.li" => "li",
        "Link" => "a",
        value @ ("section" | "div" | "h1" | "h2" | "h3" | "p" | "span" | "ul" | "li") => value,
        _ => return String::new(),
    };
    let props = &node["props"];
    if tag == "a" && !crate::services::public_link(text(props, "to")) {
        return String::new();
    }
    if text(props, "className").contains("w-px h-full") {
        return String::new();
    }
    let class = escape(text(props, "className"));
    let href = if tag == "a" {
        format!(" href=\"{}\"", escape(text(props, "to")))
    } else {
        String::new()
    };
    let children = node["children"]
        .as_array()
        .map(|nodes| {
            nodes
                .iter()
                .map(|n| service_node(n, service, depth + 1))
                .collect::<String>()
        })
        .unwrap_or_default();
    format!("<{tag} class=\"{class}\"{href}>{children}</{tag}>")
}

pub async fn service_sitemap(
    State(state): State<Arc<AppState>>,
) -> Result<([(&'static str, &'static str); 1], String), AppError> {
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let slugs: Vec<String> = sqlx::query_scalar(
        "SELECT slug FROM services WHERE status='published' ORDER BY sort_order,id",
    )
    .fetch_all(pool)
    .await?;
    let site = origin()?;
    let entries = slugs
        .into_iter()
        .map(|slug| {
            format!(
                "<url><loc>{}</loc></url>",
                escape(&format!("{site}/servicios/{slug}"))
            )
        })
        .collect::<String>();
    Ok((
        [("content-type", "application/xml; charset=utf-8")],
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?><urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">{entries}</urlset>"
        ),
    ))
}

pub async fn course_head(
    State(state): State<Arc<AppState>>,
    Path(slug): Path<String>,
) -> Result<Html<String>, AppError> {
    let course = public_course_record(state, slug).await?;
    let origin = origin()?;
    let name = text(&course, "name");
    let presentation = &course["presentation"];
    let original_name = text(presentation, "original_name") == name;
    let title = if original_name && !text(&presentation["seo"], "title").is_empty() {
        escape(text(&presentation["seo"], "title"))
    } else {
        escape(&format!("{name} | UASSPAIN"))
    };
    let description = text(&course, "short_description");
    let description = if description.is_empty() {
        name
    } else {
        description
    };
    let url = format!("{origin}/formacion/{}", text(&course, "slug"));
    let schema = json!({"@context":"https://schema.org", "@type":"Course", "name":name,
        "description":description, "url":url, "provider":{"@type":"Organization","name":"UASSPAIN","url":origin}});
    let schema = schema.to_string().replace('<', "\\u003c");
    let description = if description == text(presentation, "original_summary")
        && !text(&presentation["seo"], "description").is_empty()
    {
        escape(text(&presentation["seo"], "description"))
    } else {
        escape(description)
    };
    let keywords = escape(text(&presentation["seo"], "keywords"));
    let url = escape(&url);
    let image = escape(&format!("{origin}/images/hero_claro.webp"));
    let robots = if text(&course, "status") == "published" {
        "index, follow, max-image-preview:large"
    } else {
        "noindex, follow"
    };
    Ok(Html(format!(
        "<title>{title}</title><meta name=\"description\" content=\"{description}\"><meta name=\"keywords\" content=\"{keywords}\"><meta name=\"robots\" content=\"{robots}\"><link rel=\"canonical\" href=\"{url}\"><meta property=\"og:title\" content=\"{title}\"><meta property=\"og:description\" content=\"{description}\"><meta property=\"og:url\" content=\"{url}\"><meta property=\"og:type\" content=\"website\"><meta property=\"og:image\" content=\"{image}\"><meta name=\"twitter:image\" content=\"{image}\"><meta name=\"twitter:card\" content=\"summary_large_image\"><meta name=\"twitter:title\" content=\"{title}\"><meta name=\"twitter:description\" content=\"{description}\"><script id=\"seo-org-jsonld\" type=\"application/ld+json\">{schema}</script>"
    )))
}

pub async fn course_body(
    State(state): State<Arc<AppState>>,
    Path(slug): Path<String>,
) -> Result<Html<String>, AppError> {
    let course = public_course_record(state, slug).await?;
    let presentation = &course["presentation"];
    let heading = if text(presentation, "original_name") == text(&course, "name") {
        presentation["hero_parts"]
            .as_array()
            .map(|parts| {
                parts
                    .iter()
                    .map(|part| text(part, "text"))
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .unwrap_or_else(|| text(&course, "name").to_owned())
    } else {
        text(&course, "name").to_owned()
    };
    let mut html = format!(
        "<main class=\"max-w-5xl mx-auto px-6 pt-28 pb-24\"><a href=\"/formacion\">Formación</a><h1 class=\"font-heading text-4xl font-bold mt-6\">{}</h1><p class=\"mt-5\">{}</p>",
        escape(&heading),
        escape(text(&course, "short_description"))
    );
    html.push_str(&format!(
        "<dl class=\"mt-6\"><dt>Modalidad</dt><dd>{}</dd><dt>Duración</dt><dd>{}</dd></dl>",
        match text(&course, "modality") {
            "presencial" => "Presencial",
            "online" => "Online",
            "presencial_online" => "Presencial/Online",
            _ => "Sin especificar",
        },
        escape(text(&course, "duration"))
    ));
    if text(&course, "status") != "published" {
        html.push_str("<section class=\"mt-10\"><h2>Próximamente</h2><p>El curso aparecerá disponible cuando sea publicado.</p></section></main>");
        return Ok(Html(html));
    }
    for key in ["format_label", "certification", "badge"] {
        if key == "format_label"
            && text(&course, "modality") != text(presentation, "original_modality")
        {
            continue;
        }
        let value = text(presentation, key);
        if !value.is_empty() {
            html.push_str(&format!("<p>{}</p>", escape(value)));
        }
    }
    for (key, default_heading) in [
        ("introduction", "Introducción"),
        ("description", "Descripción"),
        ("syllabus", "Temario"),
    ] {
        let body = text(&course, key);
        if !body.is_empty() {
            let heading =
                if key == "description" && !text(presentation, "description_heading").is_empty() {
                    text(presentation, "description_heading")
                } else {
                    default_heading
                };
            let heading = escape(heading);
            html.push_str(&format!("<section class=\"mt-10\"><h2>{heading}</h2><p class=\"whitespace-pre-wrap\">{}</p></section>", escape(body)));
        }
    }
    if let Some(sections) = course.get("sections").and_then(Value::as_array) {
        let heading = text(presentation, "topics_heading");
        html.push_str(&format!(
            "<h2>{}</h2>",
            escape(if heading.is_empty() {
                "Temario"
            } else {
                heading
            })
        ));
        for section in sections {
            html.push_str(&format!("<section class=\"mt-10\"><h2>{}</h2><p class=\"whitespace-pre-wrap\">{}</p></section>", escape(text(section, "title")), escape(text(section, "body"))));
        }
    }
    let cta = &presentation["cta"];
    for key in ["heading", "description", "label"] {
        let value = text(cta, key);
        if !value.is_empty() {
            html.push_str(&format!("<p>{}</p>", escape(value)));
        }
    }
    html.push_str("</main>");
    Ok(Html(html))
}

pub async fn course_sitemap(
    State(state): State<Arc<AppState>>,
) -> Result<([(&'static str, &'static str); 1], String), AppError> {
    let pool = state.pool.as_ref().ok_or(AppError::Unavailable)?;
    let slugs: Vec<String> =
        sqlx::query_scalar("SELECT slug FROM courses WHERE status='published' ORDER BY slug")
            .fetch_all(pool)
            .await?;
    let origin = origin()?;
    let urls = slugs
        .iter()
        .map(|slug| {
            format!(
                "<url><loc>{}/formacion/{}</loc></url>",
                escape(&origin),
                escape(slug)
            )
        })
        .collect::<String>();
    Ok((
        [("content-type", "application/xml; charset=utf-8")],
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?><urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">{urls}</urlset>"
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::escape;

    #[test]
    fn html_and_xml_escape_untrusted_course_content() {
        assert_eq!(
            escape("<script>\"a&b\"</script>"),
            "&lt;script&gt;&quot;a&amp;b&quot;&lt;/script&gt;"
        );
    }

    #[test]
    fn service_paragraphs_preserve_windows_line_endings_and_escape_edits() {
        let service = serde_json::json!({
            "description": "First edit\r\n\r\n<Second edit>",
            "presentation": {"original_description": "First original\n\nSecond original"}
        });
        assert_eq!(
            super::service_node(&serde_json::json!("First original"), &service, 0),
            "First edit"
        );
        assert_eq!(
            super::service_node(&serde_json::json!("Second original"), &service, 0),
            "&lt;Second edit&gt;"
        );
    }

    #[test]
    fn common_service_template_keeps_all_original_information_cards() {
        let seed = include_str!("../migrations/0021_managed_services.sql");
        let records: Vec<_> = seed.split("'{\"layout\":").skip(1).collect();
        assert_eq!(records.len(), 7);
        for record in records {
            let data = format!(
                "{{\"layout\":{}",
                record.split_once("','published'").unwrap().0
            );
            let presentation: serde_json::Value = serde_json::from_str(&data).unwrap();
            let service = serde_json::json!({
                "title": presentation["original_title"],
                "description": presentation["original_description"],
                "short_description": presentation["original_summary"],
                "presentation": presentation
            });
            let html = super::service_template(&service);
            for tag in ["h3", "li"] {
                for node in super::service_nodes(&service["presentation"]["layout"], tag, 0) {
                    assert!(html.contains(&super::service_node(node, &service, 0)));
                }
            }
            assert!(html.contains("data-service-template=\"hero\""));
            assert!(html.contains("data-service-template=\"content\""));
            assert!(!html.contains("w-px h-full"));
        }
    }
}
