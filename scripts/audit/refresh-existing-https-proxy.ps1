param([switch]$Apply)
$ErrorActionPreference='Stop'
$uasRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
Set-Location -LiteralPath $uasRoot
$uasLan='192.168.1.34'
$uasProxy=(& netsh interface portproxy show v4tov4 | Out-String)
if($LASTEXITCODE -ne 0){throw 'No se puede leer el reenvío existente'}
if($uasProxy -notmatch '192\.168\.1\.34\s+443\s+127\.0\.0\.1\s+443'){throw 'La regla ya no coincide con la propuesta autorizable; no modificar'}
if(-not (Get-NetIPAddress -AddressFamily IPv4 -IPAddress $uasLan -ErrorAction Stop)){throw 'La IP prevista no pertenece al equipo'}
if((Get-Service iphlpsvc).Status -ne 'Running'){throw 'IP Helper no está ejecutándose; este script no reinicia servicios'}
if(-not $Apply){[pscustomobject]@{mode='READ_ONLY';current='Stored rule exists; LAN listener absent in saved diagnostic';proposed='Refresh only the identical 192.168.1.34:443 -> 127.0.0.1:443 rule';other_changes=0} | ConvertTo-Json;exit 0}
$uasAdmin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if(-not $uasAdmin){throw 'Se requiere la confirmación administrativa de Windows'}
$uasPrivate=Join-Path $uasRoot '.run/audit-20261117/https-proxy-refresh'
if(Test-Path -LiteralPath (Join-Path $uasPrivate 'before.json')){throw 'Ya existe un intento; leer su resultado antes de repetir'}
[void](New-Item -ItemType Directory -Path $uasPrivate -Force)
$uasBefore=[ordered]@{observed_at=[DateTime]::UtcNow.ToString('o');proxy=$uasProxy;listeners=@(Get-NetTCPConnection -State Listen -LocalPort 443 | Where-Object {$_.LocalAddress -in @('127.0.0.1',$uasLan)} | Select-Object LocalAddress,LocalPort,OwningProcess)}
$uasBefore | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $uasPrivate 'before.json') -Encoding UTF8
$uasReport=[ordered]@{observed_at=[DateTime]::UtcNow.ToString('o');status='APPLYING';scope='Refresh only an existing exact HTTPS portproxy entry; no new rule, address, port or service restart';before='192.168.1.34:443 -> 127.0.0.1:443';after='192.168.1.34:443 -> 127.0.0.1:443';firewall_changes=0;dns_changes=0;router_changes=0;service_restarts=0;container_changes=0;data_changes=0;reversal='Network configuration values must remain byte-equivalent; if different, stop for review. Do not delete the existing approved rule.';boot_persistence_test='NOT_RUN';external_retest='NOT_RUN'}
$uasReportPath=Join-Path $uasRoot 'docs/audits/evidence/2026-11-17-https-proxy-refresh.json'
try{
 & netsh interface portproxy set v4tov4 listenaddress=192.168.1.34 listenport=443 connectaddress=127.0.0.1 connectport=443 protocol=tcp
 if($LASTEXITCODE -ne 0){throw 'Falló la actualización de la regla existente'}
 $uasAfter=(& netsh interface portproxy show v4tov4 | Out-String)
 if($LASTEXITCODE -ne 0 -or $uasAfter.Trim() -ne $uasProxy.Trim()){throw 'Los valores difieren del respaldo; detener para revisión'}
 $uasDeadline=[DateTime]::UtcNow.AddSeconds(12)
 do{$uasLive=@(Get-NetTCPConnection -State Listen -LocalPort 443 -ErrorAction SilentlyContinue | Where-Object LocalAddress -EQ $uasLan);if($uasLive.Count){break};Start-Sleep -Milliseconds 500}while([DateTime]::UtcNow -lt $uasDeadline)
 $uasReport.configuration_values_unchanged=$true
 $uasReport.lan_listener_present=$uasLive.Count -gt 0
 $uasReport.status=if($uasReport.lan_listener_present){'PASS_LISTENER_RESTORED; TLS_AND_EXTERNAL_RETEST_PENDING'}else{'BLOCKED_NO_LISTENER_AFTER_REFRESH'}
}catch{$uasReport.status='BLOCKED';$uasReport.error=$_.Exception.Message}finally{$uasReport | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $uasReportPath -Encoding UTF8}
$uasReport | ConvertTo-Json -Depth 6
if($uasReport.status -notlike 'PASS*'){exit 1}
