#!/usr/bin/env bash
# =============================================================================
# UASSPAIN — Firewall Configuration: Backup Servers (1-3)
# =============================================================================
# DENY ALL by default. Only opens: SSH (via VPN), WireGuard, SMB (via VPN).
# NO internet access.
#
# Usage: ./infra/firewall/backup.sh --server backup1 [--dry-run]
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

# Get VPN IP for target server
case "$TARGET_SERVER" in
    backup1) SERVER_VPN_IP="$BACKUP1_VPN_IP" ;;
    backup2) SERVER_VPN_IP="$BACKUP2_VPN_IP" ;;
    backup3) SERVER_VPN_IP="$BACKUP3_VPN_IP" ;;
    *) echo "Invalid server: $TARGET_SERVER"; exit 1 ;;
esac

step()  { echo -e "\n\033[0;36m==> $1\033[0m"; }
ok()    { echo -e "    \033[0;32mOK: $1\033[0m"; }
warn()  { echo -e "    \033[0;33mAVISO: $1\033[0m"; }
fail()  { echo -e "    \033[0;31mERROR: $1\033[0m"; exit 1; }
run()   { if $DRY_RUN; then echo "  [dry-run] $*"; else "$@"; fi; }

step "Configuring firewall: $TARGET_SERVER ($SERVER_VPN_IP)"

if ! command -v ufw &>/dev/null; then
    run sudo apt-get update -qq
    run sudo apt-get install -y -qq ufw
fi

# ─── Reset ───────────────────────────────────────────────────────
run sudo ufw --force reset

# ─── Default: DENY ALL ──────────────────────────────────────────
run sudo ufw default deny incoming
run sudo ufw default deny outgoing
run sudo ufw default deny routed

# ─── Allow SSH (via VPN only) ────────────────────────────────────
step "Allowing SSH via VPN only..."
run sudo ufw allow in on "$VPN_INTERFACE_LINUX" to any port "$FW_SSH_PORT" proto tcp comment "SSH via VPN"

# ─── Allow WireGuard ─────────────────────────────────────────────
step "Allowing WireGuard..."
run sudo ufw allow in to any port "$FW_WG_PORT" proto udp comment "WireGuard"

# ─── Allow SMB from PostgreSQL server only ────────────────────────
step "Allowing SMB ($FW_SMB_PORT/tcp) from $SERVER2_VPN_IP only..."
run sudo ufw allow in on "$VPN_INTERFACE_LINUX" from "$SERVER2_VPN_IP" to any port "$FW_SMB_PORT" proto tcp comment "SMB from PG"
run sudo ufw allow in on "$VPN_INTERFACE_LINUX" from "$SERVER2_VPN_IP" to any port "$FW_NETBIOS_PORT" proto tcp comment "NetBIOS from PG"

# ─── NO outbound internet ────────────────────────────────────────
# Only allow DNS to VPN peers
run sudo ufw allow out to "$VPN_SUBNET" port 53 proto udp comment "DNS to VPN peers"

# ─── Enable ──────────────────────────────────────────────────────
step "Enabling firewall..."
run sudo ufw --force enable

step "Firewall status:"
run sudo ufw status verbose

echo ""
ok "Firewall configured: $TARGET_SERVER"
echo ""
echo "  Open ports:"
echo "    $FW_SSH_PORT/tcp   — SSH (VPN only)"
echo "    $FW_WG_PORT/udp    — WireGuard"
echo "    $FW_SMB_PORT/tcp   — SMB (from $SERVER2_VPN_IP only)"
echo "    $FW_NETBIOS_PORT/tcp — NetBIOS (from $SERVER2_VPN_IP only)"
echo ""
echo "  Internet access: NONE"
echo "  All other traffic: DENIED"
echo ""
