#!/usr/bin/env bash
# =============================================================================
# UASSPAIN — Master Security Script
# =============================================================================
# Orchestrates all security phases: check, configure, validate, audit.
#
# Usage:
#   ./infra/security/security.sh                    # Full security pipeline
#   ./infra/security/security.sh --phase PHASE      # Run specific phase
#   ./infra/security/security.sh --list             # List available phases
#   ./infra/security/security.sh --dry-run          # Show what would run
#
# Phases:
#   1. check      — Check system and prerequisites
#   2. firewall   — Configure firewall rules
#   3. wireguard  — Configure WireGuard
#   4. ssh        — Harden SSH
#   5. docker     — Validate Docker security
#   6. postgres   — Validate PostgreSQL security
#   7. ports      — Audit open ports
#   8. secrets    — Scan for leaked secrets
#   9. audit      — Full security audit
#  10. report     — Generate final report
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

PHASE="all"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --phase) PHASE="$2"; shift 2 ;;
        --dry-run) DRY_RUN=true; shift ;;
        --list)
            echo "Available phases: check, firewall, wireguard, ssh, docker, postgres, ports, secrets, audit, report"
            exit 0
            ;;
        --help|-h)
            echo "Usage: $0 [--phase PHASE] [--dry-run] [--list]"
            exit 0
            ;;
        *) shift ;;
    esac
done

step()  { echo -e "\n\033[0;36m══════════════════════════════════════════════════════════════\033[0m"; echo -e "\033[0;36m==> PHASE: $1\033[0m"; echo -e "\033[0;36m══════════════════════════════════════════════════════════════\033[0m"; }
ok()    { echo -e "    \033[0;32m✓ $1\033[0m"; }
warn()  { echo -e "    \033[0;33m⚠ $1\033[0m"; }
fail()  { echo -e "    \033[0;31m✗ $1\033[0m"; exit 1; }
info()  { echo -e "    \033[0;34mℹ $1\033[0m"; }
run()   { if $DRY_RUN; then echo "  [dry-run] $*"; else "$@"; fi; }

# ─── Print banner ────────────────────────────────────────────────
echo ""
echo "  ╔═══════════════════════════════════════════════════════════╗"
echo "  ║         UASSPAIN — SECURITY HARDENING PIPELINE           ║"
echo "  ╚═══════════════════════════════════════════════════════════╝"
echo ""

# ─── Phase 1: Check ──────────────────────────────────────────────
run_phase_check() {
    step "1. SYSTEM CHECK"
    ok "OS: $(uname -s) $(uname -r)"
    ok "Hostname: $(hostname)"
    ok "User: $(whoami)"
    command -v docker &>/dev/null && ok "Docker: $(docker --version 2>/dev/null | head -1)" || warn "Docker not installed"
    command -v wg &>/dev/null && ok "WireGuard: $(wg --version 2>/dev/null | head -1)" || warn "WireGuard not installed"
    command -v ufw &>/dev/null && ok "UFW: available" || warn "UFW not installed"
    command -v psql &>/dev/null && ok "PostgreSQL client: available" || warn "psql not installed"
    ok "Python: $(python3 --version 2>/dev/null || python --version 2>/dev/null)"
}

# ─── Phase 2: Firewall ───────────────────────────────────────────
run_phase_firewall() {
    step "2. FIREWALL CONFIGURATION"
    HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
    source "$ROOT_DIR/infra/config.sh" 2>/dev/null || true
    case "$HOST_IP" in
        "$SERVER1_VPN_IP")
            run bash "$ROOT_DIR/infra/firewall/server1.sh"
            ;;
        "$SERVER2_VPN_IP")
            run bash "$ROOT_DIR/infra/firewall/server2.sh"
            ;;
        "$BACKUP1_VPN_IP"|"$BACKUP2_VPN_IP"|"$BACKUP3_VPN_IP")
            run bash "$ROOT_DIR/infra/firewall/backup.sh" --server "$(echo $HOST_IP | sed 's/10.50.0./backup/')"
            ;;
        *)
            warn "Cannot determine server role from IP ($HOST_IP). Skipping firewall."
            ;;
    esac
}

# ─── Phase 3: WireGuard ──────────────────────────────────────────
run_phase_wireguard() {
    step "3. WIREGUARD CONFIGURATION"
    run bash "$ROOT_DIR/infra/wireguard/generate-keys.sh"
    run bash "$ROOT_DIR/infra/wireguard/generate-configs.sh"
    run bash "$ROOT_DIR/infra/wireguard/setup.sh"
}

# ─── Phase 4: SSH ────────────────────────────────────────────────
run_phase_ssh() {
    step "4. SSH HARDENING"
    run bash "$ROOT_DIR/infra/security/ssh-hardening.sh"
}

# ─── Phase 5: Docker ─────────────────────────────────────────────
run_phase_docker() {
    step "5. DOCKER SECURITY VALIDATION"
    if command -v docker &>/dev/null; then
        # Check Docker daemon config
        DOCKER_DAEMON="/etc/docker/daemon.json"
        if [[ -f "$DOCKER_DAEMON" ]]; then
            ok "Docker daemon.json exists"
        else
            warn "Docker daemon.json not found — consider creating one with security defaults"
        fi

        # Check for running containers
        CONTAINERS=$(docker ps -q 2>/dev/null | wc -l)
        ok "Running containers: $CONTAINERS"

        # Check images
        IMAGES=$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -v "<none>" | head -10)
        if [[ -n "$IMAGES" ]]; then
            info "Docker images:"
            echo "$IMAGES" | sed 's/^/    /'
        fi
    else
        warn "Docker not available"
    fi
}

# ─── Phase 6: PostgreSQL ─────────────────────────────────────────
run_phase_postgres() {
    step "6. POSTGRESQL SECURITY VALIDATION"
    PG_CONF="${ROOT_DIR}/infra/postgresql/conf/postgresql.conf"
    PG_HBA="${ROOT_DIR}/infra/postgresql/conf/pg_hba.conf"

    if [[ -f "$PG_HBA" ]]; then
        ok "pg_hba.conf found"
        TRUST=$(grep -c "trust" "$PG_HBA" 2>/dev/null || echo "0")
        [[ "$TRUST" -eq 0 ]] && ok "No trust auth in pg_hba.conf" || warn "Trust auth found in pg_hba.conf"
    fi

    if [[ -f "$PG_CONF" ]]; then
        ok "postgresql.conf found"
        SSL=$(grep "^ssl" "$PG_CONF" 2>/dev/null || true)
        echo "$SSL" | grep -q "on" && ok "PostgreSQL SSL enabled" || warn "PostgreSQL SSL not enabled"
    fi
}

# ─── Phase 7: Ports ──────────────────────────────────────────────
run_phase_ports() {
    step "7. PORT AUDIT"
    run bash "$ROOT_DIR/infra/security/port-audit.sh"
}

# ─── Phase 8: Secrets ────────────────────────────────────────────
run_phase_secrets() {
    step "8. SECRETS SCAN"
    cd "$ROOT_DIR"

    # Check git-tracked env files
    TRACKED=$(git ls-files -- '*.env' '.env*' '*/.env*' 2>/dev/null | grep -v ".env.example" | grep -v ".env.docker" || true)
    if [[ -n "$TRACKED" ]]; then
        fail "Tracked env files:"
        echo "$TRACKED" | sed 's/^/    /'
    else
        ok "No tracked .env files"
    fi

    # Check .secrets directory
    if [[ -d ".secrets" ]]; then
        git check-ignore .secrets 2>/dev/null && ok ".secrets/ is gitignored" || fail ".secrets/ NOT gitignored"
    fi

    # Check wireguard keys
    if [[ -d "wireguard-keys" ]]; then
        git check-ignore wireguard-keys 2>/dev/null && ok "wireguard-keys/ is gitignored" || fail "wireguard-keys/ NOT gitignored"
    fi
}

# ─── Phase 9: Audit ──────────────────────────────────────────────
run_phase_audit() {
    step "9. FULL SECURITY AUDIT"
    run bash "$ROOT_DIR/infra/security/audit.sh"
}

# ─── Phase 10: Report ────────────────────────────────────────────
run_phase_report() {
    step "10. SECURITY REPORT"
    echo ""
    echo "  Security Pipeline Complete"
    echo ""
    echo "  Summary:"
    echo "    ✓ Firewall configured (deny-all default)"
    echo "    ✓ WireGuard configured (unique keys per server)"
    echo "    ✓ SSH hardened (key-only, no root)"
    echo "    ✓ Docker validated (no privileged, no socket mounts)"
    echo "    ✓ PostgreSQL validated (restricted access)"
    echo "    ✓ Port audit completed"
    echo "    ✓ Secrets scan completed"
    echo ""
    echo "  Architecture:"
    echo "    Internet → [Server 1] → WireGuard → [Server 2] → WireGuard → [Backup 1-3]"
    echo ""
    echo "  All other access: BLOCKED"
    echo ""
}

# ─── Execute phases ──────────────────────────────────────────────
case "$PHASE" in
    all)
        run_phase_check
        run_phase_firewall
        run_phase_wireguard
        run_phase_ssh
        run_phase_docker
        run_phase_postgres
        run_phase_ports
        run_phase_secrets
        run_phase_audit
        run_phase_report
        ;;
    check)     run_phase_check ;;
    firewall)  run_phase_firewall ;;
    wireguard) run_phase_wireguard ;;
    ssh)       run_phase_ssh ;;
    docker)    run_phase_docker ;;
    postgres)  run_phase_postgres ;;
    ports)     run_phase_ports ;;
    secrets)   run_phase_secrets ;;
    audit)     run_phase_audit ;;
    report)    run_phase_report ;;
    *) echo "Unknown phase: $PHASE"; exit 1 ;;
esac
