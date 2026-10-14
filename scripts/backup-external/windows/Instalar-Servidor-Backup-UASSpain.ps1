#requires -Version 5.1
#requires -RunAsAdministrator
<#
 UASSpain: preparacion del PC de backups Windows con WireGuard + OpenSSH SFTP.
 EJECUTAR SOLO EN EL PC DESTINO DE BACKUPS. Requiere acceso a Internet para instalar componentes.
 No modifica el proyecto UASSpain ni su backend. Si OpenSSH ya esta en uso, se detiene sin modificarlo.
#>
[CmdletBinding()]
param(
    [string]$BackupAddress,
    [string]$UasAddress,
    [ValidateRange(1024,65535)][int]$WireGuardPort = 51820,
    [ValidateRange(1024,65535)][int]$SftpPort = 22222,
    [string]$BackupDirectory,
    [string]$VpnBackupAddress = '10.203.77.1',
    [string]$VpnUasAddress = '10.203.77.2',
    [ValidatePattern('^[a-z][a-z0-9_]{2,31}$')][string]$SftpUser = 'uasbackup_sftp',
    [string]$ClientPackageDirectory = $PSScriptRoot,
    [ValidateRange(1,1048576)][int]$MinimumFreeGB = 20
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Stop-Setup([string]$message) { throw "BLOCKED: $message" }
function Check-IP([string]$value) {
    $parsed = $null
    if (-not [System.Net.IPAddress]::TryParse($value, [ref]$parsed) -or
        $parsed.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or
        $parsed.GetAddressBytes()[0] -eq 0 -or $parsed.GetAddressBytes()[0] -eq 127 -or $parsed.GetAddressBytes()[0] -ge 224 -or
        $parsed.Equals([System.Net.IPAddress]::Broadcast)) { Stop-Setup "IPv4 no valida: $value" }
    return $parsed.ToString()
}
function Assert-Exit([string]$label) { if ($LASTEXITCODE -ne 0) { Stop-Setup "$label (codigo $LASTEXITCODE)" } }
function Assert-File([string]$file) { if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { Stop-Setup "Falta archivo: $file" } }
function Assert-NoReparsePoint([string]$path) {
    $cursor = [IO.Path]::GetFullPath($path)
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                Stop-Setup "Enlace/reparse point no permitido: $cursor"
            }
        }
        $parent = [IO.Directory]::GetParent($cursor)
        $cursor = if ($parent) { $parent.FullName } else { $null }
    }
}
function IPv4-Number([string]$address) {
    $b = [Net.IPAddress]::Parse($address).GetAddressBytes()
    return [uint64]$b[0]*16777216 + [uint64]$b[1]*65536 + [uint64]$b[2]*256 + $b[3]
}
function Assert-VpnPair([string]$server, [string]$client) {
    foreach ($ip in @($server,$client)) {
        if ($ip -notmatch '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)') { Stop-Setup 'La VPN requiere IPv4 privada RFC1918' }
        if ((IPv4-Number $ip) % 4 -notin @(1,2)) { Stop-Setup 'Elegir dos direcciones de host de una misma subred /30' }
    }
    if ($server -eq $client -or [Math]::Floor((IPv4-Number $server)/4) -ne [Math]::Floor((IPv4-Number $client)/4)) {
        Stop-Setup 'Las IP VPN deben ser distintas y pertenecer a la misma subred /30'
    }
    foreach ($route in Get-NetRoute -AddressFamily IPv4) {
        $parts = $route.DestinationPrefix -split '/'
        $prefix = [int]$parts[1]
        if ($prefix -eq 0) { continue }
        $divisor = [Math]::Pow(2,32-[Math]::Min(30,$prefix))
        if ([Math]::Floor((IPv4-Number $server)/$divisor) -eq [Math]::Floor((IPv4-Number $parts[0])/$divisor)) {
            Stop-Setup "La VPN solapa una ruta existente: $($route.DestinationPrefix)"
        }
    }
}
function Protect-Admins([string]$path, [switch]$IsDirectory) {
    # SID bien conocidos: SYSTEM y BUILTIN\Administrators, independientes del idioma del SO.
    if ($IsDirectory) {
        & icacls.exe $path '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    } else {
        & icacls.exe $path '/inheritance:r' '/grant:r' '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
    }
    Assert-Exit "ACL admin de $path"
}
function Install-WireGuard {
    $wgExe = Join-Path $env:ProgramFiles 'WireGuard\wireguard.exe'
    $tool = Join-Path $env:ProgramFiles 'WireGuard\wg.exe'
    if ((Test-Path $wgExe) -and (Test-Path $tool)) { return @($wgExe,$tool) }
    $arch = if ([Environment]::Is64BitOperatingSystem) {
        if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') {'arm64'} else {'amd64'}
    } else { Stop-Setup 'SO de 32 bits no contemplado' }
    $filename = "wireguard-$arch-1.1.1.msi"
    $url = "https://download.wireguard.com/windows-client/$filename"
    $downloadDir = Join-Path $env:TEMP ('UASSpain-WireGuard-'+[guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $downloadDir | Out-Null
    Protect-Admins $downloadDir -IsDirectory
    $msi = Join-Path $downloadDir $filename
    Write-Host "Descargando WireGuard oficial: $filename"
    Invoke-WebRequest -Uri $url -OutFile $msi -UseBasicParsing
    $signature = Get-AuthenticodeSignature -FilePath $msi
    if ($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate -or
        $signature.SignerCertificate.Subject -notmatch 'WireGuard') {
        Stop-Setup "No se ha podido validar la firma de WireGuard: $($signature.Status)"
    }
    $p = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i',"`"$msi`"",'/qn','/norestart') -WindowStyle Hidden -Wait -PassThru
    if ($p.ExitCode -notin @(0,3010)) { Stop-Setup "Fallo instalando WireGuard MSI: $($p.ExitCode)" }
    if ($p.ExitCode -eq 3010) { Stop-Setup 'Instalacion requiere reinicio. Reinicia antes de continuar.' }
    Assert-File $wgExe; Assert-File $tool
    return @($wgExe,$tool)
}

Write-Host '=== UASSpain: servidor externo de backups Windows ===' -ForegroundColor Cyan
Write-Host 'Solo se instalara en ESTE ordenador. No se modificara UASSpain de forma remota.'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or [Environment]::OSVersion.Version.Build -lt 17763) {
    Stop-Setup 'Se requiere Windows con capacidad oficial OpenSSH Server; plataforma no validada por este instalador'
}
if ([string]::IsNullOrWhiteSpace($BackupAddress)) { $BackupAddress = Read-Host 'IP de ESTE PC de backups' }
if ([string]::IsNullOrWhiteSpace($UasAddress)) { $UasAddress = Read-Host 'IP del PC UASSpain' }
$backupIP = Check-IP $BackupAddress
$uasIP = Check-IP $UasAddress
if ($backupIP -eq $uasIP) { Stop-Setup 'Las IP de los dos equipos deben ser diferentes' }
$localIP = Get-NetIPAddress -AddressFamily IPv4 -IPAddress $backupIP -ErrorAction SilentlyContinue
if (-not $localIP) { Stop-Setup "La IP $backupIP no corresponde a este PC" }
if (@($localIP).Count -ne 1) { Stop-Setup "La IP $backupIP aparece en varias interfaces" }
$interface = $localIP.InterfaceAlias

function Ask-Port([string]$label,[int]$default) {
    $answer = Read-Host "$label [Enter=$default]"
    if ([string]::IsNullOrWhiteSpace($answer)) { return $default }
    $number=0
    if (-not [int]::TryParse($answer,[ref]$number) -or $number -lt 1024 -or $number -gt 65535) {
        Stop-Setup "Puerto no valido: $answer (1024-65535)"
    }
    return $number
}
$wgPort = if ($PSBoundParameters.ContainsKey('WireGuardPort')) { $WireGuardPort } else { Ask-Port 'Puerto WireGuard UDP' $WireGuardPort }
$sftpPort = if ($PSBoundParameters.ContainsKey('SftpPort')) { $SftpPort } else { Ask-Port 'Puerto SFTP TCP, solo VPN' $SftpPort }
# Se mantienen protocolos distintos, pero se recomiendan puertos separados para claridad operativa.
$requestedFolder=$BackupDirectory
if ([string]::IsNullOrWhiteSpace($requestedFolder)) { $requestedFolder=Read-Host 'Directorio fisico de backups (Enter=C:\UASSpainBackups)' }
if ([string]::IsNullOrWhiteSpace($requestedFolder)) { $requestedFolder='C:\UASSpainBackups' }
if ($requestedFolder -notmatch '^[A-Za-z]:\\' -or $requestedFolder -match '["\r\n]' -or $requestedFolder.Substring(2).Contains(':')) {
    Stop-Setup 'Se requiere una ruta ABSOLUTA en disco local, no ruta UNC'
}
$backupDir=[IO.Path]::GetFullPath($requestedFolder).TrimEnd('\')
Assert-NoReparsePoint $backupDir
foreach ($protectedRoot in @($env:WINDIR,$env:ProgramFiles,${env:ProgramFiles(x86)},$env:ProgramData,(Join-Path $env:SystemDrive 'Users'),$PSScriptRoot)) {
    if ($protectedRoot -and ($backupDir.Equals($protectedRoot,[StringComparison]::OrdinalIgnoreCase) -or $backupDir.StartsWith($protectedRoot.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase))) {
        Stop-Setup 'El almacenamiento debe estar fuera de directorios del sistema, usuarios y codigo'
    }
}
if ($backupDir -match '^[A-Z]:$' -or $backupDir -eq $env:SystemDrive.TrimEnd('\')) {
    Stop-Setup 'No se permite seleccionar la raiz del disco'
}
$wgBackupAddress=Check-IP $VpnBackupAddress; $wgUasAddress=Check-IP $VpnUasAddress
Assert-VpnPair $wgBackupAddress $wgUasAddress
$vpnName='UASSpainBackupServidor'; $wgServiceName='WireGuardTunnel$'+$vpnName
$user=$SftpUser
$clientScriptSource=Join-Path $ClientPackageDirectory 'Instalar-Cliente-WireGuard-UASSpain.ps1'
$clientLauncherSource=Join-Path $ClientPackageDirectory 'EJECUTAR-Cliente-UASSpain.cmd'
# Clientes personalizados opcionales. El servidor genera tambien la configuracion
# importable por el cliente oficial WireGuard, sin depender de un ZIP externo.
foreach ($clientSource in @($clientScriptSource,$clientLauncherSource)) {
    if (Test-Path -LiteralPath $clientSource -PathType Leaf) { Assert-NoReparsePoint $clientSource }
}
$root=Join-Path $env:ProgramData 'UASSpainBackupSetup'
$secure=Join-Path $root 'secure'
$provision=Join-Path $root 'PARA_LLEVAR_AL_PC_UASSPAIN'
$chroot=$backupDir
$incoming=Join-Path $chroot 'incoming'
$sshdConfig=Join-Path $env:ProgramData 'ssh\sshd_config'
$wgServerConf=Join-Path $secure "$vpnName.conf"
$wgClientConf=Join-Path $provision 'UASSpainBackupCliente.conf'
$sshKey=Join-Path $provision 'id_ed25519_uasspain_backup'
$sshAuth=Join-Path $secure 'authorized_keys'
$firewallWG="UASSpainBackup-WireGuard-UDP$wgPort"
$firewallSFTP="UASSpainBackup-SFTP-VPN-TCP$sftpPort"
Assert-NoReparsePoint $root
Assert-NoReparsePoint $sshdConfig

# PRECHECK estricto: para no tocar servicios SSH preexistentes ni sobreescribir secretos.
if (Test-Path -LiteralPath $root) { Stop-Setup "Ya existe $root. No se sobreescribe; revisa la instalacion previa." }
if (Test-Path -LiteralPath $chroot) { Stop-Setup "Ya existe $chroot. No se modifica una carpeta con datos preexistentes." }
if (Get-LocalUser -Name $user -ErrorAction SilentlyContinue) { Stop-Setup "Ya existe el usuario $user; requiere revision." }
if (Get-Service -Name $wgServiceName -ErrorAction SilentlyContinue) { Stop-Setup 'Ya existe un tunel WireGuard con este nombre' }
if (Get-NetFirewallRule -Name $firewallWG -ErrorAction SilentlyContinue) { Stop-Setup 'Regla VPN previa existente' }
if (Get-NetFirewallRule -Name $firewallSFTP -ErrorAction SilentlyContinue) { Stop-Setup 'Regla SFTP previa existente' }
if (Get-NetUDPEndpoint -LocalPort $wgPort -ErrorAction SilentlyContinue) { Stop-Setup "Puerto UDP $wgPort ya utilizado" }
if (Get-NetTCPConnection -LocalPort $sftpPort -State Listen -ErrorAction SilentlyContinue) { Stop-Setup "Puerto TCP $sftpPort ya utilizado" }
$sshCapability = Get-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0'
$sshInstalled = ($sshCapability.State -eq 'Installed')
if ($sshCapability.State -notin @('Installed','NotPresent')) {
    Stop-Setup "Estado OpenSSH no soportado: $($sshCapability.State)"
}
# Reutilizar OpenSSH cuando este instalado. No alterar un servicio SSH en uso.
$existingSSHD = Get-Service sshd -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $sshdConfig) {
    Stop-Setup 'Existe configuracion SSH previa, incluso si sshd esta parado. No se reemplaza; requiere adaptacion supervisada en host dedicado.'
}
if ($existingSSHD -and @($existingSSHD.ServicesDependedOn).Count -gt 0) { Stop-Setup 'sshd tiene dependencias previas; no se sustituyen' }
if ($existingSSHD -and $existingSSHD.Status -eq 'Running') {
    Stop-Setup 'OpenSSH existente en ejecucion: no se modificara su configuracion. Usa un host dedicado o adaptacion supervisada.'
}
if ((Get-NetTCPConnection -LocalPort 22 -State Listen -ErrorAction SilentlyContinue) -or
    (Get-NetTCPConnection -LocalPort $sftpPort -State Listen -ErrorAction SilentlyContinue)) {
    Stop-Setup 'Se detecto SSH/TCP preexistente en uso. No se reemplaza.'
}
if ($env:PROCESSOR_ARCHITECTURE -eq 'x86') { Stop-Setup 'Abre PowerShell de 64 bits' }
Write-Host "Servidor: $backupIP ($interface); origen permitido: $uasIP"
Write-Host "VPN UDP/$wgPort, SFTP TCP/$sftpPort solo en $wgBackupAddress; carpeta fisica $incoming"
Write-Host 'Comprobando espacio libre de la unidad de destino...'
$targetDrive=[IO.Path]::GetPathRoot($chroot).TrimEnd('\').TrimEnd(':')
$vol = Get-Volume -DriveLetter $targetDrive -ErrorAction SilentlyContinue
if (-not $vol -or $vol.SizeRemaining -lt ([long]$MinimumFreeGB * 1GB)) { Stop-Setup "Se exigen $MinimumFreeGB GB libres en el volumen del backup" }
if ((Read-Host 'Se instalaran componentes, usuario, tunel y reglas restringidas en ESTE servidor. Escriba INSTALAR para autorizar') -cne 'INSTALAR') {
    Stop-Setup 'Instalacion no confirmada; no se han aplicado cambios'
}
$sshFirewallWasPresent = [bool](Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue)

# Instalacion por fases; ante error deja el estado pendiente para inspeccion, sin borrados.
$wgPaths=Install-WireGuard
$wgExe=$wgPaths[0]; $wgTool=$wgPaths[1]
if (-not $sshInstalled) {
    Write-Host 'OpenSSH Server no esta instalado. Instalando capacidad oficial Windows...'
    $capResult=Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0'
    if ($capResult.RestartNeeded) { Stop-Setup 'OpenSSH requiere reinicio. Revisar estado parcial antes de reanudar.' }
    if ((Get-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0').State -ne 'Installed') {
        Stop-Setup 'No se ha completado la instalacion de OpenSSH Server'
    }
    # Windows puede crear regla generica para el puerto 22. Solo deshabilitarla si fue creada AHORA.
    if (-not $sshFirewallWasPresent -and (Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue)) {
        Disable-NetFirewallRule -Name 'OpenSSH-Server-In-TCP'
    }
} else {
    Write-Host 'OpenSSH Server ya instalado: reutilizando binarios. No se desinstala ni actualiza.'
}
if (-not (Get-Service sshd -ErrorAction SilentlyContinue)) { Stop-Setup 'El servicio sshd no esta disponible' }
$sshdExe=Join-Path $env:WINDIR 'System32\OpenSSH\sshd.exe'
$keygen=Join-Path $env:WINDIR 'System32\OpenSSH\ssh-keygen.exe'
Assert-File $sshdExe; Assert-File $keygen

New-Item -ItemType Directory -Path $root,$secure,$provision,$chroot,$incoming -Force | Out-Null
Protect-Admins $root -IsDirectory; Protect-Admins $secure -IsDirectory; Protect-Admins $provision -IsDirectory

# Cuenta sin privilegios y con contrasena aleatoria, que NO se utiliza para autenticacion SSH.
$rng=New-Object byte[] 48
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($rng)
$randomPassword='Ua9!'+[Convert]::ToBase64String($rng)
$securePassword=ConvertTo-SecureString $randomPassword -AsPlainText -Force
New-LocalUser -Name $user -Password $securePassword -AccountNeverExpires -PasswordNeverExpires -Description 'SFTP solo backups UASSpain (VPN)' | Out-Null
$randomPassword=$null; $securePassword=$null
$sid=(Get-LocalUser -Name $user).SID.Value
# Directorio chroot no escribible por el usuario; /incoming si es escribible.
& icacls.exe $chroot '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' "*${sid}:(RX)" | Out-Null
Assert-Exit 'ACL chroot'
& icacls.exe $incoming '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' "*${sid}:(OI)(CI)M" | Out-Null
Assert-Exit 'ACL incoming'

# Claves VPN (servidor y cliente) y SSH del cliente.
$serverPriv=(& $wgTool genkey).Trim(); Assert-Exit 'WG genkey servidor'
$serverPub=($serverPriv | & $wgTool pubkey).Trim(); Assert-Exit 'WG pubkey servidor'
$clientPriv=(& $wgTool genkey).Trim(); Assert-Exit 'WG genkey cliente'
$clientPub=($clientPriv | & $wgTool pubkey).Trim(); Assert-Exit 'WG pubkey cliente'
$wgServer="[Interface]`r`nPrivateKey = $serverPriv`r`nAddress = $wgBackupAddress/30`r`nListenPort = $wgPort`r`n`r`n[Peer]`r`nPublicKey = $clientPub`r`nAllowedIPs = $wgUasAddress/32`r`n"
$wgClient="[Interface]`r`nPrivateKey = $clientPriv`r`nAddress = $wgUasAddress/30`r`n`r`n[Peer]`r`nPublicKey = $serverPub`r`nEndpoint = ${backupIP}:$wgPort`r`nAllowedIPs = $wgBackupAddress/32`r`nPersistentKeepalive = 25`r`n"
[IO.File]::WriteAllText($wgServerConf,$wgServer,[Text.Encoding]::ASCII)
[IO.File]::WriteAllText($wgClientConf,$wgClient,[Text.Encoding]::ASCII)
Protect-Admins $wgServerConf; Protect-Admins $wgClientConf
$serverPriv=$null; $clientPriv=$null; $wgServer=$null; $wgClient=$null
& $keygen -t ed25519 -f $sshKey -N '""' -C 'uasspain-backup-client' -q
Assert-Exit 'Generacion clave SSH'
Assert-File $sshKey; Assert-File "$sshKey.pub"
Protect-Admins $sshKey
$publicSSH=(Get-Content "$sshKey.pub" -Raw).Trim()
[IO.File]::WriteAllText($sshAuth,$publicSSH+"`n",[Text.Encoding]::ASCII)
Protect-Admins $sshAuth

# Host key de sshd. No sustituir claves preexistentes.
& $keygen -A
Assert-Exit 'Generacion claves de host SSH'
$hostPub=Join-Path $env:ProgramData 'ssh\ssh_host_ed25519_key.pub'
Assert-File $hostPub
$hostParts=((Get-Content $hostPub -Raw).Trim() -split '\s+')
if ($hostParts.Count -lt 2 -or $hostParts[0] -ne 'ssh-ed25519') { Stop-Setup 'Clave host ED25519 no disponible' }
$known="[${wgBackupAddress}]:$sftpPort $($hostParts[0]) $($hostParts[1])"
$knownFile=Join-Path $provision 'known_hosts_uasspain_backup'
[IO.File]::WriteAllText($knownFile,$known+"`n",[Text.Encoding]::ASCII)
Protect-Admins $knownFile
$peerInfo=Join-Path $provision 'peer-info.txt'
[IO.File]::WriteAllText($peerInfo,"ExpectedClientIP=$uasIP`r`nBackupServerIP=$backupIP`r`nWireGuardPort=$wgPort`r`nSftpPort=$sftpPort`r`n",[Text.Encoding]::ASCII)
Protect-Admins $peerInfo

# SSH exclusivamente por WireGuard: ni 22/tcp ni interfaz LAN.
$cfg=@"
Port $sftpPort
AddressFamily inet
ListenAddress $wgBackupAddress
HostKey __PROGRAMDATA__/ssh/ssh_host_ed25519_key
PubkeyAuthentication yes
PasswordAuthentication no
AuthenticationMethods publickey
PermitEmptyPasswords no
AllowUsers $user
AllowTcpForwarding no
AllowAgentForwarding no
PermitTTY no
Subsystem sftp sftp-server.exe
Match User $user
    AuthorizedKeysFile "$($sshAuth.Replace('\','/'))"
    ChrootDirectory "$($chroot.Replace('\','/'))"
    ForceCommand internal-sftp -d /incoming
"@
if (Test-Path $sshdConfig) {
    Stop-Setup 'La configuracion SSH aparecio despues del precheck. No se sobreescribe: revisar estado parcial.'
}
[IO.File]::WriteAllText($sshdConfig,$cfg+"`r`n",(New-Object Text.UTF8Encoding($false)))
& $sshdExe -t -f $sshdConfig
Assert-Exit 'Validacion sshd_config'

# Puertos: si no existe una regla propia, se crea la apertura minima necesaria en el firewall.
# No se cambian reglas ajenas ni se abren puertos del router.
# Firewall: solo IP del peer fisico para VPN y solo IP VPN peer para SFTP.
New-NetFirewallRule -Name $firewallWG -DisplayName 'UASSpain Backup WireGuard (solo UASSpain)' -Direction Inbound -Action Allow -Enabled True -Protocol UDP -LocalPort $wgPort -LocalAddress $backupIP -RemoteAddress $uasIP -InterfaceAlias $interface -Profile Any | Out-Null
New-NetFirewallRule -Name $firewallSFTP -DisplayName 'UASSpain Backup SFTP solo por WireGuard' -Direction Inbound -Action Allow -Enabled True -Protocol TCP -LocalPort $sftpPort -LocalAddress $wgBackupAddress -RemoteAddress $wgUasAddress -Profile Any | Out-Null

# VPN arranca como servicio y SSH depende del tunel para evitar fallos de arranque.
& $wgExe /installtunnelservice $wgServerConf
Assert-Exit 'Instalacion tunel WireGuard servidor'
Start-Sleep -Seconds 4
if (-not (Get-Service -Name $wgServiceName -ErrorAction SilentlyContinue)) { Stop-Setup 'Servicio WireGuard no creado' }
if ((Get-Service -Name $wgServiceName).Status -ne 'Running') { Stop-Setup 'Servicio WireGuard no esta en ejecucion' }
$vpnInterface = @(Get-NetIPAddress -AddressFamily IPv4 -IPAddress $wgBackupAddress -ErrorAction Stop)
if ($vpnInterface.Count -ne 1) { Stop-Setup 'No se identifica una unica interfaz de VPN para restringir SFTP' }
Set-NetFirewallRule -Name $firewallSFTP -InterfaceAlias $vpnInterface[0].InterfaceAlias
& sc.exe config sshd 'depend=' $wgServiceName | Out-Null
Assert-Exit 'Dependencia servicio SSH respecto a WireGuard'
Set-Service sshd -StartupType Automatic
Start-Service sshd
Start-Sleep -Seconds 3
if ((Get-Service sshd).Status -ne 'Running') { Stop-Setup 'El servicio SSH no arranca' }
$listen=Get-NetTCPConnection -LocalPort $sftpPort -State Listen -ErrorAction SilentlyContinue
if (@($listen | Where-Object { $_.LocalAddress -eq $wgBackupAddress }).Count -eq 0) { Stop-Setup 'SFTP no escucha en IP privada WireGuard' }
if (@($listen | Where-Object { $_.LocalAddress -ne $wgBackupAddress }).Count -gt 0) { Stop-Setup 'SFTP escucha en una interfaz no autorizada' }
# Comprobar que las reglas efectivas que creamos conservan el alcance restringido.
foreach ($ruleName in @($firewallWG,$firewallSFTP)) {
    $rule=Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
    if (-not $rule -or $rule.Enabled -ne 'True' -or $rule.Action -ne 'Allow') {
        Stop-Setup "Regla firewall no operativa: $ruleName"
    }
}
$fwWG = Get-NetFirewallRule -Name $firewallWG | Get-NetFirewallPortFilter
$fwSftp = Get-NetFirewallRule -Name $firewallSFTP | Get-NetFirewallPortFilter
if ($fwWG.Protocol -ne 'UDP' -or [string]$fwWG.LocalPort -ne [string]$wgPort -or
    $fwSftp.Protocol -ne 'TCP' -or [string]$fwSftp.LocalPort -ne [string]$sftpPort) {
    Stop-Setup 'Reglas de firewall no coinciden con los puertos elegidos'
}
Write-Host 'PASS: reglas de firewall restringidas creadas y puertos de escucha comprobados.' -ForegroundColor Green

# Archivo de datos para rellenar UASSpain, sin claves privadas impresas.
$info=@"
UASSpain - BACKUP EXTERNO POR VPN + SFTP
=========================================
IP fisica PC backup: $backupIP
IP fisica PC UASSpain: $uasIP
WireGuard servidor UDP: $wgPort (solo origen $uasIP)
Host SFTP POR VPN: $wgBackupAddress
Puerto SFTP: $sftpPort (TCP)
Usuario SFTP: $user
Ruta REMOTA SFTP: /incoming
Ruta fisica en Windows backup: $incoming
Archivo SSH private key a usar en UASSpain: id_ed25519_uasspain_backup
Archivo pin de host SSH: known_hosts_uasspain_backup
IMPORTANTE: en el panel de UASSpain separar Host, Puerto y Ruta si asi lo pide.
La clave SFTP debe configurarse mediante el mecanismo seguro del backend, no como texto en un log.
La conexion VPN desde el PC UASSpain y la integracion con su contenedor aun NO estan verificadas.
Sin instalador cliente personalizado: importar UASSpainBackupCliente.conf en WireGuard oficial.
En Linux renombrar el archivo a una interfaz propia de hasta 15 caracteres, por ejemplo uas-backup1.conf.
NO subir ni sincronizar la carpeta de aprovisionamiento (contiene claves privadas).
"@
$summaryFile=Join-Path $root 'INSTRUCCIONES_UASSPAIN.txt'
[IO.File]::WriteAllText($summaryFile,$info,[Text.Encoding]::UTF8)
Protect-Admins $summaryFile
# Si el tecnico aporta clientes originales revisados, incluirlos sin exigirlos.
foreach ($sourceFile in @($clientScriptSource,$clientLauncherSource)) {
    if (Test-Path -LiteralPath $sourceFile -PathType Leaf) {
        Assert-NoReparsePoint $sourceFile
        $destinationFile=Join-Path $provision ([IO.Path]::GetFileName($sourceFile))
        Copy-Item -LiteralPath $sourceFile -Destination $destinationFile -ErrorAction Stop
        Protect-Admins $destinationFile
    }
}

Write-Host "`n=== SERVIDOR PREPARADO (pendiente de peer UASSpain) ===" -ForegroundColor Green
Write-Host "Directorio PARA LLEVAR AL PC UASSPAIN: $provision"
Write-Host "Host SFTP: $wgBackupAddress | Puerto: $sftpPort | Usuario: $user | Ruta remota: /incoming"
Write-Host "Ruta fisica: $incoming"
Write-Host "Guia de parametros: $summaryFile"
Write-Host "ATENCION: el tunel NO estara operativo hasta instalar el cliente en $uasIP."
Write-Host 'Sin instalador cliente personalizado, importar UASSpainBackupCliente.conf en WireGuard oficial y configurar SSH/known_hosts en el almacen protegido UASSpain.'
Write-Host 'Copiar la carpeta de aprovisionamiento por medio seguro/offline; NO por correo ni nube.'
Write-Host 'Los puertos se abren SOLO en el firewall del PC de backups, y solo a los origenes autorizados.'
