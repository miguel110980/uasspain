param([switch]$Build, [switch]$InitializeKey, [string]$ComposeOverride,
    [ValidateSet('backend', 'frontend', 'nginx')][string[]]$Services)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
# Empty means unconfigured. Never invent provider credentials or overwrite an
# existing corporate password when rebuilding an encrypted installation.
if (-not (Test-Path -LiteralPath '.secrets/contact_smtp_password')) {
    [IO.File]::WriteAllText((Join-Path (Get-Location).Path '.secrets/contact_smtp_password'), '')
}
if (-not (Test-Path -LiteralPath '.secrets/postmark_server_token')) {
    [IO.File]::WriteAllText((Join-Path (Get-Location).Path '.secrets/postmark_server_token'), '')
}
$compose = @('compose','-p','uasspain','-f','docker-compose.yml','-f','docker-compose.encrypted.yml')
if ($ComposeOverride) {
    $overridePath = (Resolve-Path -LiteralPath $ComposeOverride -ErrorAction Stop).Path
    $workspacePath = (Get-Location).Path.TrimEnd('\') + '\'
    if (-not $overridePath.StartsWith($workspacePath, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'El override debe estar dentro del proyecto y revisarse antes del despliegue.'
    }
    $compose += @('-f', $overridePath)
}
& docker @compose config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Compose cifrado invalido.' }
$config = (& docker @compose config --format json | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0) { throw 'No se pudo leer la configuracion validada.' }
$permanentServices = @($config.services.PSObject.Properties.Name | Sort-Object)
if (($permanentServices -join ',') -ne 'backend,frontend,nginx,postgres,redis') {
    throw 'La pila permanente debe conservar exactamente los cinco servicios autorizados.'
}
$assetsVolume = $config.volumes.frontend_static.name
if (-not $assetsVolume) { throw 'Falta el volumen de assets persistentes.' }
$knownVolumes = @(& docker volume ls --format '{{.Name}}')
if ($LASTEXITCODE -ne 0) { throw 'No se pudo consultar los volumenes.' }
if ($knownVolumes -notcontains $assetsVolume) {
    & docker volume create --label uasspain.role=frontend-static $assetsVolume | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el volumen de assets.' }
}
if ($Build) {
    & docker @compose build @Services
    if ($LASTEXITCODE -ne 0) { throw 'Fallo al construir la pila.' }
}
if (-not $Services) {
    & docker @compose up -d --no-build postgres
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo iniciar PostgreSQL cifrado.' }
} else {
    $databaseRunning = & docker inspect uasspain-postgres --format '{{.State.Status}}'
    if ($LASTEXITCODE -ne 0 -or $databaseRunning -ne 'running') {
        throw 'El despliegue parcial requiere PostgreSQL existente en ejecucion.'
    }
}
& docker exec uasspain-postgres sh -c 'test -f /run/postgres-storage/mounted'
if ($LASTEXITCODE -ne 0) {
    & (Join-Path $PSScriptRoot 'unlock-postgres-storage.ps1') -Project uasspain -InitializeKey:$InitializeKey
}
# An already running LOCKED container has exhausted its healthcheck retries.
# Compose immediately rejects that stale unhealthy state, even after key delivery.
# Wait for PostgreSQL's own check to observe the unlocked database before up --wait.
$readyDeadline = [DateTime]::UtcNow.AddSeconds(180)
do {
    $postgresState = & docker inspect uasspain-postgres --format '{{.State.Status}} {{.State.Health.Status}}'
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo comprobar PostgreSQL.' }
    if ($postgresState -eq 'running healthy') { break }
    if ($postgresState -notlike 'running *') { throw 'PostgreSQL se detuvo durante el desbloqueo cifrado.' }
    if ([DateTime]::UtcNow -ge $readyDeadline) { throw 'PostgreSQL cifrado no supera su healthcheck tras el desbloqueo.' }
    Start-Sleep -Seconds 2
} while ($true)
if ($Services) {
    # Dependencies were inspected above. Do not recreate unaffected data/edge services.
    & docker @compose up -d --no-build --no-deps --wait --wait-timeout 180 @Services
} else {
    & docker @compose up -d --no-build --wait --wait-timeout 180
}
if ($LASTEXITCODE -ne 0) { throw 'La pila no supera los healthchecks.' }
foreach ($service in $permanentServices) {
    $serviceHealth = & docker inspect "uasspain-$service" --format '{{.State.Health.Status}}'
    if ($LASTEXITCODE -ne 0 -or $serviceHealth -ne 'healthy') {
        throw "El servicio $service no esta healthy tras el despliegue."
    }
}
& node tools/verify-postgres-storage.mjs uasspain
if ($LASTEXITCODE -ne 0) { throw 'El cifrado completo obligatorio no supera su verificacion.' }
