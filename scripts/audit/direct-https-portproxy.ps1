param([ValidateSet('Remove','Restore')][string]$Action,[switch]$Apply,[switch]$SelfTest,[switch]$ResumeAfterValidationFix)
$ErrorActionPreference='Stop'
function Get-UasRules([string]$Text){return @(($Text -split '\r?\n') | ForEach-Object {if($_ -match '^\s*(\S+)\s+(\d+)\s+(\S+)\s+(\d+)\s*$'){"$($Matches[1]) $($Matches[2]) $($Matches[3]) $($Matches[4])"}} | Sort-Object)}
function Get-UasOtherLines([string]$Text){return ((Get-UasRules $Text | Where-Object {$_ -ne '192.168.1.34 443 127.0.0.1 443'}) -join "`n")}
if($SelfTest){
 $uasOriginal=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '../../.run/audit-20261117/direct-https/apply/proxy.before.txt'))
 $uasOther='192.168.1.90 8449 127.0.0.1 8449'
 $uasTests=[ordered]@{real_snapshot_contains_exact_rule=((Get-UasRules $uasOriginal) -contains '192.168.1.34 443 127.0.0.1 443');empty_table_has_no_rules=((Get-UasRules '').Count -eq 0);removal_of_last_rule_ignores_headers=((Get-UasOtherLines $uasOriginal) -eq (Get-UasOtherLines ''));unrelated_rule_preserved=((Get-UasOtherLines ($uasOriginal+"`n"+$uasOther)) -eq $uasOther);unrelated_rule_change_detected=((Get-UasOtherLines ($uasOriginal+"`n"+$uasOther)) -ne (Get-UasOtherLines ($uasOriginal+"`n192.168.1.90 8449 127.0.0.1 8450")));ipv6_rule_preserved=((Get-UasOtherLines "::1 8449 ::1 8449") -eq '::1 8449 ::1 8449')}
 $uasPassed=@($uasTests.Values | Where-Object {$_ -ne $true}).Count -eq 0
 [ordered]@{status=$(if($uasPassed){'PASS'}else{'FAIL'});scope='Read-only regression of actual saved output, empty table and unrelated rules';tests=$uasTests;network_changes=0} | ConvertTo-Json -Depth 5
 if(-not $uasPassed){exit 1};exit 0
}
if(-not $Apply){throw 'Apply explícito requerido'}
if(-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Requiere confirmación administrativa'}
$uasRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $uasRoot
$uasPrivate=Join-Path $uasRoot '.run/audit-20261117/direct-https/apply'
if(-not (Test-Path -LiteralPath (Join-Path $uasPrivate 'before.json'))){throw 'Falta el respaldo previo de la operación'}
$uasReport=[ordered]@{observed_at=[DateTime]::UtcNow.ToString('o');action=$Action;status='BLOCKED';other_rule_changes=0;service_restarts=0;firewall_changes=0;dns_changes=0;router_changes=0}
$uasPattern='192\.168\.1\.34\s+443\s+127\.0\.0\.1\s+443'
function Get-UasProxy{ $uasText=(& netsh interface portproxy show all | Out-String);if($LASTEXITCODE -ne 0){throw 'No se puede leer la tabla'};return $uasText }
try{
 $uasBefore=Get-UasProxy
 if($Action -eq 'Remove'){
  if(Test-Path -LiteralPath (Join-Path $uasPrivate 'proxy.before.txt')){if(-not $ResumeAfterValidationFix){throw 'Ya existe un intento de retirada; revisar antes de repetir'};$uasSaved=[IO.File]::ReadAllText((Join-Path $uasPrivate 'proxy.before.txt'));if(((Get-UasRules $uasSaved) -join "`n") -ne ((Get-UasRules $uasBefore) -join "`n")){throw 'Saved and current rules differ; stop'}}
  if($uasBefore -notmatch $uasPattern){throw 'No coincide la regla exacta a retirar'}
  if(-not $ResumeAfterValidationFix){[IO.File]::WriteAllText((Join-Path $uasPrivate 'proxy.before.txt'),$uasBefore)}
  & netsh interface portproxy delete v4tov4 listenaddress=192.168.1.34 listenport=443 protocol=tcp
  if($LASTEXITCODE -ne 0){throw 'No se pudo retirar el reenvío exacto'}
  $uasAfter=Get-UasProxy
  if($uasAfter -match '192\.168\.1\.34\s+443' -or (Get-UasOtherLines $uasAfter) -ne (Get-UasOtherLines $uasBefore)){throw 'La tabla no coincide con la retirada delimitada'}
  $uasReport.status='PASS_EXACT_REDUNDANT_PROXY_REMOVED'
 }else{
  if(-not (Test-Path -LiteralPath (Join-Path $uasPrivate 'proxy.before.txt'))){throw 'Falta snapshot del reenvío retirado'}
  if($uasBefore -match '192\.168\.1\.34\s+443' -and $uasBefore -notmatch $uasPattern){throw 'Hay otra entrada para esa dirección; no sustituirla'}
  if($uasBefore -notmatch $uasPattern){& netsh interface portproxy add v4tov4 listenaddress=192.168.1.34 listenport=443 connectaddress=127.0.0.1 connectport=443 protocol=tcp;if($LASTEXITCODE -ne 0){throw 'No se pudo reponer el reenvío original'}}
  $uasAfter=Get-UasProxy
  if($uasAfter -notmatch $uasPattern -or (Get-UasOtherLines $uasAfter) -ne (Get-UasOtherLines $uasBefore)){throw 'La reposición no coincide'}
  $uasReport.status='PASS_EXACT_ORIGINAL_PROXY_RESTORED'
 }
}catch{$uasReport.error=$_.Exception.Message}finally{$uasReport | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $uasRoot ('docs/audits/evidence/2026-11-17-direct-https-proxy-'+$Action.ToLower()+'.json')) -Encoding UTF8}
$uasReport | ConvertTo-Json -Depth 5
if($uasReport.status -notlike 'PASS*'){exit 1}
