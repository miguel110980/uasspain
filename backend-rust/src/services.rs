use crate::{
    AppState,
    auth::{authenticate, require_role},
    content_realtime::lock_edit,
    error::AppError,
    uploads::{remove_managed_media, store_image_bytes},
};
use axum::{
    Json,
    extract::{Multipart, Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServiceInput {
    pub title: Option<String>,
    pub slug: Option<String>,
    pub short_description: Option<String>,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub image_url: Option<String>,
    pub presentation: Option<Value>,
    pub seo: Option<Value>,
    pub status: Option<String>,
    pub sort_order: Option<i32>,
}

fn pool(state: &AppState) -> Result<&PgPool, AppError> {
    state.pool.as_ref().ok_or(AppError::Unavailable)
}
fn admin(state: &AppState, headers: &HeaderMap) -> Result<Uuid, AppError> {
    let claims = authenticate(state, headers, "access")?;
    require_role(&claims, &["admin"])?;
    Ok(claims.profile_id)
}
fn invalid() -> AppError {
    AppError::Validation("Datos de servicio no válidos.".into())
}

fn plain_text(value: &str) -> bool {
    !value
        .chars()
        .any(|c| matches!(c, '<' | '>') || (c.is_control() && !matches!(c, '\n' | '\r' | '\t')))
}

fn normalize_slug(value: &str) -> Result<String, AppError> {
    // Reject paths before normalization; never turn a hostile URL into a slug.
    if value.chars().count() > 180
        || value.chars().any(|c| {
            !c.is_ascii_alphanumeric()
                && !matches!(
                    c,
                    ' ' | '-'
                        | 'á'
                        | 'à'
                        | 'ä'
                        | 'â'
                        | 'é'
                        | 'è'
                        | 'ë'
                        | 'ê'
                        | 'í'
                        | 'ì'
                        | 'ï'
                        | 'î'
                        | 'ó'
                        | 'ò'
                        | 'ö'
                        | 'ô'
                        | 'ú'
                        | 'ù'
                        | 'ü'
                        | 'û'
                        | 'ñ'
                        | 'Á'
                        | 'À'
                        | 'Ä'
                        | 'Â'
                        | 'É'
                        | 'È'
                        | 'Ë'
                        | 'Ê'
                        | 'Í'
                        | 'Ì'
                        | 'Ï'
                        | 'Î'
                        | 'Ó'
                        | 'Ò'
                        | 'Ö'
                        | 'Ô'
                        | 'Ú'
                        | 'Ù'
                        | 'Ü'
                        | 'Û'
                        | 'Ñ'
                )
        })
    {
        return Err(invalid());
    }
    let slug = crate::content::slugify(value);
    if slug.is_empty() {
        return Err(invalid());
    }
    Ok(slug)
}

fn normalize_input(mut input: ServiceInput, creating: bool) -> Result<ServiceInput, AppError> {
    input.title = input.title.map(|v| v.trim().to_owned());
    input.slug = match input.slug {
        Some(value) if !value.trim().is_empty() => Some(normalize_slug(&value)?),
        None | Some(_) if creating => {
            let title = input.title.as_deref().ok_or_else(invalid)?;
            let slug = crate::content::slugify(title);
            if slug.is_empty() {
                return Err(invalid());
            }
            Some(slug)
        }
        None => None,
        Some(_) => return Err(invalid()),
    };
    Ok(input)
}

pub async fn public_list(State(state): State<Arc<AppState>>) -> Result<Json<Vec<Value>>, AppError> {
    Ok(Json(sqlx::query_scalar("SELECT to_jsonb(s)-'coordinate'-'action_href'-'image_path'-'created_by'-'deleted_at'-'image_resource_id'-'presentation'-'description' FROM services s WHERE status='published' ORDER BY sort_order,created_at,id").fetch_all(pool(&state)?).await?))
}
pub async fn public_detail(
    State(state): State<Arc<AppState>>,
    Path(slug): Path<String>,
) -> Result<Json<Value>, AppError> {
    if normalize_slug(&slug).is_err() || crate::content::slugify(&slug) != slug {
        return Err(AppError::NotFound);
    }
    Ok(Json(sqlx::query_scalar("SELECT to_jsonb(s)-'coordinate'-'action_href'-'image_path'-'created_by'-'deleted_at'-'image_resource_id' FROM services s JOIN service_routes r ON r.service_id=s.id WHERE r.slug=$1 AND s.status='published'").bind(slug).fetch_optional(pool(&state)?).await?.ok_or(AppError::NotFound)?))
}
pub async fn admin_list(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<Value>>, AppError> {
    admin(&state, &headers)?;
    Ok(Json(sqlx::query_scalar("SELECT to_jsonb(s) FROM services s WHERE status!='deleted' ORDER BY sort_order,created_at,id").fetch_all(pool(&state)?).await?))
}

pub async fn create(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<ServiceInput>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let owner = admin(&state, &headers)?;
    let input = normalize_input(input, true)?;
    validate(&input)?;
    let title = input
        .title
        .as_deref()
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(invalid)?;
    let slug = input
        .slug
        .as_deref()
        .filter(|v| !v.is_empty())
        .ok_or_else(invalid)?;
    let id = Uuid::new_v4();
    let mut tx = pool(&state)?.begin().await?;
    let resource_id =
        crate::content_images::resource(&mut tx, input.image_url.as_deref().unwrap_or("")).await?;
    let value=sqlx::query_scalar("INSERT INTO services(id,title,slug,short_description,description,icon,image_url,presentation,seo,status,sort_order,created_by,published_at,image_resource_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CASE WHEN $10='published' THEN NOW() END,$13) RETURNING to_jsonb(services)")
        .bind(id).bind(title.trim()).bind(slug).bind(input.short_description.unwrap_or_default()).bind(input.description.unwrap_or_default())
        .bind(input.icon.unwrap_or_else(||"Shield".into())).bind(input.image_url.unwrap_or_default())
        .bind(input.presentation.unwrap_or(json!({}))).bind(input.seo.unwrap_or(json!({})))
        .bind(input.status.unwrap_or_else(||"draft".into())).bind(input.sort_order.unwrap_or(0)).bind(owner).bind(resource_id).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(value)))
}

pub async fn update(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<ServiceInput>,
) -> Result<Json<Value>, AppError> {
    admin(&state, &headers)?;
    let input = normalize_input(input, false)?;
    validate(&input)?;
    let mut tx = pool(&state)?.begin().await?;
    lock_edit(&mut tx, "services", id, &headers).await?;
    let resource_id =
        crate::content_images::resource(&mut tx, input.image_url.as_deref().unwrap_or("")).await?;
    let value=sqlx::query_scalar("UPDATE services SET title=COALESCE($2,title),slug=COALESCE($3,slug),short_description=COALESCE($4,short_description),description=COALESCE($5,description),icon=COALESCE($6,icon),image_url=COALESCE($7,image_url),image_resource_id=CASE WHEN $7 IS NULL THEN image_resource_id ELSE $12 END,image_path=CASE WHEN $7 IS NULL OR $7=image_url THEN image_path ELSE '' END,presentation=COALESCE($8,presentation),seo=COALESCE($9,seo),status=COALESCE($10,status),sort_order=COALESCE($11,sort_order),published_at=CASE WHEN COALESCE($10,status)='published' THEN COALESCE(published_at,NOW()) ELSE NULL END WHERE id=$1 RETURNING to_jsonb(services)")
        .bind(id).bind(input.title.map(|v|v.trim().to_owned())).bind(input.slug).bind(input.short_description).bind(input.description).bind(input.icon)
        .bind(input.image_url).bind(input.presentation).bind(input.seo).bind(input.status).bind(input.sort_order).bind(resource_id).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(value))
}

pub async fn delete(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    admin(&state, &headers)?;
    let mut tx = pool(&state)?.begin().await?;
    lock_edit(&mut tx, "services", id, &headers).await?;
    // Keep the slug and original content as a tombstone. Imports and concurrent
    // edits cannot resurrect it. Shared media is never removed by this operation.
    sqlx::query("UPDATE services SET status='deleted',deleted_at=NOW() WHERE id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn upload_image(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<Json<Value>, AppError> {
    let owner = admin(&state, &headers)?;
    let mut tx = pool(&state)?.begin().await?;
    lock_edit(&mut tx, "services", id, &headers).await?;
    let mut stored = None;
    if let Some(field) = multipart.next_field().await.map_err(|_| invalid())? {
        if field.name() != Some("file") {
            return Err(invalid());
        }
        let name = field.file_name().unwrap_or("image").to_owned();
        let mime = field.content_type().unwrap_or("").to_owned();
        let data = field.bytes().await.map_err(|_| invalid())?;
        // Validate the entire multipart stream before storing any bytes.
        if multipart
            .next_field()
            .await
            .map_err(|_| invalid())?
            .is_some()
        {
            return Err(invalid());
        }
        let sanitized = crate::service_images::sanitize(&name, &mime, &data).await?;
        let (path, url) =
            store_image_bytes(&name, &mime, &sanitized, "services", "service_").await?;
        stored = Some((path, url, mime, sanitized.len()));
    }
    let (path, url, mime, bytes) = stored.ok_or_else(invalid)?;
    let result: Result<Value,AppError>=async {
        let resource_id=crate::content_images::register(&mut tx,&path,&url,&mime,bytes,owner).await?;
        let value=sqlx::query_scalar("UPDATE services SET image_path=$2,image_url=$3,image_resource_id=$4 WHERE id=$1 RETURNING to_jsonb(services)").bind(id).bind(&path).bind(&url).bind(resource_id).fetch_one(&mut *tx).await?;
        tx.commit().await?;Ok(value)
    }.await;
    if result.is_err() {
        let _ = remove_managed_media(&path).await;
    }
    result.map(Json)
}

fn safe_path(value: &str) -> bool {
    value.is_empty()
        || (value.starts_with('/')
            && !value.starts_with("//")
            && !value.contains("..")
            && !value
                .chars()
                .any(|c| c.is_control() || "\\<>\"'`%:".contains(c)))
}
pub(crate) fn public_link(value: &str) -> bool {
    safe_path(value)
        && (matches!(
            value,
            "/contacto" | "/#servicios" | "/tecnologia" | "/nosotros" | "/formacion"
        ) || value
            .strip_prefix("/servicios/")
            .is_some_and(|slug| normalize_slug(slug).is_ok_and(|normalized| normalized == slug)))
}
const SERVICE_ICONS: &[&str] = &[
    "Shield",
    "Siren",
    "Radio",
    "Camera",
    "SprayCan",
    "ScanLine",
    "Thermometer",
    "CheckCircle",
    "ArrowRight",
    "ChevronLeft",
    "Sprout",
    "Tractor",
    "Leaf",
    "Bug",
    "Droplets",
    "Map",
    "Trees",
    "Wheat",
    "Search",
    "LifeBuoy",
    "Eye",
    "ShieldCheck",
    "Flame",
    "FireExtinguisher",
    "Moon",
    "Crosshair",
    "MapPin",
    "Layers",
    "Compass",
    "Box",
    "Scan",
    "Mountain",
    "Ruler",
    "Globe",
    "Factory",
    "Building2",
    "Zap",
    "Sun",
    "Wind",
    "House",
    "PanelsTopLeft",
    "Cable",
    "Route",
    "TowerControl",
    "Pipette",
    "Anchor",
    "Bird",
    "Waves",
    "Recycle",
    "Cloud",
    "Fish",
    "Flower2",
    "Heart",
    "Image",
    "Video",
    "Clapperboard",
    "Calendar",
    "Megaphone",
    "Plane",
    "Bike",
    "Film",
    "Tv",
    "Package",
    "Truck",
    "Navigation",
    "Bot",
    "TrafficCone",
    "Construction",
    "Ship",
    "Satellite",
    "Cpu",
    "Radar",
];
fn valid_icon(value: &str) -> bool {
    SERVICE_ICONS.contains(&value)
}
fn validate(input: &ServiceInput) -> Result<(), AppError> {
    for (value, max, required) in [
        (&input.title, 180, true),
        (&input.slug, 180, true),
        (&input.short_description, 600, false),
        (&input.description, 100_000, false),
        (&input.image_url, 600, false),
    ] {
        if value.as_ref().is_some_and(|s| {
            s.chars().count() > max || (required && s.trim().is_empty()) || !plain_text(s)
        }) {
            return Err(invalid());
        }
    }
    if input.slug.as_deref().is_some_and(|s| {
        !s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            || s.starts_with('-')
            || s.ends_with('-')
            || s.contains("--")
    }) || input.icon.as_deref().is_some_and(|s| !valid_icon(s))
        || input.sort_order.is_some_and(|s| s < 0)
        || input
            .status
            .as_deref()
            .is_some_and(|s| !matches!(s, "draft" | "published"))
        || input
            .image_url
            .as_deref()
            .is_some_and(|s| !safe_path(s) || (!s.is_empty() && !s.starts_with("/media/")))
    {
        return Err(invalid());
    }
    if let Some(p) = &input.presentation {
        if !p.is_object() || p.to_string().len() > 150_000 {
            return Err(invalid());
        }
        let Some(obj) = p.as_object() else {
            return Err(invalid());
        };
        if obj.keys().any(|k| {
            !matches!(
                k.as_str(),
                "layout" | "original_title" | "original_description" | "original_summary"
            )
        }) {
            return Err(invalid());
        }
        for key in ["original_title", "original_summary", "original_description"] {
            if obj.get(key).is_some_and(|value| {
                value
                    .as_str()
                    .is_none_or(|text| text.chars().count() > 100_000 || !plain_text(text))
            }) {
                return Err(invalid());
            }
        }
        if let Some(layout) = p.get("layout") {
            let nodes = layout.as_array().ok_or_else(invalid)?;
            let mut budget = 2000;
            for node in nodes {
                validate_node(node, 0, &mut budget)?;
            }
        }
    }
    if let Some(seo) = &input.seo {
        let obj = seo.as_object().ok_or_else(invalid)?;
        if obj.iter().any(|(k, v)| {
            !matches!(k.as_str(), "title" | "description" | "keywords")
                || v.as_str()
                    .is_none_or(|s| s.chars().count() > 600 || !plain_text(s))
        }) {
            return Err(invalid());
        }
    }
    Ok(())
}

fn validate_node(node: &Value, depth: usize, budget: &mut usize) -> Result<(), AppError> {
    if depth > 30 || *budget == 0 {
        return Err(invalid());
    }
    *budget -= 1;
    if let Some(s) = node.as_str() {
        return if s.chars().count() <= 100_000 && plain_text(s) {
            Ok(())
        } else {
            Err(invalid())
        };
    }
    let obj = node.as_object().ok_or_else(invalid)?;
    if obj
        .keys()
        .any(|k| !matches!(k.as_str(), "tag" | "props" | "children"))
    {
        return Err(invalid());
    }
    let tag = node
        .get("tag")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    if !matches!(
        tag,
        "section"
            | "div"
            | "motion.div"
            | "motion.li"
            | "Link"
            | "h1"
            | "h2"
            | "h3"
            | "p"
            | "span"
            | "ul"
            | "li"
    ) && !valid_icon(tag)
    {
        return Err(invalid());
    }
    let props = node
        .get("props")
        .and_then(Value::as_object)
        .ok_or_else(invalid)?;
    for (k, v) in props {
        if !matches!(
            k.as_str(),
            "className" | "initial" | "animate" | "transition" | "to" | "whileInView" | "viewport"
        ) {
            return Err(invalid());
        }
        if k == "to" && (tag != "Link" || v.as_str().is_none_or(|s| !public_link(s))) {
            return Err(invalid());
        }
        if k == "className"
            && v.as_str().is_none_or(|s| {
                s.len() > 2000 || !s.is_ascii() || s.chars().any(|c| "<>\"'`\\;".contains(c))
            })
        {
            return Err(invalid());
        }
        if !matches!(k.as_str(), "to" | "className") {
            let obj = v.as_object().ok_or_else(invalid)?;
            if obj.len() > 5
                || obj.iter().any(|(k, v)| {
                    !matches!(
                        k.as_str(),
                        "opacity" | "x" | "y" | "duration" | "delay" | "once" | "amount"
                    ) || (!v.is_number() && !v.is_boolean())
                })
            {
                return Err(invalid());
            }
        }
    }
    for child in node
        .get("children")
        .and_then(Value::as_array)
        .ok_or_else(invalid)?
    {
        validate_node(child, depth + 1, budget)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unsafe_links_and_markup() {
        for value in [
            json!({"title":"<script>alert(1)</script>"}),
            json!({"image_url":"//external/image.png"}),
            json!({"presentation":{"layout":[{"tag":"script","props":{},"children":["alert(1)"]}]}}),
            json!({"presentation":{"layout":[{"tag":"div","props":{"dangerouslySetInnerHTML":{}},"children":[]}]}}),
        ] {
            assert!(validate(&serde_json::from_value(value).unwrap()).is_err());
        }
    }
    #[test]
    fn accepts_safe_partial_edits() {
        assert!(
            validate(
                &serde_json::from_value(json!({"status":"published","sort_order":2})).unwrap()
            )
            .is_ok()
        );
    }
    #[test]
    fn retired_fields_and_unknown_icons_are_rejected() {
        for payload in [
            json!({"coordinate":"40 N"}),
            json!({"action_href":"/admin"}),
        ] {
            assert!(serde_json::from_value::<ServiceInput>(payload).is_err());
        }
        for id in SERVICE_ICONS {
            assert!(valid_icon(id));
        }
        for id in [
            "__proto__",
            "constructor",
            "javascript:x",
            "/images/icon.svg",
        ] {
            assert!(!valid_icon(id));
        }
    }
    #[test]
    fn normalizes_accents_without_accepting_paths() {
        assert_eq!(
            normalize_slug(" Fumigación Agrícola ").unwrap(),
            "fumigacion-agricola"
        );
        for input in [
            "../admin",
            "%2e%2e",
            "a/b",
            "\\admin",
            "javascript:x",
            "a\0b",
            "",
        ] {
            assert!(normalize_slug(input).is_err());
        }
        let generated = normalize_input(
            serde_json::from_value(json!({"title":" Inspección Técnica "})).unwrap(),
            true,
        )
        .unwrap();
        assert_eq!(generated.slug.as_deref(), Some("inspeccion-tecnica"));
        assert!(
            normalize_input(serde_json::from_value(json!({"slug":" "})).unwrap(), false).is_err()
        );
    }
    #[test]
    fn content_and_seo_remain_plain_text() {
        for payload in [
            json!({"description":"<img onerror=x>"}),
            json!({"seo":{"title":"<script>"}}),
            json!({"presentation":{"original_title":[]}}),
            json!({"presentation":{"layout":[{"tag":"Link","props":{"to":"/admin"},"children":["Open"]}]}}),
        ] {
            assert!(validate(&serde_json::from_value(payload).unwrap()).is_err());
        }
        assert!(plain_text("Texto español\r\nCon otra línea."));
        assert!(!plain_text("invisible\u{1b}"));
    }
}
