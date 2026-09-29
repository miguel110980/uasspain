# =============================================================================
# UASSPAIN — Firewall Configuration: Server 2 (PostgreSQL) — Windows
# =============================================================================
# DENY ALL by default. Only opens: SSH (via VPN), WireGuard, PostgreSQL (via VPN).
# NO internet access.
#
# Usage: .\infra\firewall\server2.ps1 [-DryRun]
# =============================================================================
param([switch]$DryRun)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. "$Root\infra\config.ps1"

function Step($msg)  { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)    { Write-Host "    OK: $msg" -ForegroundColor Green }
function Fail($msg)  { Write-Host "    ERROR: $msg" -ForegroundColor Red; exit 1 }

Step "Configuring Windows Firewall: Server 2 (PostgreSQL)"

# ─── Remove existing rules ───────────────────────────────────────
Get-NetFirewallRule -DisplayName "UASSPAIN-*" -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue

# ─── Block all inbound ───────────────────────────────────────────
Set-NetFirewallProfile -Profile Domain,Public,Private -DefaultInboundAction Block -DefaultOutboundAction Allow

# ─── Allow SSH (VPN only) ────────────────────────────────────────
Step "Allowing SSH via VPN only..."
New-NetFirewallRule -DisplayName "UASSPAIN-SSH" -Direction Inbound -Protocol TCP -LocalPort $FW_SSH_PORT -RemoteAddress $VPN_SUBNET -Action Allow

# ─── Allow WireGuard ─────────────────────────────────────────────
Step "Allowing WireGuard..."
New-NetFirewallRule -DisplayName "UASSPAIN-WireGuard" -Direction Inbound -Protocol UDP -LocalPort $FW_WG_PORT -Action Allow

# ─── Allow PostgreSQL from App server only ────────────────────────
Step "Allowing PostgreSQL from $SERVER1_VPN_IP only..."
New-NetFirewallRule -DisplayName "UASSPAIN-PG-App" -Direction Inbound -Protocol TCP -LocalPort $FW_PG_PORT -RemoteAddress $SERVER1_VPN_IP -Action Allow

# ─── Allow PostgreSQL from Backup servers ────────────────────────
New-NetFirewallRule -DisplayName "UASSPAIN-PG-Backup1" -Direction Inbound -Protocol TCP -LocalPort $FW_PG_PORT -RemoteAddress $BACKUP1_VPN_IP -Action Allow
New-NetFirewallRule -DisplayName "UASSPAIN-PG-Backup2" -Direction Inbound -Protocol TCP -LocalPort $FW_PG_PORT -RemoteAddress $BACKUP2_VPN_IP -Action Allow
New-NetFirewallRule -DisplayName "UASSPAIN-PG-Backup3" -Direction Inbound -Protocol TCP -LocalPort $FW_PG_PORT -RemoteAddress $BACKUP3_VPN_IP -Action Allow

# ─── Allow VPN subnet ────────────────────────────────────────────
New-NetFirewallRule -DisplayName "UASSPAIN-VPN-Subnet" -Direction Inbound -RemoteAddress $VPN_SUBNET -Action Allow

# ─── Block outbound internet ─────────────────────────────────────
Step "Blocking outbound internet access..."
Set-NetFirewallProfile -Profile Domain,Public,Private -DefaultOutboundAction Block
# Allow only VPN subnet outbound
New-NetFirewallRule -DisplayName "UASSPAIN-Out-VPN" -Direction Outbound -RemoteAddress $VPN_SUBNET -Action Allow
# Allow DNS to VPN peers
New-NetFirewallRule -DisplayName "UASSPAIN-Out-DNS" -Direction Outbound -Protocol UDP -RemotePort 53 -RemoteAddress $VPN_SUBNET -Action Allow

Ok "Firewall configured: Server 2 (PostgreSQL)"
Write-Host ""
Write-Host "  Internet access: BLOCKED"
Write-Host "  Open ports:"
Write-Host "    $FW_SSH_PORT/tcp — SSH (VPN only)"
Write-Host "    $FW_WG_PORT/udp  — WireGuard"
Write-Host "    $FW_PG_PORT/tcp  — PostgreSQL (from authorized VPN IPs only)"
Write-Host ""
