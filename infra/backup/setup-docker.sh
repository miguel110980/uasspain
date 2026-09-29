#!/usr/bin/env bash
# =============================================================================
# UASSPAIN — Backup Server Setup (Docker mode)
# =============================================================================
# Deploys Samba share for PostgreSQL backups via WireGuard.
#
# Usage: ./infra/backup/setup-docker.sh --server backup1 [--dry-run]
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$ROOT_DIR/infra/config.sh"

TARGET_SERVER="backup1"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --server) TARGET_SERVER="$2"; shift 2 ;;
        --dry-run) DRY_RUN=true; shift ;;
        *) shift ;;
    esac
done

case "$TARGET_SERVER" in
    backup1) SERVER_VPN_IP="$BACKUP1_VPN_IP" ;;
    backup2) SERVER_VPN_IP="$BACKUP2_VPN_IP" ;;
    backup3) SERVER_VPN_IP="$BACKUP3_VPN_IP" ;;
    *) fail "Invalid server: $TARGET_SERVER" ;;
esac

step()  { echo -e "\n\033[0;36m==> $1\033[0m"; }
ok()    { echo -e "    \033[0;32mOK: $1\033[0m"; }
warn()  { echo -e "    \033[0;33mAVISO: $1\033[0m"; }
fail()  { echo -e "    \033[0;31mERROR: $1\033[0m"; exit 1; }
run()   { if $DRY_RUN; then echo "  [dry-run] $*"; else "$@"; fi; }

step "Deploying backup server: $TARGET_SERVER ($SERVER_VPN_IP)"

# ─── Generate SMB password ──────────────────────────────────────
SECRETS_DIR="$ROOT_DIR/.secrets"
mkdir -p "$SECRETS_DIR"
SMB_PASSWORD_FILE="$SECRETS_DIR/smb_password_${TARGET_SERVER}"
if [[ ! -f "$SMB_PASSWORD_FILE" ]]; then
    openssl rand -base64 24 | tr -d '\n' > "$SMB_PASSWORD_FILE"
    chmod 600 "$SMB_PASSWORD_FILE"
    ok "Generated SMB password for $TARGET_SERVER"
fi
SMB_PASSWORD=$(cat "$SMB_PASSWORD_FILE")

# ─── Create backup directory ─────────────────────────────────────
BACKUP_DIR="$ROOT_DIR/infra/backup/data/$TARGET_SERVER"
mkdir -p "$BACKUP_DIR"

# ─── Write Samba config ──────────────────────────────────────────
step "Writing Samba configuration..."
mkdir -p "$ROOT_DIR/infra/backup/conf"
cat > "$ROOT_DIR/infra/backup/conf/smb.conf" <<EOF
[global]
   workgroup = WORKGROUP
   server string = UASSPAIN Backup Server
   security = user
   map to guest = never
   log file = /var/log/samba/log.%m
   max log size = 50

[$BACKUP_SMB_SHARE]
   path = /backups
   browseable = yes
   read only = no
   writable = yes
   valid users = $BACKUP_SMB_USER
   create mask = 0644
   directory mask = 0755
   force user = root
EOF

ok "Samba config written"

# ─── Write docker-compose.yml ────────────────────────────────────
step "Writing docker-compose.yml..."
cat > "$ROOT_DIR/infra/backup/docker-compose.yml" <<EOF
# =============================================================================
# UASSPAIN — Backup Server ($TARGET_SERVER)
# =============================================================================
services:
  samba:
    image: dperson/samba:latest
    container_name: uasspain-backup-${TARGET_SERVER}
    restart: unless-stopped
    environment:
      TZ: Europe/Madrid
    volumes:
      - ./data/${TARGET_SERVER}:/backups
      - ./conf/smb.conf:/etc/samba/smb.conf:ro
    ports:
      - "127.0.0.1:445:445"
      - "127.0.0.1:139:139"
    networks:
      - uasspain-wg-net
    deploy:
      resources:
        limits:
          memory: 256m
          cpus: "0.25"
    security_opt:
      - no-new-privileges:true
    command: >
      -u "$BACKUP_SMB_USER;$SMB_PASSWORD"
      -s "$BACKUP_SMB_SHARE;/backups;yes;no;no;all;$BACKUP_SMB_USER"
      -w WORKGROUP

networks:
  uasspain-wg-net:
    external: true
EOF

ok "docker-compose.yml written"

# ─── Deploy ──────────────────────────────────────────────────────
step "Starting backup server..."
run cd "$ROOT_DIR/infra/backup" && docker compose up -d

sleep 3
ok "Backup server deployed: $TARGET_SERVER"

echo ""
echo "  SMB Share: \\\\${SERVER_VPN_IP}\\${BACKUP_SMB_SHARE}"
echo "  User:      $BACKUP_SMB_USER"
echo "  Path:      /backups (inside container)"
echo ""
