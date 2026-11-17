# Read-only host/DNS/firewall inventory for a concrete, separately approved repair.
$ErrorActionPreference = 'Stop'
$uasRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$uasHostName = 'uasspain-prueba.duckdns.org'
$uasHostsPath = Join-Path $env:WINDIR 'System32\drivers\etc\hosts'
$uasHostsLines = @(Get-Content -LiteralPath $uasHostsPath | Where-Object { $_ -match '^\s*[^#\s]+\s+.*\buasspain-prueba\.duckdns\.org\b' })
$uasRoute = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1
$uasLocal = @(Get-NetIPAddress -InterfaceIndex $uasRoute.InterfaceIndex -AddressFamily IPv4 | Where-Object { $_.AddressState -eq 'Preferred' } | Select-Object -ExpandProperty IPAddress)
$uasProfile = Get-NetConnectionProfile -InterfaceIndex $uasRoute.InterfaceIndex
$uasDns = @(Resolve-DnsName $uasHostName -Type A -Server 1.1.1.1 -DnsOnly -NoHostsFile -QuickTimeout | Where-Object IPAddress | Select-Object -ExpandProperty IPAddress)
$uasEgress = (Invoke-RestMethod -Uri 'https://api.ipify.org?format=json' -TimeoutSec 10).ip
$uasProxy = (& netsh interface portproxy show v4tov4 | Out-String)
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect existing forwarding.' }
$uasRule = Get-NetFirewallRule -Name 'UASSpain-HTTPS-Internet'
$uasAddress = $uasRule | Get-NetFirewallAddressFilter
$uasPort = $uasRule | Get-NetFirewallPortFilter
$uasToken = Join-Path $env:LOCALAPPDATA 'UASSpain/secrets/duckdns-token.txt'
$uasPrivatePath = Join-Path $uasRoot '.run/audit-20261116/network-before.json'
$uasPrivate = [ordered]@{ observed_at=[DateTime]::UtcNow.ToString('o');hostname=$uasHostName;hosts_lines=$uasHostsLines;hosts_sha256=(Get-FileHash -LiteralPath $uasHostsPath -Algorithm SHA256).Hash;current_local_ipv4=$uasLocal;public_dns_ipv4=$uasDns;observed_egress_ipv4=$uasEgress;portproxy=$uasProxy;firewall=[ordered]@{name=$uasRule.Name;profile=$uasRule.Profile.ToString();local_address=$uasAddress.LocalAddress;remote_address=$uasAddress.RemoteAddress;local_port=$uasPort.LocalPort;protocol=$uasPort.Protocol};network_profile=$uasProfile.NetworkCategory.ToString() }
if (Test-Path -LiteralPath $uasPrivatePath) { throw 'Prior network evidence exists; inspect it before replacing the baseline.' }
$uasPrivate | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $uasPrivatePath -Encoding UTF8
$uasHostsAddress = if ($uasHostsLines.Count -eq 1) { ($uasHostsLines[0] -split '\s+')[0] } else { $null }
$uasReport = [ordered]@{ observed_at=$uasPrivate.observed_at;status='BLOCKED';scope='Read-only network preflight; original CA preserved; no network or security writes';hostname=$uasHostName;current_interface=$uasRoute.InterfaceAlias;current_local_ipv4=$uasLocal;network_profile=$uasProfile.NetworkCategory.ToString();hosts_entry_count=$uasHostsLines.Count;hosts_target_is_current_local_address=($uasLocal -contains $uasHostsAddress);public_dns_matches_current_egress=($uasDns -contains $uasEgress);existing_forwarding_points_to_loopback_443=($uasProxy -match '127\.0\.0\.1\s+443');forwarding_includes_current_local_address=(@($uasLocal | Where-Object { $uasProxy -match ([regex]::Escape($_)+'\s+443') }).Count -gt 0);firewall_rule=[ordered]@{name=$uasRule.Name;enabled=$uasRule.Enabled.ToString();action=$uasRule.Action.ToString();profile=$uasRule.Profile.ToString();local_address=$uasAddress.LocalAddress;remote_address=$uasAddress.RemoteAddress;local_port=$uasPort.LocalPort;local_address_matches_current=(@($uasLocal | Where-Object { $uasAddress.LocalAddress -contains $_ -or $uasAddress.LocalAddress -contains 'Any' }).Count -gt 0);profile_matches_current=($uasRule.Profile.ToString() -eq 'Any' -or $uasRule.Profile.ToString().Split(',').Trim() -contains $uasProfile.NetworkCategory.ToString())};protected_duckdns_token_present=(Test-Path -LiteralPath $uasToken);changes_performed=0;external_mobile_test='FAIL: owner reports connection timeout on mobile data, without Wi-Fi or Tailscale';cause_limit='Public egress mismatch is not alone proof of wrong inbound routing; router NAT, port forwarding, CGNAT and ISP behavior remain unverified.' }
$uasOutput = Join-Path $uasRoot 'docs/audits/evidence/2026-11-16-network-preflight.json'
$uasReport | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $uasOutput -Encoding UTF8
$uasReport | ConvertTo-Json -Depth 6
