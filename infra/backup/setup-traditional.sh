#!/usr/bin/env bash
# =============================================================================
# UASSPAIN — Backup Server Setup (Traditional — no Docker)
# =============================================================================
# Installs Samba directly on the system. For Linux/Ubuntu.
#
# Usage: ./infra/backup/setup-traditional.sh --server backup1 [--dry-run]
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
fail()  { echo -e "    \033[0;31mERROR: $1\033[0m"; exit 1; }
run()   { if $DRY_RUN; then echo "  [dry-run] $*"; else "$@"; fi; }

step "Installing Samba: $TARGET_SERVER ($SERVER_VPN_IP)"

# ─── Install Samba ───────────────────────────────────────────────
run sudo apt-get update -qq
run sudo apt-get install -y -qq samba samba-common-bin

# ─── Create backup user ──────────────────────────────────────────
step "Creating backup user..."
if ! id "$BACKUP_SMB_USER" &>/dev/null; then
    run sudo useradd -r -s /bin/false "$BACKUP_SMB_USER"
fi

# ─── Create backup directory ─────────────────────────────────────
BACKUP_DIR="/srv/uasspain-backups"
run sudo mkdir -p "$BACKUP_DIR"
run sudo chown "$BACKUP_SMB_USER:sambashare" "$BACKUP_DIR"
run sudo chmod 2770 "$BACKUP_DIR"

# ─── Configure Samba ─────────────────────────────────────────────
step "Configuring Samba..."
run sudo cp /etc/samba/smb.conf /etc/samba/smb.conf.bak

cat > /tmp/smb_uasspain <<EOF
[global]
   workgroup = WORKGROUP
   server string = UASSPAIN Backup Server ($TARGET_SERVER)
   security = user
   map to guest = never
   log file = /var/log/samba/log.%m
   max log size = 50
   interfaces = lo $VPN_INTERFACE_LINUX
   bind interfaces only = yes

[$BACKUP_SMB_SHARE]
   path = $BACKUP_DIR
   browseable = yes
   read only = no
   writable = yes
   valid users = $BACKUP_SMB_USER
   create mask = 0644
   directory mask = 0755
EOF

run sudo cp /tmp/smb_uasspain /etc/samba/smb.conf
run sudo testparm -s 2>/dev/null

# ─── Start Samba ─────────────────────────────────────────────────
step "Starting Samba..."
run sudo systemctl restart smbd
run sudo systemctl enable smbd

ok "Samba configured: $TARGET_SERVER"

echo ""
echo "  WARNING: Set a password for $BACKUP_SMB_USER:"
echo "  sudo smbpasswd -a $BACKUP_SMB_USER"
echo ""
echo "  SMB Share: \\\\${SERVER_VPN_IP}\\${BACKUP_SMB_SHARE}"
echo "  Local path: $BACKUP_DIR"
echo ""
