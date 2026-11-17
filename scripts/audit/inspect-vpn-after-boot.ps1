$ErrorActionPreference='Stop'
$uasRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $uasRoot
$uasAdmin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if(-not $uasAdmin){throw 'Read-only inspection requires administrator for protected configuration file names'}
$uasWg=Join-Path $env:ProgramFiles 'WireGuard/wg.exe'
$uasFolder=Join-Path $env:ProgramFiles 'WireGuard/Data/Configurations'
$uasConfigurations=@(Get-ChildItem -LiteralPath $uasFolder -File -ErrorAction Stop | Select-Object Name,Length,LastWriteTimeUtc)
$uasServices=@(Get-CimInstance Win32_Service | Where-Object {$_.Name -like '*WireGuard*' -or $_.PathName -like '*WireGuard*'} | Select-Object Name,State,StartMode)
$uasInterfaces=& $uasWg show interfaces
if($LASTEXITCODE -ne 0){throw 'WireGuard interface query failed'}
$uasReport=[ordered]@{observed_at=[DateTime]::UtcNow.ToString('o');scope='Elevated READ ONLY: service metadata, encrypted configuration file names and interface names; no file contents or private keys';status='PASS_INSPECTION_ONLY';configurations=$uasConfigurations;services=$uasServices;interfaces=@(($uasInterfaces -join ' ') -split '\s+' | Where-Object {$_});network_changes=0;services_started=0;configurations_changed=0;secret_contents_read=0}
$uasReport | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $uasRoot 'docs/audits/evidence/2026-11-17-vpn-postboot-inspection.json') -Encoding UTF8
