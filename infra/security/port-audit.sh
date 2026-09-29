#!/usr/bin/env bash
# =============================================================================
# UASSPAIN — Port Audit Script
# =============================================================================
# Scans open ports and validates against expected firewall rules.
#
# Usage: ./infra/security/port-audit.sh [--expected FILE]
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$ROOT_DIR/infra/config.sh"

step()  { echo -e "\n\033[0;36m==> $1\033[0m"; }
ok()    { echo -e "    \033[0;32m✓ $1\033[0m"; }
warn()  { echo -e "    \033[0;33m⚠ $1\033[0m"; }
fail()  { echo -e "    \033[0;31m✗ $1\033[0m"; }

step "Port Audit — $(hostname)"

# ─── TCP listening ports ──────────────────────────────────────────
step "TCP Listening Ports"
if command -v ss &>/dev/null; then
    TCP_PORTS=$(ss -tlnp 2>/dev/null | grep LISTEN | awk '{print $4 " " $6}' || true)
elif command -v netstat &>/dev/null; then
    TCP_PORTS=$(netstat -tlnp 2>/dev/null | grep LISTEN | awk '{print $4 " " $7}' || true)
else
    TCP_PORTS=""
    warn "No ss or netstat available"
fi

if [[ -n "$TCP_PORTS" ]]; then
    echo "$TCP_PORTS" | while read line; do
        echo "    $line"
    done
else
    ok "No TCP ports listening"
fi

# ─── UDP listening ports ──────────────────────────────────────────
step "UDP Listening Ports"
if command -v ss &>/dev/null; then
    UDP_PORTS=$(ss -ulnp 2>/dev/null | grep -v "Recv-Q" | awk '{print $4 " " $6}' || true)
else
    UDP_PORTS=""
fi

if [[ -n "$UDP_PORTS" ]]; then
    echo "$UDP_PORTS" | while read line; do
        echo "    $line"
    done
else
    ok "No UDP ports listening"
fi

# ─── Validate expected ports per server ───────────────────────────
step "Validating Expected Ports"

# Expected ports based on server role
EXPECTED_TCP_INBOUND=""
EXPECTED_UDP_INBOUND=""

# Detect server role
HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
case "$HOST_IP" in
    "$SERVER1_VPN_IP")
        EXPECTED_TCP_INBOUND="$FW_SSH_PORT $FW_HTTP_PORT $FW_HTTPS_PORT"
        EXPECTED_UDP_INBOUND="$FW_WG_PORT"
        echo "  Server Role: Application"
        ;;
    "$SERVER2_VPN_IP")
        EXPECTED_TCP_INBOUND="$FW_SSH_PORT $FW_PG_PORT"
        EXPECTED_UDP_INBOUND="$FW_WG_PORT"
        echo "  Server Role: PostgreSQL"
        ;;
    "$BACKUP1_VPN_IP"|"$BACKUP2_VPN_IP"|"$BACKUP3_VPN_IP")
        EXPECTED_TCP_INBOUND="$FW_SSH_PORT $FW_SMB_PORT $FW_NETBIOS_PORT"
        EXPECTED_UDP_INBOUND="$FW_WG_PORT"
        echo "  Server Role: Backup"
        ;;
    *)
        echo "  Server Role: Unknown"
        ;;
esac

# Check if expected ports are open
if [[ -n "$EXPECTED_TCP_INBOUND" ]]; then
    for port in $EXPECTED_TCP_INBOUND; do
        if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
            ok "Expected TCP port $port is open"
        else
            warn "Expected TCP port $port is NOT open"
        fi
    done
fi

if [[ -n "$EXPECTED_UDP_INBOUND" ]]; then
    for port in $EXPECTED_UDP_INBOUND; do
        if ss -ulnp 2>/dev/null | grep -q ":${port} "; then
            ok "Expected UDP port $port is open"
        else
            warn "Expected UDP port $port is NOT open"
        fi
    done
fi

# ─── Check for unexpected ports ───────────────────────────────────
step "Checking for Unexpected Ports"

ALL_OPEN=$(ss -tlnp 2>/dev/null | grep LISTEN | awk '{print $4}' | sed 's/.*://' | sort -n || true)
if [[ -n "$ALL_OPEN" ]]; then
    for port in $ALL_OPEN; do
        EXPECTED=false
        for ep in $EXPECTED_TCP_INBOUND; do
            [[ "$port" == "$ep" ]] && EXPECTED=true
        done
        if [[ "$port" == "22" ]]; then EXPECTED=true; fi  # SSH always expected locally
        if ! $EXPECTED; then
            warn "Unexpected open TCP port: $port"
        fi
    done
fi

echo ""
ok "Port audit complete"
echo ""
