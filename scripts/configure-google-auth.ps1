param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$')]
    [string]$ClientId
)
$ErrorActionPreference = 'Stop'
$workspacePath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$envPath = Join-Path $workspacePath '.env'
if (-not (Test-Path -LiteralPath $envPath)) { throw 'Falta el .env local de la instalacion.' }
$content = [IO.File]::ReadAllText($envPath)
$lines = @($content -split '\r?\n' | Where-Object { $_ -notmatch '^GOOGLE_CLIENT_ID=' })
$updated = ($lines -join "`r`n").TrimEnd("`r", "`n") + "`r`nGOOGLE_CLIENT_ID=$ClientId`r`n"
[IO.File]::WriteAllText($envPath, $updated, (New-Object Text.UTF8Encoding($false)))
& (Join-Path $PSScriptRoot 'start-encrypted-stack.ps1')
if ($LASTEXITCODE -ne 0) { throw 'No se pudo activar la configuracion de Google.' }
Write-Output 'Client ID configurado. Compruebe en Google Cloud el origen HTTPS autorizado y pruebe el acceso con su cuenta.'
