# Read-only verification after the interrupted response reader. Never repeat the DNS update.
$ErrorActionPreference='Stop'
$uasRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$uasPrivate=Join-Path $uasRoot '.run/audit-20261116'
$uasJournalPath=Join-Path $uasPrivate 'network-change-journal.json'
$uasJournal=Get-Content -LiteralPath $uasJournalPath -Raw | ConvertFrom-Json
$uasOldReport=Get-Content -LiteralPath (Join-Path $uasRoot 'docs/audits/evidence/2026-11-16-network-apply.json') -Raw | ConvertFrom-Json
if($uasJournal.hostname -ne 'uasspain-prueba.duckdns.org' -or $uasJournal.new_local_ip -ne '192.168.1.34' -or @($uasJournal.completed_steps).Count -notin @(3,4)){throw 'Unexpected journal; manual inspection required.'}
$uasChecks=@()
function Add-UasCheck([string]$Id,[bool]$Ok,$Observed){$script:uasChecks += [ordered]@{id=$Id;status=$(if($Ok){'PASS'}else{'FAIL'});observed=$Observed}}
$uasHosts=[IO.File]::ReadAllText((Join-Path $env:WINDIR 'System32\drivers\etc\hosts'))
$uasPattern='(?m)^\s*192\.168\.1\.34\s+uasspain-prueba\.duckdns\.org\s*(?:#.*)?$'
Add-UasCheck 'ONLY_PLANNED_HOSTS_RESULT' ([regex]::Matches($uasHosts,$uasPattern).Count -eq 1) @{target='current owned LAN IP'}
$uasBeforeBytes=[IO.File]::ReadAllBytes((Join-Path $uasJournal.backup_directory 'hosts.before'))
$uasLatin1=[Text.Encoding]::GetEncoding(28591)
$uasExpected=$uasLatin1.GetString($uasBeforeBytes).Replace("192.168.1.38`tuasspain-prueba.duckdns.org","192.168.1.34`tuasspain-prueba.duckdns.org")
Add-UasCheck 'OTHER_HOSTS_BYTES_PRESERVED' ([Convert]::ToBase64String($uasLatin1.GetBytes($uasExpected)) -ceq [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $env:WINDIR 'System32\drivers\etc\hosts')))) @{}
$uasProxy=(& netsh interface portproxy show v4tov4 | Out-String)
if($LASTEXITCODE -ne 0){throw 'Cannot inspect forwarding.'}
Add-UasCheck 'CURRENT_FORWARDING_AND_OLD_REMOVED' (($uasProxy -match '(?m)^\s*192\.168\.1\.34\s+443\s+127\.0\.0\.1\s+443\s*$') -and -not ($uasProxy -match '(?m)^\s*192\.168\.1\.38\s+443\s+')) @{}
$uasRule=Get-NetFirewallRule -Name 'UASSpain-HTTPS-Internet'
$uasAddress=$uasRule | Get-NetFirewallAddressFilter
$uasPort=$uasRule | Get-NetFirewallPortFilter
Add-UasCheck 'EXACT_AUTHORIZED_FIREWALL_RESULT' ($uasAddress.LocalAddress -eq '192.168.1.34' -and $uasAddress.RemoteAddress -eq 'Any' -and $uasPort.LocalPort -eq '443' -and $uasPort.Protocol -eq 'TCP' -and $uasRule.Profile.ToString() -match 'Private' -and $uasRule.Profile.ToString() -match 'Public' -and $uasRule.Enabled.ToString() -eq 'True' -and $uasRule.Action.ToString() -eq 'Allow') @{rule=$uasRule.Name;profiles=$uasRule.Profile.ToString();port=443}
$uasDns=@(Resolve-DnsName $uasJournal.hostname -Type A -Server 1.1.1.1 -DnsOnly -NoHostsFile -QuickTimeout | Where-Object IPAddress | Select-Object -ExpandProperty IPAddress)
Add-UasCheck 'PUBLIC_DNS_MATCHES_APPROVED_IPV4_WITHOUT_HOSTS' ($uasDns -contains $uasJournal.new_public_dns) @{resolver='1.1.1.1';ip_disclosed=$false}
Push-Location -LiteralPath $uasRoot
try{& node scripts/audit/public-route-readonly.mjs | Out-Null;if($LASTEXITCODE -ne 0){throw 'TLS diagnostic failed.'}}finally{Pop-Location}
$uasTls=Get-Content -LiteralPath (Join-Path $uasRoot 'docs/audits/evidence/2026-11-16-public-route.json') -Raw | ConvertFrom-Json
Add-UasCheck 'ACTUAL_LOCAL_AND_LAN_PUBLIC_TLS' ($uasTls.local_tls_status -eq 'PASS' -and @($uasTls.checks | Where-Object { $_.id -eq 'EXISTING_OWN_LAN_FORWARDING' -and $_.status -eq 'PASS' }).Count -eq 1) @{scope='Public certificate validated on this host; not WAN'}
$uasCaHash=(Get-FileHash -LiteralPath (Join-Path $uasRoot '.secrets/tls/ca.crt') -Algorithm SHA256).Hash.ToLowerInvariant()
Add-UasCheck 'SAME_CA_AS_BEFORE_NETWORK_WORK' ($uasCaHash -eq 'e3b22ef30e9e09e23761c2f289ac8d280470a7dcc27ab3f8bbf278c68a26f244') @{}
$uasReport=[ordered]@{observed_at=[DateTime]::UtcNow.ToString('o');status=$(if(@($uasChecks | Where-Object status -NE 'PASS').Count -eq 0){'PASS'}else{'FAIL'});scope='Read-only verification of the four approved adjustments; no repeat DNS update or other mutation';checks=$uasChecks;dns_update_requests=$uasOldReport.dns_request_count;previous_apply_reader=[ordered]@{status=$uasOldReport.status;phase=$uasOldReport.phase;error_code=$uasOldReport.error_code;note='Provider response was not successfully captured; subsequent public DNS now proves the requested value. No DNS update repeated.'};other_dns_records='No txt/ipv6/clear parameter sent; same-run before/after baseline was not persisted before the reader interruption, so not claimed compared';external_access='NOT_RUN_AFTER_CHANGE';ca_changed=$false;router_changed=$false}
$uasExternalPath=Join-Path $uasRoot 'docs/audits/evidence/2026-11-16-public-after-network.json'
if(Test-Path -LiteralPath $uasExternalPath){$uasExternal=Get-Content -LiteralPath $uasExternalPath -Raw | ConvertFrom-Json;if($uasExternal.status -eq 'PASS'){$uasReport.external_access='PASS_BASIC_OWNER_CONFIRMED';$uasReport.external_evidence='2026-11-16-public-after-network.json'}elseif($uasExternal.latest_external_laptop_test){$uasReport.external_access='FAIL_LATEST_EXTERNAL_LAPTOP';$uasReport.external_evidence='2026-11-16-public-after-network.json'}}
$uasReport | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $uasRoot 'docs/audits/evidence/2026-11-16-network-verified.json') -Encoding UTF8
if($uasReport.status -eq 'PASS'){
    if(@($uasJournal.completed_steps) -notcontains 'dns_a'){$uasJournal.completed_steps=@($uasJournal.completed_steps)+@('dns_a')}
    $uasJournal | Add-Member -Force -NotePropertyName 'dns_verified_after_reader_interruption' -NotePropertyValue $true
    $uasJournal | Add-Member -Force -NotePropertyName 'provider_acknowledgement_captured' -NotePropertyValue $false
    $uasJournal | Add-Member -Force -NotePropertyName 'verification_recorded_at' -NotePropertyValue $uasReport.observed_at
    $uasJournal | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $uasJournalPath -Encoding UTF8
}
[pscustomobject]$uasReport | Select-Object status,checks,dns_update_requests,external_access | ConvertTo-Json -Depth 5
if($uasReport.status -ne 'PASS'){exit 1}
