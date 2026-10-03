-- Only mounted by docker-compose.e2e.yml into its fresh isolated cluster.
-- Reproduce production's privilege boundary; credentials are fixture-only.
\getenv fixture_password POSTGRES_PASSWORD
CREATE ROLE uasspain_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'fixture_password';
CREATE ROLE uasspain_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'fixture_password';
CREATE ROLE uasspain_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'fixture_password';
CREATE ROLE uasspain_restore LOGIN NOSUPERUSER CREATEDB NOCREATEROLE NOREPLICATION PASSWORD :'fixture_password';
GRANT uasspain_migrator TO uasspain_restore;
ALTER DATABASE test_e2e_uasspain OWNER TO uasspain_migrator;
ALTER SCHEMA public OWNER TO uasspain_migrator;
REVOKE ALL ON DATABASE test_e2e_uasspain FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE test_e2e_uasspain TO uasspain_app, uasspain_backup, uasspain_restore;
GRANT USAGE ON SCHEMA public TO uasspain_app, uasspain_backup, uasspain_restore;
ALTER DEFAULT PRIVILEGES FOR ROLE uasspain_migrator IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO uasspain_app;
ALTER DEFAULT PRIVILEGES FOR ROLE uasspain_migrator IN SCHEMA public
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO uasspain_app;
ALTER DEFAULT PRIVILEGES FOR ROLE uasspain_migrator IN SCHEMA public
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE uasspain_migrator IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO uasspain_app;
ALTER DEFAULT PRIVILEGES FOR ROLE uasspain_migrator IN SCHEMA public
    GRANT SELECT ON TABLES TO uasspain_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE uasspain_migrator IN SCHEMA public
    GRANT SELECT ON SEQUENCES TO uasspain_backup;
