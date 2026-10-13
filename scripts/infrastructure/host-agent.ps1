param(
    [string]$KeyFile,
    [string]$OutputDirectory,
    [switch]$PrepareKey,
    [switch]$InspectOnly
)
$ErrorActionPreference='Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Use host-agent.py on Linux.' }
function Invoke-Read([string]$Program,[string[]]$Arguments) {
    $start=New-Object Diagnostics.ProcessStartInfo
    $start.FileName=$Program
    # Only fixed read-only operations and validated interface names reach here.
    $start.Arguments=($Arguments | ForEach-Object { '"'+$_.Replace('"','')+'"' }) -join ' '
    $start.UseShellExecute=$false; $start.CreateNoWindow=$true
    $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true
    $process=New-Object Diagnostics.Process; $process.StartInfo=$start
    if(-not $process.Start()){throw 'Collector command unavailable'}
    $stdout=$process.StandardOutput.ReadToEndAsync(); $stderr=$process.StandardError.ReadToEndAsync()
    if(-not $process.WaitForExit(5000)){$process.Kill();throw 'Collector command timeout'}
    $value=$stdout.GetAwaiter().GetResult(); $null=$stderr.GetAwaiter().GetResult()
    if($process.ExitCode -ne 0){throw 'Collector read operation denied'}
    return $value.Trim()
}
$wg=Join-Path $env:ProgramFiles 'WireGuard\wg.exe'
$installed=Test-Path -LiteralPath $wg -PathType Leaf
$errors=New-Object 'Collections.Generic.List[string]'
$interfaces=New-Object 'Collections.Generic.List[object]'
$networks=New-Object 'Collections.Generic.List[string]'
$mounts=@()
$services=@(Get-Service -Name 'WireGuardTunnel$*' -ErrorAction SilentlyContinue)
$serviceState=if($services.Count -eq 0){'unavailable'}elseif(@($services|Where-Object Status -eq 'Running').Count -gt 0){'running'}else{'stopped'}
$complete=$true
try {
    $names=if($installed){(Invoke-Read $wg @('show','interfaces')) -split '\s+'}else{@()}
    foreach($name in $names){
        if([string]::IsNullOrEmpty($name)){continue}
        if($name -notmatch '^[A-Za-z0-9_.-]{1,64}$'){throw 'Invalid interface name'}
        $keys=(Invoke-Read $wg @('show',$name,'peers')) -split '\r?\n'
        $data=@{}
        foreach($field in @('endpoints','allowed-ips','latest-handshakes','transfer','persistent-keepalive')) {
            $table=@{}
            foreach($line in ((Invoke-Read $wg @('show',$name,$field)) -split '\r?\n')) {
                $parts=$line -split "`t",2
                if($parts.Count -eq 2){$table[$parts[0]]=$parts[1]}
            }
            $data[$field]=$table
        }
        $peers=@(foreach($publicKey in $keys){if($publicKey){
            $transfer=@($data.transfer[$publicKey] -split '\s+')
            $endpoint=$data.endpoints[$publicKey];if($endpoint -eq '(none)'){$endpoint=''}
            $keepalive=$data.'persistent-keepalive'[$publicKey];if($keepalive -eq 'off'){$keepalive=0}
            [ordered]@{public_key=$publicKey;endpoint=[string]$endpoint;allowed_ips=@($data.'allowed-ips'[$publicKey] -split '\s+'|Where-Object {$_ -and $_ -ne '(none)'});latest_handshake=[long]$data.'latest-handshakes'[$publicKey];rx_bytes=[long]$transfer[0];tx_bytes=[long]$transfer[1];keepalive=[int]$keepalive}
        }})
        $addresses=@(Get-NetIPAddress -InterfaceAlias $name -ErrorAction Stop|Where-Object {$_.IPAddress -notlike 'fe80:*'}|ForEach-Object { '{0}/{1}' -f $_.IPAddress,$_.PrefixLength })
        $interfaces.Add([ordered]@{name=$name;public_key=(Invoke-Read $wg @('show',$name,'public-key'));listen_port=[int](Invoke-Read $wg @('show',$name,'listen-port'));addresses=$addresses;peers=$peers})
    }
}catch{$errors.Add('WG_QUERY_DENIED');$interfaces.Clear()}
if(-not $installed){$errors.Add('WG_UNAVAILABLE')}
try {
    $vpnNames=@($interfaces|ForEach-Object {$_.name})
    Get-NetIPAddress -ErrorAction Stop | Where-Object {$_.InterfaceAlias -notin $vpnNames -and $_.IPAddress -notlike '127.*' -and $_.IPAddress -ne '::1' -and $_.IPAddress -notlike 'fe80:*'} | ForEach-Object {$networks.Add(('{0}/{1}' -f $_.IPAddress,$_.PrefixLength))}
    if(Get-Command docker -ErrorAction SilentlyContinue){
        $backend=Invoke-Read 'docker' @('inspect','uasspain-backend')|ConvertFrom-Json
        if($backend.Config.Labels.'com.docker.compose.project' -ne 'uasspain' -or $backend.Config.Labels.'com.docker.compose.service' -ne 'backend'){throw 'Backend identity mismatch'}
        $mounts=@($backend.Mounts|ForEach-Object {[ordered]@{source=[string]$_.Source;destination=[string]$_.Destination;read_only=-not $_.RW}})
        $ids=(Invoke-Read 'docker' @('network','ls','-q')) -split '\r?\n'
        foreach($id in $ids){if($id -match '^[a-f0-9]+$'){
            $network=Invoke-Read 'docker' @('network','inspect',$id)|ConvertFrom-Json
            foreach($subnet in @($network.IPAM.Config)){if($subnet.Subnet){$networks.Add([string]$subnet.Subnet)}}
        }}
    }else{$complete=$false}
}catch{$complete=$false}
if(-not $complete){$errors.Add('NETWORK_INVENTORY_INCOMPLETE')}
$installation='unknown'
try {$system=Get-CimInstance Win32_ComputerSystem -ErrorAction Stop;if($system.Model -match 'Virtual|VMware|KVM|VirtualBox'){$installation='virtual_machine'}}catch{}
$observation=[ordered]@{schema=1;observed_at=[DateTime]::UtcNow.ToString('o');host_platform='windows';installation=$installation;wireguard_installed=$installed;service_state=$serviceState;interfaces=@($interfaces.ToArray());networks=@($networks.ToArray()|Sort-Object -Unique);network_inventory_complete=$complete;mounts=$mounts;errors=@($errors.ToArray())}
if($InspectOnly){$observation|ConvertTo-Json -Depth 10;exit 0}
if(-not $KeyFile -or -not $OutputDirectory){throw 'KeyFile and OutputDirectory are required; use InspectOnly for read-only inspection.'}
$keyTarget=[IO.Path]::GetFullPath($KeyFile)
$outTarget=[IO.Path]::GetFullPath($OutputDirectory)
if($PrepareKey -and -not(Test-Path -LiteralPath $keyTarget)){
    $parent=Split-Path -Parent $keyTarget
    if(-not(Test-Path -LiteralPath $parent -PathType Container)){throw 'Prepare the protected credential directory first.'}
    $bytes=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create();$rng.GetBytes($bytes);$rng.Dispose()
    $file=[IO.File]::Open($keyTarget,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try{$file.Write($bytes,0,$bytes.Length)}finally{$file.Dispose();[Array]::Clear($bytes,0,$bytes.Length)}
    $acl=New-Object Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true,$false)
    foreach($identity in @([Security.Principal.WindowsIdentity]::GetCurrent().Name,'NT AUTHORITY\SYSTEM')){$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','Allow')))}
    Set-Acl -LiteralPath $keyTarget -AclObject $acl
}
if((Get-Item -LiteralPath $keyTarget).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Key symlinks/reparse points are forbidden.'}
$key=[IO.File]::ReadAllBytes($keyTarget);if($key.Length -lt 32){throw 'Collector key is not valid.'}
if(-not(Test-Path -LiteralPath $outTarget -PathType Container)){throw 'Prepare the observation directory first.'}
if((Get-Item -LiteralPath $outTarget).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Observation directory reparse points are forbidden.'}
$payload=[Text.Encoding]::UTF8.GetBytes(($observation|ConvertTo-Json -Depth 10 -Compress))
$mac=New-Object Security.Cryptography.HMACSHA256;$mac.Key=$key
try{$signed=[ordered]@{payload=[Convert]::ToBase64String($payload);signature=[Convert]::ToBase64String($mac.ComputeHash($payload))}|ConvertTo-Json -Compress}finally{$mac.Dispose();[Array]::Clear($key,0,$key.Length)}
$temporary=Join-Path $outTarget ([Guid]::NewGuid().ToString()+'.tmp')
[IO.File]::WriteAllText($temporary,$signed,(New-Object Text.UTF8Encoding($false)))
$target=Join-Path $outTarget 'status.json'
try {
    if(Test-Path -LiteralPath $target){if((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Snapshot reparse point forbidden'};[IO.File]::Replace($temporary,$target,[NullString]::Value)}else{[IO.File]::Move($temporary,$target)}
} finally {
    if((Test-Path -LiteralPath $temporary -PathType Leaf) -and [IO.File]::ReadAllText($temporary) -eq $signed){Remove-Item -LiteralPath $temporary}
}
Write-Output 'HOST_OBSERVATION=WRITTEN_AUTHENTICATED; no VPN/firewall/routing changes.'
