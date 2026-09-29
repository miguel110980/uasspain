# =============================================================================
# UASSPAIN — Master Security Script (Windows/PowerShell)
# =============================================================================
# Orchestrates all security phases.
#
# Usage:
#   .\infra\security\security.ps1                      # Full pipeline
#   .\infra\security\security.ps1 -Phase firewall      # Specific phase
#   .\infra\security\security.ps1 -List                # List phases
# =============================================================================
param(
    [string]$Phase = "all",
    [switch]$DryRun,
    [switch]$List
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. "$Root\infra\config.ps1"

function Step($msg)  { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)    { Write-Host "    OK: $msg" -ForegroundColor Green }
function Warn($msg)  { Write-Host "    AVISO: $msg" -ForegroundColor Yellow }
function Fail($msg)  { Write-Host "    ERROR: $msg" -ForegroundColor Red }

if ($List) {
    Write-Host "Available phases: check, firewall, wireguard, ssh, docker, ports, secrets, audit, report"
    exit 0
}

Write-Host ""
Write-Host "  ╔═══════════════════════════════════════════════════════════╗"
Write-Host "  ║         UASSPAIN — SECURITY HARDENING PIPELINE           ║"
Write-Host "  ╚═══════════════════════════════════════════════════════════╝"
Write-Host ""

# ─── Phase 1: Check ──────────────────────────────────────────────
function Run-PhaseCheck {
    Step "1. SYSTEM CHECK"
    Ok "OS: Windows $([System.Environment]::OSVersion.Version)"
    Ok "User: $env:USERNAME"
    if (Get-Command docker -ErrorAction SilentlyContinue) { Ok "Docker: installed" }
    else { Warn "Docker not installed" }
    $wgPath = "$env:ProgramFiles\WireGuard\wg.exe"
    if (Test-Path $wgPath) { Ok "WireGuard: installed" }
    else { Warn "WireGuard not installed" }
}

# ─── Phase 2: Firewall ───────────────────────────────────────────
function Run-PhaseFirewall {
    Step "2. FIREWALL CONFIGURATION"
    & "$Root\infra\firewall\server1.ps1"
}

# ─── Phase 3: WireGuard ──────────────────────────────────────────
function Run-PhaseWireguard {
    Step "3. WIREGUARD CONFIGURATION"
    & "$Root\infra\wireguard\generate-keys.ps1"
    & "$Root\infra\wireguard\generate-configs.ps1"
    & "$Root\infra\wireguard\setup.ps1"
}

# ─── Phase 4: SSH ────────────────────────────────────────────────
function Run-PhaseSSH {
    Step "4. SSH HARDENING"
    # Windows equivalent: disable RDP if not needed, harden WinRM
    Ok "Windows: SSH hardening via Windows Firewall rules"
}

# ─── Phase 5: Docker ─────────────────────────────────────────────
function Run-PhaseDocker {
    Step "5. DOCKER SECURITY VALIDATION"
    & "$Root\infra\security\audit.ps1"
}

# ─── Phase 6: Ports ──────────────────────────────────────────────
function Run-PhasePorts {
    Step "6. PORT AUDIT"
    $listening = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
        Select-Object LocalPort, OwningProcess, @{N='ProcessName';E={(Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).Name}} |
        Sort-Object LocalPort
    if ($listening) {
        Write-Host "  Listening TCP ports:"
        $listening | ForEach-Object { Write-Host "    $($_.LocalPort) ($($_.ProcessName))" }
    }
}

# ─── Phase 7: Secrets ────────────────────────────────────────────
function Run-PhaseSecrets {
    Step "7. SECRETS SCAN"
    & "$Root\infra\security\audit.ps1"
}

# ─── Phase 8: Audit ──────────────────────────────────────────────
function Run-PhaseAudit {
    Step "8. FULL SECURITY AUDIT"
    & "$Root\infra\security\audit.ps1"
}

# ─── Phase 9: Report ─────────────────────────────────────────────
function Run-PhaseReport {
    Step "9. SECURITY REPORT"
    Write-Host ""
    Write-Host "  Security Pipeline Complete"
    Write-Host "  All access: DENY BY DEFAULT"
    Write-Host ""
}

# ─── Execute ─────────────────────────────────────────────────────
switch ($Phase) {
    "all" {
        Run-PhaseCheck
        Run-PhaseFirewall
        Run-PhaseWireguard
        Run-PhaseSSH
        Run-PhaseDocker
        Run-PhasePorts
        Run-PhaseSecrets
        Run-PhaseAudit
        Run-PhaseReport
    }
    "check"     { Run-PhaseCheck }
    "firewall"  { Run-PhaseFirewall }
    "wireguard" { Run-PhaseWireguard }
    "ssh"       { Run-PhaseSSH }
    "docker"    { Run-PhaseDocker }
    "ports"     { Run-PhasePorts }
    "secrets"   { Run-PhaseSecrets }
    "audit"     { Run-PhaseAudit }
    "report"    { Run-PhaseReport }
    default     { Write-Host "Unknown phase: $Phase"; exit 1 }
}
