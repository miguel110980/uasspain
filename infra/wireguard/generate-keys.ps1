# =============================================================================
# UASSPAIN — WireGuard Key Generation (Windows/PowerShell)
# =============================================================================
# Generates unique key pairs for each server. Keys are NEVER stored in Git.
#
# Usage: .\infra\wireguard\generate-keys.ps1 [-Force]
# =============================================================================
param([switch]$Force)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. "$Root\infra\config.ps1"

function Step($msg)  { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)    { Write-Host "    OK: $msg" -ForegroundColor Green }
function Warn($msg)  { Write-Host "    AVISO: $msg" -ForegroundColor Yellow }
function Fail($msg)  { Write-Host "    ERROR: $msg" -ForegroundColor Red; exit 1 }

# ─── Validate prerequisites ─────────────────────────────────────
$wgPath = "$env:ProgramFiles\WireGuard\wg.exe"
if (-not (Test-Path $wgPath)) {
    Fail "WireGuard no está instalado. Instala desde https://www.wireguard.com/install/"
}

# ─── Create key directory ────────────────────────────────────────
$KeyDir = Join-Path $Root $WG_KEY_DIR
if (-not (Test-Path $KeyDir)) {
    New-Item -ItemType Directory -Path $KeyDir -Force | Out-Null
}

# ─── Server definitions ──────────────────────────────────────────
$Servers = @(
    @{ Name = "server1"; VpnIP = $SERVER1_VPN_IP },
    @{ Name = "server2"; VpnIP = $SERVER2_VPN_IP },
    @{ Name = "backup1"; VpnIP = $BACKUP1_VPN_IP },
    @{ Name = "backup2"; VpnIP = $BACKUP2_VPN_IP },
    @{ Name = "backup3"; VpnIP = $BACKUP3_VPN_IP }
)

# ─── Generate keys ───────────────────────────────────────────────
Step "Generating WireGuard keys for $($Servers.Count) servers..."

foreach ($server in $Servers) {
    $name = $server.Name
    $vpnIP = $server.VpnIP
    $privkeyFile = Join-Path $KeyDir "$name.privatekey"
    $pubkeyFile = Join-Path $KeyDir "$name.publickey"
    $pskFile = Join-Path $KeyDir "$name.psk"

    if ((Test-Path $privkeyFile) -and -not $Force) {
        Warn "Keys for $name already exist. Use -Force to regenerate."
        continue
    }

    Step "Generating keys for $name ($vpnIP)..."

    # Generate private key
    $privkey = & $wgPath genkey
    Set-Content -Path $privkeyFile -Value $privkey -NoNewline
    (Get-Item $privkeyFile).Attributes = 'Hidden'

    # Derive public key
    $pubkey = $privkey | & $wgPath pubkey
    Set-Content -Path $pubkeyFile -Value $pubkey -NoNewline

    # Generate preshared key
    $psk = & $wgPath genpsk
    Set-Content -Path $pskFile -Value $psk -NoNewline
    (Get-Item $pskFile).Attributes = 'Hidden'

    Ok "Keys generated: $name"
}

# ─── Display public keys ─────────────────────────────────────────
Step "Public keys (share these, NEVER share private keys):"
Write-Host ""
Write-Host ("{0,-12} {1,-15} {2}" -f "SERVER", "VPN IP", "PUBLIC KEY")
Write-Host ("{0,-12} {1,-15} {2}" -f "------", "-------", "----------")
foreach ($server in $Servers) {
    $pubkey = Get-Content (Join-Path $KeyDir "$($server.Name).publickey")
    Write-Host ("{0,-12} {1,-15} {2}" -f $server.Name, $server.VpnIP, $pubkey)
}
Write-Host ""
Ok "All keys generated in: $KeyDir"
Warn "NEVER commit private keys or PSKs to Git!"
