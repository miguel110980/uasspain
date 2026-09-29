#!/usr/bin/env bash
# =============================================================================
# UASSPAIN — PostgreSQL 18 Server Setup (Traditional — no Docker)
# =============================================================================
# Installs PostgreSQL 18 directly on the system. For Linux/Ubuntu.
#
# Usage: ./infra/postgresql/setup-traditional.sh [--dry-run]
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

step "Installing PostgreSQL 18 (Traditional mode)"

# ─── Add PostgreSQL repository ───────────────────────────────────
step "Adding PostgreSQL repository..."
if ! grep -q "apt.postgresql.org" /etc/apt/sources.list.d/pgdg.list 2>/dev/null; then
    run sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
    run sudo install -d /usr/share/postgresql-common/pgdg
    run sudo curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
    run sudo tee /etc/apt/sources.list.d/pgdg.list > /dev/null <<PGDGEOF
deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main
PGDGEOF
fi

run sudo apt-get update -qq

# ─── Install PostgreSQL ──────────────────────────────────────────
step "Installing PostgreSQL $PG_VERSION..."
run sudo apt-get install -y -qq postgresql-$PG_VERSION postgresql-client-$PG_VERSION postgresql-contrib-$PG_VERSION

# ─── Stop default cluster ────────────────────────────────────────
step "Configuring PostgreSQL..."
run sudo systemctl stop postgresql

# ─── Configure listen_addresses ──────────────────────────────────
PG_DATA_DIR="/etc/postgresql/$PG_VERSION/main"
PG_CONF="$PG_DATA_DIR/postgresql.conf"
PG_HBA="$PG_DATA_DIR/pg_hba.conf"

# Backup original
run sudo cp "$PG_CONF" "${PG_CONF}.bak"
run sudo cp "$PG_HBA" "${PG_HBA}.bak"

# Configure
run sudo sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '$SERVER2_VPN_IP'/" "$PG_CONF"
run sudo sed -i "s/#port = 5432/port = $PG_PORT/" "$PG_CONF"

# Memory tuning
run sudo sed -i "s/#shared_buffers = '128MB'/shared_buffers = '$PG_SHARED_BUFFERS'/" "$PG_CONF"
run sudo sed -i "s/#effective_cache_size = '4GB'/effective_cache_size = '$PG_EFFECTIVE_CACHE_SIZE'/" "$PG_CONF"
run sudo sed -i "s/#work_mem = '4MB'/work_mem = '$PG_WORK_MEM'/" "$PG_CONF"
run sudo sed -i "s/#maintenance_work_mem = '64MB'/maintenance_work_mem = '$PG_MAINTENANCE_WORK_MEM'/" "$PG_CONF"
run sudo sed -i "s/#max_connections = 100/max_connections = $PG_MAX_CONNECTIONS/" "$PG_CONF"

# Statement timeout
echo "statement_timeout = ${PG_STATEMENT_TIMEOUT_MS}ms" | sudo tee -a "$PG_CONF" > /dev/null

# Logging
run sudo sed -i "s/#log_connections = off/log_connections = on/" "$PG_CONF"
run sudo sed -i "s/#log_disconnections = off/log_disconnections = on/" "$PG_CONF"

# ─── Configure pg_hba.conf ───────────────────────────────────────
step "Configuring client authentication..."
cat > /tmp/pg_hba_uasspain <<EOF
# UASSPAIN — PostgreSQL 18 pg_hba.conf
# TYPE  DATABASE  USER          ADDRESS           METHOD

# Local admin
local   all       postgres                        peer

# Application user via WireGuard
host    $PG_DATABASE  $PG_USER_APP     $SERVER1_VPN_IP/32   scram-sha-256

# Migrate user via WireGuard
host    $PG_DATABASE  $PG_USER_MIGRATE $SERVER1_VPN_IP/32   scram-sha-256

# Backup servers via WireGuard
host    $PG_DATABASE  $PG_USER_APP     $BACKUP1_VPN_IP/32   scram-sha-256
host    $PG_DATABASE  $PG_USER_APP     $BACKUP2_VPN_IP/32   scram-sha-256
host    $PG_DATABASE  $PG_USER_APP     $BACKUP3_VPN_IP/32   scram-sha-256

# Reject all
host    all       all           0.0.0.0/0         reject
EOF

run sudo cp /tmp/pg_hba_uasspain "$PG_HBA"
run sudo chmod 640 "$PG_HBA"
run sudo chown postgres:postgres "$PG_HBA"

# ─── Start PostgreSQL ────────────────────────────────────────────
step "Starting PostgreSQL..."
run sudo systemctl start postgresql
run sudo systemctl enable postgresql

# ─── Create users and database ───────────────────────────────────
step "Creating users and database..."

# Generate random passwords
SECRETS_DIR="$ROOT_DIR/.secrets"
mkdir -p "$SECRETS_DIR"
TRAD_APP_PASS=$(openssl rand -base64 24)
TRAD_MIGRATE_PASS=$(openssl rand -base64 24)
echo -n "$TRAD_APP_PASS" > "$SECRETS_DIR/pg_app_password"
echo -n "$TRAD_MIGRATE_PASS" > "$SECRETS_DIR/pg_migrate_password"
chmod 600 "$SECRETS_DIR/pg_app_password" "$SECRETS_DIR/pg_migrate_password"

sudo -u postgres psql -c "CREATE ROLE $PG_USER_APP WITH LOGIN PASSWORD '$TRAD_APP_PASS';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE ROLE $PG_USER_MIGRATE WITH LOGIN PASSWORD '$TRAD_MIGRATE_PASS' CREATEDB;" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE $PG_DATABASE OWNER $PG_USER_MIGRATE;" 2>/dev/null || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $PG_DATABASE TO $PG_USER_MIGRATE;" 2>/dev/null
sudo -u postgres psql -d "$PG_DATABASE" -c "GRANT USAGE ON SCHEMA public TO $PG_USER_APP;" 2>/dev/null
sudo -u postgres psql -d "$PG_DATABASE" -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO $PG_USER_APP;" 2>/dev/null
sudo -u postgres psql -d "$PG_DATABASE" -c "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO $PG_USER_APP;" 2>/dev/null

ok "Users and database created"

echo ""
ok "PostgreSQL 18 installed (Traditional mode)"
echo ""
echo "  Passwords stored in: $SECRETS_DIR/pg_*_password"
echo "  Rotate passwords after first login."
echo ""
