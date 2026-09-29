#!/usr/bin/env bash
# =============================================================================
# UASSPAIN — Firewall Configuration: Server 1 (Application)
# =============================================================================
# DENY ALL by default. Only opens: SSH, HTTP, HTTPS, WireGuard.
#
# Usage: ./infra/firewall/server1.sh [--dry-run]
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

step "Configuring firewall: Server 1 (Application)"

# ─── Check if UFW is available ───────────────────────────────────
if ! command -v ufw &>/dev/null; then
    warn "UFW not found. Installing..."
    run sudo apt-get update -qq
    run sudo apt-get install -y -qq ufw
fi

# ─── Reset firewall ──────────────────────────────────────────────
step "Resetting firewall rules..."
run sudo ufw --force reset

# ─── Default policies: DENY ALL ──────────────────────────────────
step "Setting default policies: DENY ALL"
run sudo ufw default deny incoming
run sudo ufw default deny outgoing
run sudo ufw default deny routed

# ─── Allow SSH (VPN only — no public SSH) ────────────────────────
step "Allowing SSH ($FW_SSH_PORT/tcp) via VPN only..."
run sudo ufw allow in on "$VPN_INTERFACE_LINUX" to any port "$FW_SSH_PORT" proto tcp comment "SSH via VPN"

# ─── Allow HTTP/HTTPS (public) ───────────────────────────────────
step "Allowing HTTP ($FW_HTTP_PORT) and HTTPS ($FW_HTTPS_PORT)..."
run sudo ufw allow in to any port "$FW_HTTP_PORT" proto tcp comment "HTTP"
run sudo ufw allow in to any port "$FW_HTTPS_PORT" proto tcp comment "HTTPS"

# ─── Allow WireGuard ─────────────────────────────────────────────
step "Allowing WireGuard ($FW_WG_PORT/udp)..."
run sudo ufw allow in to any port "$FW_WG_PORT" proto udp comment "WireGuard"

# ─── Allow VPN subnet traffic ────────────────────────────────────
step "Allowing traffic from VPN subnet ($VPN_SUBNET)..."
run sudo ufw allow in on "$VPN_INTERFACE_LINUX" from "$VPN_SUBNET" comment "VPN subnet"

# ─── Allow outbound DNS ──────────────────────────────────────────
step "Allowing outbound DNS..."
run sudo ufw allow out to any port 53 proto udp comment "DNS"
run sudo ufw allow out to any port 53 proto tcp comment "DNS TCP"

# ─── Allow outbound HTTPS (for updates, API calls) ───────────────
step "Allowing outbound HTTPS..."
run sudo ufw allow out to any port 443 proto tcp comment "HTTPS outbound"

# ─── Allow outbound SMTP (for email) ─────────────────────────────
step "Allowing outbound SMTP..."
run sudo ufw allow out to any port 587 proto tcp comment "SMTP"
run sudo ufw allow out to any port 465 proto tcp comment "SMTPS"

# ─── Enable firewall ─────────────────────────────────────────────
step "Enabling firewall..."
run sudo ufw --force enable

# ─── Show status ─────────────────────────────────────────────────
step "Firewall status:"
run sudo ufw status verbose

echo ""
ok "Firewall configured: Server 1 (Application)"
echo ""
echo "  Open ports:"
echo "    $FW_SSH_PORT/tcp  — SSH (VPN only)"
echo "    $FW_HTTP_PORT/tcp — HTTP"
echo "    $FW_HTTPS_PORT/tcp — HTTPS"
echo "    $FW_WG_PORT/udp   — WireGuard"
echo "    VPN subnet        — WireGuard traffic"
echo ""
echo "  All other traffic: DENIED"
echo ""
