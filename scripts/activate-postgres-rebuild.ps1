param(
    [ValidatePattern('^uasspain-rebuild-[a-z0-9_-]+$')]
    [string]$Project = 'uasspain-rebuild-20261003'
)

$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $workspace
foreach ($variable in @('POSTGRES_DATA_VOLUME_NAME','POSTGRES_VARLIB_VOLUME_NAME','POSTGRES_CIPHERTEXT_VOLUME_NAME','COMPOSE_FILE')) {
    if ([Environment]::GetEnvironmentVariable($variable, 'Process')) {
        throw "Retire el override $variable de esta sesion: la activacion controla esos nombres mediante .env."
    }
}
# No BitLocker dependency: the dedicated filesystem and swap must pass.
& node tools/verify-postgres-storage.mjs $Project
if ($LASTEXITCODE -ne 0) { throw 'El almacenamiento cifrado no cumple el gate obligatorio.' }
$applicationReport = Get-Content -LiteralPath ".run/$Project/application-verification.json" -Raw | ConvertFrom-Json
foreach ($check in @('https_ca_hostname','real_admin_login','personal_fields_match','unassigned_role_denied','multirole_session_switch','admin_api_isolation','roles_restored_admin_only','chromium_login_admin')) {
    if ($applicationReport.$check -ne $true) { throw "Falta validacion real de aplicacion: $check" }
}
& node tools/postgres-rebuild.mjs verify $Project
if ($LASTEXITCODE -ne 0) { throw 'La verificacion PostgreSQL ha fallado.' }

# Construir primero; hasta este punto la pila principal sigue intacta.
& docker compose -p uasspain -f docker-compose.yml build backend postgres
if ($LASTEXITCODE -ne 0) { throw 'No se pudo preparar la imagen principal.' }
& docker compose -p uasspain -f docker-compose.yml -f docker-compose.encrypted.yml build postgres
if ($LASTEXITCODE -ne 0) { throw 'No se pudo preparar la imagen cifrada.' }
& docker compose -p uasspain -f docker-compose.yml config --format json | Out-String -OutVariable originalModelJson | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudo leer el modelo principal.' }
$originalModel = $originalModelJson | ConvertFrom-Json
$previousData = $originalModel.volumes.postgres_data.name
$previousVarlib = $originalModel.volumes.postgres_varlib.name
$newCiphertext = "${Project}_postgres_ciphertext"
$activeMountsJson = & docker inspect uasspain-postgres --format '{{json .Mounts}}'
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron verificar los volumenes actuales.' }
$activeMounts = $activeMountsJson | ConvertFrom-Json
$previousCipher = $activeMounts | Where-Object { $_.Destination -eq '/encrypted-postgres' }
if ($activeMounts | Where-Object { $_.Name -eq $newCiphertext }) { throw 'La reconstruccion ya es el destino activo.' }
$environmentPath = Join-Path $workspace '.env'
$environmentExisted = Test-Path -LiteralPath $environmentPath
$previousEnvironment = if ($environmentExisted) { [System.IO.File]::ReadAllText($environmentPath) } else { '' }
$nextEnvironment = [regex]::Replace($previousEnvironment, '(?m)^(POSTGRES_(DATA|VARLIB|CIPHERTEXT)_VOLUME_NAME|POSTGRES_CIPHERTEXT_EXTERNAL|COMPOSE_FILE)=.*\r?\n?', '')
$nextEnvironment = $nextEnvironment.TrimEnd() + "`nPOSTGRES_CIPHERTEXT_VOLUME_NAME=$newCiphertext`nPOSTGRES_CIPHERTEXT_EXTERNAL=true`nCOMPOSE_FILE=docker-compose.yml;docker-compose.encrypted.yml`n"

try {
    & docker compose -p $Project -f docker-compose.yml -f docker-compose.encrypted.yml -f docker-compose.rebuild.yml stop
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo detener el candidato.' }
    & docker compose -p uasspain -f docker-compose.yml stop backend postgres
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo detener PostgreSQL principal.' }
    [System.IO.File]::WriteAllText($environmentPath, $nextEnvironment, [System.Text.UTF8Encoding]::new($false))
    & docker compose -p uasspain -f docker-compose.yml -f docker-compose.encrypted.yml up -d --no-build postgres
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el servidor cifrado.' }
    & (Join-Path $PSScriptRoot 'unlock-postgres-storage.ps1') -Project uasspain
    & docker compose -p uasspain -f docker-compose.yml -f docker-compose.encrypted.yml up -d --no-build --wait --wait-timeout 180
    if ($LASTEXITCODE -ne 0) { throw 'La pila reconstruida no supera los healthchecks.' }
    & node tools/verify-postgres-storage.mjs uasspain
    if ($LASTEXITCODE -ne 0) { throw 'La pila principal no supera el gate de cifrado.' }
} catch {
    # Evitar dos servidores sobre el mismo PGDATA y recuperar el destino anterior.
    & docker compose -p uasspain -f docker-compose.yml -f docker-compose.encrypted.yml stop backend postgres
    if ($environmentExisted) {
        [System.IO.File]::WriteAllText($environmentPath, $previousEnvironment, [System.Text.UTF8Encoding]::new($false))
    } else {
        Remove-Item -LiteralPath $environmentPath
    }
    if ($null -ne $previousCipher) {
        & docker compose -p uasspain -f docker-compose.yml -f docker-compose.encrypted.yml up -d --no-build postgres
        if ($LASTEXITCODE -eq 0) { & (Join-Path $PSScriptRoot 'unlock-postgres-storage.ps1') -Project uasspain }
        & docker compose -p uasspain -f docker-compose.yml -f docker-compose.encrypted.yml up -d --no-build --wait --wait-timeout 180
    }
    throw 'Activacion fallida. Se conserva la configuracion y todos los datos anteriores. No se permite arrancar PostgreSQL en claro; compruebe el estado antes de recuperar.'
}
[pscustomobject]@{
    Activated = $true
    PostgresCiphertext = $newCiphertext
    RollbackPostgresData = $previousData
    RollbackPostgresVarlib = $previousVarlib
    EncryptedBackup = ".run/$Project/original-database.pgcustom.enc"
} | ConvertTo-Json
