use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres};
use uuid::Uuid;

use crate::{
    AppState,
    auth::{Claims, authenticate, require_role},
    error::AppError,
};

#[derive(Debug, Deserialize)]
pub struct AccessToggle {
    alumno_id: Option<Uuid>,
    #[serde(rename = "type")]
    item_type: Option<String>,
    item_id: Option<Uuid>,
    acceso: Option<bool>,
    #[serde(default)]
    motivo: String,
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(student_id): Path<Uuid>,
) -> Result<Json<Value>, AppError> {
    let claims = staff(&state, &headers)?;
    let pool = pool(&state)?;
    let student = student_for_staff(pool, &claims, student_id, false).await?;

    let materials = sqlx::query_scalar::<_, Value>(&format!(
        "SELECT jsonb_build_object(\
             'id', m.id, 'titulo', m.titulo, 'descripcion', m.descripcion, \
             'categoria', m.categoria, 'tipo', m.tipo, 'activo', m.activo, \
             'created_date', m.created_date, 'curso', NULL, \
             'acceso', {grant}, \
             'heredado', EXISTS(SELECT 1 FROM materiales_permisoaccesomaterial p \
               WHERE p.alumno_id=$1 AND p.material_id IS NULL AND p.categoria=m.categoria AND NOT p.permitido)) \
         FROM materiales_material m \
         WHERE {} ORDER BY m.categoria, m.titulo",
        crate::academic_scope::resource_scope("m", "subido_por_id", 2, 3),
        grant = crate::academic_scope::material_grant("m", 1)
    ))
    .bind(student_id)
    .bind(&claims.role)
    .bind(claims.profile_id)
    .fetch_all(pool)
    .await?;

    let exams = sqlx::query_scalar::<_, Value>(&format!(
        "SELECT jsonb_build_object(\
             'id', e.id, 'nombre', e.nombre, 'descripcion', e.descripcion, \
             'categoria', e.categoria, 'activo', e.activo, 'created_date', e.created_date, 'curso', NULL, \
             'acceso', {grant}, \
             'heredado', EXISTS(SELECT 1 FROM examenes_bloqueoexamen b \
               WHERE b.alumno_id=$1 AND b.examen_id IS NULL AND b.categoria=e.categoria AND b.bloqueado \
                 AND (b.fecha_inicio IS NULL OR b.fecha_inicio<=NOW()) AND (b.fecha_fin IS NULL OR b.fecha_fin>NOW()))) \
         FROM examenes_examen e \
         WHERE {} ORDER BY e.categoria, e.nombre",
        crate::academic_scope::resource_scope("e", "creado_por_id", 2, 3),
        grant = crate::academic_scope::exam_grant("e", 1)
    ))
    .bind(student_id)
    .bind(&claims.role)
    .bind(claims.profile_id)
    .fetch_all(pool)
    .await?;

    Ok(Json(json!({
        "alumno": {"id": student_id, "nombre": state.cipher.decrypt(&student.0)?, "apellidos": state.cipher.decrypt(&student.1)?},
        "materiales": materials,
        "examenes": exams,
    })))
}

pub async fn toggle(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(input): Json<AccessToggle>,
) -> Result<Json<Value>, AppError> {
    let claims = staff(&state, &headers)?;
    let (student_id, item_type, item_id, access) = validate_toggle(&input)?;
    let mut transaction = pool(&state)?.begin().await?;
    student_for_staff(&mut *transaction, &claims, student_id, true).await?;
    let (category, published) =
        crate::academic_scope::staff_resource(&mut *transaction, &claims, item_type, item_id, true)
            .await?;
    if !published {
        return Err(AppError::Validation("El recurso no está publicado.".into()));
    }
    let inherited_statement = match item_type {
        "material" => {
            "SELECT EXISTS(SELECT 1 FROM materiales_permisoaccesomaterial WHERE alumno_id=$1 AND material_id IS NULL AND categoria=$2 AND NOT permitido)"
        }
        _ => {
            "SELECT EXISTS(SELECT 1 FROM examenes_bloqueoexamen WHERE alumno_id=$1 AND examen_id IS NULL AND categoria=$2 AND bloqueado AND (fecha_inicio IS NULL OR fecha_inicio<=NOW()) AND (fecha_fin IS NULL OR fecha_fin>NOW()))"
        }
    };
    let inherited: bool = sqlx::query_scalar(inherited_statement)
        .bind(student_id)
        .bind(&category)
        .fetch_one(&mut *transaction)
        .await?;
    if inherited {
        return Err(AppError::Validation(
            "El bloqueo heredado de categoría no se puede modificar individualmente.".into(),
        ));
    }

    // Serializa cambios sobre el mismo alumno/item. La tabla de permisos legacy no
    // posee una restriccion unica y un update_or_create concurrente podria duplicar filas.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!(
            "instructor-access:{student_id}:{item_type}:{item_id}"
        ))
        .execute(&mut *transaction)
        .await?;

    let (instance_id, action, model_name) = match item_type {
        "material" => {
            let existing: Option<Uuid> = sqlx::query_scalar(
                "SELECT id FROM materiales_permisoaccesomaterial \
                 WHERE alumno_id=$1 AND material_id=$2 \
                 ORDER BY updated_date DESC, created_date DESC LIMIT 1 FOR UPDATE",
            )
            .bind(student_id)
            .bind(item_id)
            .fetch_optional(&mut *transaction)
            .await?;
            let id = existing.unwrap_or_else(Uuid::new_v4);
            if existing.is_some() {
                sqlx::query(
                    "UPDATE materiales_permisoaccesomaterial SET categoria=$2, permitido=$3, \
                     concedido_por_id=$4, motivo=$5, updated_date=NOW() WHERE id=$1",
                )
                .bind(id)
                .bind(category)
                .bind(access)
                .bind(claims.profile_id)
                .bind(input.motivo.trim())
                .execute(&mut *transaction)
                .await?;
            } else {
                sqlx::query(
                    "INSERT INTO materiales_permisoaccesomaterial \
                     (id,created_date,updated_date,categoria,permitido,motivo,alumno_id,concedido_por_id,material_id) \
                     VALUES ($1,NOW(),NOW(),$2,$3,$4,$5,$6,$7)",
                )
                .bind(id)
                .bind(category)
                .bind(access)
                .bind(input.motivo.trim())
                .bind(student_id)
                .bind(claims.profile_id)
                .bind(item_id)
                .execute(&mut *transaction)
                .await?;
            }
            (id, "toggle_acceso_material", "PermisoAccesoMaterial")
        }
        "examen" => {
            let id = Uuid::new_v4();
            let saved_id: Uuid = sqlx::query_scalar(
                "INSERT INTO examenes_bloqueoexamen \
                 (id,created_date,updated_date,categoria,motivo,bloqueado,fecha_inicio,fecha_fin,alumno_id,creado_por_id,examen_id) \
                 VALUES ($1,NOW(),NOW(),$2,$3,$4,NULL,NULL,$5,$6,$7) \
                 ON CONFLICT (alumno_id,examen_id) WHERE examen_id IS NOT NULL DO UPDATE SET \
                 categoria=EXCLUDED.categoria,motivo=EXCLUDED.motivo,bloqueado=EXCLUDED.bloqueado,\
                 creado_por_id=EXCLUDED.creado_por_id,fecha_inicio=NULL,fecha_fin=NULL,updated_date=NOW() RETURNING id",
            )
            .bind(id)
            .bind(category)
            .bind(input.motivo.trim())
            .bind(!access)
            .bind(student_id)
            .bind(claims.profile_id)
            .bind(item_id)
            .fetch_one(&mut *transaction)
            .await?;
            (saved_id, "toggle_acceso_examen", "BloqueoExamen")
        }
        _ => unreachable!("validated item type"),
    };

    let extra = match item_type {
        "material" => json!({"alumno_id":student_id,"material_id":item_id,"acceso":access}),
        _ => json!({"alumno_id":student_id,"examen_id":item_id,"acceso":access}),
    };
    sqlx::query(
        "INSERT INTO core_auditlog \
         (id,created_date,updated_date,model_name,instance_id,action,extra,profile_id) \
         VALUES ($1,NOW(),NOW(),$2,$3,$4,$5,$6)",
    )
    .bind(Uuid::new_v4())
    .bind(model_name)
    .bind(instance_id.to_string())
    .bind(action)
    .bind(extra)
    .bind(claims.profile_id)
    .execute(&mut *transaction)
    .await?;
    transaction.commit().await?;

    Ok(Json(json!({
        "alumno_id": student_id,
        "type": item_type,
        "item_id": item_id,
        "acceso": access,
    })))
}

fn validate_toggle(input: &AccessToggle) -> Result<(Uuid, &str, Uuid, bool), AppError> {
    let student = input.alumno_id.ok_or_else(|| {
        AppError::Validation("alumno_id, type e item_id son obligatorios.".to_owned())
    })?;
    let item = input.item_id.ok_or_else(|| {
        AppError::Validation("alumno_id, type e item_id son obligatorios.".to_owned())
    })?;
    let item_type = input.item_type.as_deref().ok_or_else(|| {
        AppError::Validation("alumno_id, type e item_id son obligatorios.".to_owned())
    })?;
    if !matches!(item_type, "material" | "examen") {
        return Err(AppError::Validation(
            "type debe ser material o examen.".to_owned(),
        ));
    }
    let access = input
        .acceso
        .ok_or_else(|| AppError::Validation("acceso debe ser un booleano.".to_owned()))?;
    if input.motivo.chars().count() > 2_000 {
        return Err(AppError::Validation("motivo demasiado largo.".to_owned()));
    }
    Ok((student, item_type, item, access))
}

fn staff(state: &AppState, headers: &HeaderMap) -> Result<Claims, AppError> {
    let claims = authenticate(state, headers, "access")?;
    require_role(&claims, &["admin", "instructor"])?;
    Ok(claims)
}

async fn student_for_staff<'e, E>(
    executor: E,
    claims: &Claims,
    student_id: Uuid,
    lock: bool,
) -> Result<(String, String), AppError>
where
    E: sqlx::Executor<'e, Database = Postgres>,
{
    let statement = format!(
        "SELECT nombre,apellidos,assigned_instructor_id FROM accounts_userprofile \
         WHERE id=$1 AND (role='alumno' OR roles ? 'alumno'){}",
        if lock { " FOR UPDATE" } else { "" }
    );
    let row: Option<(String, String, Option<Uuid>)> = sqlx::query_as(&statement)
        .bind(student_id)
        .fetch_optional(executor)
        .await?;
    let (name, surname, assigned) = row.ok_or(AppError::NotFound)?;
    if claims.role == "instructor" && assigned != Some(claims.profile_id) {
        return Err(AppError::Forbidden);
    }
    Ok((name, surname))
}

fn pool(state: &AppState) -> Result<&PgPool, AppError> {
    state.pool.as_ref().ok_or(AppError::Unavailable)
}

#[cfg(test)]
mod tests {
    use super::{AccessToggle, validate_toggle};
    use uuid::Uuid;

    fn valid(item_type: &str) -> AccessToggle {
        AccessToggle {
            alumno_id: Some(Uuid::new_v4()),
            item_type: Some(item_type.to_owned()),
            item_id: Some(Uuid::new_v4()),
            acceso: Some(true),
            motivo: String::new(),
        }
    }

    #[test]
    fn toggle_accepts_only_known_resource_types() {
        assert!(validate_toggle(&valid("material")).is_ok());
        assert!(validate_toggle(&valid("examen")).is_ok());
        assert!(validate_toggle(&valid("perfil")).is_err());
    }

    #[test]
    fn toggle_requires_explicit_boolean_and_bounded_reason() {
        let mut input = valid("material");
        input.acceso = None;
        assert!(validate_toggle(&input).is_err());
        input.acceso = Some(false);
        input.motivo = "x".repeat(2_001);
        assert!(validate_toggle(&input).is_err());
    }
}
