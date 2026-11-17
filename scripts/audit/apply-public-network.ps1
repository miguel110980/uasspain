param([switch]$Apply)
# Implements only the four adjustments explicitly approved in the chat.
$ErrorActionPreference = 'Stop'
$VerbosePreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$DebugPreference = 'SilentlyContinue'
$uasRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$uasPrivateRoot = Join-Path $uasRoot '.run/audit-20261116'
$uasBaseline = Get-Content -LiteralPath (Join-Path $uasPrivateRoot 'network-before.json') -Raw | ConvertFrom-Json
$uasReportPath = Join-Path $uasRoot 'docs/audits/evidence/2026-11-16-network-apply.json'
$uasJournalPath = Join-Path $uasPrivateRoot 'network-change-journal.json'
$uasOldIp = '192.168.1.38'
$uasNewIp = '192.168.1.34'
$uasHostName = 'uasspain-prueba.duckdns.org'
$uasRuleName = 'UASSpain-HTTPS-Internet'
$uasReport = [ordered]@{ started_at=[DateTime]::UtcNow.ToString('o');status='RUNNING';phase='PRECHECK';authorization='Four specific network adjustments approved by owner; preserve CA, keys, Docker, data, router and all other ports/rules';changes=@();checks=@();elevated=$false;dns_request_count=0;secrets_printed=$false;router_changes=0;docker_rebuilds=0 }
function Save-UasReport { $uasReport | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $uasReportPath -Encoding UTF8 }
function Assert-Uas([bool]$Condition,[string]$Id) { $uasReport.checks += [ordered]@{id=$Id;status=$(if($Condition){'PASS'}else{'FAIL'})}; Save-UasReport; if(-not $Condition){throw $Id} }
function Invoke-UasNetsh([string[]]$Arguments) { $uasNativeOutput = & netsh @Arguments 2>&1 | Out-String; if($LASTEXITCODE -ne 0){throw 'PORTPROXY_COMMAND_FAILED'} }
function Get-UasDnsRecords([string]$Name,[string]$Kind) { $uasAnswer = Invoke-RestMethod -Uri ('https://dns.google/resolve?name='+[Uri]::EscapeDataString($Name)+'&type='+$Kind) -TimeoutSec 15; if($uasAnswer.Status -ne 0){throw 'DNS_READ_FAILED'}; return @($uasAnswer.Answer | Where-Object { $_.type -eq $(if($Kind -eq 'AAAA'){28}else{16}) } | Select-Object -ExpandProperty data | Sort-Object) }
function Hash-UasFile([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash }
try {
    $uasIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $uasReport.elevated = ([Security.Principal.WindowsPrincipal]::new($uasIdentity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if($Apply -and -not $uasReport.elevated){$uasReport.status='BLOCKED';$uasReport.phase='ADMIN_REQUIRED';Save-UasReport;exit 5}
    if($Apply -and (Test-Path -LiteralPath $uasJournalPath)){throw 'EXISTING_JOURNAL_REQUIRES_INSPECTION_BEFORE_REPEAT'}
    Assert-Uas ($uasBaseline.hostname -eq $uasHostName) 'EXPECTED_HOSTNAME'
    Assert-Uas (@($uasBaseline.current_local_ipv4).Count -eq 1 -and $uasBaseline.current_local_ipv4[0] -eq $uasNewIp) 'EXPECTED_SNAPSHOT_LOCAL_ADDRESS'
    $uasRoute = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1
    $uasCurrentIps = @(Get-NetIPAddress -InterfaceIndex $uasRoute.InterfaceIndex -AddressFamily IPv4 | Where-Object AddressState -EQ 'Preferred' | Select-Object -ExpandProperty IPAddress)
    $uasProfile = Get-NetConnectionProfile -InterfaceIndex $uasRoute.InterfaceIndex
    Assert-Uas ($uasCurrentIps -contains $uasNewIp -and $uasProfile.NetworkCategory.ToString() -eq 'Private') 'CURRENT_LOCAL_ADDRESS_AND_PROFILE_UNCHANGED'
    $uasHostsPath = Join-Path $env:WINDIR 'System32\drivers\etc\hosts'
    Assert-Uas ((Hash-UasFile $uasHostsPath) -eq $uasBaseline.hosts_sha256) 'HOSTS_BASELINE_UNCHANGED'
    $uasHostsBytes = [IO.File]::ReadAllBytes($uasHostsPath)
    $uasLatin1 = [Text.Encoding]::GetEncoding(28591)
    $uasHostsText = $uasLatin1.GetString($uasHostsBytes)
    $uasPattern = '(?m)^(?<indent>[ \t]*)'+[regex]::Escape($uasOldIp)+'(?=[ \t]+'+[regex]::Escape($uasHostName)+'[ \t]*(?:#.*)?\r?$)'
    Assert-Uas ([regex]::Matches($uasHostsText,$uasPattern).Count -eq 1) 'SINGLE_OWNED_HOSTS_ENTRY'
    $uasNewHosts = [regex]::Replace($uasHostsText,$uasPattern,[Text.RegularExpressions.MatchEvaluator]{param($uasMatch) $uasMatch.Groups['indent'].Value+$uasNewIp})
    $uasProxyText = (& netsh interface portproxy show v4tov4 | Out-String)
    Assert-Uas ($LASTEXITCODE -eq 0 -and [regex]::Matches($uasProxyText,'(?m)^\s*'+[regex]::Escape($uasOldIp)+'\s+443\s+127\.0\.0\.1\s+443\s*$').Count -eq 1) 'EXACT_EXISTING_FORWARDING'
    Assert-Uas (-not ($uasProxyText -match ('(?m)^\s*'+[regex]::Escape($uasNewIp)+'\s+443\s+'))) 'NEW_FORWARDING_NOT_ALREADY_PRESENT'
    $uasRule = Get-NetFirewallRule -Name $uasRuleName
    $uasAddress = $uasRule | Get-NetFirewallAddressFilter
    $uasPort = $uasRule | Get-NetFirewallPortFilter
    Assert-Uas ($uasRule.Enabled.ToString() -eq 'True' -and $uasRule.Action.ToString() -eq 'Allow' -and $uasRule.Direction.ToString() -eq 'Inbound' -and $uasRule.Profile.ToString() -eq 'Public' -and @($uasAddress.LocalAddress).Count -eq 1 -and @($uasAddress.LocalAddress)[0] -eq $uasOldIp -and @($uasAddress.RemoteAddress).Count -eq 1 -and @($uasAddress.RemoteAddress)[0] -eq 'Any' -and $uasPort.Protocol -eq 'TCP' -and $uasPort.LocalPort -eq '443') 'EXACT_EXISTING_HTTPS_RULE'
    $uasEgress1 = (Invoke-RestMethod -Uri 'https://api.ipify.org?format=json' -TimeoutSec 15).ip.Trim()
    $uasEgress2 = (Invoke-WebRequest -UseBasicParsing -Uri 'https://checkip.amazonaws.com' -TimeoutSec 15).Content.Trim()
    $uasParsedIp = $null
    Assert-Uas ([Net.IPAddress]::TryParse($uasEgress1,[ref]$uasParsedIp) -and $uasParsedIp.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and $uasEgress1 -eq $uasEgress2 -and $uasEgress1 -eq $uasBaseline.observed_egress_ipv4) 'CURRENT_PUBLIC_ADDRESS_CONFIRMED_BY_TWO_SOURCES'
    $uasTokenPath = Join-Path $env:LOCALAPPDATA 'UASSpain/secrets/duckdns-token.txt'
    $uasAcl = Get-Acl -LiteralPath $uasTokenPath
    $uasAclRules = @($uasAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
    Assert-Uas ($uasAcl.AreAccessRulesProtected -and $uasAclRules.Count -eq 1 -and $uasAclRules[0].IdentityReference -eq $uasIdentity.User -and $uasAclRules[0].AccessControlType -eq 'Allow') 'EXISTING_DNS_TOKEN_ACL_PRESERVED'
    $uasBeforeAAAA = @(Get-UasDnsRecords $uasHostName 'AAAA')
    $uasBeforeTXT = @(Get-UasDnsRecords $uasHostName 'TXT')
    $uasBeforeAcmeTXT = @(Get-UasDnsRecords ('_acme-challenge.'+$uasHostName) 'TXT')
    $uasTlsHashes = @{}
    Get-ChildItem -LiteralPath (Join-Path $uasRoot '.secrets/tls') -File | ForEach-Object { $uasTlsHashes[$_.Name] = Hash-UasFile $_.FullName }
    $uasDpapiHash = Hash-UasFile (Join-Path $uasRoot '.secrets/postgres-storage-key.dpapi')
    if(-not $Apply){$uasReport.status='PASS';$uasReport.phase='DRY_RUN';$uasReport.changes=@();Save-UasReport;Write-Output 'NETWORK_DRY_RUN=PASS; CHANGES=0';exit 0}
    $uasBackupDir = Join-Path $uasPrivateRoot ('network-change-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff'))
    [void][IO.Directory]::CreateDirectory($uasBackupDir)
    [IO.File]::WriteAllBytes((Join-Path $uasBackupDir 'hosts.before'),$uasHostsBytes)
    $uasBaseline | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $uasBackupDir 'configuration.before.json') -Encoding UTF8
    $uasJournal = [ordered]@{started_at=$uasReport.started_at;backup_directory=$uasBackupDir;hostname=$uasHostName;old_local_ip=$uasOldIp;new_local_ip=$uasNewIp;previous_public_dns=$uasBaseline.public_dns_ipv4;new_public_dns=$uasEgress1;before_aaaa=$uasBeforeAAAA;before_txt=$uasBeforeTXT;before_acme_txt=$uasBeforeAcmeTXT;before_pki_hashes=$uasTlsHashes;before_dpapi_hash=$uasDpapiHash;completed_steps=@()}
    function Save-UasJournal { $uasJournal | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $uasJournalPath -Encoding UTF8; Save-UasReport }
    Save-UasJournal
    $uasReport.phase='HOSTS'
    [IO.File]::WriteAllBytes($uasHostsPath,$uasLatin1.GetBytes($uasNewHosts))
    Assert-Uas ($uasLatin1.GetString([IO.File]::ReadAllBytes($uasHostsPath)) -ceq $uasNewHosts) 'HOSTS_EXACT_RESULT'
    $uasJournal.completed_steps += 'hosts';$uasReport.changes += 'Only the existing domain hosts entry moved to current LAN IP';Save-UasJournal
    $uasReport.phase='FORWARDING'
    Invoke-UasNetsh @('interface','portproxy','add','v4tov4',"listenaddress=$uasNewIp",'listenport=443','connectaddress=127.0.0.1','connectport=443')
    $uasCurrentProxy = (& netsh interface portproxy show v4tov4 | Out-String)
    Assert-Uas ($LASTEXITCODE -eq 0 -and $uasCurrentProxy -match ('(?m)^\s*'+[regex]::Escape($uasNewIp)+'\s+443\s+127\.0\.0\.1\s+443\s*$')) 'NEW_FORWARDING_VERIFIED_BEFORE_REMOVING_OLD'
    Invoke-UasNetsh @('interface','portproxy','delete','v4tov4',"listenaddress=$uasOldIp",'listenport=443')
    $uasCurrentProxy = (& netsh interface portproxy show v4tov4 | Out-String)
    Assert-Uas ($LASTEXITCODE -eq 0 -and -not ($uasCurrentProxy -match ('(?m)^\s*'+[regex]::Escape($uasOldIp)+'\s+443\s+'))) 'ONLY_IDENTIFIED_OLD_FORWARDING_REMOVED'
    $uasJournal.completed_steps += 'forwarding';$uasReport.changes += 'Only the identified TCP443 forwarding moved; Docker destination unchanged';Save-UasJournal
    $uasReport.phase='FIREWALL_RULE'
    $uasAddress | Set-NetFirewallAddressFilter -LocalAddress $uasNewIp
    Set-NetFirewallRule -Name $uasRuleName -Profile Private,Public
    $uasAfterRule = Get-NetFirewallRule -Name $uasRuleName
    $uasAfterAddress = $uasAfterRule | Get-NetFirewallAddressFilter
    $uasAfterPort = $uasAfterRule | Get-NetFirewallPortFilter
    Assert-Uas ($uasAfterAddress.LocalAddress -eq $uasNewIp -and $uasAfterAddress.RemoteAddress -eq 'Any' -and $uasAfterPort.LocalPort -eq '443' -and $uasAfterPort.Protocol -eq 'TCP' -and $uasAfterRule.Profile.ToString() -match 'Private' -and $uasAfterRule.Profile.ToString() -match 'Public' -and $uasAfterRule.Enabled.ToString() -eq 'True' -and $uasAfterRule.Action.ToString() -eq 'Allow') 'ONLY_HTTPS_RULE_TARGET_AND_PROFILE_ADJUSTED'
    $uasJournal.completed_steps += 'firewall_rule';$uasReport.changes += 'Only the named existing HTTPS rule now admits current LAN IP in Private and Public';Save-UasJournal
    $uasReport.phase='LOCAL_TLS_GATE'
    Push-Location -LiteralPath $uasRoot
    try { & node scripts/audit/public-route-readonly.mjs | Out-Null; if($LASTEXITCODE -ne 0){throw 'LOCAL_TLS_RUNNER_FAILED'} } finally { Pop-Location }
    $uasLocalProof = Get-Content -LiteralPath (Join-Path $uasRoot 'docs/audits/evidence/2026-11-16-public-route.json') -Raw | ConvertFrom-Json
    Assert-Uas ($uasLocalProof.local_tls_status -eq 'PASS' -and @($uasLocalProof.checks | Where-Object { $_.id -eq 'EXISTING_OWN_LAN_FORWARDING' -and $_.status -eq 'PASS' }).Count -eq 1) 'REAL_CURRENT_LAN_HTTPS_GATE'
    $uasReport.phase='DNS_A'
    $uasToken = [IO.File]::ReadAllText($uasTokenPath).Trim()
    try {
        Assert-Uas (-not [string]::IsNullOrWhiteSpace($uasToken)) 'EXISTING_DNS_TOKEN_NONEMPTY'
        $uasReport.dns_request_count=1;Save-UasJournal
        $uasUri='https://www.duckdns.org/update?domains=uasspain-prueba&token='+[Uri]::EscapeDataString($uasToken)+'&ip='+[Uri]::EscapeDataString($uasEgress1)+'&verbose=true'
        $uasHttpResponse = Invoke-WebRequest -UseBasicParsing -Uri $uasUri -TimeoutSec 25
        $uasReport.dns_http_status = [int]$uasHttpResponse.StatusCode
        $uasReport.dns_response_body_type = $uasHttpResponse.Content.GetType().FullName
        $uasResponse = $(if($uasHttpResponse.Content -is [byte[]]){[Text.Encoding]::UTF8.GetString($uasHttpResponse.Content)}else{[string]$uasHttpResponse.Content}).Trim()
        $uasResponseLines = @($uasResponse -split '\r?\n')
        Assert-Uas ($uasResponseLines.Count -ge 4 -and $uasResponseLines[0] -eq 'OK' -and $uasResponseLines[1] -eq $uasEgress1 -and $uasResponseLines[-1] -in @('UPDATED','NOCHANGE')) 'DNS_PROVIDER_ACKNOWLEDGED_ONLY_AUTHORIZED_A_UPDATE'
    } finally { $uasToken=$null;$uasUri=$null;$uasResponse=$null;$uasResponseLines=$null;$uasHttpResponse=$null }
    $uasJournal.completed_steps += 'dns_a';$uasReport.changes += 'Only the authorized DuckDNS A record updated; no TXT, IPv6, other names or credentials written';Save-UasJournal
    $uasReport.phase='VERIFY'
    Assert-Uas ((@($uasBeforeAAAA) -join "`n") -ceq (@(Get-UasDnsRecords $uasHostName 'AAAA') -join "`n")) 'AAAA_PRESERVED'
    Assert-Uas ((@($uasBeforeTXT) -join "`n") -ceq (@(Get-UasDnsRecords $uasHostName 'TXT') -join "`n")) 'TXT_PRESERVED'
    Assert-Uas ((@($uasBeforeAcmeTXT) -join "`n") -ceq (@(Get-UasDnsRecords ('_acme-challenge.'+$uasHostName) 'TXT') -join "`n")) 'ACME_TXT_PRESERVED'
    Assert-Uas (@(Get-ChildItem -LiteralPath (Join-Path $uasRoot '.secrets/tls') -File | Where-Object { $uasTlsHashes[$_.Name] -ne (Hash-UasFile $_.FullName) }).Count -eq 0) 'ALL_EXISTING_LOCAL_PKI_FILES_UNCHANGED'
    Assert-Uas ((Hash-UasFile (Join-Path $uasRoot '.secrets/postgres-storage-key.dpapi')) -eq $uasDpapiHash) 'DPAPI_KEY_UNCHANGED'
    $uasDnsMatches=$false
    for($uasAttempt=0;$uasAttempt -lt 6;$uasAttempt++) { try { $uasNowDns=@(Resolve-DnsName $uasHostName -Type A -Server 1.1.1.1 -DnsOnly -NoHostsFile -QuickTimeout | Where-Object IPAddress | Select-Object -ExpandProperty IPAddress); if($uasNowDns -contains $uasEgress1){$uasDnsMatches=$true;break} } catch { } Start-Sleep -Seconds 5 }
    $uasReport.dns_public_resolver_matches=$uasDnsMatches
    $uasReport.status=$(if($uasDnsMatches){'PASS'}else{'BLOCKED'})
    $uasReport.phase=$(if($uasDnsMatches){'APPLIED_VERIFY_EXTERNAL_NEXT'}else{'APPLIED_DNS_PROPAGATION_PENDING'})
    $uasReport.external_access='NOT_RUN_AFTER_CHANGE';$uasReport.completed_at=[DateTime]::UtcNow.ToString('o');Save-UasJournal
    Write-Output ('NETWORK_ADJUSTMENTS='+$uasReport.status+'; STEPS='+$uasJournal.completed_steps.Count+'; SECRETS_PRINTED=false')
    if(-not $uasDnsMatches){exit 6}
} catch {
    $uasReport.status='BLOCKED';$uasReport.error_code=$(if($_.Exception.Message -match '^[A-Z0-9_]+$'){$_.Exception.Message}else{'OPERATION_FAILED_PRIVATE_DETAILS_WITHHELD'})
    $uasReport.completed_at=[DateTime]::UtcNow.ToString('o');Save-UasReport
    Write-Output ('NETWORK_ADJUSTMENTS=BLOCKED; PHASE='+$uasReport.phase+'; CODE='+$uasReport.error_code+'; INSPECT_JOURNAL_BEFORE_RETRY')
    exit 1
}
