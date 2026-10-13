[CmdletBinding(SupportsShouldProcess=$true,ConfirmImpact='High')]
param([string]$AllowedRoot,[string[]]$Directories=@(),[switch]$PrepareDirectories)
$ErrorActionPreference='Stop'
$report=[ordered]@{platform='windows';docker='NOT_RUN';linux_containers='NOT_RUN';wireguard='NOT_RUN';encrypted_start='scripts/start-encrypted-stack.ps1 -Build';directories=@();changes_applied=$false}
$server=$false
try {$server=(Get-CimInstance Win32_OperatingSystem).ProductType -ne 1}catch{}
$report['windows_server']=$server
if(Get-Command docker -ErrorAction SilentlyContinue){
    $type=& docker info --format '{{.OSType}}' 2>$null
    if($LASTEXITCODE -eq 0){$report.docker='PASS';$report.linux_containers=if($type -eq 'linux'){'PASS'}else{'BLOCKED'}}else{$report.docker='BLOCKED'}
    & docker compose version --short 2>$null | Out-Null
    $report['compose']=if($LASTEXITCODE -eq 0){'PASS'}else{'BLOCKED'}
}else{$report.docker='BLOCKED'}
$report.wireguard=if(Test-Path -LiteralPath (Join-Path $env:ProgramFiles 'WireGuard\wg.exe')){'CONFIGURED'}else{'NOT_CONFIGURED'}
if($server){$report['requirements']='Docker Desktop is not supported on Windows Server; use a validated Linux VM or supported container infrastructure.'}
foreach($directory in $Directories){
    if(-not $AllowedRoot){throw 'An explicit AllowedRoot is mandatory.'}
    $root=[IO.Path]::GetFullPath($AllowedRoot).TrimEnd('\')
    $target=[IO.Path]::GetFullPath($directory)
    if(-not $target.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) -or $directory -match '(^|[\\/])\.\.([\\/]|$)'){throw 'Directory outside the approved root.'}
    $ancestor=$target
    while($ancestor){if(Test-Path -LiteralPath $ancestor){if((Get-Item -LiteralPath $ancestor).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Reparse-point ancestors are forbidden.'}};$parent=Split-Path -Parent $ancestor;if($parent -eq $ancestor){break};$ancestor=$parent}
    if($PrepareDirectories -and -not(Test-Path -LiteralPath $target) -and $PSCmdlet.ShouldProcess($target,'Create only this approved directory')){New-Item -ItemType Directory -Path $target|Out-Null;$report.changes_applied=$true}
    $report.directories+=@{path=$target;state=if(Test-Path -LiteralPath $target -PathType Container){'CONFIGURED'}else{'NOT_CONFIGURED'}}
}
$report|ConvertTo-Json -Depth 5
