#!/usr/bin/env bash
# =============================================================================
# UASSPAIN — Security Audit Script
# =============================================================================
# Validates Docker, PostgreSQL, WireGuard, Firewall, and application security.
#
# Usage: ./infra/security/audit.sh [--server SERVER_NAME] [--fix] [--dry-run]
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

FIX=false
DRY_RUN=false
SERVER="all"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --server) SERVER="$2"; shift 2 ;;
        --fix) FIX=true; shift ;;
        --dry-run) DRY_RUN=true; shift ;;
        *) shift ;;
    esac
done

PASS=0
FAIL=0
WARN=0

pass() { echo -e "  \033[0;32m✓ PASS\033[0m: $1"; PASS=$((PASS+1)); }
fail() { echo -e "  \033[0;31m✗ FAIL\033[0m: $1"; FAIL=$((FAIL+1)); }
warn() { echo -e "  \033[0;33m⚠ WARN\033[0m: $1"; WARN=$((WARN+1)); }
info() { echo -e "  \033[0;36mℹ INFO\033[0m: $1"; }

step() { echo -e "\n\033[0;36m═══ $1 ═══\033[0m"; }

# ─── 1. Docker Security ──────────────────────────────────────────
if [[ "$SERVER" == "all" ]] || [[ "$SERVER" == "server1" ]]; then
    step "Docker Security Audit"

    # Check for privileged containers
    if command -v docker &>/dev/null; then
        PRIVILEGED=$(docker ps --format '{{.Names}}' 2>/dev/null | while read c; do
            docker inspect "$c" --format '{{.HostConfig.Privileged}}' 2>/dev/null
        done | grep -c "true" || true)
        if [[ "$PRIVILEGED" -gt 0 ]]; then
            fail "$PRIVILEGED privileged container(s) found"
        else
            pass "No privileged containers"
        fi

        # Check for docker socket mounts
        SOCKET_MOUNTS=$(docker ps --format '{{.Names}}' 2>/dev/null | while read c; do
            docker inspect "$c" --format '{{range .Mounts}}{{.Source}}:{{.Destination}} {{end}}' 2>/dev/null
        done | grep -c "docker.sock" || true)
        if [[ "$SOCKET_MOUNTS" -gt 0 ]]; then
            fail "Docker socket mounted in container(s)"
        else
            pass "No docker socket mounts"
        fi

        # Check no-new-privileges
        NO_PRIV=$(docker ps --format '{{.Names}}' 2>/dev/null | while read c; do
            docker inspect "$c" --format '{{.HostConfig.SecurityOpt}}' 2>/dev/null
        done | grep -c "no-new-privileges" || true)
        TOTAL_CONTAINERS=$(docker ps -q 2>/dev/null | wc -l)
        if [[ "$NO_PRIV" -ge "$TOTAL_CONTAINERS" ]] && [[ "$TOTAL_CONTAINERS" -gt 0 ]]; then
            pass "All containers have no-new-privileges"
        elif [[ "$TOTAL_CONTAINERS" -gt 0 ]]; then
            warn "$((TOTAL_CONTAINERS - NO_PRIV))/$TOTAL_CONTAINERS containers missing no-new-privileges"
        fi

        # Check user namespace
        USER_NS=$(docker info --format '{{.SecurityOptions}}' 2>/dev/null | grep -c "userns" || true)
        if [[ "$USER_NS" -gt 0 ]]; then
            pass "User namespace remapping enabled"
        else
            info "User namespace remapping not enabled (consider for production)"
        fi

        # Check exposed ports
        EXPOSED=$(docker ps --format '{{.Ports}}' 2>/dev/null | grep -v "^$" | head -20)
        if [[ -n "$EXPOSED" ]]; then
            info "Exposed ports:"
            echo "$EXPOSED" | sed 's/^/    /'
        fi
    else
        info "Docker not available on this system"
    fi
fi

# ─── 2. PostgreSQL Security ──────────────────────────────────────
if [[ "$SERVER" == "all" ]] || [[ "$SERVER" == "server2" ]]; then
    step "PostgreSQL Security Audit"

    # Check pg_hba.conf
    PG_HBA="${ROOT_DIR}/infra/postgresql/conf/pg_hba.conf"
    if [[ -f "$PG_HBA" ]]; then
        # Check for trust method
        TRUST_LINES=$(grep -c "trust" "$PG_HBA" 2>/dev/null || true)
        if [[ "$TRUST_LINES" -gt 0 ]]; then
            fail "pg_hba.conf contains 'trust' authentication ($TRUST_LINES lines)"
        else
            pass "No 'trust' authentication in pg_hba.conf"
        fi

        # Check for 0.0.0.0/0
        OPEN_CIDR=$(grep -c "0.0.0.0/0" "$PG_HBA" 2>/dev/null || true)
        if [[ "$OPEN_CIDR" -gt 0 ]]; then
            fail "pg_hba.conf allows connections from 0.0.0.0/0"
        else
            pass "No open CIDR (0.0.0.0/0) in pg_hba.conf"
        fi

        # Check scram-sha-256
        SCRAM=$(grep -c "scram-sha-256" "$PG_HBA" 2>/dev/null || true)
        if [[ "$SCRAM" -gt 0 ]]; then
            pass "pg_hba.conf uses scram-sha-256 authentication"
        else
            warn "pg_hba.conf does not use scram-sha-256"
        fi
    else
        info "pg_hba.conf not found at expected path"
    fi

    # Check postgresql.conf
    PG_CONF="${ROOT_DIR}/infra/postgresql/conf/postgresql.conf"
    if [[ -f "$PG_CONF" ]]; then
        # Check listen_addresses
        LISTEN=$(grep "listen_addresses" "$PG_CONF" 2>/dev/null || true)
        if echo "$LISTEN" | grep -q "0.0.0.0"; then
            warn "PostgreSQL listens on all interfaces (0.0.0.0)"
        elif echo "$LISTEN" | grep -q "127.0.0.1"; then
            pass "PostgreSQL listens on localhost only"
        fi

        # Check SSL
        SSL=$(grep "^ssl" "$PG_CONF" 2>/dev/null || true)
        if echo "$SSL" | grep -q "ssl = on"; then
            pass "PostgreSQL SSL enabled"
        else
            warn "PostgreSQL SSL not enabled (consider for production)"
        fi

        # Check statement_timeout
        STMT=$(grep "statement_timeout" "$PG_CONF" 2>/dev/null || true)
        if [[ -n "$STMT" ]]; then
            pass "Statement timeout configured"
        else
            warn "No statement timeout configured"
        fi
    fi
fi

# ─── 3. WireGuard Security ───────────────────────────────────────
step "WireGuard Security Audit"

if command -v wg &>/dev/null; then
    # Check for PSK usage
    WG_CONF="/etc/wireguard/wg0.conf"
    if [[ -f "$WG_CONF" ]]; then
        PSK_COUNT=$(grep -c "PresharedKey" "$WG_CONF" 2>/dev/null || true)
        PEER_COUNT=$(grep -c "^\[Peer\]" "$WG_CONF" 2>/dev/null || true)
        if [[ "$PSK_COUNT" -ge "$PEER_COUNT" ]] && [[ "$PEER_COUNT" -gt 0 ]]; then
            pass "All WireGuard peers use preshared keys"
        elif [[ "$PEER_COUNT" -gt 0 ]]; then
            warn "$((PEER_COUNT - PSK_COUNT))/$PEER_COUNT peers missing preshared keys"
        fi

        # Check AllowedIPs
        RESTRICTED=$(grep -c "AllowedIPs = 0.0.0.0/0" "$WG_CONF" 2>/dev/null || true)
        if [[ "$RESTRICTED" -gt 0 ]]; then
            fail "WireGuard peer(s) with unrestricted AllowedIPs (0.0.0.0/0)"
        else
            pass "WireGuard AllowedIPs properly restricted"
        fi
    fi

    # Check key files permissions
    KEY_DIR="${ROOT_DIR}/wireguard-keys"
    if [[ -d "$KEY_DIR" ]]; then
        PERMS=$(stat -c "%a" "$KEY_DIR"/*.privatekey 2>/dev/null || echo "none")
        if echo "$PERMS" | grep -q "600"; then
            pass "WireGuard private key permissions: 600"
        elif [[ "$PERMS" != "none" ]]; then
            warn "WireGuard private key permissions should be 600 (currently: $PERMS)"
        fi
    fi
else
    info "WireGuard not installed on this system"
fi

# ─── 4. Firewall Audit ───────────────────────────────────────────
step "Firewall Security Audit"

if command -v ufw &>/dev/null; then
    UFW_STATUS=$(ufw status 2>/dev/null | head -1)
    if echo "$UFW_STATUS" | grep -q "active"; then
        pass "UFW firewall is active"

        # Check for open ports
        OPEN_PORTS=$(ufw status | grep ALLOW | grep -v "v6" || true)
        if [[ -n "$OPEN_PORTS" ]]; then
            info "Allowed rules:"
            echo "$OPEN_PORTS" | sed 's/^/    /'
        fi
    else
        fail "UFW firewall is not active"
    fi
elif command -v firewall-cmd &>/dev/null; then
    FIREWALLD=$(firewall-cmd --state 2>/dev/null || echo "not running")
    if [[ "$FIREWALLD" == "running" ]]; then
        pass "firewalld is running"
    else
        warn "firewalld is not running"
    fi
else
    info "No firewall tool found (ufw/firewalld)"
fi

# ─── 5. SSH Security ─────────────────────────────────────────────
step "SSH Security Audit"

SSHD_CONFIG="/etc/ssh/sshd_config"
if [[ -f "$SSHD_CONFIG" ]]; then
    # Check root login
    ROOT_LOGIN=$(grep -i "^PermitRootLogin" "$SSHD_CONFIG" 2>/dev/null | awk '{print $2}' || echo "not set")
    if [[ "$ROOT_LOGIN" == "no" ]]; then
        pass "SSH root login disabled"
    elif [[ "$ROOT_LOGIN" == "without-password" ]] || [[ "$ROOT_LOGIN" == "prohibit-password" ]]; then
        pass "SSH root login restricted to key-based"
    else
        warn "SSH root login is: $ROOT_LOGIN (consider disabling)"
    fi

    # Check password auth
    PASS_AUTH=$(grep -i "^PasswordAuthentication" "$SSHD_CONFIG" 2>/dev/null | awk '{print $2}' || echo "not set")
    if [[ "$PASS_AUTH" == "no" ]]; then
        pass "SSH password authentication disabled"
    else
        warn "SSH password authentication is: $PASS_AUTH (consider disabling)"
    fi

    # Check empty passwords
    EMPTY_PW=$(grep -i "^PermitEmptyPasswords" "$SSHD_CONFIG" 2>/dev/null | awk '{print $2}' || echo "not set")
    if [[ "$EMPTY_PW" == "no" ]] || [[ "$EMPTY_PW" == "not set" ]]; then
        pass "SSH empty passwords denied"
    else
        fail "SSH allows empty passwords!"
    fi

    # Check protocol
    PROTOCOL=$(grep -i "^Protocol" "$SSHD_CONFIG" 2>/dev/null | awk '{print $2}' || echo "not set")
    if [[ "$PROTOCOL" == "2" ]] || [[ "$PROTOCOL" == "not set" ]]; then
        pass "SSH protocol 2 (or default)"
    fi
else
    info "sshd_config not found"
fi

# ─── 6. Secrets Audit ────────────────────────────────────────────
step "Secrets Audit"

# Check for secrets in git
cd "$ROOT_DIR"
if command -v git &>/dev/null && git rev-parse --git-dir &>/dev/null; then
    # Check tracked .env files
    TRACKED_ENV=$(git ls-files -- '*.env' '.env*' '*/.env*' 2>/dev/null | grep -v ".env.example" | grep -v ".env.docker" || true)
    if [[ -n "$TRACKED_ENV" ]]; then
        fail "Tracked env files with potential secrets:"
        echo "$TRACKED_ENV" | sed 's/^/    /'
    else
        pass "No tracked .env files with secrets"
    fi

    # Check for hardcoded passwords in tracked files
    SECRETS_GIT=$(git grep -l -i "password.*=.*['\"]" -- '*.py' '*.sh' '*.yml' '*.yaml' '*.conf' 2>/dev/null | grep -v "test" | grep -v ".example" | head -10 || true)
    if [[ -n "$SECRETS_GIT" ]]; then
        warn "Files with potential hardcoded passwords:"
        echo "$SECRETS_GIT" | sed 's/^/    /'
    else
        pass "No obvious hardcoded passwords in tracked files"
    fi
fi

# Check .secrets directory
SECRETS_DIR="${ROOT_DIR}/.secrets"
if [[ -d "$SECRETS_DIR" ]]; then
    SECRETS_GITIGNORED=$(git check-ignore "$SECRETS_DIR" 2>/dev/null || true)
    if [[ -n "$SECRETS_GITIGNORED" ]]; then
        pass ".secrets/ directory is gitignored"
    else
        fail ".secrets/ directory is NOT gitignored!"
    fi
fi

# ─── 7. Network Audit ────────────────────────────────────────────
step "Network Security Audit"

# Check for unexpected listening ports
if command -v ss &>/dev/null; then
    LISTENING=$(ss -tlnp 2>/dev/null | grep LISTEN || true)
    if [[ -n "$LISTENING" ]]; then
        info "Listening TCP ports:"
        echo "$LISTENING" | awk '{print "    " $4 " (" $6 ")"}' | head -20
    fi
elif command -v netstat &>/dev/null; then
    LISTENING=$(netstat -tlnp 2>/dev/null | grep LISTEN || true)
    if [[ -n "$LISTENING" ]]; then
        info "Listening TCP ports:"
        echo "$LISTENING" | awk '{print "    " $4 " (" $7 ")"}' | head -20
    fi
fi

# ─── Summary ──────────────────────────────────────────────────────
step "Security Audit Summary"
echo ""
echo -e "  \033[0;32mPASS: $PASS\033[0m"
echo -e "  \033[0;31mFAIL: $FAIL\033[0m"
echo -e "  \033[0;33mWARN: $WARN\033[0m"
echo ""

if [[ $FAIL -gt 0 ]]; then
    echo -e "  \033[0;31mSecurity audit FAILED — $FAIL critical issues found\033[0m"
    exit 1
else
    echo -e "  \033[0;32mSecurity audit PASSED — no critical issues\033[0m"
    exit 0
fi
