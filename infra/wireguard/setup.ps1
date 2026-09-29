# =============================================================================
# UASSPAIN — WireGuard Setup (Windows/PowerShell)
# =============================================================================
# Installs WireGuard if needed, activates tunnel, validates connectivity.
#
# Usage: .\infra\wireguard\setup.ps1 [-Server SERVER_NAME] [-DryRun]
# =============================================================================
param(
    [string]$Server = "",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. "$Root\infra\config.ps1"

function Step($msg)  { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)    { Write-Host "    OK: $msg" -ForegroundColor Green }
function Warn($msg)  { Write-Host "    AVISO: $msg" -ForegroundColor Yellow }
function Fail($msg)  { Write-Host "    ERROR: $msg" -ForegroundColor Red; exit 1 }

$wgPath = "$env:ProgramFiles\WireGuard\wg.exe"
$wgQuick = "$env:ProgramFiles\WireGuard\wg-quick.exe"

# ─── Detect current server ───────────────────────────────────────
function Get-ServerRole {
    $adapters = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -like "10.50.0.*" }
    if ($adapters) {
        $ip = $adapters[0].IPAddress
        switch ($ip) {
            $SERVER1_VPN_IP { return "server1" }
            $SERVER2_VPN_IP { return "server2" }
            $BACKUP1_VPN_IP { return "backup1" }
            $BACKUP2_VPN_IP { return "backup2" }
            $BACKUP3_VPN_IP { return "backup3" }
        }
    }
    return "unknown"
}

# ─── Install WireGuard ──────────────────────────────────────────
function Install-WireGuard {
    if (Test-Path $wgPath) {
        Ok "WireGuard already installed"
        return
    }

    Step "Installing WireGuard..."

    $wgUrl = "https://download.wireguard.com/windows-client/wireguard-amd64-0.5.3.msix"
    $installer = "$env:TEMP\WireGuard Installer.msix"

    Step "Downloading WireGuard..."
    Invoke-WebRequest -Uri $wgUrl -OutFile $installer -UseBasicParsing

    Step "Installing WireGuard..."
    Add-AppxPackage -Path $installer -ErrorAction SilentlyContinue

    if (-not (Test-Path $wgPath)) {
        $wgExeUrl = "https://download.wireguard.com/wireguard-amd64-0.5.3.exe"
        $wgExeInstaller = "$env:TEMP\wireguard-install.exe"
        Invoke-WebRequest -Uri $wgExeUrl -OutFile $wgExeInstaller -UseBasicParsing
        Start-Process -FilePath $wgExeInstaller -ArgumentList "/install", "/quiet" -Wait -NoNewWindow
    }

    if (-not (Test-Path $wgPath)) {
        Fail "No se pudo instalar WireGuard. Instala manualmente desde https://www.wireguard.com/install/"
    }

    Ok "WireGuard installed"
}

# ─── Activate WireGuard tunnel ───────────────────────────────────
function Activate-Tunnel {
    param([string]$ServerName)

    $confFile = Join-Path $Root "$WG_CONFIG_DIR\$ServerName.conf"
    if (-not (Test-Path $confFile)) {
        Fail "Config not found: $confFile — run generate-configs.ps1 first"
    }

    Step "Activating WireGuard tunnel ($ServerName)..."

    # Check if already active
    $adapter = Get-NetAdapter -InterfaceDescription '*WireGuard*' -ErrorAction SilentlyContinue
    if ($adapter -and $adapter.Status -eq 'Up') {
        Ok "WireGuard interface already active: $($adapter.Name)"
        return
    }

    # Import and activate
    if (-not $DryRun) {
        & $wgQuick up $confFile 2>$null
        if ($LASTEXITCODE -ne 0) {
            Warn "wg-quick failed, trying manual import..."
            & $wgPath /importconfig $confFile 2>$null
        }
    } else {
        Write-Host "  [dry-run] & $wgQuick up $confFile"
    }

    Start-Sleep -Seconds 2
    Ok "WireGuard tunnel activated"
}

# ─── Validate connectivity ───────────────────────────────────────
function Test-VPNConnectivity {
    param([string]$TargetIP, [string]$TargetName)

    Step "Validating connectivity to $TargetName ($TargetIP)..."

    $result = Test-NetConnection -ComputerName $TargetIP -Port 51820 -WarningAction SilentlyContinue
    if ($result.TcpTestSucceeded) {
        Ok "$TargetName reachable via WireGuard"
    } else {
        Warn "$TargetName no responde en puerto 51820 (puede ser normal si el firewall bloquea TCP)"
        # Try ping
        $ping = Test-Connection -ComputerName $TargetIP -Count 2 -Quiet -ErrorAction SilentlyContinue
        if ($ping) {
            Ok "$TargetName reachable via ICMP"
        } else {
            Warn "$TargetName no responde a ping (ICMP puede estar bloqueado)"
        }
    }
}

# ─── Main ────────────────────────────────────────────────────────
$ServerName = if ($Server) { $Server } else { Get-ServerRole }
if ($ServerName -eq "unknown") {
    Fail "No se pudo determinar el servidor actual. Usa -Server SERVER_NAME"
}

Step "Setting up WireGuard for: $ServerName"

Install-WireGuard
Activate-Tunnel -ServerName $ServerName

# Validate connectivity based on role
switch ($ServerName) {
    "server1" {
        Test-VPNConnectivity -TargetIP $SERVER2_VPN_IP -TargetName "Server 2 (PostgreSQL)"
    }
    "server2" {
        Test-VPNConnectivity -TargetIP $SERVER1_VPN_IP -TargetName "Server 1 (Application)"
        Test-VPNConnectivity -TargetIP $BACKUP1_VPN_IP -TargetName "Backup 1"
        Test-VPNConnectivity -TargetIP $BACKUP2_VPN_IP -TargetName "Backup 2"
        Test-VPNConnectivity -TargetIP $BACKUP3_VPN_IP -TargetName "Backup 3"
    }
    { $_ -in "backup1","backup2","backup3" } {
        Test-VPNConnectivity -TargetIP $SERVER2_VPN_IP -TargetName "Server 2 (PostgreSQL)"
    }
}

Write-Host ""
Ok "WireGuard setup complete for $ServerName"
Write-Host ""
Write-Host "  Verify manually:"
Write-Host "    $wgPath show"
Write-Host ""
