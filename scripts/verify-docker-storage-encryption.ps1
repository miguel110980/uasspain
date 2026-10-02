param(
    [string]$DockerDataPath = "$env:LOCALAPPDATA\Docker\wsl\disk\docker_data.vhdx"
)

$ErrorActionPreference = 'Stop'
$resolvedDataPath = (Resolve-Path -LiteralPath $DockerDataPath).Path
$mountPoint = [System.IO.Path]::GetPathRoot($resolvedDataPath).TrimEnd('\')
if ($mountPoint -notmatch '^[A-Za-z]:$') {
    throw 'El disco Docker debe estar en una unidad local verificable con BitLocker.'
}
try {
    $volume = Get-BitLockerVolume -MountPoint $mountPoint -ErrorAction Stop
    if ($null -eq $volume) { throw 'BitLocker no devolvio el estado de la unidad.' }
} catch {
    throw 'No se pudo acreditar BitLocker. Ejecute este comprobador en PowerShell como administrador; no modifica discos ni muestra claves.'
}
$verified = $volume.VolumeStatus.ToString() -eq 'FullyEncrypted' -and
    $volume.ProtectionStatus.ToString() -eq 'On' -and
    $volume.EncryptionPercentage -eq 100 -and
    $volume.EncryptionMethod.ToString() -ne 'None'
[pscustomobject]@{
    DockerDataPath = $resolvedDataPath
    MountPoint = $mountPoint
    VolumeStatus = $volume.VolumeStatus.ToString()
    ProtectionStatus = $volume.ProtectionStatus.ToString()
    EncryptionMethod = $volume.EncryptionMethod.ToString()
    EncryptionPercentage = $volume.EncryptionPercentage
    StorageEncryptionVerified = $verified
} | ConvertTo-Json
if (-not $verified) {
    throw 'No se cumple el cifrado en reposo: la unidad debe estar completamente cifrada y con proteccion activa.'
}
