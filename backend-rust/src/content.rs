use std::sync::Arc;

use axum::{
    Json,
    extract::{Multipart, Path, State},
    http::{HeaderMap, StatusCode},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    AppState,
    auth::{Claims, authenticate, require_role},
    error::AppError,
    uploads::{remove_managed_media, store_image_bytes},
};

#[derive(Debug, Deserialize)]
pub struct PostWrite {
    #[serde(default)]
    title: String,
    body: String,
    #[serde(default = "draft")]
    status: String,
    #[serde(default)]
    sort_order: i32,
}

#[derive(Debug, Deserialize)]
pub struct PostPatch {
    title: Option<String>,
    body: Option<String>,
    status: Option<String>,
    sort_order: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct CourseWrite {
    name: String,
    #[serde(default)]
    slug: String,
    #[serde(default)]
    short_description: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    introduction: String,
    #[serde(default)]
    syllabus: String,
    modality: String,
    category: String,
    #[serde(default)]
    duration: String,
    sections: Option<Vec<SectionWrite>>,
    #[serde(default = "upcoming")]
    status: String,
    #[serde(default)]
    sort_order: i32,
}

#[derive(Debug, Deserialize)]
pub struct CoursePatch {
    name: Option<String>,
    slug: Option<String>,
    short_description: Option<String>,
    description: Option<String>,
    introduction: Option<String>,
    syllabus: Option<String>,
    modality: Option<String>,
    category: Option<String>,
    duration: Option<String>,
    sections: Option<Vec<SectionWrite>>,
    status: Option<String>,
    sort_order: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct SectionWrite {
    id: Option<Uuid>,
    title: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    sort_order: i32,
}

#[derive(Debug, Deserialize)]
pub struct SectionPatch {
    title: Option<String>,
    body: Option<String>,
    sort_order: Option<i32>,
}

pub async fn public_posts(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<Value>>, AppError> {
    let rows = sqlx::query_scalar::<_, Value>(
        "SELECT jsonb_build_object(
            'id', p.id, 'title', p.title, 'body', p.body, 'status', p.status,
            'sort_order', p.sort_order, 'created_at', p.created_at,
            'updated_at', p.updated_at, 'published_at', p.published_at,
            'images', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', i.id, 'url', i.file_url, 'alt_text', i.alt_text,
                'sort_order', i.sort_order, 'created_at', i.created_at
            ) ORDER BY i.sort_order, i.created_at) FROM blog_post_images i WHERE i.post_id=p.id), '[]'::jsonb)
        ) FROM blog_posts p WHERE p.status='published'
        ORDER BY p.sort_order, p.published_at DESC NULLS LAST, p.created_at DESC LIMIT 100",
    )
    .fetch_all(pool(&state)?)
    .await?;
    Ok(Json(rows))
}

pub async fn public_post(
    State(state): State<Arc<AppState>>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    post_json(pool(&state)?, id, true).await.map(Json)
}

pub async fn admin_posts(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<Value>>, AppError> {
    admin(&state, &headers)?;
    let rows = sqlx::query_scalar::<_, Value>(
        "SELECT jsonb_build_object(
            'id', p.id, 'title', p.title, 'body', p.body, 'status', p.status,
            'sort_order', p.sort_order, 'created_at', p.created_at,
            'updated_at', p.updated_at, 'published_at', p.published_at,
            'images', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', i.id, 'url', i.file_url, 'alt_text', i.alt_text,
                'sort_order', i.sort_order, 'created_at', i.created_at
            ) ORDER BY i.sort_order, i.created_at) FROM blog_post_images i WHERE i.post_id=p.id), '[]'::jsonb)
        ) FROM blog_posts p ORDER BY p.sort_order, p.created_at DESC LIMIT 200",
    )
    .fetch_all(pool(&state)?)
    .await?;
    Ok(Json(rows))
}

pub async fn create_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<PostWrite>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let claims = admin(&state, &headers)?;
    validate_post(&input.title, &input.body, &input.status, input.sort_order)?;
    let id = Uuid::new_v4();
    sqlx::query(
        "INSERT INTO blog_posts (id,title,body,status,sort_order,created_by,published_at)
         VALUES ($1,$2,$3,$4,$5,$6,CASE WHEN $4='published' THEN NOW() ELSE NULL END)",
    )
    .bind(id)
    .bind(input.title.trim())
    .bind(input.body.trim())
    .bind(input.status)
    .bind(input.sort_order)
    .bind(claims.profile_id)
    .execute(pool(&state)?)
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(post_json(pool(&state)?, id, false).await?),
    ))
}

pub async fn update_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(input): Json<PostPatch>,
) -> Result<Json<Value>, AppError> {
    admin(&state, &headers)?;
    validate_post_patch(&input)?;
    let changed = sqlx::query(
        "UPDATE blog_posts SET title=COALESCE($2,title), body=COALESCE($3,body),
         status=COALESCE($4,status), sort_order=COALESCE($5,sort_order), updated_at=NOW(),
         published_at=CASE WHEN COALESCE($4,status)='published' THEN COALESCE(published_at,NOW()) ELSE NULL END
         WHERE id=$1",
    )
    .bind(id)
    .bind(input.title.map(|value| value.trim().to_owned()))
    .bind(input.body.map(|value| value.trim().to_owned()))
    .bind(input.status)
    .bind(input.sort_order)
    .execute(pool(&state)?)
    .await?;
    if changed.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(post_json(pool(&state)?, id, false).await?))
}

pub async fn delete_post(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    admin(&state, &headers)?;
    let mut tx = pool(&state)?.begin().await?;
    let paths: Vec<String> =
        sqlx::query_scalar("SELECT storage_path FROM blog_post_images WHERE post_id=$1 FOR UPDATE")
            .bind(id)
            .fetch_all(&mut *tx)
            .await?;
    let deleted = sqlx::query("DELETE FROM blog_posts WHERE id=$1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    if deleted.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    tx.commit().await?;
    remove_files(paths).await;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn add_post_image(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<Value>), AppError> {
    admin(&state, &headers)?;
    let mut alt_text = String::new();
    let mut upload: Option<(String, String, Vec<u8>)> = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| invalid("Formulario multipart no válido."))?
    {
        match field.name() {
            Some("alt_text") => {
                alt_text = field
                    .text()
                    .await
                    .map_err(|_| invalid("Texto alternativo no válido."))?;
            }
            Some("file") => {
                let name = field.file_name().unwrap_or("imagen").to_owned();
                let mime = field
                    .content_type()
                    .unwrap_or("application/octet-stream")
                    .to_owned();
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|_| invalid("No se pudo leer la imagen."))?;
                upload = Some((name, mime, bytes.to_vec()));
            }
            _ => {}
        }
    }
    if alt_text.chars().count() > 240 {
        return Err(invalid("El texto alternativo es demasiado largo."));
    }
    let (name, mime, bytes) = upload.ok_or_else(|| invalid("No se envió ninguna imagen."))?;
    let mut tx = pool(&state)?.begin().await?;
    lock_post(&mut tx, id).await?;
    let (count, total): (i64, i64) = sqlx::query_as(
        "SELECT COUNT(*),COALESCE(SUM(size_bytes),0)::BIGINT FROM blog_post_images WHERE post_id=$1",
    )
    .bind(id)
    .fetch_one(&mut *tx)
    .await?;
    let size_bytes =
        i64::try_from(bytes.len()).map_err(|_| invalid("La imagen es demasiado grande."))?;
    let sort_order = i32::try_from(count)
        .map_err(|_| invalid("La publicación contiene demasiadas imágenes."))?;
    if count >= max_images() || total.saturating_add(size_bytes) > max_total_image_bytes() {
        return Err(invalid(
            "La publicación supera el límite de imágenes o tamaño total.",
        ));
    }
    let (storage_path, file_url) = store_image_bytes(&name, &mime, &bytes, "blog", "post_").await?;
    let image_id = Uuid::new_v4();
    let inserted = sqlx::query_scalar::<_, Value>(
        "INSERT INTO blog_post_images (id,post_id,storage_path,file_url,alt_text,content_type,size_bytes,sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING jsonb_build_object('id',id,'url',file_url,'alt_text',alt_text,'sort_order',sort_order,'created_at',created_at)",
    )
    .bind(image_id)
    .bind(id)
    .bind(&storage_path)
    .bind(&file_url)
    .bind(alt_text.trim())
    .bind(mime)
    .bind(size_bytes)
    .bind(sort_order)
    .fetch_one(&mut *tx)
    .await;
    match inserted {
        Ok(image) => {
            tx.commit().await?;
            Ok((StatusCode::CREATED, Json(image)))
        }
        Err(error) => {
            let _ = remove_managed_media(&storage_path).await;
            Err(error.into())
        }
    }
}

pub async fn delete_post_image(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((post_id, image_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, AppError> {
    admin(&state, &headers)?;
    let path: String = sqlx::query_scalar(
        "DELETE FROM blog_post_images WHERE id=$1 AND post_id=$2 RETURNING storage_path",
    )
    .bind(image_id)
    .bind(post_id)
    .fetch_optional(pool(&state)?)
    .await?
    .ok_or(AppError::NotFound)?;
    if let Err(error) = remove_managed_media(&path).await {
        tracing::warn!(%error, %image_id, "orphaned blog image could not be removed");
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn public_courses(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<Value>>, AppError> {
    let rows = sqlx::query_scalar::<_, Value>(
        "SELECT jsonb_build_object('id',id,'name',name,'slug',slug,
         'short_description',short_description,'description',CASE WHEN status='published' THEN description ELSE '' END,'modality',modality,'duration',duration,'cover_image_url',cover_image_url,
         'category',category,'menu_icon',presentation->>'icon','status',status,'content_available',status='published','sort_order',sort_order,'published_at',published_at)
         FROM courses WHERE status IN ('upcoming','published') ORDER BY sort_order,name",
    )
    .fetch_all(pool(&state)?)
    .await?;
    Ok(Json(rows))
}

pub async fn public_course(
    State(state): State<Arc<AppState>>,
    Path(slug): Path<String>,
) -> Result<Json<Value>, AppError> {
    let normalized = normalize_slug(&slug)?;
    let row = course_json_by_slug(pool(&state)?, &normalized, false).await?;
    Ok(Json(row))
}

pub async fn admin_courses(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<Value>>, AppError> {
    admin(&state, &headers)?;
    let rows = sqlx::query_scalar::<_, Value>(
        "SELECT jsonb_build_object('id',c.id,'name',c.name,'slug',c.slug,'category',c.category,'presentation',c.presentation,
         'modality',c.modality,'duration',c.duration,'short_description',c.short_description,'description',c.description,
         'introduction',c.introduction,'syllabus',c.syllabus,
         'cover_image_url',c.cover_image_url,'cover_image_path',c.cover_image_path,
         'status',c.status,'sort_order',c.sort_order,'created_at',c.created_at,
         'updated_at',c.updated_at,'published_at',c.published_at,
         'sections',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sort_order,s.created_at)
          FROM course_sections s WHERE s.course_id=c.id),'[]'::jsonb))
         FROM courses c ORDER BY c.sort_order,c.name",
    )
    .fetch_all(pool(&state)?)
    .await?;
    Ok(Json(rows))
}

pub async fn create_course(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(mut input): Json<CourseWrite>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let claims = admin(&state, &headers)?;
    input.name = course_text(&input.name);
    input.description = course_text(&input.description);
    input.duration = course_text(&input.duration);
    if input.short_description.trim().is_empty() {
        input.short_description = input.description.chars().take(320).collect();
    }
    let id = Uuid::new_v4();
    let generated = input.slug.trim().is_empty();
    let mut slug = if generated {
        generated_slug(&input.name, id, false)
    } else {
        normalize_slug(&input.slug)?
    };
    validate_course(&input, &slug)?;
    let mut tx = pool(&state)?.begin().await?;
    for attempt in 0..2 {
        let inserted: Option<Uuid> = sqlx::query_scalar(
            "INSERT INTO courses (id,name,slug,short_description,description,introduction,syllabus,status,sort_order,created_by,published_at,modality,duration,category) \
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $8='published' THEN NOW() ELSE NULL END,$11,$12,$13) \
             ON CONFLICT (slug) DO NOTHING RETURNING id"
        ).bind(id).bind(&input.name).bind(&slug).bind(input.short_description.trim())
         .bind(&input.description).bind(input.introduction.trim()).bind(input.syllabus.trim())
         .bind(&input.status).bind(input.sort_order).bind(claims.profile_id)
         .bind(&input.modality).bind(&input.duration).bind(&input.category).fetch_optional(&mut *tx).await?;
        if inserted.is_some() {
            break;
        }
        if !generated || attempt == 1 {
            return Err(invalid("El slug ya existe."));
        }
        slug = generated_slug(&input.name, id, true);
    }
    if let Some(sections) = input.sections {
        replace_course_sections(&mut tx, id, sections).await?;
    }
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(course_json_by_id(pool(&state)?, id).await?),
    ))
}

pub async fn update_course(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(mut input): Json<CoursePatch>,
) -> Result<Json<Value>, AppError> {
    admin(&state, &headers)?;
    input.name = input.name.map(|value| course_text(&value));
    input.description = input.description.map(|value| course_text(&value));
    input.duration = input.duration.map(|value| course_text(&value));
    validate_course_patch(&input)?;
    let slug = input.slug.as_deref().map(normalize_slug).transpose()?;
    let mut tx = pool(&state)?.begin().await?;
    let existing_description: Option<String> =
        sqlx::query_scalar("SELECT description FROM courses WHERE id=$1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
    let existing_description = existing_description.ok_or(AppError::NotFound)?;
    // Category, modality and status changes must not rewrite an imported hero summary.
    if input.short_description.is_none()
        && input
            .description
            .as_ref()
            .is_some_and(|value| value != &existing_description)
    {
        input.short_description = input
            .description
            .as_ref()
            .map(|value| value.chars().take(320).collect());
    }
    let result = sqlx::query(
        "UPDATE courses SET name=COALESCE($2,name),slug=COALESCE($3,slug), \
         short_description=COALESCE($4,short_description),description=COALESCE($5,description), \
         introduction=COALESCE($6,introduction),syllabus=COALESCE($7,syllabus), \
         status=COALESCE($8,status),sort_order=COALESCE($9,sort_order),updated_at=NOW(), \
         published_at=CASE WHEN COALESCE($8,status)='published' THEN COALESCE(published_at,NOW()) ELSE NULL END, \
         modality=COALESCE($10,modality),duration=COALESCE($11,duration),category=COALESCE($12,category) WHERE id=$1"
    ).bind(id).bind(input.name).bind(slug).bind(input.short_description)
     .bind(input.description).bind(input.introduction).bind(input.syllabus)
     .bind(input.status).bind(input.sort_order).bind(input.modality).bind(input.duration).bind(input.category)
     .execute(&mut *tx).await;
    map_unique(result)?;
    if let Some(sections) = input.sections {
        replace_course_sections(&mut tx, id, sections).await?;
    }
    tx.commit().await?;
    Ok(Json(course_json_by_id(pool(&state)?, id).await?))
}

async fn replace_course_sections(
    tx: &mut Transaction<'_, Postgres>,
    course_id: Uuid,
    sections: Vec<SectionWrite>,
) -> Result<(), AppError> {
    // Existing IDs may only belong to this course. Never move another course's
    // topics or let duplicate IDs silently replace content.
    let mut ids = std::collections::HashSet::new();
    for section in &sections {
        if let Some(id) = section.id {
            if !ids.insert(id) {
                return Err(invalid("Temas duplicados."));
            }
            let owns: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM course_sections WHERE id=$1 AND course_id=$2)",
            )
            .bind(id)
            .bind(course_id)
            .fetch_one(&mut **tx)
            .await?;
            if !owns {
                return Err(invalid("El tema no pertenece a este curso."));
            }
        }
    }
    sqlx::query("DELETE FROM course_sections WHERE course_id=$1")
        .bind(course_id)
        .execute(&mut **tx)
        .await?;
    for (order, section) in sections.into_iter().enumerate() {
        sqlx::query("INSERT INTO course_sections (id,course_id,title,body,sort_order) VALUES ($1,$2,$3,$4,$5)")
            .bind(section.id.unwrap_or_else(Uuid::new_v4)).bind(course_id)
            .bind(course_text(&section.title)).bind(course_text(&section.body)).bind(order as i32)
            .execute(&mut **tx).await?;
    }
    Ok(())
}

pub async fn delete_course(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    admin(&state, &headers)?;
    let path: Option<String> =
        sqlx::query_scalar("DELETE FROM courses WHERE id=$1 RETURNING NULLIF(cover_image_path,'')")
            .bind(id)
            .fetch_optional(pool(&state)?)
            .await?
            .ok_or(AppError::NotFound)?;
    if let Some(path) = path
        && let Err(error) = remove_managed_media(&path).await
    {
        tracing::warn!(%error, %id, "orphaned course cover could not be removed");
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn upload_course_cover(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<Json<Value>, AppError> {
    admin(&state, &headers)?;
    let mut upload: Option<(String, String, Vec<u8>)> = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| invalid("Formulario multipart no válido."))?
    {
        if field.name() == Some("file") {
            let name = field.file_name().unwrap_or("portada").to_owned();
            let mime = field
                .content_type()
                .unwrap_or("application/octet-stream")
                .to_owned();
            let bytes = field
                .bytes()
                .await
                .map_err(|_| invalid("No se pudo leer la portada."))?;
            upload = Some((name, mime, bytes.to_vec()));
        }
    }
    let (name, mime, bytes) = upload.ok_or_else(|| invalid("No se envió ninguna portada."))?;
    let old: String = sqlx::query_scalar("SELECT cover_image_path FROM courses WHERE id=$1")
        .bind(id)
        .fetch_optional(pool(&state)?)
        .await?
        .ok_or(AppError::NotFound)?;
    let (path, url) = store_image_bytes(&name, &mime, &bytes, "courses", "cover_").await?;
    if let Err(error) = sqlx::query(
        "UPDATE courses SET cover_image_path=$2,cover_image_url=$3,updated_at=NOW() WHERE id=$1",
    )
    .bind(id)
    .bind(&path)
    .bind(&url)
    .execute(pool(&state)?)
    .await
    {
        let _ = remove_managed_media(&path).await;
        return Err(error.into());
    }
    if !old.is_empty()
        && let Err(error) = remove_managed_media(&old).await
    {
        tracing::warn!(%error, %id, "old course cover could not be removed");
    }
    Ok(Json(json!({"cover_image_url":url,"cover_image_path":path})))
}

pub async fn create_section(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(course_id): Path<Uuid>,
    Json(input): Json<SectionWrite>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    admin(&state, &headers)?;
    validate_section(&input.title, &input.body, input.sort_order)?;
    let row = sqlx::query_scalar::<_, Value>(
        "INSERT INTO course_sections (id,course_id,title,body,sort_order) SELECT $1,id,$3,$4,$5 FROM courses WHERE id=$2
         RETURNING to_jsonb(course_sections)",
    ).bind(Uuid::new_v4()).bind(course_id).bind(input.title.trim()).bind(input.body.trim()).bind(input.sort_order)
        .fetch_optional(pool(&state)?).await?.ok_or(AppError::NotFound)?;
    Ok((StatusCode::CREATED, Json(row)))
}

pub async fn update_section(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((course_id, section_id)): Path<(Uuid, Uuid)>,
    Json(input): Json<SectionPatch>,
) -> Result<Json<Value>, AppError> {
    admin(&state, &headers)?;
    validate_section_patch(&input)?;
    let row = sqlx::query_scalar::<_, Value>(
        "UPDATE course_sections SET title=COALESCE($3,title),body=COALESCE($4,body),sort_order=COALESCE($5,sort_order),updated_at=NOW()
         WHERE id=$1 AND course_id=$2 RETURNING to_jsonb(course_sections)",
    ).bind(section_id).bind(course_id).bind(input.title.map(|v|v.trim().to_owned()))
        .bind(input.body.map(|v|v.trim().to_owned())).bind(input.sort_order)
        .fetch_optional(pool(&state)?).await?.ok_or(AppError::NotFound)?;
    Ok(Json(row))
}

pub async fn delete_section(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((course_id, section_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, AppError> {
    admin(&state, &headers)?;
    let result = sqlx::query("DELETE FROM course_sections WHERE id=$1 AND course_id=$2")
        .bind(section_id)
        .bind(course_id)
        .execute(pool(&state)?)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn post_json(pool: &PgPool, id: Uuid, public_only: bool) -> Result<Value, AppError> {
    sqlx::query_scalar::<_, Value>(
        "SELECT jsonb_build_object('id',p.id,'title',p.title,'body',p.body,'status',p.status,
         'sort_order',p.sort_order,'created_at',p.created_at,'updated_at',p.updated_at,'published_at',p.published_at,
         'images',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'url',i.file_url,'alt_text',i.alt_text,'sort_order',i.sort_order,'created_at',i.created_at) ORDER BY i.sort_order,i.created_at) FROM blog_post_images i WHERE i.post_id=p.id),'[]'::jsonb))
         FROM blog_posts p WHERE p.id=$1 AND ($2=FALSE OR p.status='published')",
    ).bind(id).bind(public_only).fetch_optional(pool).await?.ok_or(AppError::NotFound)
}

async fn course_json_by_id(pool: &PgPool, id: Uuid) -> Result<Value, AppError> {
    sqlx::query_scalar::<_, Value>(
        "SELECT jsonb_build_object('id',c.id,'name',c.name,'slug',c.slug,'category',c.category,'presentation',c.presentation,'modality',c.modality,'duration',c.duration,'short_description',c.short_description,
         'description',c.description,'introduction',c.introduction,'syllabus',c.syllabus,
         'cover_image_url',c.cover_image_url,'cover_image_path',c.cover_image_path,'status',c.status,
         'sort_order',c.sort_order,'created_at',c.created_at,'updated_at',c.updated_at,'published_at',c.published_at,
         'sections',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sort_order,s.created_at) FROM course_sections s WHERE s.course_id=c.id),'[]'::jsonb))
         FROM courses c WHERE c.id=$1",
    ).bind(id).fetch_optional(pool).await?.ok_or(AppError::NotFound)
}

async fn course_json_by_slug(
    pool: &PgPool,
    slug: &str,
    admin_view: bool,
) -> Result<Value, AppError> {
    sqlx::query_scalar::<_, Value>(
        "SELECT jsonb_build_object('id',c.id,'name',c.name,'slug',c.slug,'category',c.category,'presentation',c.presentation,'modality',c.modality,'duration',c.duration,'short_description',c.short_description,
         'description',CASE WHEN c.status='published' OR $2 THEN c.description ELSE '' END,
         'introduction',CASE WHEN c.status='published' OR $2 THEN c.introduction ELSE '' END,
         'syllabus',CASE WHEN c.status='published' OR $2 THEN c.syllabus ELSE '' END,
         'cover_image_url',c.cover_image_url,'status',c.status,'sort_order',c.sort_order,
         'published_at',c.published_at,'content_available',(c.status='published' OR $2),
         'sections',CASE WHEN c.status='published' OR $2 THEN COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sort_order,s.created_at) FROM course_sections s WHERE s.course_id=c.id),'[]'::jsonb) ELSE '[]'::jsonb END)
         FROM courses c WHERE c.slug=$1 AND (c.status IN ('upcoming','published') OR $2)",
    ).bind(slug).bind(admin_view).fetch_optional(pool).await?.ok_or(AppError::NotFound)
}

async fn lock_post(tx: &mut Transaction<'_, Postgres>, id: Uuid) -> Result<(), AppError> {
    let exists: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM blog_posts WHERE id=$1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut **tx)
            .await?;
    exists.map(|_| ()).ok_or(AppError::NotFound)
}

async fn remove_files(paths: Vec<String>) {
    for path in paths {
        if let Err(error) = remove_managed_media(&path).await {
            tracing::warn!(%error, %path, "orphaned managed media could not be removed");
        }
    }
}

fn admin(state: &AppState, headers: &HeaderMap) -> Result<Claims, AppError> {
    let claims = authenticate(state, headers, "access")?;
    require_role(&claims, &["admin"])?;
    Ok(claims)
}
fn pool(state: &AppState) -> Result<&PgPool, AppError> {
    state.pool.as_ref().ok_or(AppError::Unavailable)
}
fn invalid(message: &str) -> AppError {
    AppError::Validation(message.to_owned())
}
fn draft() -> String {
    "draft".to_owned()
}
fn course_text(value: &str) -> String {
    value
        .chars()
        .filter(|ch| !ch.is_control() || *ch == '\n' || *ch == '\t')
        .collect::<String>()
        .trim()
        .to_owned()
}
fn generated_slug(name: &str, id: Uuid, suffix: bool) -> String {
    let base = slugify(name);
    let base = if base.is_empty() { "curso" } else { &base };
    if suffix {
        format!(
            "{}-{}",
            base.chars()
                .take(147)
                .collect::<String>()
                .trim_end_matches('-'),
            id.simple()
        )
    } else {
        base.chars()
            .take(180)
            .collect::<String>()
            .trim_end_matches('-')
            .to_owned()
    }
}
fn validate_topics(sections: Option<&[SectionWrite]>) -> Result<(), AppError> {
    if let Some(sections) = sections {
        if sections.len() > 100 || sections.iter().map(|s| s.body.len()).sum::<usize>() > 100_000 {
            return Err(invalid("El temario es demasiado largo."));
        }
        for section in sections {
            validate_section(
                &course_text(&section.title),
                &course_text(&section.body),
                section.sort_order,
            )?;
        }
    }
    Ok(())
}
fn upcoming() -> String {
    "upcoming".to_owned()
}
fn max_images() -> i64 {
    std::env::var("BLOG_MAX_IMAGES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(12)
        .clamp(1, 30)
}
fn max_total_image_bytes() -> i64 {
    std::env::var("BLOG_MAX_TOTAL_IMAGE_BYTES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(40 * 1024 * 1024)
}

fn validate_post(title: &str, body: &str, status: &str, order: i32) -> Result<(), AppError> {
    if title.chars().count() > 180
        || body.trim().is_empty()
        || body.chars().count() > 50_000
        || !matches!(status, "draft" | "published")
        || order < 0
    {
        return Err(invalid("Datos de publicación no válidos."));
    }
    Ok(())
}
fn validate_post_patch(input: &PostPatch) -> Result<(), AppError> {
    validate_optional_text(input.title.as_deref(), 180, false)?;
    validate_optional_text(input.body.as_deref(), 50_000, true)?;
    if input
        .status
        .as_deref()
        .is_some_and(|v| !matches!(v, "draft" | "published"))
        || input.sort_order.is_some_and(|v| v < 0)
    {
        return Err(invalid("Datos de publicación no válidos."));
    }
    Ok(())
}
fn validate_course(input: &CourseWrite, slug: &str) -> Result<(), AppError> {
    validate_topics(input.sections.as_deref())?;
    if input.name.trim().is_empty()
        || input.name.chars().count() > 180
        || input.short_description.chars().count() > 320
        || input.description.trim().is_empty()
        || input.description.chars().count() > 100_000
        || !valid_course_modality(&input.modality)
        || !valid_course_category(&input.category)
        || input.duration.chars().count() > 120
        || input.introduction.chars().count() > 50_000
        || input.syllabus.chars().count() > 50_000
        || !matches!(input.status.as_str(), "upcoming" | "published")
        || input.sort_order < 0
        || slug.is_empty()
    {
        return Err(invalid("Datos de curso no válidos."));
    }
    Ok(())
}
fn validate_course_patch(input: &CoursePatch) -> Result<(), AppError> {
    if input
        .category
        .as_deref()
        .is_some_and(|value| !valid_course_category(value))
    {
        return Err(invalid("Categoría no válida."));
    }
    validate_topics(input.sections.as_deref())?;
    validate_optional_text(input.duration.as_deref(), 120, false)?;
    if input
        .modality
        .as_deref()
        .is_some_and(|value| !valid_course_modality(value))
    {
        return Err(invalid("Modalidad no válida."));
    }
    validate_optional_text(input.name.as_deref(), 180, true)?;
    validate_optional_text(input.short_description.as_deref(), 320, false)?;
    validate_optional_text(input.description.as_deref(), 100_000, true)?;
    validate_optional_text(input.introduction.as_deref(), 50_000, false)?;
    validate_optional_text(input.syllabus.as_deref(), 50_000, false)?;
    if input
        .status
        .as_deref()
        .is_some_and(|v| !matches!(v, "upcoming" | "published"))
        || input.sort_order.is_some_and(|v| v < 0)
    {
        return Err(invalid("Datos de curso no válidos."));
    }
    Ok(())
}
fn validate_section(title: &str, body: &str, order: i32) -> Result<(), AppError> {
    if title.trim().is_empty()
        || title.chars().count() > 180
        || body.chars().count() > 100_000
        || order < 0
    {
        return Err(invalid("Datos de sección no válidos."));
    }
    Ok(())
}
fn validate_section_patch(input: &SectionPatch) -> Result<(), AppError> {
    validate_optional_text(input.title.as_deref(), 180, true)?;
    validate_optional_text(input.body.as_deref(), 100_000, false)?;
    if input.sort_order.is_some_and(|v| v < 0) {
        return Err(invalid("Orden no válido."));
    }
    Ok(())
}
fn validate_optional_text(value: Option<&str>, max: usize, required: bool) -> Result<(), AppError> {
    if value.is_some_and(|v| v.chars().count() > max || (required && v.trim().is_empty())) {
        return Err(invalid("Texto no válido."));
    }
    Ok(())
}

fn valid_course_category(value: &str) -> bool {
    matches!(value, "easa" | "non_easa" | "instructor" | "other")
}
fn valid_course_modality(value: &str) -> bool {
    matches!(value, "online" | "presencial" | "presencial_online")
}
fn normalize_slug(value: &str) -> Result<String, AppError> {
    let slug = value.trim().to_ascii_lowercase();
    let segment = match slug.split_once('/') {
        Some(("easa" | "no-easa" | "instructor", segment)) => segment,
        Some(_) => return Err(invalid("Ruta de curso no válida.")),
        None => slug.as_str(),
    };
    if segment.is_empty() || slug.len() > 180 || slugify(segment) != segment {
        return Err(invalid(
            "Slug no válido; use letras minúsculas, números y guiones.",
        ));
    }
    Ok(slug)
}
fn slugify(value: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for ch in value.trim().to_lowercase().chars() {
        let mapped = match ch {
            'á' | 'à' | 'ä' | 'â' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            c => c,
        };
        if mapped.is_ascii_alphanumeric() {
            out.push(mapped);
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    out
}
fn map_unique(
    result: Result<sqlx::postgres::PgQueryResult, sqlx::Error>,
) -> Result<sqlx::postgres::PgQueryResult, AppError> {
    match result {
        Err(sqlx::Error::Database(error)) if error.is_unique_violation() => {
            Err(invalid("El slug ya existe."))
        }
        other => other.map_err(Into::into),
    }
}

#[cfg(test)]
mod tests {
    use super::{normalize_slug, slugify, validate_post};
    use serde_json::json;
    #[test]
    fn slug_is_normalized_and_stable() {
        assert_eq!(slugify("  Curso Ágil / STS  "), "curso-agil-sts");
        assert!(normalize_slug("curso-agil-sts").is_ok());
        assert!(normalize_slug("../Curso").is_err());
    }
    #[test]
    fn post_accepts_text_without_images() {
        assert!(validate_post("", "Solo texto", "published", 0).is_ok());
    }
    #[test]
    fn invalid_status_is_rejected() {
        assert!(validate_post("", "Texto", "hidden", 0).is_err());
    }

    #[test]
    fn course_requires_description_and_known_modality() {
        let valid = json!({"name":"Curso","description":"Contenido","modality":"online","category":"other"});
        let mut input: super::CourseWrite = serde_json::from_value(valid.clone()).unwrap();
        assert!(super::validate_course(&input, "curso").is_ok());
        input.description = "   ".into();
        assert!(super::validate_course(&input, "curso").is_err());
        input.description = "Contenido".into();
        input.modality = "hibrido".into();
        assert!(super::validate_course(&input, "curso").is_err());
        assert!(
            serde_json::from_value::<super::CourseWrite>(
                json!({"name":"Curso","description":"Texto"})
            )
            .is_err()
        );
    }

    #[test]
    fn course_topics_reject_empty_titles_and_large_duration() {
        let input: super::CourseWrite = serde_json::from_value(json!({"name":"Curso","description":"Texto","modality":"presencial","category":"other","duration":"x".repeat(121)})).unwrap();
        assert!(super::validate_course(&input, "curso").is_err());
        let sections: Vec<super::SectionWrite> =
            serde_json::from_value(json!([{"title":" \0 ","body":"Texto"}])).unwrap();
        assert!(super::validate_topics(Some(&sections)).is_err());
    }

    #[test]
    fn course_create_and_patch_support_the_same_three_modalities() {
        for modality in [
            "online",
            "presencial",
            "presencial_online",
            "",
            "hybrid",
            "Presencial/Online",
        ] {
            let create: super::CourseWrite = serde_json::from_value(json!({"name":"Curso","description":"Contenido","category":"other","modality":modality})).unwrap();
            let patch: super::CoursePatch =
                serde_json::from_value(json!({"modality":modality})).unwrap();
            let valid = matches!(modality, "online" | "presencial" | "presencial_online");
            assert_eq!(super::validate_course(&create, "curso").is_ok(), valid);
            assert_eq!(super::validate_course_patch(&patch).is_ok(), valid);
        }
    }

    #[test]
    fn course_text_preserves_plain_text_and_removes_controls() {
        assert_eq!(
            super::course_text(" \0Texto\r\nseguro\t \u{7f}"),
            "Texto\nseguro"
        );
    }

    #[test]
    fn generated_course_urls_are_bounded_and_handle_collisions() {
        let id = uuid::Uuid::new_v4();
        let name = "Curso ".repeat(100);
        let first = super::generated_slug(&name, id, false);
        let collision = super::generated_slug(&name, id, true);
        assert!(first.len() <= 180 && collision.len() <= 180);
        assert_ne!(first, collision);
        assert!(super::normalize_slug(&collision).is_ok());
        assert_eq!(super::generated_slug("飞行", id, false), "curso");
    }
    #[test]
    fn course_category_is_required_and_restricted() {
        for category in ["easa", "non_easa", "instructor", "other"] {
            assert!(super::valid_course_category(category));
        }
        for category in ["", "EASA", "arbitrary", "../other"] {
            assert!(!super::valid_course_category(category));
        }
        assert!(
            serde_json::from_value::<super::CourseWrite>(
                json!({"name":"Curso","description":"Texto","modality":"online"})
            )
            .is_err()
        );
    }
    #[test]
    fn legacy_slugs_only_allow_the_established_route_prefixes() {
        assert!(normalize_slug("easa/sts-01").is_ok());
        assert!(normalize_slug("no-easa/en01").is_ok());
        assert!(normalize_slug("instructor/continua").is_ok());
        for slug in [
            "../sts",
            "unknown/sts",
            "easa/../sts",
            "easa/a/b",
            "easa/",
            "/easa/sts",
            "easa/a%2fb",
        ] {
            assert!(normalize_slug(slug).is_err());
        }
    }
}
