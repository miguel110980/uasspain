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
    pub coordinate: Option<String>,
    pub image_url: Option<String>,
    pub action_href: Option<String>,
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

pub async fn public_list(State(state): State<Arc<AppState>>) -> Result<Json<Vec<Value>>, AppError> {
    Ok(Json(sqlx::query_scalar("SELECT to_jsonb(s)-'image_path'-'created_by'-'deleted_at'-'image_resource_id'-'presentation'-'description' FROM services s WHERE status='published' ORDER BY sort_order,created_at,id").fetch_all(pool(&state)?).await?))
}
pub async fn public_detail(
    State(state): State<Arc<AppState>>,
    Path(slug): Path<String>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(sqlx::query_scalar("SELECT to_jsonb(s)-'image_path'-'created_by'-'deleted_at'-'image_resource_id' FROM services s WHERE slug=$1 AND status='published'").bind(slug).fetch_optional(pool(&state)?).await?.ok_or(AppError::NotFound)?))
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
    let value=sqlx::query_scalar("INSERT INTO services(id,title,slug,short_description,description,icon,coordinate,image_url,action_href,presentation,seo,status,sort_order,created_by,published_at,image_resource_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,CASE WHEN $12='published' THEN NOW() END,$15) RETURNING to_jsonb(services)")
        .bind(id).bind(title.trim()).bind(slug).bind(input.short_description.unwrap_or_default()).bind(input.description.unwrap_or_default())
        .bind(input.icon.unwrap_or_else(||"Shield".into())).bind(input.coordinate.unwrap_or_default()).bind(input.image_url.unwrap_or_default())
        .bind(input.action_href.unwrap_or_else(||format!("/servicios/{slug}"))).bind(input.presentation.unwrap_or(json!({}))).bind(input.seo.unwrap_or(json!({})))
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
    validate(&input)?;
    let mut tx = pool(&state)?.begin().await?;
    lock_edit(&mut tx, "services", id, &headers).await?;
    let resource_id =
        crate::content_images::resource(&mut tx, input.image_url.as_deref().unwrap_or("")).await?;
    let value=sqlx::query_scalar("UPDATE services SET title=COALESCE($2,title),slug=COALESCE($3,slug),short_description=COALESCE($4,short_description),description=COALESCE($5,description),icon=COALESCE($6,icon),coordinate=COALESCE($7,coordinate),image_url=COALESCE($8,image_url),image_resource_id=CASE WHEN $8 IS NULL THEN image_resource_id ELSE $14 END,image_path=CASE WHEN $8 IS NULL OR $8=image_url THEN image_path ELSE '' END,action_href=COALESCE($9,action_href),presentation=COALESCE($10,presentation),seo=COALESCE($11,seo),status=COALESCE($12,status),sort_order=COALESCE($13,sort_order),published_at=CASE WHEN COALESCE($12,status)='published' THEN COALESCE(published_at,NOW()) ELSE NULL END WHERE id=$1 RETURNING to_jsonb(services)")
        .bind(id).bind(input.title.map(|v|v.trim().to_owned())).bind(input.slug).bind(input.short_description).bind(input.description).bind(input.icon).bind(input.coordinate)
        .bind(input.image_url).bind(input.action_href).bind(input.presentation).bind(input.seo).bind(input.status).bind(input.sort_order).bind(resource_id).fetch_one(&mut *tx).await?;
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
        let (path, url) = store_image_bytes(&name, &mime, &data, "services", "service_").await?;
        stored = Some((path, url, mime, data.len()));
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
fn valid_icon(value: &str) -> bool {
    matches!(
        value,
        "Shield"
            | "Siren"
            | "Radio"
            | "Camera"
            | "SprayCan"
            | "ScanLine"
            | "Thermometer"
            | "CheckCircle"
            | "ArrowRight"
            | "ChevronLeft"
    )
}
fn validate(input: &ServiceInput) -> Result<(), AppError> {
    for (value, max, required) in [
        (&input.title, 180, true),
        (&input.slug, 180, true),
        (&input.short_description, 600, false),
        (&input.description, 100_000, false),
        (&input.coordinate, 80, false),
        (&input.action_href, 600, false),
        (&input.image_url, 600, false),
    ] {
        if value.as_ref().is_some_and(|s| {
            s.chars().count() > max || (required && s.trim().is_empty()) || s.contains('\0')
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
        || input.action_href.as_deref().is_some_and(|s| !safe_path(s))
        || input.image_url.as_deref().is_some_and(|s| {
            !safe_path(s)
                || (!s.is_empty() && !s.starts_with("/media/") && !s.starts_with("/images/"))
        })
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
                || v.as_str().is_none_or(|s| s.len() > 1000)
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
        return if s.len() <= 100_000 && !s.contains('\0') {
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
        if k == "to" && (tag != "Link" || v.as_str().is_none_or(|s| !safe_path(s))) {
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
            json!({"action_href":"javascript:alert(1)"}),
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
}
