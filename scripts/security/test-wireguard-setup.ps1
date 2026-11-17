param([string]$ReportPath)
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sourcePath = Join-Path $repositoryRoot 'infra/wireguard/setup.ps1'
$source = [IO.File]::ReadAllText($sourcePath)
$sourceHash = ([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([IO.File]::ReadAllBytes($sourcePath)))).Replace('-', '').ToLowerInvariant()
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($sourcePath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'WireGuard source does not parse in this PowerShell version' }
# Load reviewed function definitions only, never the installer/network main body.
foreach ($node in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] }, $true)) {
    . ([scriptblock]::Create($node.Extent.Text))
}
$script:results = [Collections.Generic.List[object]]::new()
function Check($Name, [scriptblock]$Body) {
    try { & $Body; $script:results.Add([pscustomobject]@{name=$Name;status='PASS'}) }
    catch { $script:results.Add([pscustomobject]@{name=$Name;status='FAIL';error=$_.Exception.Message}) }
}
function Assert($Condition, $Message) { if (-not $Condition) { throw $Message } }
function Expect-Failure([scriptblock]$Body, $Pattern) {
    $message = $null
    try { & $Body } catch { $message = $_.Exception.Message }
    Assert ($message -and $message -match $Pattern) 'Expected rejection did not occur or was unrelated'
}
function Reset-Fixture {
    $script:effects = [Collections.Generic.List[string]]::new()
    $script:success = [Collections.Generic.List[string]]::new()
    $script:DryRun = $false; $script:AllowInstall = $false
    $script:ToolsPresent = $true; $script:ConfigPresent = $true
    $script:InstallerExit = 0; $script:TunnelExit = 0
    $script:SignatureStatus = 'Valid'; $script:Publisher = 'CN=WireGuard LLC, O=WireGuard LLC, C=US'
    $script:ServiceState = 'Running'; $script:ServiceInstalled = $false
    $script:ActiveTunnelName = 'server1'; $script:InterfaceList = 'server1'
    $script:RouteAlias = 'server1'
    $script:Allowed = @("peer-a`t192.0.2.2/32")
    $script:Handshakes = @("peer-a`t$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())")
    $script:Root = $repositoryRoot; $script:WG_CONFIG_DIR = 'synthetic-configs'
    $script:wgPath = 'SYNTHETIC-wg.exe'
    $script:wireguardExe = { param($Verb,$Config) $script:effects.Add('tunnel:'+$Verb); $script:LASTEXITCODE=$script:TunnelExit; $script:ServiceInstalled=$true }
}
function Step($msg) {}
function Warn($msg) {}
function Ok($msg) { $script:success.Add($msg) }
function Fail($msg) { throw $msg }
function Test-Path { param($Path) if ([string]$Path -like '*.conf') { return $script:ConfigPresent }; return $script:ToolsPresent }
function Invoke-WebRequest { param($Uri,$OutFile,[switch]$UseBasicParsing) $script:effects.Add('download'); Assert ($Uri -eq 'https://download.wireguard.com/windows-client/wireguard-installer.exe') 'Unexpected download origin' }
function Get-AuthenticodeSignature { param($LiteralPath) return [pscustomobject]@{Status=$script:SignatureStatus;SignerCertificate=[pscustomobject]@{Subject=$script:Publisher}} }
function Start-Process { param($FilePath,$ArgumentList,[switch]$Wait,[switch]$PassThru,$WindowStyle) $script:effects.Add('installer'); Assert ($WindowStyle -eq 'Hidden') 'Installer window must be hidden'; $script:ToolsPresent=($script:InstallerExit -eq 0); return [pscustomobject]@{ExitCode=$script:InstallerExit} }
function Add-AppxPackage { throw 'Unexpected Appx installation' }
function Get-Service {
    param($Name,$ErrorAction)
    Assert ($Name -eq 'WireGuardTunnel$server1') 'Wrong named tunnel service'
    if ($script:ServiceState -eq 'Missing' -and -not $script:ServiceInstalled) { return $null }
    $service = [pscustomobject]@{Status=if($script:ServiceState -eq 'Stopped'){'Stopped'}else{'Running'}}
    $service | Add-Member ScriptMethod WaitForStatus { param($Desired,$Timeout) if ($this.Status -ne $Desired) { throw 'Service did not start' } }
    return $service
}
function Get-NetAdapter { throw 'An unrelated adapter must not establish tunnel identity' }
function Find-NetRoute { param($RemoteIPAddress,$ErrorAction) $script:effects.Add('route-read'); return @([pscustomobject]@{IPAddress='192.0.2.1'},[pscustomobject]@{DestinationPrefix='192.0.2.2/32';InterfaceAlias=$script:RouteAlias}) }
function Test-NetConnection { throw 'TCP reachability is not WireGuard proof' }
function Test-Connection { param($ComputerName,$Count,[switch]$Quiet,$ErrorAction) $script:effects.Add('ping'); return $true }
function Get-WireGuardStatus { param($Tunnel,$Field) $script:effects.Add('status:'+$Field); switch($Field){'interfaces'{$script:InterfaceList};'allowed-ips'{$script:Allowed};'latest-handshakes'{$script:Handshakes};default{throw 'Unsafe status field'}} }

Check 'DryRun installation has no side effects even when allowed' { Reset-Fixture; $script:DryRun=$true; $script:AllowInstall=$true; $script:ToolsPresent=$false; Install-WireGuard; Assert ($script:effects.Count -eq 0) 'DryRun installed/downloaded' }
Check 'DryRun activation has no side effects or success' { Reset-Fixture; $script:DryRun=$true; Activate-Tunnel server1; Assert ($script:effects.Count -eq 0 -and $script:success.Count -eq 0) 'DryRun activated tunnel' }
Check 'DryRun verification has no network probe or success' { Reset-Fixture; $script:DryRun=$true; Test-VPNConnectivity 192.0.2.2 SYNTHETIC; Assert ($script:effects.Count -eq 0 -and $script:success.Count -eq 0) 'DryRun validated/probed network' }
foreach ($role in @('server1','server2','backup1','backup2','backup3')) {
    Check ('Full main DryRun '+$role) { Reset-Fixture; $script:DryRun=$true; $Server=$role; & ([scriptblock]::Create($source.Substring($source.IndexOf('$ServerName = if')))); Assert ($script:effects.Count -eq 0 -and $script:success.Count -eq 0) 'DryRun main performed operation/claimed success' }
}
Check 'Missing binaries require explicit install authorization' { Reset-Fixture; $script:ToolsPresent=$false; Expect-Failure { Install-WireGuard } 'explicit.*AllowInstall'; Assert ($script:effects.Count -eq 0) 'Installer ran without authorization' }
Check 'Installed tools are reused' { Reset-Fixture; Install-WireGuard; Assert ($script:effects.Count -eq 0) 'Reinstalled existing tools' }
Check 'Invalid signature blocks execution' { Reset-Fixture; $script:ToolsPresent=$false;$script:AllowInstall=$true;$script:SignatureStatus='NotSigned';Expect-Failure {Install-WireGuard} 'signature/publisher';Assert ('installer' -notin $script:effects) 'Unsigned installer executed' }
Check 'Wrong publisher blocks execution' { Reset-Fixture; $script:ToolsPresent=$false;$script:AllowInstall=$true;$script:Publisher='CN=Other vendor';Expect-Failure {Install-WireGuard} 'signature/publisher';Assert ('installer' -notin $script:effects) 'Wrong publisher executed' }
Check 'Installer failure cannot claim success' { Reset-Fixture; $script:ToolsPresent=$false;$script:AllowInstall=$true;$script:InstallerExit=7;Expect-Failure {Install-WireGuard} 'installer failed';Assert ($script:success.Count -eq 0) 'Failed installer claimed success' }
Check 'Authorized signed installation requires success and both tools' { Reset-Fixture; $script:ToolsPresent=$false;$script:AllowInstall=$true;Install-WireGuard;Assert ('download' -in $script:effects -and 'installer' -in $script:effects -and $script:success.Count -eq 1) 'Signed installation contract failed' }
Check 'Missing config cannot install service' { Reset-Fixture;$script:ConfigPresent=$false;Expect-Failure {Activate-Tunnel server1} 'Config not found';Assert ($script:effects.Count -eq 0) 'Created service without config' }
Check 'Stopped existing service is preserved' { Reset-Fixture;$script:ServiceState='Stopped';Expect-Failure {Activate-Tunnel server1} 'not replaced or restarted';Assert ($script:effects.Count -eq 0) 'Changed existing stopped service' }
Check 'Native tunnel-service failure cannot claim activation' { Reset-Fixture;$script:ServiceState='Missing';$script:TunnelExit=7;Expect-Failure {Activate-Tunnel server1} 'service installation failed';Assert ($script:success.Count -eq 0) 'Failed activation claimed success' }
Check 'Native service activation uses official verb and exact interface' { Reset-Fixture;$script:ServiceState='Missing';Activate-Tunnel server1;Assert ('tunnel:/installtunnelservice' -in $script:effects -and $script:ActiveTunnelName -eq 'server1') 'Wrong activation command' }
Check 'Existing named service does not reinstall' { Reset-Fixture;Activate-Tunnel server1;Assert ('tunnel:/installtunnelservice' -notin $script:effects) 'Reinstalled running service' }
Check 'Unrelated interface cannot establish activation' { Reset-Fixture;$script:InterfaceList='other-tunnel';Expect-Failure {Activate-Tunnel server1} 'requested tunnel interface';Assert ($script:success.Count -eq 0) 'Wrong interface accepted' }

$prefixCases = @(
    @('192.0.2.2','192.0.2.2/32',$true),@('192.0.2.2','192.0.2.3/32',$false),
    @('192.0.2.2','192.0.2.0/24',$true),@('192.0.2.2','198.51.100.0/24',$false),
    @('192.0.2.2','0.0.0.0/0',$true),@('192.0.2.2','192.0.2.0/33',$false),
    @('192.0.2.2','invalid/24',$false),@('192.0.2.2','192.0.2.0/-1',$false),
    @('2001:db8::2','2001:db8::/64',$true),@('2001:db8::2','2001:db9::/64',$false),
    @('2001:db8::2','192.0.2.2/32',$false),@('2001:db8::2','2001:db8::2/128',$true)
)
foreach ($case in $prefixCases) { Check ('Prefix '+$case[0]+' '+$case[1]) { Assert ((Test-IPInPrefix $case[0] $case[1]) -eq $case[2]) 'Prefix comparison mismatch' } }
$handshakeCases = @(
    @('current',@("peer-a`t192.0.2.2/32"),@("peer-a`t999"),$true),
    @('boundary180',@("peer-a`t192.0.2.2/32"),@("peer-a`t820"),$true),
    @('stale181',@("peer-a`t192.0.2.2/32"),@("peer-a`t819"),$false),
    @('zero',@("peer-a`t192.0.2.2/32"),@("peer-a`t0"),$false),
    @('future',@("peer-a`t192.0.2.2/32"),@("peer-a`t1001"),$false),
    @('invalid',@("peer-a`t192.0.2.2/32"),@("peer-a`tnan"),$false),
    @('wrong-peer',@("peer-a`t192.0.2.2/32"),@("peer-b`t999"),$false),
    @('wrong-address',@("peer-a`t198.51.100.2/32"),@("peer-a`t999"),$false),
    @('ambiguous-peer',@("peer-a`t192.0.2.2/32","peer-b`t192.0.2.0/24"),@("peer-a`t999","peer-b`t999"),$false),
    @('duplicate-handshake',@("peer-a`t192.0.2.2/32"),@("peer-a`t999","peer-a`t998"),$false),
    @('second-prefix',@("peer-a`t198.51.100.2/32, 192.0.2.2/32"),@("peer-a`t999"),$true)
)
foreach ($case in $handshakeCases) {
    Check ('Handshake '+$case[0]) { if($case[3]) { Assert-RecentPeerHandshake $case[1] $case[2] 192.0.2.2 1000 } else { Expect-Failure { Assert-RecentPeerHandshake $case[1] $case[2] 192.0.2.2 1000 } 'peer|handshake' } }
}
Check 'Wrong route fails before network traffic' { Reset-Fixture;$script:RouteAlias='Ethernet';Expect-Failure {Test-VPNConnectivity 192.0.2.2 SYNTHETIC} 'Selected route';Assert ('ping' -notin $script:effects -and $script:success.Count -eq 0) 'Non-tunnel traffic accepted' }
Check 'TCP/ping with no handshake is not validation' { Reset-Fixture;$script:Handshakes=@("peer-a`t0");Expect-Failure {Test-VPNConnectivity 192.0.2.2 SYNTHETIC} 'handshake';Assert ($script:success.Count -eq 0) 'Ping was treated as VPN proof' }
Check 'Matching route and recent exact peer succeed' { Reset-Fixture;Test-VPNConnectivity 192.0.2.2 SYNTHETIC;Assert ($script:success.Count -eq 1) 'Valid route and peer rejected' }

$failures = @($script:results | Where-Object status -eq 'FAIL')
$report = [pscustomobject]@{status=if($failures.Count){'FAIL'}else{'PASS'};powershell=$PSVersionTable.PSVersion.ToString();source_sha256=$sourceHash;tests=$script:results.Count;failures=$failures.Count;network_or_system_operations=0;scope='mocked external boundaries; not real WireGuard/SFTP validation';results=@($script:results)}
if ($ReportPath) { [IO.File]::WriteAllText($ReportPath, ($report | ConvertTo-Json -Depth 7), [Text.UTF8Encoding]::new($false)) }
$report | ConvertTo-Json -Depth 7
if ($failures.Count) { exit 1 }
exit 0
