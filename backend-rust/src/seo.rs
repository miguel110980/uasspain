use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::Html,
};
use serde_json::{Value, json};

use crate::{AppState, error::AppError};

fn origin() -> Result<String, AppError> {
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

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn text<'a>(course: &'a Value, key: &str) -> &'a str {
    course.get(key).and_then(Value::as_str).unwrap_or("")
}

async fn published(state: Arc<AppState>, slug: String) -> Result<Value, AppError> {
    let Json(course) = crate::content::public_course(State(state), Path(slug))
        .await
        .map_err(|error| match error {
            AppError::Validation(_) => AppError::NotFound,
            other => other,
        })?;
    if text(&course, "status") != "published" {
        return Err(AppError::NotFound);
    }
    Ok(course)
}

pub async fn course_route(
    State(state): State<Arc<AppState>>,
    Path(slug): Path<String>,
) -> Result<StatusCode, AppError> {
    published(state, slug).await?;
    Ok(StatusCode::OK)
}

pub async fn course_head(
    State(state): State<Arc<AppState>>,
    Path(slug): Path<String>,
) -> Result<Html<String>, AppError> {
    let course = published(state, slug).await?;
    let origin = origin()?;
    let name = text(&course, "name");
    let title = escape(&format!("{name} | UASSPAIN"));
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
    let description = escape(description);
    let url = escape(&url);
    let image = escape(&format!("{origin}/images/hero_claro.webp"));
    Ok(Html(format!(
        "<title>{title}</title><meta name=\"description\" content=\"{description}\"><meta name=\"robots\" content=\"index, follow, max-image-preview:large\"><link rel=\"canonical\" href=\"{url}\"><meta property=\"og:title\" content=\"{title}\"><meta property=\"og:description\" content=\"{description}\"><meta property=\"og:url\" content=\"{url}\"><meta property=\"og:type\" content=\"website\"><meta property=\"og:image\" content=\"{image}\"><meta name=\"twitter:image\" content=\"{image}\"><meta name=\"twitter:card\" content=\"summary_large_image\"><meta name=\"twitter:title\" content=\"{title}\"><meta name=\"twitter:description\" content=\"{description}\"><script id=\"seo-org-jsonld\" type=\"application/ld+json\">{schema}</script>"
    )))
}

pub async fn course_body(
    State(state): State<Arc<AppState>>,
    Path(slug): Path<String>,
) -> Result<Html<String>, AppError> {
    let course = published(state, slug).await?;
    let mut html = format!(
        "<main class=\"max-w-5xl mx-auto px-6 pt-28 pb-24\"><a href=\"/formacion\">Formación</a><h1 class=\"font-heading text-4xl font-bold mt-6\">{}</h1><p class=\"mt-5\">{}</p>",
        escape(text(&course, "name")),
        escape(text(&course, "short_description"))
    );
    for (key, heading) in [
        ("introduction", "Introducción"),
        ("description", "Descripción"),
        ("syllabus", "Temario"),
    ] {
        let body = text(&course, key);
        if !body.is_empty() {
            html.push_str(&format!("<section class=\"mt-10\"><h2>{heading}</h2><p class=\"whitespace-pre-wrap\">{}</p></section>", escape(body)));
        }
    }
    if let Some(sections) = course.get("sections").and_then(Value::as_array) {
        for section in sections {
            html.push_str(&format!("<section class=\"mt-10\"><h2>{}</h2><p class=\"whitespace-pre-wrap\">{}</p></section>", escape(text(section, "title")), escape(text(section, "body"))));
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
}
