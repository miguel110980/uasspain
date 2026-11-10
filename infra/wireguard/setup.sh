#!/usr/bin/env bash
# =============================================================================
# UASSPAIN — WireGuard Setup (install + activate + validate)
# =============================================================================
# Installs WireGuard if needed, activates tunnel, validates handshake.
#
# Usage: ./infra/wireguard/setup.sh [--server SERVER_NAME] [--dry-run] [--allow-install]
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$ROOT_DIR/infra/config.sh"

TARGET_SERVER=""
DRY_RUN=false
ALLOW_INSTALL=false
while (($#)); do
    case "$1" in
        --server) [[ $# -ge 2 && -z "$TARGET_SERVER" ]] || { printf '%s\n' 'Missing or duplicate --server value' >&2; exit 2; }; TARGET_SERVER=$2; shift 2 ;;
        --dry-run) DRY_RUN=true; shift ;;
        --allow-install) ALLOW_INSTALL=true; shift ;;
        server1|server2|backup1|backup2|backup3) [[ -z "$TARGET_SERVER" ]] || { printf '%s\n' 'Duplicate server' >&2; exit 2; }; TARGET_SERVER=$1; shift ;;
        *) printf '%s\n' 'Unknown option or server' >&2; exit 2 ;;
    esac
done
case "$TARGET_SERVER" in ''|server1|server2|backup1|backup2|backup3) ;; *) printf '%s\n' 'Invalid server' >&2; exit 2 ;; esac

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
    if $DRY_RUN; then echo '[dry-run] Tool check only; installation requires --allow-install.'; return; fi
    if command -v wg &>/dev/null; then
        ok "WireGuard already installed: $(wg --version)"
        return
    fi

    $ALLOW_INSTALL || fail 'WireGuard missing; explicit --allow-install authorization required'
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

    command -v wg >/dev/null && command -v wg-quick >/dev/null || fail 'Installation did not provide both WireGuard tools'
    ok "WireGuard installed"
}

# ─── Activate WireGuard tunnel ───────────────────────────────────
activate_tunnel() {
    local server_name="$1"
    if $DRY_RUN; then echo "[dry-run] Tunnel $server_name not activated."; return; fi
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
    local destination="/etc/wireguard/${VPN_INTERFACE_LINUX}.conf"
    sudo test ! -L "$destination" || fail 'Existing tunnel configuration is a symlink; not replaced'
    if sudo test -e "$destination"; then
        sudo cmp -s "$conf_file" "$destination" || fail 'Existing tunnel configuration differs; not overwritten'
    else
        run sudo install -m 600 -- "$conf_file" "$destination"
    fi

    # Enable on boot
    run sudo systemctl enable wg-quick@"$VPN_INTERFACE_LINUX" || fail 'Could not enable tunnel persistence'

    # Bring up interface
    run sudo wg-quick up "$VPN_INTERFACE_LINUX" || fail 'Tunnel activation failed; no success claimed'

    sleep 2
    ok "WireGuard tunnel activated"
}

# ─── Validate handshake ──────────────────────────────────────────
validate_handshake() {
    if $DRY_RUN; then echo '[dry-run] Handshake NOT_VALIDATED.'; return; fi
    step "Validating WireGuard handshake..."

    local show_output
    show_output=$(sudo wg show "$VPN_INTERFACE_LINUX" latest-handshakes 2>/dev/null || echo "")

    if [[ -z "$show_output" ]]; then
        fail "No se pudo obtener el estado de WireGuard"
    fi

    printf '%s\n' "$show_output" | awk -v now="$(date +%s)" '$2 ~ /^[0-9]+$/ && $2>0 && now-$2>=0 && now-$2<=180 {ok=1} END {exit !ok}' || fail 'No recent WireGuard handshake; connectivity not validated'
}

# ─── Validate connectivity ───────────────────────────────────────
validate_connectivity() {
    local target_ip="$1"
    local target_name="$2"

    step "Validating connectivity to $target_name ($target_ip)..."

    if $DRY_RUN; then echo '[dry-run] Peer route/handshake NOT_VALIDATED.'; return; fi
    local route allowed peer handshakes
    route=$(ip route get "$target_ip") || fail 'Could not determine selected route'
    printf '%s\n' "$route" | awk -v iface="$VPN_INTERFACE_LINUX" '{for(i=1;i<NF;i++)if($i=="dev" && $(i+1)==iface)ok=1}END{exit !ok}' || fail 'Selected route does not use the requested WireGuard interface'
    ping -c 1 -W 2 "$target_ip" >/dev/null 2>&1 || true
    allowed=$(sudo wg show "$VPN_INTERFACE_LINUX" allowed-ips) || fail 'Could not read allowed peers'
    # Repository-generated topology uses explicit IPv4 /32 peer destinations.
    peer=$(printf '%s\n' "$allowed" | awk -v target="$target_ip/32" '{for(i=2;i<=NF;i++){n=split($i,a,",");for(j=1;j<=n;j++)if(a[j]==target)print $1}}' | sort -u)
    [[ -n "$peer" && "$peer" != *$'\n'* ]] || fail 'No unique configured peer covers the target address'
    handshakes=$(sudo wg show "$VPN_INTERFACE_LINUX" latest-handshakes) || fail 'Could not read peer handshake'
    printf '%s\n' "$handshakes" | awk -v key="$peer" -v now="$(date +%s)" '$1==key {count++; if($2 ~ /^[0-9]+$/ && $2>0 && now-$2>=0 && now-$2<=180)ok=1} END {exit !(count==1 && ok)}' || fail 'Target peer handshake missing, invalid or stale'
    ok "$target_name: selected tunnel route and recent target-peer handshake verified; SFTP not tested"
}

# ─── Main ────────────────────────────────────────────────────────
# Determine which server we're on
SERVER_NAME="${TARGET_SERVER:-$(detect_server_role)}"
if [[ "$SERVER_NAME" == "unknown" ]]; then
    fail "No se pudo determinar el servidor actual. Especifica --server SERVER_NAME"
fi

step "Setting up WireGuard for: $SERVER_NAME"

if $DRY_RUN; then
    echo "[dry-run] Plan for $SERVER_NAME only; no installation, sudo, service change, network probe or activation. VPN/SFTP NOT_VALIDATED."
    exit 0
fi

install_wireguard
activate_tunnel "$SERVER_NAME"

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
