# =============================================================================
# UASSPAIN — WireGuard Setup (Windows/PowerShell)
# =============================================================================
# Installs WireGuard if needed, activates tunnel, validates connectivity.
#
# Usage: .\infra\wireguard\setup.ps1 [-Server SERVER_NAME] [-DryRun] [-AllowInstall]
# =============================================================================
param(
    [ValidateSet('', 'server1', 'server2', 'backup1', 'backup2', 'backup3')]
    [string]$Server = "",
    [switch]$DryRun,
    [switch]$AllowInstall
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $Root 'infra\config.ps1')

function Step($msg)  { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)    { Write-Host "    OK: $msg" -ForegroundColor Green }
function Warn($msg)  { Write-Host "    AVISO: $msg" -ForegroundColor Yellow }
function Fail($msg)  { Write-Host "    ERROR: $msg" -ForegroundColor Red; exit 1 }

$wgPath = "$env:ProgramFiles\WireGuard\wg.exe"
$wireguardExe = "$env:ProgramFiles\WireGuard\wireguard.exe"
$script:ActiveTunnelName = ''

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
    if ($DryRun) { Write-Host '[dry-run] Check WireGuard; installation requires -AllowInstall.'; return }
    if ((Test-Path $wgPath) -and (Test-Path $wireguardExe)) {
        Ok "WireGuard already installed"
        return
    }

    if (-not $AllowInstall) { Fail 'WireGuard missing. Installation requires explicit -AllowInstall authorization.' }
    $installer = Join-Path ([IO.Path]::GetTempPath()) ('uasspain-wireguard-' + [guid]::NewGuid().ToString('N') + '.exe')
    Invoke-WebRequest -Uri 'https://download.wireguard.com/windows-client/wireguard-installer.exe' -OutFile $installer -UseBasicParsing
    $signature = Get-AuthenticodeSignature -LiteralPath $installer
    if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate -or $signature.SignerCertificate.Subject -notmatch '(?:^|,\s*)CN=WireGuard LLC(?:,|$)') {
        Fail 'WireGuard installer signature/publisher validation failed; installer not executed.'
    }
    $installProcess = Start-Process -FilePath $installer -ArgumentList '/install', '/quiet' -Wait -PassThru -WindowStyle Hidden
    if ($installProcess.ExitCode -ne 0) { Fail 'WireGuard installer failed; no installation success claimed.' }
    if (-not (Test-Path $wgPath) -or -not (Test-Path $wireguardExe)) {
        Fail "No se pudo instalar WireGuard. Instala manualmente desde https://www.wireguard.com/install/"
    }

    Ok "WireGuard installed"
}

# ─── Activate WireGuard tunnel ───────────────────────────────────
function Activate-Tunnel {
    param([string]$ServerName)

    if ($DryRun) { Write-Host "[dry-run] Request tunnel service for $ServerName; no activation performed."; return }
    $confFile = Join-Path $Root "$WG_CONFIG_DIR\$ServerName.conf"
    if (-not (Test-Path $confFile)) {
        Fail "Config not found: $confFile — run generate-configs.ps1 first"
    }

    Step "Activating WireGuard tunnel ($ServerName)..."

    $tunnelName = [IO.Path]::GetFileNameWithoutExtension($confFile)
    $serviceName = 'WireGuardTunnel$' + $tunnelName
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($service -and $service.Status -ne 'Running') {
        Fail 'The named tunnel service already exists but is stopped. Review its configuration; it is not replaced or restarted automatically.'
    }
    if (-not $service) {
        & $wireguardExe /installtunnelservice $confFile
        if ($LASTEXITCODE -ne 0) { Fail 'Tunnel service installation failed; no activation success claimed.' }
        $service = Get-Service -Name $serviceName -ErrorAction Stop
        $service.WaitForStatus('Running', [TimeSpan]::FromSeconds(10))
    }
    $script:ActiveTunnelName = $tunnelName
    $interfaces = @(Get-WireGuardStatus -Tunnel $tunnelName -Field 'interfaces') -join ' '
    if ($tunnelName -notin ($interfaces -split '\s+')) { Fail 'The requested tunnel interface is not active.' }
    Ok "Named tunnel interface active: $tunnelName; peer connectivity not yet validated"
}

function Get-WireGuardStatus {
    param([string]$Tunnel, [ValidateSet('interfaces', 'allowed-ips', 'latest-handshakes')][string]$Field)
    if ($Field -eq 'interfaces') { $output = @(& $wgPath show interfaces 2>$null) }
    else { $output = @(& $wgPath show $Tunnel $Field 2>$null) }
    if ($LASTEXITCODE -ne 0) { Fail 'Could not read WireGuard public status.' }
    return $output
}

function Test-IPInPrefix {
    param([string]$Address, [string]$Prefix)
    $parts = $Prefix.Split('/')
    if ($parts.Count -ne 2) { return $false }
    $ip = $null; $network = $null; $bits = 0
    if (-not [Net.IPAddress]::TryParse($Address, [ref]$ip) -or -not [Net.IPAddress]::TryParse($parts[0], [ref]$network) -or -not [int]::TryParse($parts[1], [ref]$bits)) { return $false }
    $a = $ip.GetAddressBytes(); $b = $network.GetAddressBytes()
    if ($a.Length -ne $b.Length -or $bits -lt 0 -or $bits -gt $a.Length * 8) { return $false }
    for ($i = 0; $i -lt $a.Length; $i++) {
        $remaining = [Math]::Min(8, [Math]::Max(0, $bits - 8 * $i))
        $mask = if ($remaining -eq 0) { 0 } else { (255 -shl (8 - $remaining)) -band 255 }
        if (($a[$i] -band $mask) -ne ($b[$i] -band $mask)) { return $false }
    }
    return $true
}

function Assert-RecentPeerHandshake {
    param([string[]]$AllowedIPs, [string[]]$Handshakes, [string]$TargetIP, [long]$Now)
    $matchingPeers = @($AllowedIPs | ForEach-Object {
        $parts = $_ -split '\s+', 2
        if ($parts.Count -eq 2) {
            foreach ($prefix in ($parts[1] -split ',')) {
                if (Test-IPInPrefix -Address $TargetIP -Prefix $prefix.Trim()) { $parts[0]; break }
            }
        }
    } | Select-Object -Unique)
    if ($matchingPeers.Count -ne 1) { Fail 'No unique configured peer covers the target IP.' }
    $handshakeMatches = @($Handshakes | Where-Object { ($_ -split '\s+', 2)[0] -eq $matchingPeers[0] })
    if ($handshakeMatches.Count -ne 1) { Fail 'No unique handshake for the target peer.' }
    $fields = $handshakeMatches[0] -split '\s+', 2; $timestamp = 0L
    if ($fields.Count -ne 2 -or -not [long]::TryParse($fields[1], [ref]$timestamp) -or $timestamp -le 0 -or $Now - $timestamp -lt 0 -or $Now - $timestamp -gt 180) {
        Fail 'Target peer handshake missing, invalid or older than 180 seconds.'
    }
}

# ─── Validate connectivity ───────────────────────────────────────
function Test-VPNConnectivity {
    param([string]$TargetIP, [string]$TargetName)

    if ($DryRun) { Write-Host "[dry-run] Check route and recent peer handshake for $TargetName; not validated."; return }
    Step "Validating connectivity to $TargetName ($TargetIP)..."
    if (-not $script:ActiveTunnelName) { Fail 'No validated named tunnel interface.' }
    $routes = @(Find-NetRoute -RemoteIPAddress $TargetIP -ErrorAction Stop | Where-Object { $_.PSObject.Properties['DestinationPrefix'] })
    if ($routes.Count -ne 1 -or $routes[0].InterfaceAlias -ne $script:ActiveTunnelName) { Fail 'Selected route does not use the requested WireGuard tunnel.' }
    # Generate traffic only through the already verified route; ping alone is not proof.
    $null = Test-Connection -ComputerName $TargetIP -Count 1 -Quiet -ErrorAction SilentlyContinue
    $allowed = @(Get-WireGuardStatus -Tunnel $script:ActiveTunnelName -Field 'allowed-ips')
    $handshakes = @(Get-WireGuardStatus -Tunnel $script:ActiveTunnelName -Field 'latest-handshakes')
    Assert-RecentPeerHandshake -AllowedIPs $allowed -Handshakes $handshakes -TargetIP $TargetIP -Now ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
    Ok "${TargetName}: selected tunnel route and recent target-peer handshake verified; SFTP not tested"
}

# ─── Main ────────────────────────────────────────────────────────
$ServerName = if ($Server) { $Server } else { Get-ServerRole }
if ($ServerName -eq "unknown") {
    Fail "No se pudo determinar el servidor actual. Usa -Server SERVER_NAME"
}

Step "Setting up WireGuard for: $ServerName"

if ($DryRun) {
    Write-Host "[dry-run] Plan for $ServerName only: check tools, request named service, then verify routes and target-peer handshakes."
    Write-Host '[dry-run] No download, installation, service change, network probe or tunnel activation performed. VPN/SFTP NOT_VALIDATED.'
    return
}

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
