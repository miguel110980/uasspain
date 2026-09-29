# Runner E2E Rust: pila aislada -> semillas por API -> suite -> teardown.
param([switch]$Keep)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ComposeFile = Join-Path $Root 'docker-compose.e2e.yml'
$BackendContext = Join-Path $Root 'backend-rust'
$Docker = (Get-Command docker -ErrorAction Stop).Source
$ExitCode = 1
$KeyDir = Join-Path ([IO.Path]::GetTempPath()) 'uasspain-e2e-keys'
$EncryptionKeyBytes = [byte[]]::new(32)
$EncryptionKeyRng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $EncryptionKeyRng.GetBytes($EncryptionKeyBytes) }
finally { $EncryptionKeyRng.Dispose() }
$env:E2E_FIELD_ENCRYPTION_KEY = [Convert]::ToBase64String($EncryptionKeyBytes)

function Invoke-E2EJson {
    param(
        [Parameter(Mandatory)] [string]$Method,
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [object]$Body,
        [Microsoft.PowerShell.Commands.WebRequestSession]$Session
    )
    $params = @{
        Uri = "http://127.0.0.1:8010$Path"
        Method = $Method
        ContentType = 'application/json'
        Headers = @{ Origin = 'http://localhost:8010' }
        Body = ($Body | ConvertTo-Json -Depth 8 -Compress)
    }
    if ($Session) { $params.WebSession = $Session }
    Invoke-RestMethod @params
}

try {
    Write-Host '==> Reconstruyendo backend Rust E2E desde el lockfile'
    & $Docker build -t uasspain-backend:e2e-local $BackendContext
    if ($LASTEXITCODE -ne 0) { throw 'build E2E falló' }

    $PrivKey = Join-Path $KeyDir 'backup_sftp_ed25519'
    if (-not (Test-Path -LiteralPath $PrivKey)) {
        New-Item -ItemType Directory -Force -Path $KeyDir | Out-Null
        & ssh-keygen -q -t ed25519 -N '""' -f $PrivKey -C uasspain-e2e-backup
        if ($LASTEXITCODE -ne 0) { throw 'ssh-keygen E2E falló' }
    }
    $env:E2E_BACKUP_SSH_PUB = (Get-Content -LiteralPath "$PrivKey.pub" -Raw).Trim()

    Write-Host '==> Recreando pila E2E aislada'
    & $Docker compose -f $ComposeFile down -v --remove-orphans
    & $Docker compose -f $ComposeFile up -d --build --wait --wait-timeout 180
    if ($LASTEXITCODE -ne 0) {
        & $Docker compose -f $ComposeFile logs --no-color backend-e2e
        throw 'up --wait E2E falló'
    }

    $DbName = (& $Docker compose -f $ComposeFile exec -T postgres-e2e `
        psql -U uasspain -d test_e2e_uasspain -Atc 'select current_database()').Trim()
    if ($DbName -ne 'test_e2e_uasspain') { throw "BD E2E inesperada: $DbName" }

    Write-Host '==> Sembrando usuarios mediante API Rust'
    $Session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    Invoke-E2EJson -Method POST -Path '/api/auth/login/' -Session $Session -Body @{
        email = 'e2e-admin@test.local'; password = 'E2eAdmin_2026!'
    } | Out-Null
    Invoke-E2EJson -Method POST -Path '/api/users/crear-instructor/' -Session $Session -Body @{
        nombre = 'E2E'; apellidos = 'Instructor'; email = 'instructor.e2e@test.local'
        username = 'instructor.e2e'; dni_nie = '87654321X'; fecha_nacimiento = '1990-01-01'
        password = 'E2eInstr_2026!'; es_admin = $false
    } | Out-Null
    $Student = Invoke-E2EJson -Method POST -Path '/api/auth/register/' -Body @{
        nombre = 'E2E'; apellidos = 'Alumno'; email = 'alumno.e2e@test.local'
        username = 'alumno.e2e'; dni_nie = '12345678Z'; fecha_nacimiento = '2000-01-01'
        password = 'E2ePass_2026!'
    }
    $StudentId = [string]$Student.id
    if ($StudentId -notmatch '^[0-9a-fA-F-]{36}$') { throw 'ID de alumno E2E no válido' }
    $ActivateSql = "UPDATE accounts_userprofile SET status='activo', otp_verified=TRUE WHERE id='$StudentId'::uuid;"
    & $Docker compose -f $ComposeFile exec -T postgres-e2e `
        psql -U uasspain -d test_e2e_uasspain -v ON_ERROR_STOP=1 -c $ActivateSql | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'activación de alumno E2E falló' }

    Write-Host '==> Preparando destinos SFTP E2E'
    $BackendId = (& $Docker compose -f $ComposeFile ps -q backend-e2e).Trim()
    & $Docker cp $PrivKey "${BackendId}:/app/backup_keys/backup_sftp_ed25519"
    foreach ($Service in @('sftp-ext1-e2e', 'sftp-ext2-e2e')) {
        & $Docker compose -f $ComposeFile exec -T -u 0 $Service `
            sh -c 'chown 1000:1000 /backups && chmod 750 /backups'
    }
    & $Docker compose -f $ComposeFile exec -T -u 0 sftp-ext1-e2e `
        sh -c "printf 'CORRUPT-E2E-BACKUP' > /backups/uasspain_full_20200101_000000.sql.gz.enc"

    $KnownHosts = @()
    foreach ($Service in @('sftp-ext1-e2e', 'sftp-ext2-e2e')) {
        $Public = (& $Docker compose -f $ComposeFile exec -T $Service `
            cat /config/ssh_host_keys/ssh_host_ed25519_key.pub).Trim() -split '\s+'
        $KnownHosts += "[$Service]:2222 $($Public[0]) $($Public[1])"
    }
    $KnownHostsPath = Join-Path $KeyDir 'known_hosts'
    [IO.File]::WriteAllText($KnownHostsPath, (($KnownHosts -join "`n") + "`n"))
    & $Docker cp $KnownHostsPath "${BackendId}:/app/backup_keys/known_hosts"
    & $Docker exec -u 0 $BackendId sh -c `
        'chown -R uasspain:uasspain /app/backup_keys && chmod 700 /app/backup_keys && chmod 600 /app/backup_keys/backup_sftp_ed25519 && chmod 644 /app/backup_keys/known_hosts'

    Write-Host '==> Ejecutando suite funcional en Python efímero fijado'
    & $Docker run --rm `
        -v "${Root}:/workspace:ro" `
        -e E2E_BASE=http://host.docker.internal:8010 `
        -e E2E_ORIGIN=http://localhost:8010 `
        python:3.13.7-slim-bookworm `
        sh -c 'pip install --disable-pip-version-check --no-cache-dir websockets==15.0.1 && python /workspace/scripts/e2e/e2e_api.py'
    $ExitCode = $LASTEXITCODE
}
finally {
    if (-not $Keep) {
        Write-Host '==> Eliminando exclusivamente la pila y volúmenes E2E'
        & $Docker compose -f $ComposeFile down -v --remove-orphans | Out-Null
    }
    if (Test-Path -LiteralPath $KeyDir) {
        $ResolvedKeyDir = (Resolve-Path -LiteralPath $KeyDir).Path
        $ResolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
        if ($ResolvedKeyDir.StartsWith($ResolvedTemp + '\', [StringComparison]::OrdinalIgnoreCase) -and
            [IO.Path]::GetFileName($ResolvedKeyDir) -eq 'uasspain-e2e-keys') {
            Remove-Item -LiteralPath $ResolvedKeyDir -Recurse -Force
        }
    }
    Remove-Item Env:E2E_FIELD_ENCRYPTION_KEY -ErrorAction SilentlyContinue
}

exit $ExitCode
