param([switch]$Apply)
$ErrorActionPreference='Stop'
$uasRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $uasRoot
$uasProxy=(& netsh interface portproxy show all | Out-String)
if($LASTEXITCODE -ne 0 -or $uasProxy -notmatch '192\.168\.1\.34\s+443\s+127\.0\.0\.1\s+443'){throw 'La regla existente no coincide; detener'}
[void](Get-NetIPAddress -IPAddress '192.168.1.34' -AddressFamily IPv4 -ErrorAction Stop)
if(-not $Apply){[pscustomobject]@{mode='READ_ONLY';proposal='Remove and immediately restore only 192.168.1.34:443 -> 127.0.0.1:443; no service restarts'} | ConvertTo-Json;exit 0}
if(-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Requiere confirmación administrativa'}
$uasPrivate=Join-Path $uasRoot '.run/audit-20261117/https-proxy-recreate'
if(Test-Path -LiteralPath (Join-Path $uasPrivate 'before.json')){throw 'Existe un intento previo; revisar antes de repetir'}
[void](New-Item -ItemType Directory -Path $uasPrivate -Force)
[ordered]@{observed_at=[DateTime]::UtcNow.ToString('o');proxy=$uasProxy;services=@(Get-Service iphlpsvc,Tailscale | Select-Object Name,@{n='Status';e={$_.Status.ToString()}})} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $uasPrivate 'before.json') -Encoding UTF8
$uasReport=[ordered]@{observed_at=[DateTime]::UtcNow.ToString('o');status='APPLYING';scope='Only existing 192.168.1.34:443 -> 127.0.0.1:443 mapping; temporary removal followed immediately by identical re-add';other_rule_changes=0;service_restarts=0;firewall_changes=0;dns_changes=0;router_changes=0;container_changes=0;data_changes=0;external_test='NOT_RUN';boot_persistence='NOT_RUN'}
$uasRemoved=$false
function Add-UasExactRule{& netsh interface portproxy add v4tov4 listenaddress=192.168.1.34 listenport=443 connectaddress=127.0.0.1 connectport=443 protocol=tcp;if($LASTEXITCODE -ne 0){throw 'No se pudo reponer el reenvío exacto'}}
try{
 & netsh interface portproxy delete v4tov4 listenaddress=192.168.1.34 listenport=443 protocol=tcp
 if($LASTEXITCODE -ne 0){throw 'No se retiró la regla exacta'}
 $uasRemoved=$true
 Add-UasExactRule
 $uasRemoved=$false
 $uasAfter=(& netsh interface portproxy show all | Out-String)
 if($LASTEXITCODE -ne 0 -or $uasAfter.Trim() -ne $uasProxy.Trim()){throw 'La tabla no coincide con el respaldo; detener'}
 $uasReport.configuration_values_unchanged=$true
 $uasDeadline=[DateTime]::UtcNow.AddSeconds(12)
 do{$uasLive=@(Get-NetTCPConnection -State Listen -LocalPort 443 -ErrorAction SilentlyContinue | Where-Object LocalAddress -EQ '192.168.1.34');if($uasLive.Count){break};Start-Sleep -Milliseconds 500}while([DateTime]::UtcNow -lt $uasDeadline)
 $uasReport.lan_listener_present=$uasLive.Count -gt 0
 $uasReport.status=if($uasReport.lan_listener_present){'PASS_LISTENER_RESTORED; FUNCTIONAL_RETEST_PENDING'}else{'BLOCKED_NO_LISTENER_AFTER_EXACT_RECREATION'}
}catch{
 $uasReport.status='BLOCKED';$uasReport.error=$_.Exception.Message
 if($uasRemoved){try{Add-UasExactRule;$uasReport.recovery='Exact mapping restored after failure'}catch{$uasReport.recovery='BLOCKED_EXACT_MAPPING_RESTORE_FAILED'}}
}finally{$uasReport | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $uasRoot 'docs/audits/evidence/2026-11-17-https-proxy-recreate.json') -Encoding UTF8}
$uasReport | ConvertTo-Json -Depth 6
if($uasReport.status -notlike 'PASS*'){exit 1}
