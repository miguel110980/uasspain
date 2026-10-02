#!/bin/sh
set -eu

read_secret() {
    value=$(cat "/run/secrets/$1")
    if [ -z "$value" ]; then
        echo "FATAL: el secreto $1 está vacío" >&2
        exit 1
    fi
    printf '%s' "$value"
}

export UASSPAIN_APP_PASSWORD="$(read_secret db_app_password)"
export UASSPAIN_MIGRATION_PASSWORD="$(read_secret db_migration_password)"
export UASSPAIN_BACKUP_PASSWORD="$(read_secret db_backup_password)"
export UASSPAIN_RESTORE_PASSWORD="$(read_secret db_restore_password)"
export UASSPAIN_MONITOR_PASSWORD="$(read_secret db_monitor_password)"

psql --set=ON_ERROR_STOP=1 \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --set=owner_role="$POSTGRES_USER" \
    --set=database_name="$POSTGRES_DB" <<'SQL'
\getenv app_password UASSPAIN_APP_PASSWORD
\getenv migration_password UASSPAIN_MIGRATION_PASSWORD
\getenv backup_password UASSPAIN_BACKUP_PASSWORD
\getenv restore_password UASSPAIN_RESTORE_PASSWORD
\getenv monitor_password UASSPAIN_MONITOR_PASSWORD

SELECT format('CREATE ROLE uasspain_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uasspain_app') \gexec
SELECT format('CREATE ROLE uasspain_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'migration_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uasspain_migrator') \gexec
SELECT format('CREATE ROLE uasspain_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'backup_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uasspain_backup') \gexec
SELECT format('CREATE ROLE uasspain_restore LOGIN NOSUPERUSER CREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'restore_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uasspain_restore') \gexec
SELECT format('CREATE ROLE uasspain_monitor LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'monitor_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'uasspain_monitor') \gexec

SELECT format('ALTER ROLE uasspain_app PASSWORD %L', :'app_password') \gexec
SELECT format('ALTER ROLE uasspain_migrator PASSWORD %L', :'migration_password') \gexec
SELECT format('ALTER ROLE uasspain_backup PASSWORD %L', :'backup_password') \gexec
SELECT format('ALTER ROLE uasspain_restore PASSWORD %L', :'restore_password') \gexec
SELECT format('ALTER ROLE uasspain_monitor PASSWORD %L', :'monitor_password') \gexec

-- El rol bootstrap también posee objetos internos; una reasignación global los
-- tocaría. Limitamos el cambio de propietario al esquema de la aplicación.
DO $$
DECLARE item record;
BEGIN
    FOR item IN
        SELECT c.relkind, n.nspname, c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
          AND (
              c.relkind <> 'S'
              OR NOT EXISTS (
                  SELECT 1 FROM pg_depend d
                  WHERE d.classid = 'pg_class'::regclass
                    AND d.objid = c.oid
                    AND d.deptype IN ('a', 'i')
              )
          )
    LOOP
        EXECUTE format(
            'ALTER %s %I.%I OWNER TO uasspain_migrator',
            CASE item.relkind
                WHEN 'S' THEN 'SEQUENCE'
                WHEN 'v' THEN 'VIEW'
                WHEN 'm' THEN 'MATERIALIZED VIEW'
                WHEN 'f' THEN 'FOREIGN TABLE'
                ELSE 'TABLE'
            END,
            item.nspname,
            item.relname
        );
    END LOOP;
    FOR item IN
        SELECT p.oid::regprocedure AS signature
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
    LOOP
        EXECUTE format('ALTER FUNCTION %s OWNER TO uasspain_migrator', item.signature);
    END LOOP;
    FOR item IN
        SELECT n.nspname, t.typname
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
          AND t.typtype IN ('d', 'e')
          AND t.typelem = 0
    LOOP
        EXECUTE format('ALTER TYPE %I.%I OWNER TO uasspain_migrator', item.nspname, item.typname);
    END LOOP;
END
$$;
SELECT format('ALTER DATABASE %I OWNER TO uasspain_migrator', :'database_name') \gexec
ALTER SCHEMA public OWNER TO uasspain_migrator;

REVOKE ALL ON DATABASE :"database_name" FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE uasspain_migrator IN SCHEMA public
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE uasspain_restore IN SCHEMA public
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

GRANT CONNECT ON DATABASE :"database_name" TO uasspain_app, uasspain_backup, uasspain_restore, uasspain_monitor;
GRANT USAGE ON SCHEMA public TO uasspain_app, uasspain_backup, uasspain_restore;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO uasspain_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO uasspain_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO uasspain_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO uasspain_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO uasspain_backup;
GRANT uasspain_migrator TO uasspain_restore;
GRANT pg_monitor TO uasspain_monitor;

ALTER DEFAULT PRIVILEGES FOR ROLE uasspain_migrator IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO uasspain_app;
ALTER DEFAULT PRIVILEGES FOR ROLE uasspain_migrator IN SCHEMA public
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO uasspain_app;
ALTER DEFAULT PRIVILEGES FOR ROLE uasspain_migrator IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO uasspain_app;
ALTER DEFAULT PRIVILEGES FOR ROLE uasspain_migrator IN SCHEMA public
    GRANT SELECT ON TABLES TO uasspain_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE uasspain_migrator IN SCHEMA public
    GRANT SELECT ON SEQUENCES TO uasspain_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE uasspain_restore IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO uasspain_app;
ALTER DEFAULT PRIVILEGES FOR ROLE uasspain_restore IN SCHEMA public
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO uasspain_app;

-- El runtime puede consultar la versión para los manifiestos de backup, pero
-- no alterar el registro de migraciones. En un cluster nuevo aún no existe;
-- el backend aplica la misma restricción inmediatamente después de SQLx.
DO $$
BEGIN
    IF to_regclass('public._sqlx_migrations') IS NOT NULL THEN
        REVOKE INSERT, UPDATE, DELETE ON public._sqlx_migrations FROM uasspain_app;
    END IF;
END
$$;
SQL

unset UASSPAIN_APP_PASSWORD UASSPAIN_MIGRATION_PASSWORD UASSPAIN_BACKUP_PASSWORD \
    UASSPAIN_RESTORE_PASSWORD UASSPAIN_MONITOR_PASSWORD
