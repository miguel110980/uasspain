# Runner E2E Rust: pila aislada -> semillas por API -> suite -> teardown.
param(
    [switch]$Keep, [switch]$SkipBuild, [switch]$SkipBrowser, [switch]$FrontendOnly, [switch]$SecureBrowser,
    [switch]$PreserveVolumes,
    [ValidateSet('all', 'panels', 'chat', 'presence', 'assignments', 'modals', 'courses', 'content', 'instructor', 'sessions', 'realtime', 'concurrent', 'private', 'admin-protection')]
    [string[]]$BrowserScope = @('all')
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ComposeFile = Join-Path $Root 'docker-compose.e2e.yml'
$ComposeArgs = @('-f', $ComposeFile)
$PreviousBrowserOrigin = $env:E2E_BROWSER_ORIGIN
if ($SecureBrowser) {
    if ($BrowserScope -contains 'all') { $BrowserScope = @('sessions', 'realtime', 'presence', 'concurrent', 'private', 'admin-protection') }
    if ($BrowserScope | Where-Object { $_ -notin @('sessions', 'realtime', 'presence', 'concurrent', 'private', 'admin-protection') }) {
        throw 'SecureBrowser supports sessions, realtime, presence, concurrent and private scopes.'
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

    if ($PreserveVolumes) {
        # Fresh isolated fixtures without deleting any existing Docker volume.
        $PreservedRunId = [Guid]::NewGuid().ToString('N')
        $VolumeOverrideDir = Join-Path $Root '.run/e2e-preserved-volumes'
        New-Item -ItemType Directory -Force -Path $VolumeOverrideDir | Out-Null
        $VolumeOverrideFile = Join-Path $VolumeOverrideDir "$PreservedRunId.json"
        $E2EConfig = (& $Docker compose @ComposeArgs config --format json | ConvertFrom-Json)
        if ($LASTEXITCODE -ne 0) { throw 'No se pudieron identificar los volumenes E2E' }
        $FreshVolumes = @{}
        foreach ($Volume in $E2EConfig.volumes.PSObject.Properties) {
            $FreshVolumes[$Volume.Name] = @{ name = "uasspain-e2e-preserved-${PreservedRunId}-$($Volume.Name)" }
        }
        [IO.File]::WriteAllText($VolumeOverrideFile, (@{ volumes = $FreshVolumes } | ConvertTo-Json -Depth 4))
        $ComposeArgs += @('-f', $VolumeOverrideFile)
    }

    Write-Host '==> Recreando pila E2E aislada'
    if ($PreserveVolumes) { & $Docker compose @ComposeArgs down --remove-orphans }
    else { & $Docker compose @ComposeArgs down -v --remove-orphans }
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

    Write-Host '==> Validando el gate 2FA y fallo de transporte SMTP sin mailbox de desarrollo'
    $SmtpComposeArgs = $ComposeArgs + @('-f', (Join-Path $Root 'docker-compose.auth-smtp-e2e.yml'))
    try {
        & $Docker compose @SmtpComposeArgs up -d --wait --wait-timeout 60 backend-e2e | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'La fase SMTP aislada no arranco' }
        & node (Join-Path $Root 'scripts/e2e/e2e-auth-smtp.mjs')
        if ($LASTEXITCODE -ne 0) { throw 'La regresion 2FA/SMTP fallo' }
    } finally {
        & $Docker compose @ComposeArgs up -d --wait --wait-timeout 60 backend-e2e | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo restaurar el mailbox aislado' }
    }

    if (-not $SkipBrowser) {
        Write-Host '==> Validando contacto con receptor SMTP autenticado y TLS exclusivamente aislado'
        $PreviousContactComposeFiles = $env:E2E_CONTACT_COMPOSE_FILES
        try {
            $ContactComposeFiles = for ($i = 1; $i -lt $ComposeArgs.Count; $i += 2) { $ComposeArgs[$i] }
            $env:E2E_CONTACT_COMPOSE_FILES = ConvertTo-Json -InputObject @($ContactComposeFiles) -Compress
            & node (Join-Path $Root 'scripts/e2e/e2e-contact.mjs')
            if ($LASTEXITCODE -ne 0) { throw 'La suite de contacto SMTP/TLS aislado fallo' }
        } finally {
            $env:E2E_CONTACT_COMPOSE_FILES = $PreviousContactComposeFiles
        }
    }

    Write-Host '==> Validando configuracion de correo y cola cifrada con fixtures aislados'
    & $Docker compose @ComposeArgs restart backend-e2e | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'reinicio previo a correo E2E fallo' }
    & $Docker compose @ComposeArgs up -d --wait --wait-timeout 60 backend-e2e | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'readiness previa a correo E2E fallo' }
    & node (Join-Path $Root 'scripts/e2e/e2e-mail-system.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'La suite interna de correo E2E fallo' }

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

    Write-Host '==> Validando deltas de datos/media y restauracion full e incremental'
    & node (Join-Path $Root 'scripts/e2e/e2e-backup-deltas.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'La restauracion de deltas de backups E2E fallo' }

    Write-Host '==> Validando inventario independiente, historial y ocho combinaciones de destinos'
    & $Docker compose @ComposeArgs restart backend-e2e | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'reinicio previo a inventario E2E fallo' }
    & $Docker compose @ComposeArgs up -d --wait --wait-timeout 60 backend-e2e | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'readiness previa a inventario E2E fallo' }
    & node (Join-Path $Root 'scripts/e2e/e2e-backup-inventory.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'La suite de inventario de backups E2E fallo' }

    Write-Host '==> Validando cursos, temario transaccional y permisos contra PostgreSQL'
    & $Docker compose @ComposeArgs restart backend-e2e | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'reinicio previo a cursos E2E fallo' }
    & $Docker compose @ComposeArgs up -d --wait --wait-timeout 60 backend-e2e | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'readiness previa a cursos E2E fallo' }
    & node (Join-Path $Root 'scripts/e2e/e2e-courses.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'La suite de cursos E2E fallo' }

    Write-Host '==> Validando servicios y sincronizacion de contenido'
    & node (Join-Path $Root 'scripts/e2e/e2e-content.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'La suite de contenido E2E fallo' }

    Write-Host '==> Validando proteccion de administradores en conexiones'
    & $Docker compose @ComposeArgs restart backend-e2e | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'reinicio previo a proteccion de administradores fallo' }
    & $Docker compose @ComposeArgs up -d --wait --wait-timeout 60 backend-e2e | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'readiness previa a proteccion de administradores fallo' }
    & node (Join-Path $Root 'scripts/e2e/e2e-admin-session-protection.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'La suite de proteccion de administradores fallo' }

    Write-Host '==> Validando accesos academicos, historicos y aislamiento de instructores'
    & $Docker compose @ComposeArgs restart backend-e2e | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'reinicio previo a accesos academicos E2E fallo' }
    & $Docker compose @ComposeArgs up -d --wait --wait-timeout 60 backend-e2e | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'readiness previa a accesos academicos E2E fallo' }
    & node (Join-Path $Root 'scripts/e2e/e2e-instructor-access.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'La suite de accesos academicos E2E fallo' }

    function Invoke-Operations {
        param([string]$Mode, [string[]]$FixtureArguments = @())
        & $Docker run --rm --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true `
            -v "${PSScriptRoot}:/workspace/e2e:ro" --network uasspain-e2e_e2e_net `
            -e E2E_BASE=http://backend-e2e:8000 -e E2E_ORIGIN=http://localhost:8010 `
            $PythonImage /workspace/e2e/e2e_operations.py $Mode @FixtureArguments
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
    $Lifecycle = (Invoke-Operations 'profile-lifecycle-prepare') | ConvertFrom-Json
    foreach ($Id in @($Lifecycle.student_id, $Lifecycle.teacher_id)) {
        if ([string]$Id -notmatch '^[0-9a-fA-F-]{36}$') { throw 'ID del fixture lifecycle no valido' }
    }
    # Registration remains pending until OTP verification. Activate only this
    # newly registered disposable fixture, never a real account.
    & $Docker compose @ComposeArgs exec -T postgres-e2e psql -U uasspain -d test_e2e_uasspain -v ON_ERROR_STOP=1 `
        -c "UPDATE accounts_userprofile SET status='activo',otp_verified=TRUE WHERE id='$($Lifecycle.student_id)'::uuid;" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'activacion del fixture lifecycle fallo' }
    Invoke-Operations -Mode 'profile-lifecycle' -FixtureArguments @([string]$Lifecycle.teacher_id, [string]$Lifecycle.student_id)
    Invoke-Operations 'load'
    Write-Host '==> Validando 100 sesiones HTTP/WebSocket y carreras de autenticacion'
    & $Docker compose @ComposeArgs restart backend-e2e | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'reinicio previo a concurrencia E2E fallo' }
    & $Docker compose @ComposeArgs up -d --wait --wait-timeout 60 backend-e2e | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'readiness previa a concurrencia E2E fallo' }
    & node (Join-Path $Root 'scripts/e2e/e2e-concurrent-sessions.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'La suite de sesiones concurrentes E2E fallo' }
    Write-Host '==> Validando aislamiento y moderacion de 20 canales privados de chat'
    & node (Join-Path $Root 'scripts/e2e/e2e-chat-private.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'La suite de canales privados de chat E2E fallo' }
    & node (Join-Path $Root 'scripts/e2e/e2e-instructor-peer.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'La suite de canales entre instructores E2E fallo' }
    & node (Join-Path $Root 'scripts/e2e/e2e-video-isolation.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'La suite de aislamiento de videollamadas E2E fallo' }
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
        if ($SecureBrowser -and $BrowserScope -contains 'private') {
            Write-Host '==> Validando cuotas reales del edge HTTPS con 20 canales privados'
            & node (Join-Path $Root 'scripts/e2e/e2e-chat-edge.mjs')
            if ($LASTEXITCODE -ne 0) { throw 'La regresion de cuotas de chat HTTPS fallo' }
        }
        # Each group uses the unchanged production login limit. A backend restart
        # between groups isolates test traffic instead of weakening that limit.
        $BrowserGroups = @(
            @{ Key = 'panels'; Label = 'paneles y acceso'; Arguments = @('--grep-invert', '@panel-modals|@course-module|@content-module|@instructor-access|@session-regression|@realtime-regression|@concurrent-regression|@private-channel-regression|@private-chat-measurement|@admin-protection|staff-presence-video.spec|student-assignment.spec') },
            @{ Key = 'chat'; Label = 'chat bidireccional'; Arguments = @('panels.spec.ts', '--grep', 'chat messages appear bidirectionally') },
            @{ Key = 'admin-protection'; Label = 'proteccion de administradores'; Arguments = @('admin-session-protection.spec.ts') },
            @{ Key = 'presence'; Label = 'presencia y videollamada'; Arguments = @('staff-presence-video.spec.ts') },
            @{ Key = 'assignments'; Label = 'asignación de alumnos'; Arguments = @('student-assignment.spec.ts') },
            @{ Key = 'modals'; Label = 'modales y datos'; Arguments = @('--grep', '@panel-modals') },
            @{ Key = 'courses'; Label = 'cursos'; Arguments = @('--grep', '@course-module') },
            @{ Key = 'content'; Label = 'servicios y sincronizacion de contenido'; Arguments = @('--grep', '@content-module') },
            @{ Key = 'instructor'; Label = 'permisos academicos y sincronizacion'; Arguments = @('--grep', '@instructor-access') },
            @{ Key = 'sessions'; Label = 'persistencia y recuperación de sesión'; Arguments = @('--grep', '@session-regression') },
            @{ Key = 'realtime'; Label = 'chat y medios en tiempo real'; Arguments = @('--grep', '@realtime-regression') },
            @{ Key = 'concurrent'; Label = 'paneles simultaneos y 50 ventanas'; Arguments = @('--grep', '@concurrent-regression') },
            @{ Key = 'private'; Label = 'canales privados y recuperacion'; Arguments = @('--grep', '@private-channel-regression|@private-chat-measurement') }
        )
        # Invoke Node directly so Windows cmd does not interpret regex pipes.
        $PlaywrightCli = Join-Path $Root 'frontend/node_modules/@playwright/test/cli.js'
        # Discover the selected panel cases, then isolate each specification.
        # The broad group creates more browser contexts than the production
        # limiter permits in one interval; no application limit is relaxed.
        if ($BrowserScope -contains 'all' -or $BrowserScope -contains 'panels') {
            $PanelGroup = $BrowserGroups | Where-Object { $_.Key -eq 'panels' }
            Push-Location (Join-Path $Root 'frontend')
            try {
                $PanelArguments = $PanelGroup.Arguments
                $ListedCases = (& node $PlaywrightCli test @PanelArguments --list --reporter=json) -join "`n"
                if ($LASTEXITCODE -ne 0) { throw 'No se pudieron enumerar los casos de paneles' }
                $PanelSuites = @(($ListedCases | ConvertFrom-Json).suites)
                $PanelSpecs = @(($PanelSuites | ForEach-Object { $_.file }) | Sort-Object -Unique)
                if (-not $PanelSpecs.Count) { throw 'El grupo de paneles no contiene casos' }
                $PerSpecGroups = @($PanelSpecs | ForEach-Object {
                    $Specification = $_
                    if ([IO.Path]::GetFileName($Specification) -eq 'panels.spec.ts') {
                        # These cases each create independent authenticated windows.
                        # Even this single file exceeds the unchanged context budget.
                        foreach ($Case in @($PanelSuites | Where-Object { $_.file -eq $Specification } | ForEach-Object { $_.specs })) {
                            @{ Key = 'panels'; Label = $Case.title; Arguments = @($Specification, '--grep', ([regex]::Escape($Case.title) + '$')) + $PanelArguments }
                        }
                    } else {
                        @{ Key = 'panels'; Label = [IO.Path]::GetFileName($Specification); Arguments = @($Specification) + $PanelArguments }
                    }
                })
                $BrowserGroups = $PerSpecGroups + @($BrowserGroups | Where-Object { $_.Key -ne 'panels' })
            } finally { Pop-Location }
        }
        if ($BrowserScope -contains 'all' -or $BrowserScope -contains 'concurrent') {
            $ConcurrentGroup = $BrowserGroups | Where-Object { $_.Key -eq 'concurrent' }
            Push-Location (Join-Path $Root 'frontend')
            try {
                $ConcurrentArguments = $ConcurrentGroup.Arguments
                $ListedConcurrent = (& node $PlaywrightCli test @ConcurrentArguments --list --reporter=json) -join "`n"
                if ($LASTEXITCODE -ne 0) { throw 'No se pudieron enumerar los casos de concurrencia' }
                $ConcurrentCases = @(($ListedConcurrent | ConvertFrom-Json).suites | ForEach-Object { $_.specs })
                if (-not $ConcurrentCases.Count) { throw 'El grupo de concurrencia no contiene casos' }
                # The eight-window acceptance must start with a fresh context
                # budget. Its own concurrency remains intact within one test.
                $ConcurrentGroups = @($ConcurrentCases | ForEach-Object {
                    @{ Key = 'concurrent'; Label = $_.title; Arguments = @('--grep', ([regex]::Escape($_.title) + '$')) }
                })
                $BrowserGroups = @($BrowserGroups | Where-Object { $_.Key -notin @('concurrent', 'private') }) + $ConcurrentGroups + @($BrowserGroups | Where-Object { $_.Key -eq 'private' })
            } finally { Pop-Location }
        }
        foreach ($BrowserGroup in $BrowserGroups | Where-Object { ($BrowserScope -contains 'all' -and $_.Key -ne 'chat') -or $BrowserScope -contains $_.Key }) {
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
        if ($BrowserScope -contains 'all') {
            Write-Host '==> Auditando layout y accesibilidad con autenticacion y API reales'
            & $Docker compose @ComposeArgs restart backend-e2e | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'reinicio previo al audit UI fallo' }
            & $Docker compose @ComposeArgs up -d --wait --wait-timeout 60 backend-e2e | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'readiness previa al audit UI fallo' }
            & node (Join-Path $Root 'scripts/e2e/e2e-ui-audit.mjs')
            if ($LASTEXITCODE -ne 0) { throw 'La auditoria UI contra backend real fallo' }
        }
    }
}
finally {
    if (-not $Keep) {
        if ($PreserveVolumes) {
            Write-Host '==> Retirando contenedores E2E; todos los volumenes se conservan'
            & $Docker compose @ComposeArgs down --remove-orphans | Out-Null
        } else {
            Write-Host '==> Eliminando exclusivamente la pila y volúmenes E2E'
            & $Docker compose @ComposeArgs down -v --remove-orphans | Out-Null
        }
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
