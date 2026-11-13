use sqlx::Postgres;
use uuid::Uuid;

use crate::{auth::Claims, error::AppError};

// Legacy resources without an author and administrator-authored resources form
// the shared catalog. An instructor's resources belong to that instructor and
// their assigned students. All arguments here are static SQL identifiers.
pub(crate) fn resource_scope(alias: &str, author: &str, role: usize, profile: usize) -> String {
    include_str!("academic_resource_scope.sql")
        .replace("__ROLE__", &format!("${role}"))
        .replace("__PROFILE__", &format!("${profile}"))
        .replace("__ALIAS__", alias)
        .replace("__AUTHOR__", author)
}

pub(crate) fn exam_access(alias: &str, role: usize, profile: usize) -> String {
    format!(
        "(${role}::text<>'alumno' OR ({}))",
        exam_grant(alias, profile)
    )
}

pub(crate) fn exam_grant(alias: &str, profile: usize) -> String {
    format!(
        "{alias}.activo AND EXISTS(SELECT 1 FROM examenes_bloqueoexamen g \
         WHERE g.alumno_id=${profile} AND NOT g.bloqueado \
         AND (g.fecha_inicio IS NULL OR g.fecha_inicio<=NOW()) \
         AND (g.fecha_fin IS NULL OR g.fecha_fin>NOW()) \
         AND (g.examen_id={alias}.id OR (g.examen_id IS NULL AND g.categoria={alias}.categoria))) \
         AND NOT EXISTS(SELECT 1 \
         FROM examenes_bloqueoexamen b WHERE b.alumno_id=${profile} AND b.bloqueado \
         AND (b.fecha_inicio IS NULL OR b.fecha_inicio<=NOW()) \
         AND (b.fecha_fin IS NULL OR b.fecha_fin>NOW()) \
         AND (b.examen_id={alias}.id OR (b.examen_id IS NULL AND b.categoria={alias}.categoria)))"
    )
}

pub(crate) fn material_grant(alias: &str, profile: usize) -> String {
    format!(
        "{alias}.activo AND EXISTS(SELECT 1 FROM materiales_permisoaccesomaterial g \
        WHERE g.alumno_id=${profile} AND g.permitido \
        AND (g.material_id={alias}.id OR (g.material_id IS NULL AND g.categoria={alias}.categoria))) \
        AND NOT EXISTS(SELECT 1 FROM materiales_permisoaccesomaterial b \
        WHERE b.alumno_id=${profile} AND NOT b.permitido \
        AND (b.material_id={alias}.id OR (b.material_id IS NULL AND b.categoria={alias}.categoria)))"
    )
}

pub(crate) fn material_access(alias: &str, role: usize, profile: usize) -> String {
    format!(
        "(${role}::text<>'alumno' OR ({}))",
        material_grant(alias, profile)
    )
}

// Publication controls catalog visibility; personal grants control content.
// resource_scope still excludes private resources belonging to another instructor.
pub(crate) fn material_listing_scope(alias: &str, role: usize) -> String {
    format!("(${role}::text<>'alumno' OR {alias}.activo)")
}

pub(crate) async fn staff_resource<'e, E>(
    executor: E,
    claims: &Claims,
    item_type: &str,
    id: Uuid,
    lock: bool,
) -> Result<(String, bool), AppError>
where
    E: sqlx::Executor<'e, Database = Postgres>,
{
    let (table, author) = match item_type {
        "material" => ("materiales_material", "subido_por_id"),
        "examen" => ("examenes_examen", "creado_por_id"),
        _ => return Err(AppError::Validation("Tipo de recurso no válido.".into())),
    };
    let statement = format!(
        "SELECT r.categoria,r.activo FROM {table} r WHERE r.id=$1 AND {}{}",
        resource_scope("r", author, 2, 3),
        if lock { " FOR SHARE OF r" } else { "" }
    );
    sqlx::query_as(&statement)
        .bind(id)
        .bind(&claims.role)
        .bind(claims.profile_id)
        .fetch_optional(executor)
        .await?
        .ok_or(AppError::NotFound)
}
