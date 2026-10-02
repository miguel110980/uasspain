param(
    [ValidatePattern('^[a-z0-9][a-z0-9_-]+$')]
    [string]$Project = 'uasspain',
    [string]$KeyFile = '.secrets/postgres-storage-key.dpapi',
    [switch]$InitializeKey
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $workspace
$resolvedKey = [IO.Path]::GetFullPath((Join-Path $workspace $KeyFile))
if (-not $resolvedKey.StartsWith($workspace + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'La clave protegida debe estar dentro del workspace.'
}
$entropy = [Text.Encoding]::UTF8.GetBytes('UASSpain|PostgreSQL-storage|v1')
$scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
$key = $null
$protected = $null
$delivery = $null
try {
    $targetMountsJson = & docker inspect "${Project}-postgres" --format '{{json .Mounts}}'
    if ($LASTEXITCODE -ne 0) { throw 'No existe el contenedor objetivo.' }
    $targetMounts = $targetMountsJson | ConvertFrom-Json
    $cipherMount = $targetMounts | Where-Object { $_.Destination -eq '/encrypted-postgres' -and $_.Type -eq 'volume' }
    if ($null -eq $cipherMount) { throw 'El destino no es un PostgreSQL con volumen cifrado.' }
    $running = & docker ps --format '{{.Names}}'
    if ($LASTEXITCODE -ne 0) { throw 'No se pudieron verificar servidores PostgreSQL activos.' }
    foreach ($peer in $running) {
        if ($peer -ne "${Project}-postgres" -and $peer -match '^uasspain(-rebuild-[a-z0-9_-]+)?-postgres$') {
            $peerMountsJson = & docker inspect $peer --format '{{json .Mounts}}'
            if ($LASTEXITCODE -ne 0) { throw 'No se pudo verificar otro servidor PostgreSQL.' }
            $peerMounts = $peerMountsJson | ConvertFrom-Json
            if ($peerMounts | Where-Object { $_.Name -eq $cipherMount.Name }) {
                throw 'Otro servidor activo usa el mismo volumen; se rechaza desbloquear dos PGDATA simultaneos.'
            }
        }
    }
    if ($InitializeKey) {
        if (Test-Path -LiteralPath $resolvedKey) { throw 'No se sobrescribe una clave existente.' }
        & docker exec "${Project}-postgres" sh -c 'test ! -f /encrypted-postgres/gocryptfs.conf'
        if ($LASTEXITCODE -ne 0) { throw 'El volumen ya esta cifrado: recupere su clave original; no se genera un reemplazo.' }
        $key = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($key) } finally { $rng.Dispose() }
        $protected = [Security.Cryptography.ProtectedData]::Protect($key, $entropy, $scope)
        [IO.File]::WriteAllBytes($resolvedKey, $protected)
    } else {
        $protected = [IO.File]::ReadAllBytes($resolvedKey)
        $key = [Security.Cryptography.ProtectedData]::Unprotect($protected, $entropy, $scope)
    }
    if ($key.Length -ne 32) { throw 'Clave protegida invalida.' }
    # .NET stdin bypasses shell interpolation; key never appears in argv/logs.
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = 'docker'
    $start.Arguments = "exec -i ${Project}-postgres sh -c ""test ! -f /run/postgres-storage/mounted || exit 1; umask 077; cat > /run/postgres-storage/unlock.key.tmp && mv /run/postgres-storage/unlock.key.tmp /run/postgres-storage/unlock.key"""
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = [Diagnostics.Process]::Start($start)
    # Build hex as a clearable byte buffer, without an immutable secret String.
    $delivery = New-Object byte[] 65
    $alphabet = [Text.Encoding]::ASCII.GetBytes('0123456789abcdef')
    for ($index = 0; $index -lt $key.Length; $index++) {
        $delivery[2 * $index] = $alphabet[$key[$index] -shr 4]
        $delivery[2 * $index + 1] = $alphabet[$key[$index] -band 15]
    }
    $delivery[64] = 10
    $process.StandardInput.BaseStream.Write($delivery, 0, $delivery.Length)
    $process.StandardInput.Close()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw 'Fallo al entregar la clave al tmpfs PostgreSQL; salida sensible retenida.' }
    $process.Dispose()
    Write-Output 'Clave protegida entregada por stdin; no se ha escrito una clave en claro en el host.'
} finally {
    if ($null -ne $key) { [Array]::Clear($key,0,$key.Length) }
    if ($null -ne $protected) { [Array]::Clear($protected,0,$protected.Length) }
    if ($null -ne $delivery) { [Array]::Clear($delivery,0,$delivery.Length) }
}
