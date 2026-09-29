#!/usr/bin/env bash
# =============================================================================
# UASSPAIN — Firewall Configuration: Server 2 (PostgreSQL)
# =============================================================================
# DENY ALL by default. Only opens: SSH (via VPN), WireGuard, PostgreSQL (via VPN).
# NO internet access.
#
# Usage: ./infra/firewall/server2.sh [--dry-run]
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

step "Configuring firewall: Server 2 (PostgreSQL)"

if ! command -v ufw &>/dev/null; then
    run sudo apt-get update -qq
    run sudo apt-get install -y -qq ufw
fi

# ─── Reset ───────────────────────────────────────────────────────
step "Resetting firewall rules..."
run sudo ufw --force reset

# ─── Default: DENY ALL ──────────────────────────────────────────
step "Setting default policies: DENY ALL"
run sudo ufw default deny incoming
run sudo ufw default deny outgoing
run sudo ufw default deny routed

# ─── Allow SSH (via VPN only) ────────────────────────────────────
step "Allowing SSH ($FW_SSH_PORT/tcp) via VPN only..."
run sudo ufw allow in on "$VPN_INTERFACE_LINUX" to any port "$FW_SSH_PORT" proto tcp comment "SSH via VPN"

# ─── Allow WireGuard ─────────────────────────────────────────────
step "Allowing WireGuard ($FW_WG_PORT/udp)..."
run sudo ufw allow in to any port "$FW_WG_PORT" proto udp comment "WireGuard"

# ─── Allow PostgreSQL from Application server only ────────────────
step "Allowing PostgreSQL ($FW_PG_PORT/tcp) from $SERVER1_VPN_IP only..."
run sudo ufw allow in on "$VPN_INTERFACE_LINUX" from "$SERVER1_VPN_IP" to any port "$FW_PG_PORT" proto tcp comment "PG from App"

# ─── Allow PostgreSQL from Backup servers (for restore) ──────────
for backup_ip in "$BACKUP1_VPN_IP" "$BACKUP2_VPN_IP" "$BACKUP3_VPN_IP"; do
    run sudo ufw allow in on "$VPN_INTERFACE_LINUX" from "$backup_ip" to any port "$FW_PG_PORT" proto tcp comment "PG from Backup"
done

# ─── NO outbound internet ────────────────────────────────────────
# Only allow DNS to VPN peers (for resolution if needed)
step "Allowing DNS to VPN peers only..."
run sudo ufw allow out to "$VPN_SUBNET" port 53 proto udp comment "DNS to VPN peers"

# ─── Enable ──────────────────────────────────────────────────────
step "Enabling firewall..."
run sudo ufw --force enable

step "Firewall status:"
run sudo ufw status verbose

echo ""
ok "Firewall configured: Server 2 (PostgreSQL)"
echo ""
echo "  Open ports:"
echo "    $FW_SSH_PORT/tcp  — SSH (VPN only)"
echo "    $FW_WG_PORT/udp   — WireGuard"
echo "    $FW_PG_PORT/tcp   — PostgreSQL (from $SERVER1_VPN_IP only)"
echo ""
echo "  Internet access: NONE"
echo "  All other traffic: DENIED"
echo ""
