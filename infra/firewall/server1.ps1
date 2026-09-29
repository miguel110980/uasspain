# =============================================================================
# UASSPAIN — Firewall Configuration: Server 1 (Application) — Windows
# =============================================================================
# DENY ALL by default. Only opens: SSH, HTTP, HTTPS, WireGuard.
#
# Usage: .\infra\firewall\server1.ps1 [-DryRun]
# =============================================================================
param([switch]$DryRun)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. "$Root\infra\config.ps1"

function Step($msg)  { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)    { Write-Host "    OK: $msg" -ForegroundColor Green }
function Warn($msg)  { Write-Host "    AVISO: $msg" -ForegroundColor Yellow }
function Fail($msg)  { Write-Host "    ERROR: $msg" -ForegroundColor Red; exit 1 }

Step "Configuring Windows Firewall: Server 1 (Application)"

# ─── Remove existing UASSPAIN rules ──────────────────────────────
Step "Removing existing UASSPAIN rules..."
Get-NetFirewallRule -DisplayName "UASSPAIN-*" -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue

# ─── Block all inbound by default ────────────────────────────────
Step "Setting default inbound policy: Block"
Set-NetFirewallProfile -Profile Domain,Public,Private -DefaultInboundAction Block -DefaultOutboundAction Allow

# ─── Allow SSH ───────────────────────────────────────────────────
Step "Allowing SSH ($FW_SSH_PORT/tcp)..."
New-NetFirewallRule -DisplayName "UASSPAIN-SSH" -Direction Inbound -Protocol TCP -LocalPort $FW_SSH_PORT -Action Allow -Profile Any

# ─── Allow HTTP/HTTPS ────────────────────────────────────────────
Step "Allowing HTTP ($FW_HTTP_PORT) and HTTPS ($FW_HTTPS_PORT)..."
New-NetFirewallRule -DisplayName "UASSPAIN-HTTP" -Direction Inbound -Protocol TCP -LocalPort $FW_HTTP_PORT -Action Allow -Profile Any
New-NetFirewallRule -DisplayName "UASSPAIN-HTTPS" -Direction Inbound -Protocol TCP -LocalPort $FW_HTTPS_PORT -Action Allow -Profile Any

# ─── Allow WireGuard ─────────────────────────────────────────────
Step "Allowing WireGuard ($FW_WG_PORT/udp)..."
New-NetFirewallRule -DisplayName "UASSPAIN-WireGuard" -Direction Inbound -Protocol UDP -LocalPort $FW_WG_PORT -Action Allow -Profile Any

# ─── Allow VPN subnet ────────────────────────────────────────────
Step "Allowing traffic from VPN subnet ($VPN_SUBNET)..."
New-NetFirewallRule -DisplayName "UASSPAIN-VPN-Subnet" -Direction Inbound -RemoteAddress $VPN_SUBNET -Action Allow -Profile Any

Ok "Firewall configured: Server 1 (Application)"
Write-Host ""
Write-Host "  Open ports:"
Write-Host "    $FW_SSH_PORT/tcp  — SSH"
Write-Host "    $FW_HTTP_PORT/tcp — HTTP"
Write-Host "    $FW_HTTPS_PORT/tcp — HTTPS"
Write-Host "    $FW_WG_PORT/udp   — WireGuard"
Write-Host ""
Write-Host "  Verify: Get-NetFirewallRule -DisplayName 'UASSPAIN-*' | Format-Table DisplayName,Direction,Action"
Write-Host ""
