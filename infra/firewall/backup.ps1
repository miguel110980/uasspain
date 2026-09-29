# =============================================================================
# UASSPAIN — Firewall Configuration: Backup Servers (1-3) — Windows
# =============================================================================
# DENY ALL by default. Only opens: SSH (via VPN), WireGuard, SMB (via VPN).
# NO internet access.
#
# Usage: .\infra\firewall\backup.ps1 -Server backup1 [-DryRun]
# =============================================================================
param(
    [Parameter(Mandatory=$true)]
    [string]$Server,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. "$Root\infra\config.ps1"

function Step($msg)  { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)    { Write-Host "    OK: $msg" -ForegroundColor Green }
function Fail($msg)  { Write-Host "    ERROR: $msg" -ForegroundColor Red; exit 1 }

# Get VPN IP for target server
switch ($Server) {
    "backup1" { $ServerVPNIP = $BACKUP1_VPN_IP }
    "backup2" { $ServerVPNIP = $BACKUP2_VPN_IP }
    "backup3" { $ServerVPNIP = $BACKUP3_VPN_IP }
    default { Fail "Invalid server: $Server" }
}

Step "Configuring Windows Firewall: $Server ($ServerVPNIP)"

# ─── Remove existing rules ───────────────────────────────────────
Get-NetFirewallRule -DisplayName "UASSPAIN-*" -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue

# ─── Block all inbound ───────────────────────────────────────────
Set-NetFirewallProfile -Profile Domain,Public,Private -DefaultInboundAction Block -DefaultOutboundAction Allow

# ─── Allow SSH (VPN only) ────────────────────────────────────────
Step "Allowing SSH via VPN only..."
New-NetFirewallRule -DisplayName "UASSPAIN-SSH" -Direction Inbound -Protocol TCP -LocalPort $FW_SSH_PORT -RemoteAddress $VPN_SUBNET -Action Allow

# ─── Allow WireGuard ─────────────────────────────────────────────
New-NetFirewallRule -DisplayName "UASSPAIN-WireGuard" -Direction Inbound -Protocol UDP -LocalPort $FW_WG_PORT -Action Allow

# ─── Allow SMB from PostgreSQL server only ────────────────────────
Step "Allowing SMB from $SERVER2_VPN_IP only..."
New-NetFirewallRule -DisplayName "UASSPAIN-SMB" -Direction Inbound -Protocol TCP -LocalPort $FW_SMB_PORT -RemoteAddress $SERVER2_VPN_IP -Action Allow
New-NetFirewallRule -DisplayName "UASSPAIN-NetBIOS" -Direction Inbound -Protocol TCP -LocalPort $FW_NETBIOS_PORT -RemoteAddress $SERVER2_VPN_IP -Action Allow

# ─── Allow VPN subnet ────────────────────────────────────────────
New-NetFirewallRule -DisplayName "UASSPAIN-VPN-Subnet" -Direction Inbound -RemoteAddress $VPN_SUBNET -Action Allow

# ─── Block outbound internet ─────────────────────────────────────
Set-NetFirewallProfile -Profile Domain,Public,Private -DefaultOutboundAction Block
New-NetFirewallRule -DisplayName "UASSPAIN-Out-VPN" -Direction Outbound -RemoteAddress $VPN_SUBNET -Action Allow
New-NetFirewallRule -DisplayName "UASSPAIN-Out-DNS" -Direction Outbound -Protocol UDP -RemotePort 53 -RemoteAddress $VPN_SUBNET -Action Allow

Ok "Firewall configured: $Server"
Write-Host ""
Write-Host "  Internet access: BLOCKED"
Write-Host "  Open ports:"
Write-Host "    $FW_SSH_PORT/tcp   — SSH (VPN only)"
Write-Host "    $FW_WG_PORT/udp    — WireGuard"
Write-Host "    $FW_SMB_PORT/tcp   — SMB (from $SERVER2_VPN_IP only)"
Write-Host "    $FW_NETBIOS_PORT/tcp — NetBIOS (from $SERVER2_VPN_IP only)"
Write-Host ""
