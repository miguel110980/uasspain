#requires -Version 5.1
param(
    [ValidateRange(5, 300)] [int]$PollSeconds = 10,
    [ValidateRange(30, 900)] [int]$RetrySeconds = 60
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Este watcher requiere Windows y la clave DPAPI del usuario actual.' }

$workspacePath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$unlockPath = Join-Path $PSScriptRoot 'unlock-postgres-storage.ps1'
$protectedKeyPath = Join-Path $workspacePath '.secrets/postgres-storage-key.dpapi'
$logDirectory = Join-Path $workspacePath '.run/uasspain'
$logPath = Join-Path $logDirectory 'storage-autounlock.log'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$sid = $identity.User.Value
$sha = [Security.Cryptography.SHA256]::Create()
try { $scopeHash = -join ($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($workspacePath.ToLowerInvariant()))[0..11] | ForEach-Object { $_.ToString('x2') }) }
finally { $sha.Dispose(); $identity.Dispose() }
$scopeName = "UASSpainEncryptedWatcher-$sid-$scopeHash"
$mutex = $null
$stopEvent = $null
$ownsMutex = $false
$lastLogState = ''

function Write-WatcherState([string]$State) {
    # Only fixed internal states reach this log; never persist child output or exceptions.
    if ($script:lastLogState -eq $State) { return }
    $script:lastLogState = $State
    try {
        [IO.Directory]::CreateDirectory($logDirectory) | Out-Null
        if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 1048576) {
            [IO.File]::Copy($logPath, (Join-Path $logDirectory 'storage-autounlock.previous.log'), $true)
            [IO.File]::WriteAllText($logPath, '')
        }
        [IO.File]::AppendAllText($logPath, ([DateTime]::UtcNow.ToString('o') + " $State`r`n"))
    } catch { } # A log failure must never expose raw diagnostics or interrupt key handling.
}

function ConvertTo-ProcessArgument([string]$Value) {
    # Windows CommandLineToArgvW quoting, without invoking a shell.
    return '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}

function Invoke-HiddenProcess([string]$Executable, [string[]]$Arguments, [int]$TimeoutMilliseconds = 8000) {
    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = $Executable
    $startInfo.Arguments = ($Arguments | ForEach-Object { ConvertTo-ProcessArgument $_ }) -join ' '
    $startInfo.WorkingDirectory = $workspacePath
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = $null
    try {
        $process = [Diagnostics.Process]::Start($startInfo)
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutMilliseconds)) {
            $process.Kill()
            $process.WaitForExit()
            return [pscustomobject]@{ ExitCode = -1; Output = '' }
        }
        # stderr is drained to avoid pipe deadlock and is deliberately discarded.
        $null = $stderr.GetAwaiter().GetResult()
        return [pscustomobject]@{ ExitCode = $process.ExitCode; Output = $stdout.GetAwaiter().GetResult().Trim() }
    } catch {
        return [pscustomobject]@{ ExitCode = -1; Output = '' }
    } finally { if ($null -ne $process) { $process.Dispose() } }
}

try {
    $mutex = [Threading.Mutex]::new($false, "Global\$scopeName")
    try { $ownsMutex = $mutex.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) { exit 0 }
    $stopEvent = [Threading.EventWaitHandle]::new($false, [Threading.EventResetMode]::ManualReset, "Global\$scopeName-Stop")
    $null = $stopEvent.Reset()
    Write-WatcherState 'WATCHER_STARTED'
    $nextUnlockAttempt = [DateTime]::MinValue
    while (-not $stopEvent.WaitOne(0)) {
        try {
            $dockerCommand = Get-Command docker.exe -ErrorAction SilentlyContinue
            if ($null -eq $dockerCommand) {
                Write-WatcherState 'DOCKER_CLI_UNAVAILABLE'
            } else {
                $dockerPath = $dockerCommand.Source
                $state = Invoke-HiddenProcess $dockerPath @('inspect', '--format', '{{.State.Running}}|{{.State.Status}}', 'uasspain-postgres')
                if ($state.ExitCode -ne 0) {
                    Write-WatcherState 'DOCKER_OR_CONTAINER_UNAVAILABLE'
                } elseif ($state.Output -ne 'true|running') {
                    # Never call compose up/start: an intentional stop remains stopped.
                    Write-WatcherState 'POSTGRES_NOT_RUNNING'
                } else {
                    $mounted = Invoke-HiddenProcess $dockerPath @('exec', 'uasspain-postgres', 'sh', '-c', 'test -f /run/postgres-storage/mounted')
                    if ($mounted.ExitCode -eq 0) {
                        Write-WatcherState 'POSTGRES_STORAGE_UNLOCKED'
                    } elseif ([DateTime]::UtcNow -lt $nextUnlockAttempt) {
                        Write-WatcherState 'UNLOCK_RETRY_WAIT'
                    } elseif (-not (Test-Path -LiteralPath $protectedKeyPath -PathType Leaf)) {
                        Write-WatcherState 'PROTECTED_KEY_MISSING'
                        $nextUnlockAttempt = [DateTime]::UtcNow.AddSeconds($RetrySeconds)
                    } else {
                        $mountsResult = Invoke-HiddenProcess $dockerPath @('inspect', '--format', '{{json .Mounts}}', 'uasspain-postgres')
                        $cipherMount = if ($mountsResult.ExitCode -eq 0) {
                            ($mountsResult.Output | ConvertFrom-Json) | Where-Object { $_.Type -eq 'volume' -and $_.Destination -eq '/encrypted-postgres' }
                        } else { $null }
                        $cipherConfig = Invoke-HiddenProcess $dockerPath @('exec', 'uasspain-postgres', 'sh', '-c', 'test -f /encrypted-postgres/gocryptfs.conf && test ! -f /run/postgres-storage/mounted')
                        if ($null -eq $cipherMount -or $cipherConfig.ExitCode -ne 0) {
                            Write-WatcherState 'ENCRYPTED_STORAGE_NOT_READY'
                            $nextUnlockAttempt = [DateTime]::UtcNow.AddSeconds($RetrySeconds)
                        } else {
                            Write-WatcherState 'UNLOCK_REQUESTED'
                            $powershellPath = Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'
                            # CurrentUser DPAPI and stdin->container tmpfs are handled by the existing helper.
                            # No InitializeKey, plain key file, environment key, or raw child log is used.
                            $unlock = Invoke-HiddenProcess $powershellPath @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $unlockPath, '-Project', 'uasspain') 30000
                            if ($unlock.ExitCode -eq 0) { Write-WatcherState 'UNLOCK_DELIVERED' }
                            else { Write-WatcherState 'UNLOCK_FAILED' }
                            $nextUnlockAttempt = [DateTime]::UtcNow.AddSeconds($RetrySeconds)
                        }
                    }
                }
            }
        } catch {
            Write-WatcherState 'CHECK_FAILED'
            $nextUnlockAttempt = [DateTime]::UtcNow.AddSeconds($RetrySeconds)
        }
        $null = $stopEvent.WaitOne($PollSeconds * 1000)
    }
    Write-WatcherState 'WATCHER_STOPPED'
} finally {
    if ($null -ne $stopEvent) { $stopEvent.Dispose() }
    if ($ownsMutex -and $null -ne $mutex) { $mutex.ReleaseMutex() }
    if ($null -ne $mutex) { $mutex.Dispose() }
}
