# =============================================================================
# UASSPAIN — Security Audit Script (Windows/PowerShell)
# =============================================================================
# Validates Docker, WireGuard, Firewall, and application security.
#
# Usage: .\infra\security\audit.ps1 [-Server SERVER_NAME]
# =============================================================================
param([string]$Server = "all")

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

$Pass = 0; $Fail = 0; $Warn = 0

function Step($msg)  { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Pass($msg)  { Write-Host "  PASS: $msg" -ForegroundColor Green; $script:Pass++ }
function Fail($msg)  { Write-Host "  FAIL: $msg" -ForegroundColor Red; $script:Fail++ }
function Warn($msg)  { Write-Host "  WARN: $msg" -ForegroundColor Yellow; $script:Warn++ }
function Info($msg)  { Write-Host "  INFO: $msg" -ForegroundColor Gray }

# ─── 1. Docker Security ──────────────────────────────────────────
Step "Docker Security Audit"

if (Get-Command docker -ErrorAction SilentlyContinue) {
    try {
        docker info 2>&1 | Out-Null
        # Check for privileged containers
        $containers = docker ps --format '{{.Names}}' 2>$null
        $privileged = 0
        foreach ($c in $containers) {
            $priv = docker inspect $c --format '{{.HostConfig.Privileged}}' 2>$null
            if ($priv -eq "true") { $privileged++ }
        }
        if ($privileged -gt 0) { Fail "$privileged privileged container(s) found" }
        else { Pass "No privileged containers" }

        # Check for docker socket mounts
        $socketMounts = 0
        foreach ($c in $containers) {
            $mounts = docker inspect $c --format '{{range .Mounts}}{{.Source}} {{end}}' 2>$null
            if ($mounts -match "docker.sock") { $socketMounts++ }
        }
        if ($socketMounts -gt 0) { Fail "Docker socket mounted in container(s)" }
        else { Pass "No docker socket mounts" }

        # Check no-new-privileges
        $noPriv = 0
        $total = ($containers | Measure-Object).Count
        foreach ($c in $containers) {
            $secOpt = docker inspect $c --format '{{.HostConfig.SecurityOpt}}' 2>$null
            if ($secOpt -match "no-new-privileges") { $noPriv++ }
        }
        if ($noPriv -ge $total -and $total -gt 0) { Pass "All containers have no-new-privileges" }
        elseif ($total -gt 0) { Warn "$($total - $noPriv)/$total containers missing no-new-privileges" }

    } catch {
        Info "Docker not running or not accessible"
    }
} else {
    Info "Docker not installed"
}

# ─── 2. Windows Firewall ─────────────────────────────────────────
Step "Windows Firewall Audit"

$fwProfiles = Get-NetFirewallProfile -ErrorAction SilentlyContinue
foreach ($p in $fwProfiles) {
    if ($p.DefaultInboundAction -eq "Block") {
        Pass "$($p.Name) profile: inbound blocked by default"
    } else {
        Fail "$($p.Name) profile: inbound NOT blocked by default (action: $($p.DefaultInboundAction))"
    }
}

# Check for open inbound rules
$openRules = Get-NetFirewallRule -Direction Inbound -Enabled True -Action Allow -ErrorAction SilentlyContinue |
    Select-Object DisplayName, Direction, Action | Format-Table -AutoSize
Info "Active inbound allow rules:"
$openRules

# ─── 3. Windows Update ───────────────────────────────────────────
Step "Windows Update Status"

try {
    $hotfixes = Get-HotFix -ErrorAction SilentlyContinue | Sort-Object -Property InstalledOn -Descending | Select-Object -First 3
    if ($hotfixes) {
        Info "Latest hotfixes:"
        foreach ($hf in $hotfixes) {
            Info "  $($hf.HotFixID) - $($hf.InstalledOn.ToString('yyyy-MM-dd'))"
        }
    } else {
        Warn "No hotfixes found"
    }
} catch {
    Info "Cannot check hotfixes"
}

# ─── 4. Secrets Audit ────────────────────────────────────────────
Step "Secrets Audit"

$envFiles = Get-ChildItem -Path $Root -Filter ".env" -Recurse -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notlike "*node_modules*" -and $_.FullName -notlike "*.venv*" }
if ($envFiles) {
    foreach ($f in $envFiles) {
        $gitignored = git check-ignore $f.FullName 2>$null
        if (-not $gitignored) {
            Warn "Unignored env file: $($f.FullName)"
        }
    }
}

# Check .secrets directory
$secretsDir = Join-Path $Root ".secrets"
if (Test-Path $secretsDir) {
    $ignored = git check-ignore $secretsDir 2>$null
    if ($ignored) { Pass ".secrets/ directory is gitignored" }
    else { Fail ".secrets/ directory is NOT gitignored!" }
}

# ─── Summary ──────────────────────────────────────────────────────
Step "Security Audit Summary"
Write-Host ""
Write-Host "  PASS: $Pass" -ForegroundColor Green
Write-Host "  FAIL: $Fail" -ForegroundColor Red
Write-Host "  WARN: $Warn" -ForegroundColor Yellow
Write-Host ""

if ($Fail -gt 0) {
    Write-Host "  Security audit FAILED — $Fail critical issues found" -ForegroundColor Red
    exit 1
} else {
    Write-Host "  Security audit PASSED — no critical issues" -ForegroundColor Green
}
