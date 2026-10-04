#requires -Version 5.1
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Esta tarea requiere Windows y DPAPI del usuario actual.' }
if (-not (Get-Module -ListAvailable ScheduledTasks)) { throw 'No esta disponible el modulo ScheduledTasks; no se ha instalado ninguna tarea.' }
Import-Module ScheduledTasks

$workspacePath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$watcherPath = Join-Path $PSScriptRoot 'watch-encrypted-stack.ps1'
$protectedKeyPath = Join-Path $workspacePath '.secrets/postgres-storage-key.dpapi'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$sid = $identity.User.Value
$userName = $identity.Name
$sha = [Security.Cryptography.SHA256]::Create()
try { $scopeHash = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($workspacePath.ToLowerInvariant()))[0..11] | ForEach-Object { $_.ToString('x2') }) }
finally { $sha.Dispose(); $identity.Dispose() }
$scopeName = "UASSpainEncryptedWatcher-$sid-$scopeHash"
$taskName = "UASSpain-EncryptedAutoUnlock-$sid-$scopeHash"
$existing = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
if ($null -ne $existing -and $existing.Principal.UserId -notin @($sid, $userName)) {
    throw 'La tarea existente no pertenece al usuario actual; no se modifica.'
}

if ($Uninstall) {
    # Signal the user/workspace watcher without stopping Docker or any container.
    $stopEvent = $null
    try {
        if ([Threading.EventWaitHandle]::TryOpenExisting("Global\$scopeName-Stop", [ref]$stopEvent)) {
            $null = $stopEvent.Set()
        }
    } finally { if ($null -ne $stopEvent) { $stopEvent.Dispose() } }
    if ($null -ne $existing) {
        Stop-ScheduledTask -TaskName $taskName -TaskPath '\'
        Unregister-ScheduledTask -TaskName $taskName -TaskPath '\' -Confirm:$false
    }
    Write-Output 'Recuperacion automatica desinstalada para este usuario. Los contenedores, datos y claves se conservan.'
    exit 0
}

if (-not (Test-Path -LiteralPath $watcherPath -PathType Leaf)) { throw 'Falta el watcher; no se ha instalado ninguna tarea.' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'unlock-postgres-storage.ps1') -PathType Leaf)) { throw 'Falta el helper de desbloqueo; no se ha instalado ninguna tarea.' }
if (-not (Test-Path -LiteralPath $protectedKeyPath -PathType Leaf)) { throw 'Falta la clave DPAPI existente; no se genera ni sustituye ninguna clave.' }
$powershellPath = Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'
# Task Scheduler starts the same user's interactive token with limited privileges.
# No Windows password is stored; this task cannot unlock before that user logs in.
$action = New-ScheduledTaskAction -Execute $powershellPath -Argument ('-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $watcherPath + '"') -WorkingDirectory $workspacePath
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userName
$principal = New-ScheduledTaskPrincipal -UserId $userName -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval ([TimeSpan]::FromMinutes(1))
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Desbloquea solamente el PostgreSQL cifrado de UASSpain ya iniciado, usando DPAPI del usuario actual. No inicia contenedores ni almacena claves en claro.'
Register-ScheduledTask -TaskName $taskName -TaskPath '\' -InputObject $task -Force | Out-Null
Start-ScheduledTask -TaskName $taskName -TaskPath '\'
Write-Output 'Recuperacion automatica registrada e iniciada para el usuario actual, con privilegios limitados y sin almacenar una contrasena de Windows.'
Write-Output 'Solo desbloquea el contenedor PostgreSQL existente cuando ya esta en ejecucion; respeta las paradas manuales.'
