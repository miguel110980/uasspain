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
    if let Some(nodes) = service["presentation"]["layout"].as_array() {
        for node in nodes {
            html.push_str(&service_node(node, &service, 0));
        }
    } else {
        html.push_str(&format!("<section class=\"pt-28 px-6 pb-16\"><h1 class=\"font-heading text-4xl\">{}</h1><p>{}</p><p class=\"whitespace-pre-wrap\">{}</p></section>",escape(text(&service,"title")),escape(text(&service,"short_description")),escape(text(&service,"description"))));
    }
    html.push_str("</main>");
    Ok(Html(html))
}

fn service_node(node: &Value, service: &Value, depth: usize) -> String {
    if depth > 30 {
        return String::new();
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
}
