# Runner E2E Rust: pila aislada -> semillas por API -> suite -> teardown.
param(
    [switch]$Keep, [switch]$SkipBuild, [switch]$SkipBrowser, [switch]$FrontendOnly, [switch]$SecureBrowser,
    [ValidateSet('all', 'panels', 'presence', 'assignments', 'modals', 'courses', 'sessions', 'realtime')]
    [string[]]$BrowserScope = @('all')
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ComposeFile = Join-Path $Root 'docker-compose.e2e.yml'
$ComposeArgs = @('-f', $ComposeFile)
$PreviousBrowserOrigin = $env:E2E_BROWSER_ORIGIN
if ($SecureBrowser) {
    if ($BrowserScope -contains 'all') { $BrowserScope = @('sessions', 'realtime', 'presence') }
    if ($BrowserScope | Where-Object { $_ -notin @('sessions', 'realtime', 'presence') }) {
        throw 'SecureBrowser supports sessions, realtime and presence scopes.'
    }
    $ComposeArgs += @('-f', (Join-Path $Root 'docker-compose.realtime-e2e.yml'))
    $env:E2E_BROWSER_ORIGIN = 'https://localhost:8444'
}
$BackendContext = Join-Path $Root 'backend-rust'
$Docker = (Get-Command docker -ErrorAction Stop).Source
$ExitCode = 1
$SetupWindowId = [Guid]::NewGuid().ToString()
$KeyDirName = 'uasspain-e2e-keys-' + [Guid]::NewGuid().ToString('N')
$KeyDir = Join-Path ([IO.Path]::GetTempPath()) $KeyDirName
$PreviousKey = $env:E2E_FIELD_ENCRYPTION_KEY
$PreviousPublicKey = $env:E2E_BACKUP_SSH_PUB
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
        Headers = @{ Origin = 'http://localhost:8010'; 'X-UASSpain-Window-Id' = $SetupWindowId }
        Body = ($Body | ConvertTo-Json -Depth 8 -Compress)
    }
    if ($Session) { $params.WebSession = $Session }
    Invoke-RestMethod @params
}

try {
    Write-Host '==> Reconstruyendo backend Rust E2E desde el lockfile'
    if (-not $SkipBuild) {
        & $Docker build -t uasspain-backend:e2e-local $BackendContext
        if ($LASTEXITCODE -ne 0) { throw 'build E2E falló' }
    }
    $PythonImage = 'uasspain-e2e-python:local'
    $PythonImageExists = [string](& $Docker image ls -q $PythonImage)
    if (-not $SkipBuild -or -not $PythonImageExists) {
        & $Docker build -f (Join-Path $PSScriptRoot 'Dockerfile.python') -t $PythonImage $PSScriptRoot
        if ($LASTEXITCODE -ne 0) { throw 'build de herramientas Python E2E fallo' }
    }

    $PrivKey = Join-Path $KeyDir 'backup_sftp_ed25519'
    if (-not (Test-Path -LiteralPath $PrivKey)) {
        New-Item -ItemType Directory -Force -Path $KeyDir | Out-Null
        $EmptyPassphrase = if ($PSVersionTable.PSVersion.Major -lt 7) { '""' } else { '' }
        & ssh-keygen -q -t ed25519 -N $EmptyPassphrase -f $PrivKey -C uasspain-e2e-backup
        if ($LASTEXITCODE -ne 0) { throw 'ssh-keygen E2E falló' }
    }
    $env:E2E_BACKUP_SSH_PUB = (Get-Content -LiteralPath "$PrivKey.pub" -Raw).Trim()

    Write-Host '==> Recreando pila E2E aislada'
    & $Docker compose @ComposeArgs down -v --remove-orphans
    if ($LASTEXITCODE -ne 0) { throw 'teardown E2E inicial falló' }
    & $Docker compose @ComposeArgs up -d --build --wait --wait-timeout 180
    if ($LASTEXITCODE -ne 0) {
        & $Docker compose @ComposeArgs logs --no-color backend-e2e
        throw 'up --wait E2E falló'
    }

    $DbName = (& $Docker compose @ComposeArgs exec -T postgres-e2e `
        psql -U uasspain -d test_e2e_uasspain -Atc 'select current_database()').Trim()
    if ($DbName -ne 'test_e2e_uasspain') { throw "BD E2E inesperada: $DbName" }

    Write-Host '==> Sembrando usuarios mediante API Rust'
    $Session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    Invoke-E2EJson -Method POST -Path '/api/auth/login/' -Session $Session -Body @{
        email = 'e2e-admin@test.local'; password = 'E2eAdmin_2026!'
    } | Out-Null
    $Instructor = Invoke-E2EJson -Method POST -Path '/api/users/crear-instructor/' -Session $Session -Body @{
        nombre = 'E2E'; apellidos = 'Instructor'; email = 'instructor.e2e@test.local'
        username = 'instructor.e2e'; dni_nie = '87654321X'; fecha_nacimiento = '1990-01-01'
        password = 'E2eInstr_2026!'; es_admin = $false
    }
    $Student = Invoke-E2EJson -Method POST -Path '/api/auth/register/' -Body @{
        nombre = 'E2E'; apellidos = 'Alumno'; email = 'alumno.e2e@test.local'
        username = 'alumno.e2e'; dni_nie = '12345678Z'; fecha_nacimiento = '2000-01-01'
        password = 'E2ePass_2026!'
    }
    $StudentId = [string]$Student.id
    if ($StudentId -notmatch '^[0-9a-fA-F-]{36}$') { throw 'ID de alumno E2E no válido' }
    $ActivateSql = "UPDATE accounts_userprofile SET status='activo', otp_verified=TRUE WHERE id='$StudentId'::uuid;"
    & $Docker compose @ComposeArgs exec -T postgres-e2e `
        psql -U uasspain -d test_e2e_uasspain -v ON_ERROR_STOP=1 -c $ActivateSql | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'activación de alumno E2E falló' }

    $SecondStudent = Invoke-E2EJson -Method POST -Path '/api/auth/register/' -Body @{
        nombre = 'E2E'; apellidos = 'Segundo'; email = 'segundo.e2e@test.local'
        username = 'segundo.e2e'; dni_nie = '11111111H'; fecha_nacimiento = '2000-01-01'
        password = 'E2eSecond_2026!' # pragma: allowlist secret - isolated fixture
    }
    $SecondStudentId = [string]$SecondStudent.id
    if ($SecondStudentId -notmatch '^[0-9a-fA-F-]{36}$') { throw 'ID del segundo alumno E2E no válido' }
    & $Docker compose @ComposeArgs exec -T postgres-e2e `
        psql -U uasspain -d test_e2e_uasspain -v ON_ERROR_STOP=1 `
        -c "UPDATE accounts_userprofile SET status='activo', otp_verified=TRUE WHERE id='$SecondStudentId'::uuid;" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'activación del segundo alumno E2E falló' }
    $AssignmentStudents = @($SecondStudentId)
    if ($FrontendOnly) { $AssignmentStudents += $StudentId }
    Invoke-E2EJson -Method POST -Path "/api/profiles/$($Instructor.id)/assign-alumnos/" -Session $Session -Body @{
        student_ids = $AssignmentStudents
    } | Out-Null

    Write-Host '==> Preparando destinos SFTP E2E'
    $BackendId = (& $Docker compose @ComposeArgs ps -q backend-e2e).Trim()
    & $Docker cp $PrivKey "${BackendId}:/app/backup_keys/backup_sftp_ed25519"
    if ($LASTEXITCODE -ne 0) { throw 'copia de clave SFTP E2E falló' }
    foreach ($Service in @('sftp-ext1-e2e', 'sftp-ext2-e2e')) {
        & $Docker compose @ComposeArgs exec -T -u 0 $Service `
            sh -c 'chown 1000:1000 /backups && chmod 750 /backups'
        if ($LASTEXITCODE -ne 0) { throw 'preparación del destino SFTP E2E falló' }
    }
    & $Docker compose @ComposeArgs exec -T -u 0 sftp-ext1-e2e `
        sh -c "printf 'CORRUPT-E2E-BACKUP' > /backups/uasspain_full_20200101_000000.sql.gz.enc"
    if ($LASTEXITCODE -ne 0) { throw 'preparación de backup corrupto E2E falló' }

    $KnownHosts = @()
    foreach ($Service in @('sftp-ext1-e2e', 'sftp-ext2-e2e')) {
        $Public = (& $Docker compose @ComposeArgs exec -T $Service `
            cat /config/ssh_host_keys/ssh_host_ed25519_key.pub).Trim() -split '\s+'
        if ($LASTEXITCODE -ne 0 -or $Public.Count -lt 2) { throw 'lectura de clave pública SFTP E2E falló' }
        $KnownHosts += "[$Service]:2222 $($Public[0]) $($Public[1])"
    }
    $KnownHostsPath = Join-Path $KeyDir 'known_hosts'
    [IO.File]::WriteAllText($KnownHostsPath, (($KnownHosts -join "`n") + "`n"))
    & $Docker cp $KnownHostsPath "${BackendId}:/app/backup_keys/known_hosts"
    if ($LASTEXITCODE -ne 0) { throw 'copia de known_hosts E2E falló' }
    & $Docker exec -u 0 $BackendId sh -c `
        'chown -R uasspain:uasspain /app/backup_keys && chmod 700 /app/backup_keys && chmod 600 /app/backup_keys/backup_sftp_ed25519 && chmod 644 /app/backup_keys/known_hosts'
    if ($LASTEXITCODE -ne 0) { throw 'permisos de las claves SFTP E2E falló' }

    # The frontend audit uses the same isolated fixtures without running server-only suites.
    # Default behavior still executes every API and operational gate.
    if (-not $FrontendOnly) {
    Write-Host '==> Ejecutando suite funcional en Python efímero fijado'
    & $Docker compose @ComposeArgs exec -T backend-e2e mkdir -p /app/backups/destination-local
    if ($LASTEXITCODE -ne 0) { throw 'Directorio del destino local E2E no disponible' }
    & $Docker run --rm `
        --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true `
        -v "${PSScriptRoot}:/workspace/e2e:ro" `
        --network uasspain-e2e_e2e_net `
        -e E2E_BASE=http://backend-e2e:8000 `
        -e E2E_ORIGIN=http://localhost:8010 `
        $PythonImage /workspace/e2e/e2e_api.py
    $ExitCode = $LASTEXITCODE
    if ($ExitCode -ne 0) { throw 'La suite API E2E falló' }

    Write-Host '==> Validando recuperacion y OTP con correo de fixture cifrado (sin SMTP externo)'
    & $Docker compose @ComposeArgs restart backend-e2e | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'reinicio previo a autenticacion E2E fallo' }
    & $Docker compose @ComposeArgs up -d --wait --wait-timeout 60 backend-e2e | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'readiness previa a autenticacion E2E fallo' }
    & node (Join-Path $Root 'scripts/e2e/e2e-auth.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'La suite de recuperacion y OTP E2E fallo' }

    Write-Host '==> Validando alcance de paneles, asignaciones y contadores contra PostgreSQL'
    & node (Join-Path $Root 'scripts/e2e/e2e-panels.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'La suite de alcance de paneles E2E fallo' }

    Write-Host '==> Validando selector de instructor, permisos y reasignacion concurrente'
    & node (Join-Path $Root 'scripts/e2e/e2e-assignments.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'La suite de asignaciones E2E fallo' }

    Write-Host '==> Validando backups simplificados y restauracion real'
    & $Docker compose @ComposeArgs restart backend-e2e | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'reinicio previo a backups E2E fallo' }
    & $Docker compose @ComposeArgs up -d --wait --wait-timeout 60 backend-e2e | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'readiness previa a backups E2E fallo' }
    & node (Join-Path $Root 'scripts/e2e/e2e-backups.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'La suite de backups E2E fallo' }

    Write-Host '==> Validando cursos, temario transaccional y permisos contra PostgreSQL'
    & $Docker compose @ComposeArgs restart backend-e2e | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'reinicio previo a cursos E2E fallo' }
    & $Docker compose @ComposeArgs up -d --wait --wait-timeout 60 backend-e2e | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'readiness previa a cursos E2E fallo' }
    & node (Join-Path $Root 'scripts/e2e/e2e-courses.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'La suite de cursos E2E fallo' }

    function Invoke-Operations {
        param([string]$Mode)
        & $Docker run --rm --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true `
            -v "${PSScriptRoot}:/workspace/e2e:ro" --network uasspain-e2e_e2e_net `
            -e E2E_BASE=http://backend-e2e:8000 -e E2E_ORIGIN=http://localhost:8010 `
            $PythonImage /workspace/e2e/e2e_operations.py $Mode
        if ($LASTEXITCODE -ne 0) { throw "Prueba operacional falló: $Mode" }
    }
    Write-Host '==> Validando plazo de examen, concurrencia y carga acotada'
    Invoke-Operations 'auth-case'
    $ExpiryFixture = (Invoke-Operations 'deadline-prepare') | ConvertFrom-Json
    $ExpiryId = [string]$ExpiryFixture.attempt_id
    if ($ExpiryId -notmatch '^[0-9a-fA-F-]{36}$') { throw 'ID del intento de plazo E2E no válido' }
    & $Docker compose @ComposeArgs exec -T postgres-e2e psql -U uasspain -d test_e2e_uasspain `
        -v ON_ERROR_STOP=1 -c "UPDATE examenes_intento SET started_at=NOW()-INTERVAL '41 minutes', expires_at=NOW()-INTERVAL '1 minute' WHERE id='$ExpiryId'::uuid;" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'preparación del plazo E2E falló' }
    Invoke-Operations 'deadline-verify'
    Invoke-Operations 'profile-lifecycle'
    Invoke-Operations 'load'
    Write-Host '==> Probando caída y recuperación de dependencias aisladas'
    foreach ($Dependency in @('redis-e2e', 'postgres-e2e')) {
        try {
            & $Docker compose @ComposeArgs stop $Dependency | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'paro de dependencia E2E falló' }
            Invoke-Operations $(if ($Dependency -eq 'redis-e2e') { 'redis-down' } else { 'db-down' })
        } finally {
            & $Docker compose @ComposeArgs up -d --wait --wait-timeout 60 $Dependency | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'recuperación de dependencia E2E falló' }
        }
        Invoke-Operations 'recovered'
    }
    }
    $ExitCode = 0
    if (-not $SkipBrowser) {
        # Each group uses the unchanged production login limit. A backend restart
        # between groups isolates test traffic instead of weakening that limit.
        $BrowserGroups = @(
            @{ Key = 'panels'; Label = 'paneles y acceso'; Arguments = @('--grep-invert', '@panel-modals|@course-module|@session-regression|@realtime-regression|staff-presence-video.spec|student-assignment.spec') },
            @{ Key = 'presence'; Label = 'presencia y videollamada'; Arguments = @('staff-presence-video.spec.ts') },
            @{ Key = 'assignments'; Label = 'asignación de alumnos'; Arguments = @('student-assignment.spec.ts') },
            @{ Key = 'modals'; Label = 'modales y datos'; Arguments = @('--grep', '@panel-modals') },
            @{ Key = 'courses'; Label = 'cursos'; Arguments = @('--grep', '@course-module') },
            @{ Key = 'sessions'; Label = 'persistencia y recuperación de sesión'; Arguments = @('--grep', '@session-regression') },
            @{ Key = 'realtime'; Label = 'chat y medios en tiempo real'; Arguments = @('--grep', '@realtime-regression') }
        )
        # Invoke Node directly so Windows cmd does not interpret regex pipes.
        $PlaywrightCli = Join-Path $Root 'frontend/node_modules/@playwright/test/cli.js'
        foreach ($BrowserGroup in $BrowserGroups | Where-Object { $BrowserScope -contains 'all' -or $BrowserScope -contains $_.Key }) {
            Write-Host "==> Preparando navegador: $($BrowserGroup.Label)"
            & $Docker compose @ComposeArgs restart backend-e2e | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'reinicio del backend E2E fallo' }
            & $Docker compose @ComposeArgs up -d --wait --wait-timeout 60 backend-e2e | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'readiness tras reinicio del backend E2E fallo' }
            Push-Location (Join-Path $Root 'frontend')
            try {
                $BrowserArguments = $BrowserGroup.Arguments
                & node $PlaywrightCli test @BrowserArguments
                $ExitCode = $LASTEXITCODE
                if ($ExitCode -ne 0) { throw 'La suite de navegador E2E fallo' }
            } finally { Pop-Location }
        }
    }
}
finally {
    if (-not $Keep) {
        Write-Host '==> Eliminando exclusivamente la pila y volúmenes E2E'
        & $Docker compose @ComposeArgs down -v --remove-orphans | Out-Null
    }
    if (Test-Path -LiteralPath $KeyDir) {
        $ResolvedKeyDir = (Resolve-Path -LiteralPath $KeyDir).Path
        $ResolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
        if ($ResolvedKeyDir.StartsWith($ResolvedTemp + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and
            [IO.Path]::GetFileName($ResolvedKeyDir) -eq $KeyDirName) {
            Remove-Item -LiteralPath $ResolvedKeyDir -Recurse -Force
        }
    }
    $env:E2E_FIELD_ENCRYPTION_KEY = $PreviousKey
    $env:E2E_BACKUP_SSH_PUB = $PreviousPublicKey
    $env:E2E_BROWSER_ORIGIN = $PreviousBrowserOrigin
}

exit $ExitCode
