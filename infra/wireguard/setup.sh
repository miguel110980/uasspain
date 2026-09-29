#!/usr/bin/env bash
# =============================================================================
# UASSPAIN — WireGuard Setup (install + activate + validate)
# =============================================================================
# Installs WireGuard if needed, activates tunnel, validates handshake.
#
# Usage: ./infra/wireguard/setup.sh [--server SERVER_NAME] [--dry-run]
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$ROOT_DIR/infra/config.sh"

TARGET_SERVER="${1:-}"
DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true
[[ "${2:-}" == "--dry-run" ]] && DRY_RUN=true

step()  { echo -e "\n\033[0;36m==> $1\033[0m"; }
ok()    { echo -e "    \033[0;32mOK: $1\033[0m"; }
warn()  { echo -e "    \033[0;33mAVISO: $1\033[0m"; }
fail()  { echo -e "    \033[0;31mERROR: $1\033[0m"; exit 1; }
run()   { if $DRY_RUN; then echo "  [dry-run] $*"; else "$@"; fi; }

# ─── Detect current server role ──────────────────────────────────
detect_server_role() {
    local wg_ip
    wg_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    case "$wg_ip" in
        "$SERVER1_VPN_IP") echo "server1" ;;
        "$SERVER2_VPN_IP") echo "server2" ;;
        "$BACKUP1_VPN_IP") echo "backup1" ;;
        "$BACKUP2_VPN_IP") echo "backup2" ;;
        "$BACKUP3_VPN_IP") echo "backup3" ;;
        *) echo "unknown" ;;
    esac
}

# ─── Install WireGuard ──────────────────────────────────────────
install_wireguard() {
    if command -v wg &>/dev/null; then
        ok "WireGuard already installed: $(wg --version)"
        return
    fi

    step "Installing WireGuard..."

    if command -v apt-get &>/dev/null; then
        run sudo apt-get update -qq
        run sudo apt-get install -y -qq wireguard wireguard-tools
    elif command -v dnf &>/dev/null; then
        run sudo dnf install -y wireguard-tools
    elif command -v pacman &>/dev/null; then
        run sudo pacman -S --noconfirm wireguard-tools
    elif command -v yum &>/dev/null; then
        run sudo yum install -y epel-release
        run sudo yum install -y wireguard-tools
    else
        fail "No se encontró un gestor de paquetes compatible (apt/dnf/pacman/yum)"
    fi

    ok "WireGuard installed"
}

# ─── Activate WireGuard tunnel ───────────────────────────────────
activate_tunnel() {
    local server_name="$1"
    local conf_file="$ROOT_DIR/$WG_CONFIG_DIR/${server_name}.conf"

    if [[ ! -f "$conf_file" ]]; then
        fail "Config not found: $conf_file — run generate-configs.sh first"
    fi

    step "Activating WireGuard tunnel ($server_name)..."

    # Check if already active
    if sudo wg show "$VPN_INTERFACE_LINUX" &>/dev/null; then
        local current_ip
        current_ip=$(sudo wg show "$VPN_INTERFACE_LINUX" allowed-ips 2>/dev/null | head -1)
        ok "WireGuard interface $VPN_INTERFACE_LINUX already active"
        return
    fi

    # Copy config and activate
    run sudo cp "$conf_file" "/etc/wireguard/${VPN_INTERFACE_LINUX}.conf"
    run sudo chmod 600 "/etc/wireguard/${VPN_INTERFACE_LINUX}.conf"

    # Enable on boot
    run sudo systemctl enable wg-quick@"$VPN_INTERFACE_LINUX" 2>/dev/null || true

    # Bring up interface
    run sudo wg-quick up "$VPN_INTERFACE_LINUX"

    sleep 2
    ok "WireGuard tunnel activated"
}

# ─── Validate handshake ──────────────────────────────────────────
validate_handshake() {
    step "Validating WireGuard handshake..."

    local show_output
    show_output=$(sudo wg show "$VPN_INTERFACE_LINUX" latest-handshakes 2>/dev/null || echo "")

    if [[ -z "$show_output" ]]; then
        fail "No se pudo obtener el estado de WireGuard"
    fi

    local has_handshake=false
    while IFS= read -r line; do
        local timestamp
        timestamp=$(echo "$line" | awk '{print $2}')
        if [[ "$timestamp" != "0" ]] && [[ -n "$timestamp" ]]; then
            has_handshake=true
            local seconds_ago=$(( $(date +%s) - timestamp ))
            ok "Handshake received ${seconds_ago}s ago"
        fi
    done <<< "$show_output"

    if ! $has_handshake; then
        warn "No se ha recibido ningún handshake aún"
        warn "Esto puede ser normal si el peer remoto no está activo"
    fi
}

# ─── Validate connectivity ───────────────────────────────────────
validate_connectivity() {
    local target_ip="$1"
    local target_name="$2"

    step "Validating connectivity to $target_name ($target_ip)..."

    if ping -c 3 -W 2 "$target_ip" &>/dev/null; then
        ok "$target_name reachable via WireGuard"
        return 0
    else
        warn "$target_name no responde a ping (puede ser normal si ICMP está bloqueado)"
        return 0
    fi
}

# ─── Main ────────────────────────────────────────────────────────
# Determine which server we're on
SERVER_NAME="${TARGET_SERVER:-$(detect_server_role)}"
if [[ "$SERVER_NAME" == "unknown" ]]; then
    fail "No se pudo determinar el servidor actual. Especifica --server SERVER_NAME"
fi

step "Setting up WireGuard for: $SERVER_NAME"

install_wireguard
activate_tunnel "$SERVER_NAME"
validate_handshake

# Validate connectivity to peers based on server role
case "$SERVER_NAME" in
    server1)
        validate_connectivity "$SERVER2_VPN_IP" "Server 2 (PostgreSQL)"
        ;;
    server2)
        validate_connectivity "$SERVER1_VPN_IP" "Server 1 (Application)"
        validate_connectivity "$BACKUP1_VPN_IP" "Backup 1"
        validate_connectivity "$BACKUP2_VPN_IP" "Backup 2"
        validate_connectivity "$BACKUP3_VPN_IP" "Backup 3"
        ;;
    backup1|backup2|backup3)
        validate_connectivity "$SERVER2_VPN_IP" "Server 2 (PostgreSQL)"
        ;;
esac

echo ""
ok "WireGuard setup complete for $SERVER_NAME"
echo ""
echo "  Verify manually:"
echo "    sudo wg show"
echo "    sudo wg show $VPN_INTERFACE_LINUX latest-handshakes"
echo ""
