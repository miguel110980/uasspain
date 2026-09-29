#!/usr/bin/env bash
# =============================================================================
# UASSPAIN — PostgreSQL 18 Server Setup (Docker mode)
# =============================================================================
# Deploys PostgreSQL 18 in Docker with persistent volumes, secure config,
# WireGuard-only access, and proper user/role management.
#
# Usage: ./infra/postgresql/setup-docker.sh [--dry-run]
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$ROOT_DIR/infra/config.sh"

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

step()  { echo -e "\n\033[0;36m==> $1\033[0m"; }
ok()    { echo -e "    \033[0;32mOK: $1\033[0m"; }
warn()  { echo -e "    \033[0;33mAVISO: $1\033[0m"; }
fail()  { echo -e "    \033[0;31mERROR: $1\033[0m"; exit 1; }
run()   { if $DRY_RUN; then echo "  [dry-run] $*"; else "$@"; fi; }

step "Deploying PostgreSQL 18 (Docker mode)"

# ─── Validate secrets exist ──────────────────────────────────────
SECRETS_DIR="$ROOT_DIR/.secrets"
for secret in db_password; do
    if [[ ! -f "$SECRETS_DIR/$secret" ]]; then
        fail "Missing secret: $SECRETS_DIR/$secret — run generate-secrets.sh first"
    fi
done

# ─── Create Docker network ───────────────────────────────────────
step "Creating Docker network..."
run docker network create --driver bridge --subnet 10.50.0.0/24 uasspain-wg-net 2>/dev/null || ok "Network exists"

# ─── Create volumes ──────────────────────────────────────────────
step "Creating Docker volumes..."
run docker volume create uasspain-pgdata 2>/dev/null || ok "Volume exists"

# ─── Write PostgreSQL custom config ──────────────────────────────
step "Writing PostgreSQL configuration..."
PG_CONF_DIR="$ROOT_DIR/infra/postgresql/conf"
mkdir -p "$PG_CONF_DIR"

cat > "$PG_CONF_DIR/postgresql.conf" <<EOF
# =============================================================================
# UASSPAIN — PostgreSQL 18 Configuration
# =============================================================================

# Connection
listen_addresses = '$SERVER2_VPN_IP'
port = $PG_PORT
max_connections = $PG_MAX_CONNECTIONS

# Authentication
password_encryption = scram-sha-256

# Memory
shared_buffers = $PG_SHARED_BUFFERS
effective_cache_size = $PG_EFFECTIVE_CACHE_SIZE
work_mem = $PG_WORK_MEM
maintenance_work_mem = $PG_MAINTENANCE_WORK_MEM

# WAL
wal_buffers = '16MB'
checkpoint_completion_target = 0.9
wal_compression = on

# Logging
log_connections = on
log_disconnections = on
log_line_prefix = '%t [%p]: user=%u,db=%d '
log_min_duration_statement = 1000

# Security
ssl = off
statement_timeout = ${PG_STATEMENT_TIMEOUT_MS}ms

# Performance
random_page_cost = 1.1
effective_io_concurrency = 200
EOF

cat > "$PG_CONF_DIR/pg_hba.conf" <<EOF
# =============================================================================
# UASSPAIN — PostgreSQL 18 Client Authentication
# =============================================================================
# TYPE  DATABASE  USER          ADDRESS           METHOD

# Local connections (admin)
local   all       postgres                        peer

# Application user via WireGuard only
host    $PG_DATABASE  $PG_USER_APP     $SERVER1_VPN_IP/32   scram-sha-256

# Migrate user via WireGuard only
host    $PG_DATABASE  $PG_USER_MIGRATE $SERVER1_VPN_IP/32   scram-sha-256

# Backup servers via WireGuard only (pg_dump/restore)
host    $PG_DATABASE  $PG_USER_APP     $BACKUP1_VPN_IP/32   scram-sha-256
host    $PG_DATABASE  $PG_USER_APP     $BACKUP2_VPN_IP/32   scram-sha-256
host    $PG_DATABASE  $PG_USER_APP     $BACKUP3_VPN_IP/32   scram-sha-256

# Reject all other connections
host    all       all           0.0.0.0/0         reject
EOF

ok "PostgreSQL config written"

# ─── Write init script ───────────────────────────────────────────
step "Writing database initialization script..."

# Generate strong random passwords for database users
APP_USER_PASS=$(openssl rand -base64 24)
MIGRATE_USER_PASS=$(openssl rand -base64 24)

# Store generated passwords in secrets directory
SECRETS_DIR="$ROOT_DIR/.secrets"
mkdir -p "$SECRETS_DIR"
echo -n "$APP_USER_PASS" > "$SECRETS_DIR/pg_app_password"
echo -n "$MIGRATE_USER_PASS" > "$SECRETS_DIR/pg_migrate_password"
chmod 600 "$SECRETS_DIR/pg_app_password" "$SECRETS_DIR/pg_migrate_password"

cat > "$PG_CONF_DIR/init.sql" <<EOF
-- =============================================================================
-- UASSPAIN — PostgreSQL 18 Initialization
-- =============================================================================
-- Passwords are generated randomly and stored in .secrets/pg_*_password
-- NEVER use default or hardcoded passwords in production!

-- Create application user (minimal privileges)
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$PG_USER_APP') THEN
        CREATE ROLE $PG_USER_APP WITH LOGIN PASSWORD '$APP_USER_PASS';
    END IF;
END
\$\$;

-- Create migration user
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$PG_USER_MIGRATE') THEN
        CREATE ROLE $PG_USER_MIGRATE WITH LOGIN PASSWORD '$MIGRATE_USER_PASS' CREATEDB;
    END IF;
END
\$\$;

-- Create database
SELECT 'CREATE DATABASE $PG_DATABASE OWNER $PG_USER_MIGRATE'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$PG_DATABASE')\gexec

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE $PG_DATABASE TO $PG_USER_MIGRATE;
GRANT CONNECT ON DATABASE $PG_DATABASE TO $PG_USER_APP;
GRANT USAGE ON SCHEMA public TO $PG_USER_APP;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO $PG_USER_APP;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO $PG_USER_APP;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO $PG_USER_APP;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO $PG_USER_APP;
EOF

ok "Init script written"

# ─── Write docker-compose.yml ────────────────────────────────────
step "Writing docker-compose.yml..."
cat > "$ROOT_DIR/infra/postgresql/docker-compose.yml" <<EOF
# =============================================================================
# UASSPAIN — PostgreSQL 18 (Standalone Docker)
# =============================================================================
services:
  postgres:
    image: postgres:18.3-alpine
    container_name: uasspain-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: $PG_DATABASE
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
      PGDATA: /var/lib/postgresql/data/pgdata
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./conf/postgresql.conf:/etc/postgresql/postgresql.conf:ro
      - ./conf/pg_hba.conf:/etc/postgresql/pg_hba.conf:ro
      - ./conf/init.sql:/docker-entrypoint-initdb.d/01-init.sql:ro
    command: postgres -c config_file=/etc/postgresql/postgresql.conf -c hba_file=/etc/postgresql/pg_hba.conf
    ports:
      - "127.0.0.1:$PG_PORT:$PG_PORT"
    networks:
      - uasspain-wg-net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d $PG_DATABASE"]
      interval: 5s
      timeout: 5s
      retries: 10
    deploy:
      resources:
        limits:
          memory: 2g
          cpus: "2.0"
    secrets:
      - db_password
    security_opt:
      - no-new-privileges:true

networks:
  uasspain-wg-net:
    external: true

volumes:
  pgdata:
    driver: local

secrets:
  db_password:
    file: ../../.secrets/db_password
EOF

ok "docker-compose.yml written"

# ─── Deploy ──────────────────────────────────────────────────────
step "Starting PostgreSQL..."
run bash -c 'cd "'"$ROOT_DIR"'/infra/postgresql" && docker compose up -d'

# ─── Wait for healthy ────────────────────────────────────────────
step "Waiting for PostgreSQL to become healthy..."
MAX_WAIT=60
WAITED=0
while [[ $WAITED -lt $MAX_WAIT ]]; do
    if docker inspect --format='{{.State.Health.Status}}' uasspain-postgres 2>/dev/null | grep -q "healthy"; then
        ok "PostgreSQL is healthy"
        break
    fi
    sleep 2
    WAITED=$((WAITED + 2))
    echo -n "."
done
if [[ $WAITED -ge $MAX_WAIT ]]; then
    warn "PostgreSQL health check timed out after ${MAX_WAIT}s"
fi

echo ""
ok "PostgreSQL 18 deployed (Docker mode)"
echo ""
echo "  Connection: $(hostname -I | awk '{print $1}'):$PG_PORT"
echo "  Database:   $PG_DATABASE"
echo "  Users:      $PG_USER_APP, $PG_USER_MIGRATE"
echo "  Config:     $ROOT_DIR/infra/postgresql/"
echo ""
