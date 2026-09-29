#!/usr/bin/env bash
# =============================================================================
# UASSPAIN — SSH Hardening Script (Linux)
# =============================================================================
# Hardens SSH configuration: disable root login, disable password auth,
# enforce key-based auth, limit login attempts.
#
# Usage: ./infra/security/ssh-hardening.sh [--dry-run]
# =============================================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "ERROR: This script requires root privileges. Run with sudo." >&2
    exit 1
fi

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

step()  { echo -e "\n\033[0;36m==> $1\033[0m"; }
ok()    { echo -e "    \033[0;32mOK: $1\033[0m"; }
warn()  { echo -e "    \033[0;33mAVISO: $1\033[0m"; }
fail()  { echo -e "    \033[0;31mERROR: $1\033[0m"; exit 1; }
run()   { if $DRY_RUN; then echo "  [dry-run] $*"; else "$@"; fi; }

SSHD_CONFIG="/etc/ssh/sshd_config"
SSHD_BACKUP="/etc/ssh/sshd_config.bak.$(date +%Y%m%d%H%M%S)"

step "Hardening SSH configuration"

# ─── Backup current config ───────────────────────────────────────
if [[ -f "$SSHD_CONFIG" ]]; then
    run sudo cp "$SSHD_CONFIG" "$SSHD_BACKUP"
    ok "Backup created: $SSHD_BACKUP"
fi

# ─── Apply hardening ─────────────────────────────────────────────
# Create hardening config
cat > /tmp/sshd_hardening <<'EOF'
# UASSPAIN SSH Hardening — Applied by ssh-hardening.sh

# Disable root login
PermitRootLogin no

# Disable password authentication (use keys only)
PasswordAuthentication no

# Disable empty passwords
PermitEmptyPasswords no

# Use SSH protocol 2 only
Protocol 2

# Limit authentication attempts
MaxAuthTries 3

# Set login grace time
LoginGraceTime 30

# Disable X11 forwarding
X11Forwarding no

# Disable TCP forwarding (unless explicitly needed)
AllowTcpForwarding no

# Disable agent forwarding
AllowAgentForwarding no

# Use only strong crypto
KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com

# Set client alive interval
ClientAliveInterval 300
ClientAliveCountMax 2

# Log more information
LogLevel VERBOSE
EOF

# Append to sshd_config
if [[ -f "$SSHD_CONFIG" ]]; then
    # Check if hardening already applied
    if grep -q "UASSPAIN SSH Hardening" "$SSHD_CONFIG" 2>/dev/null; then
        warn "SSH hardening already applied"
    else
        run sudo bash -c "cat /tmp/sshd_hardening >> $SSHD_CONFIG"
        ok "SSH hardening applied"
    fi
fi

# ─── Validate config ─────────────────────────────────────────────
step "Validating SSH configuration..."
if sudo sshd -t 2>/dev/null; then
    ok "SSH config valid"
else
    fail "SSH config invalid — rolling back"
    if [[ -f "$SSHD_BACKUP" ]]; then
        run sudo cp "$SSHD_BACKUP" "$SSHD_CONFIG"
    fi
fi

# ─── Restart SSH ─────────────────────────────────────────────────
step "Restarting SSH service..."
run sudo systemctl restart sshd 2>/dev/null || run sudo systemctl restart ssh 2>/dev/null
ok "SSH service restarted"

echo ""
ok "SSH hardening complete"
echo ""
echo "  WARNING: Ensure you have SSH key access before closing this session!"
echo "  If locked out, use console access to restore: sudo cp $SSHD_BACKUP $SSHD_CONFIG"
echo ""
