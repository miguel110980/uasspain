param([switch]$Build, [switch]$InitializeKey)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$compose = @('compose','-p','uasspain','-f','docker-compose.yml','-f','docker-compose.encrypted.yml')
& docker @compose config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Compose cifrado invalido.' }
if ($Build) {
    & docker @compose build
    if ($LASTEXITCODE -ne 0) { throw 'Fallo al construir la pila.' }
}
& docker @compose up -d --no-build postgres
if ($LASTEXITCODE -ne 0) { throw 'No se pudo iniciar PostgreSQL cifrado.' }
& docker exec uasspain-postgres sh -c 'test -f /run/postgres-storage/mounted'
if ($LASTEXITCODE -ne 0) {
    & (Join-Path $PSScriptRoot 'unlock-postgres-storage.ps1') -Project uasspain -InitializeKey:$InitializeKey
}
& docker @compose up -d --no-build --wait --wait-timeout 180
if ($LASTEXITCODE -ne 0) { throw 'La pila no supera los healthchecks.' }
& node tools/verify-postgres-storage.mjs uasspain
if ($LASTEXITCODE -ne 0) { throw 'El cifrado completo obligatorio no supera su verificacion.' }
