#!/usr/bin/env bash
# =============================================================================
# UASSPAIN — WireGuard Key Generation (all servers)
# =============================================================================
# Generates unique key pairs for each server. Keys are NEVER stored in Git.
#
# Usage: ./infra/wireguard/generate-keys.sh [--force]
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load infrastructure config
source "$ROOT_DIR/infra/config.sh"

FORCE=false
[[ "${1:-}" == "--force" ]] && FORCE=true

step()  { echo -e "\n\033[0;36m==> $1\033[0m"; }
ok()    { echo -e "    \033[0;32mOK: $1\033[0m"; }
warn()  { echo -e "    \033[0;33mAVISO: $1\033[0m"; }
fail()  { echo -e "    \033[0;31mERROR: $1\033[0m"; exit 1; }

# ─── Validate prerequisites ─────────────────────────────────────
if ! command -v wg &>/dev/null; then
    fail "WireGuard no está instalado. Instala wireguard-tools primero."
fi

# ─── Create key directory ────────────────────────────────────────
KEY_DIR="$ROOT_DIR/$WG_KEY_DIR"
mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"

# ─── Server list ─────────────────────────────────────────────────
declare -A SERVERS=(
    ["server1"]="$SERVER1_VPN_IP"
    ["server2"]="$SERVER2_VPN_IP"
    ["backup1"]="$BACKUP1_VPN_IP"
    ["backup2"]="$BACKUP2_VPN_IP"
    ["backup3"]="$BACKUP3_VPN_IP"
)

# ─── Generate keys ───────────────────────────────────────────────
step "Generating WireGuard keys for ${#SERVERS[@]} servers..."

for server in "${!SERVERS[@]}"; do
    vpn_ip="${SERVERS[$server]}"
    privkey_file="$KEY_DIR/${server}.privatekey"
    pubkey_file="$KEY_DIR/${server}.publickey"
    preshared_file="$KEY_DIR/${server}.psk"

    if [[ -f "$privkey_file" ]] && ! $FORCE; then
        warn "Keys for $server already exist. Use --force to regenerate."
        continue
    fi

    step "Generating keys for $server ($vpn_ip)..."

    # Generate private key
    wg genkey | install -m 600 /dev/stdin "$privkey_file"

    # Derive public key
    cat "$privkey_file" | wg pubkey > "$pubkey_file"

    # Generate preshared key for additional security
    wg genpsk > "$preshared_file"

    chmod 600 "$privkey_file" "$preshared_file"
    chmod 644 "$pubkey_file"

    ok "Keys generated: $server"
done

# ─── Display public keys ─────────────────────────────────────────
step "Public keys (share these, NEVER share private keys):"
echo ""
printf "%-12s %-15s %s\n" "SERVER" "VPN IP" "PUBLIC KEY"
printf "%-12s %-15s %s\n" "------" "-------" "----------"
for server in "${!SERVERS[@]}"; do
    vpn_ip="${SERVERS[$server]}"
    pubkey=$(cat "$KEY_DIR/${server}.publickey")
    printf "%-12s %-15s %s\n" "$server" "$vpn_ip" "$pubkey"
done
echo ""
ok "All keys generated in: $KEY_DIR"
warn "NEVER commit private keys or PSKs to Git!"
