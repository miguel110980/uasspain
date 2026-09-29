use std::time::Duration;

use sqlx::{
    PgPool,
    postgres::{PgConnectOptions, PgPoolOptions, PgSslMode},
};

use crate::{error::AppError, security::FieldCipher};

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

pub async fn connect_from_env() -> Result<Option<PgPool>, AppError> {
    let Some(url) = database_url() else {
        return Ok(None);
    };
    if let Some(migration_url) = migration_database_url() {
        let migration_pool = create_pool(&migration_url, 2, 0).await?;
        run_migrations(&migration_pool).await?;
        migration_pool.close().await;
    }
    let pool = create_pool(&url, env_u32("DB_POOL_MAX", 20), env_u32("DB_POOL_MIN", 1)).await?;
    if migration_database_url().is_none() {
        // Compatibilidad para desarrollo/E2E: si no hay credencial de migrador,
        // el rol de runtime conserva el comportamiento histórico.
        run_migrations(&pool).await?;
    }
    Ok(Some(pool))
}

async fn create_pool(
    url: &str,
    max_connections: u32,
    min_connections: u32,
) -> Result<PgPool, AppError> {
    let mut options: PgConnectOptions = url.parse().map_err(|_| AppError::Unavailable)?;
    let ssl_mode = std::env::var("DB_SSLMODE").unwrap_or_else(|_| "prefer".to_owned());
    options = options.ssl_mode(match ssl_mode.as_str() {
        "disable" => PgSslMode::Disable,
        "require" => PgSslMode::Require,
        "verify-ca" => PgSslMode::VerifyCa,
        "verify-full" => PgSslMode::VerifyFull,
        _ => PgSslMode::Prefer,
    });
    if let Ok(root) = std::env::var("DB_SSLROOTCERT") {
        options = options.ssl_root_cert(root);
    }
    let pool = PgPoolOptions::new()
        .max_connections(max_connections)
        .min_connections(min_connections)
        .acquire_timeout(Duration::from_secs(env_u64("DB_CONNECT_TIMEOUT", 10)))
        .idle_timeout(Duration::from_secs(600))
        .connect_with(options)
        .await?;
    Ok(pool)
}

async fn run_migrations(pool: &PgPool) -> Result<(), AppError> {
    let schema_exists: bool =
        sqlx::query_scalar("SELECT to_regclass('public.accounts_userprofile') IS NOT NULL")
            .fetch_one(pool)
            .await?;
    if schema_exists {
        baseline_existing_schema(pool).await?;
    }
    MIGRATOR.run(pool).await.map_err(|error| {
        tracing::error!(%error, "database migration failed");
        AppError::Unavailable
    })
}

async fn baseline_existing_schema(pool: &PgPool) -> Result<(), AppError> {
    const REQUIRED_TABLES: &[&str] = &[
        "auth_user",
        "accounts_userprofile",
        "backups_backupconfig",
        "backups_backupjob",
        "backups_backupserver",
        "conexiones_conexion",
        "conexiones_mensaje",
        "conexiones_mensajestaff",
        "conexiones_registroconexion",
        "conexiones_videollamada",
        "core_auditlog",
        "core_systemsetting",
        "examenes_archivoexamen",
        "examenes_bloqueoexamen",
        "examenes_examen",
        "examenes_pregunta",
        "examenes_resultadoexamen",
        "examenes_resultadopractico",
        "materiales_material",
        "materiales_materialcompletado",
        "materiales_permisoaccesomaterial",
        "materiales_publicacionboe",
    ];
    let compatible: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM unnest($1::text[]) AS required(name) WHERE to_regclass('public.' || required.name) IS NOT NULL",
    )
    .bind(REQUIRED_TABLES)
    .fetch_one(pool)
    .await?;
    if compatible != i64::try_from(REQUIRED_TABLES.len()).unwrap_or_default() {
        tracing::error!(
            compatible,
            required = REQUIRED_TABLES.len(),
            "existing database schema is incomplete"
        );
        return Err(AppError::Unavailable);
    }
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS _sqlx_migrations (version BIGINT PRIMARY KEY, description TEXT NOT NULL, installed_on TIMESTAMPTZ NOT NULL DEFAULT NOW(), success BOOLEAN NOT NULL, checksum BYTEA NOT NULL, execution_time BIGINT NOT NULL)",
    )
    .execute(pool)
    .await?;
    // La base heredada equivale únicamente al esquema inicial. Las migraciones
    // posteriores deben ejecutarse normalmente también en instalaciones existentes.
    for migration in MIGRATOR.iter().filter(|migration| migration.version == 1) {
        sqlx::query(
            "INSERT INTO _sqlx_migrations (version,description,success,checksum,execution_time) VALUES ($1,$2,TRUE,$3,0) ON CONFLICT (version) DO NOTHING",
        )
        .bind(migration.version)
        .bind(&*migration.description)
        .bind(&*migration.checksum)
        .execute(pool)
        .await?;
    }
    Ok(())
}

pub async fn ensure_bootstrap_admin(pool: &PgPool, cipher: &FieldCipher) -> Result<(), AppError> {
    if !env_bool("BOOTSTRAP_ADMIN_ENABLED", false) {
        return Ok(());
    }
    let email = std::env::var("BOOTSTRAP_ADMIN_EMAIL")
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    let password = read_secret("BOOTSTRAP_ADMIN_PASSWORD", "BOOTSTRAP_ADMIN_PASSWORD_FILE")
        .ok_or(AppError::Unavailable)?;
    let username = std::env::var("BOOTSTRAP_ADMIN_USERNAME")
        .unwrap_or_else(|_| "admin".into())
        .trim()
        .to_owned();
    let nombre =
        std::env::var("BOOTSTRAP_ADMIN_FIRST_NAME").unwrap_or_else(|_| "Administrador".into());
    let apellidos = std::env::var("BOOTSTRAP_ADMIN_LAST_NAME").unwrap_or_else(|_| "Sistema".into());
    let dni = std::env::var("BOOTSTRAP_ADMIN_DNI").unwrap_or_default();
    let birth = std::env::var("BOOTSTRAP_ADMIN_BIRTH_DATE").unwrap_or_default();
    if email.is_empty() || !email.contains('@') || username.is_empty() {
        tracing::error!("BOOTSTRAP_ADMIN_EMAIL or BOOTSTRAP_ADMIN_USERNAME is invalid");
        return Err(AppError::Unavailable);
    }
    crate::registration::validate_password(&password, &username, &email, &dni)?;
    let email_lookup = cipher.blind_index(&email)?;
    let existing: Option<(uuid::Uuid, i32)> = sqlx::query_as(
        "SELECT id,user_id FROM accounts_userprofile WHERE email_lookup=$1 AND user_id IS NOT NULL LIMIT 1",
    )
    .bind(&email_lookup)
    .fetch_optional(pool)
    .await?;
    if let Some((profile_id, user_id)) = existing {
        let mut tx = pool.begin().await?;
        sqlx::query(
            "UPDATE auth_user SET is_superuser=TRUE,is_staff=TRUE,is_active=TRUE WHERE id=$1",
        )
        .bind(user_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query("UPDATE accounts_userprofile SET status='activo',role='admin',roles='[\"admin\"]'::jsonb,otp_verified=TRUE,updated_date=NOW() WHERE id=$1")
            .bind(profile_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        return Ok(());
    }
    let password_hash = crate::registration::hash_argon2(&password)?;
    let profile_id = uuid::Uuid::new_v4();
    let opaque_username = format!("u_{}", uuid::Uuid::new_v4().simple());
    let opaque_email = format!("user-{profile_id}@internal.uasspain.local");
    let username_lookup = cipher.blind_index(&username.to_lowercase())?;
    let dni_lookup = if dni.trim().is_empty() {
        String::new()
    } else {
        cipher.blind_index(&dni.trim().to_uppercase())?
    };
    let mut tx = pool.begin().await?;
    let user_id: i32 = sqlx::query_scalar("INSERT INTO auth_user (password,last_login,is_superuser,username,first_name,last_name,email,is_staff,is_active,date_joined) VALUES ($1,NULL,TRUE,$2,'','',$3,TRUE,TRUE,NOW()) RETURNING id")
        .bind(password_hash)
        .bind(opaque_username)
        .bind(opaque_email)
        .fetch_one(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO accounts_userprofile (id,created_date,updated_date,nombre,apellidos,email,username,dni_nie,foto_perfil,status,role,otp_hash,otp_verified,user_id,roles,username_lookup,email_lookup,dni_lookup,fecha_nacimiento,active_session_key,login_otp_created_at,login_otp_hash,login_2fa_enabled_override,session_role,assigned_instructor_id) VALUES ($1,NOW(),NOW(),$2,$3,$4,$5,$6,'','activo','admin','',TRUE,$7,'[\"admin\"]'::jsonb,$8,$9,$10,$11,'',NULL,'',NULL,'',NULL)")
        .bind(profile_id)
        .bind(cipher.encrypt(nombre.trim())?)
        .bind(cipher.encrypt(apellidos.trim())?)
        .bind(cipher.encrypt(&email)?)
        .bind(cipher.encrypt(&username)?)
        .bind(cipher.encrypt(dni.trim())?)
        .bind(user_id)
        .bind(username_lookup)
        .bind(email_lookup)
        .bind(dni_lookup)
        .bind(cipher.encrypt(birth.trim())?)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    tracing::info!(%profile_id, "bootstrap administrator created");
    Ok(())
}

fn database_url() -> Option<String> {
    if let Ok(url) = std::env::var("DATABASE_URL") {
        return Some(url);
    }
    let host = std::env::var("DB_HOST").ok()?;
    let port = std::env::var("DB_PORT").unwrap_or_else(|_| "5432".to_owned());
    let name = std::env::var("DB_NAME").unwrap_or_else(|_| "uasspain".to_owned());
    let user = std::env::var("DB_USER").unwrap_or_else(|_| "uasspain".to_owned());
    let password = read_secret("DB_PASSWORD", "DB_PASSWORD_FILE")?;
    Some(format!(
        "postgres://{}:{}@{host}:{port}/{}",
        percent(&user),
        percent(&password),
        percent(&name)
    ))
}

fn migration_database_url() -> Option<String> {
    if let Ok(url) = std::env::var("DB_MIGRATION_URL") {
        return (!url.trim().is_empty()).then_some(url);
    }
    let user = std::env::var("DB_MIGRATION_USER").ok()?;
    let password = read_secret("DB_MIGRATION_PASSWORD", "DB_MIGRATION_PASSWORD_FILE")?;
    database_url_for(&user, &password)
}

fn database_url_for(user: &str, password: &str) -> Option<String> {
    let host = std::env::var("DB_HOST").ok()?;
    let port = std::env::var("DB_PORT").unwrap_or_else(|_| "5432".to_owned());
    let name = std::env::var("DB_NAME").unwrap_or_else(|_| "uasspain".to_owned());
    Some(format!(
        "postgres://{}:{}@{host}:{port}/{}",
        percent(user),
        percent(password),
        percent(&name)
    ))
}

fn read_secret(value: &str, file: &str) -> Option<String> {
    std::env::var(value)
        .ok()
        .filter(|v| !v.is_empty())
        .or_else(|| {
            std::env::var(file)
                .ok()
                .and_then(|path| std::fs::read_to_string(path).ok())
                .map(|v| v.trim().to_owned())
        })
}
fn percent(value: &str) -> String {
    value
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
                char::from(b).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}
fn env_u32(name: &str, fallback: u32) -> u32 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(fallback)
}
fn env_u64(name: &str, fallback: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(fallback)
}
fn env_bool(name: &str, fallback: bool) -> bool {
    std::env::var(name).ok().map_or(fallback, |value| {
        matches!(value.to_lowercase().as_str(), "1" | "true" | "yes")
    })
}
