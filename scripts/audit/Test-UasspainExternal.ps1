param([string]$OutputPath)
# Portable read-only diagnostic: run on the second laptop over phone data, without VPN/Tailscale.
# Never changes hosts, DNS, firewall, routes, certificates, services or accounts.
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$uasDomain='uasspain-prueba.duckdns.org'
$uasReport=[ordered]@{observed_at=[DateTime]::UtcNow.ToString('o');computer=$env:COMPUTERNAME;scope='Read-only client diagnostic; owner must confirm external mobile connection without VPN/Tailscale';server_computer_name='MIGUEL';external_location_not_automatically_proven=$true;checks=@();configuration_changes=0;credentials_used=0}
function Add-UasClientCheck([string]$Id,[string]$Status,$Observed){$script:uasReport.checks += [ordered]@{id=$Id;status=$Status;observed=$Observed}}
function Get-UasPage([string]$Url){try{$uasR=Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 12;$uasBody=if($uasR.Content -is [byte[]]){[Text.Encoding]::UTF8.GetString($uasR.Content)}else{[string]$uasR.Content};return @{http=[int]$uasR.StatusCode;text=$uasBody;bytes=$uasR.RawContentLength}}catch{$uasCode=$null;if($_.Exception.Response){$uasCode=[int]$_.Exception.Response.StatusCode};return @{http=$uasCode;text='';error=$_.Exception.GetType().Name}}}
try{
 $uasSystem=@([Net.Dns]::GetHostAddresses($uasDomain) | ForEach-Object {$_.IPAddressToString})
 Add-UasClientCheck 'SYSTEM_DNS' 'PASS' @{addresses=$uasSystem}
 $uasPublic=@(Resolve-DnsName $uasDomain -Type A -Server 1.1.1.1 -DnsOnly -NoHostsFile -QuickTimeout | Where-Object IPAddress | Select-Object -ExpandProperty IPAddress)
 Add-UasClientCheck 'PUBLIC_DNS_WITHOUT_HOSTS' 'PASS' @{addresses=$uasPublic}
 $uasMatches=@($uasSystem | Where-Object {$uasPublic -contains $_}).Count -gt 0
 Add-UasClientCheck 'SYSTEM_LOOKUP_MATCHES_PUBLIC_A' $(if($uasMatches){'PASS'}else{'FAIL'}) @{limit='Mismatch may be hosts, cache or resolver; no automatic correction performed'}
 $uasTcp=[Net.Sockets.TcpClient]::new()
 try{$uasTask=$uasTcp.ConnectAsync($uasDomain,443);$uasConnected=$uasTask.Wait(6000) -and $uasTcp.Connected;Add-UasClientCheck 'TCP443_BY_DOMAIN' $(if($uasConnected){'PASS'}else{'FAIL'}) @{connected=$uasConnected}}catch{Add-UasClientCheck 'TCP443_BY_DOMAIN' 'FAIL' @{error=$_.Exception.GetType().Name}}finally{$uasTcp.Dispose()}
 $uasPage=Get-UasPage ('https://'+$uasDomain+'/')
 Add-UasClientCheck 'NORMAL_HTTPS_HTML' $(if($uasPage.http -eq 200 -and $uasPage.text.Length -gt 100){'PASS'}else{'FAIL'}) @{http=$uasPage.http;body_bytes=$uasPage.bytes;error=$uasPage.error;tls_bypass=$false}
 if($uasPage.http -eq 200){
  $uasAssets=@([regex]::Matches($uasPage.text,'(?:src|href|data-stylesheet)=["''](?<path>/assets/[^"''<>]+\.(?:js|css))["'']') | ForEach-Object {$_.Groups['path'].Value} | Select-Object -Unique)
  foreach($uasAsset in $uasAssets){$uasResource=Get-UasPage ('https://'+$uasDomain+$uasAsset);Add-UasClientCheck ('ESSENTIAL_ASSET:'+($uasAsset -replace '^/assets/','')) $(if($uasResource.http -eq 200 -and $uasResource.text.Length -gt 20){'PASS'}else{'FAIL'}) @{http=$uasResource.http;body_bytes=$uasResource.bytes;tls_bypass=$false}}
  Add-UasClientCheck 'HTML_REFERENCES_ESSENTIAL_ASSETS' $(if(@($uasAssets | Where-Object {$_ -like '*.js'}).Count -gt 0 -and @($uasAssets | Where-Object {$_ -like '*.css'}).Count -gt 0){'PASS'}else{'FAIL'}) @{count=$uasAssets.Count;limit='Includes compiled CSS embedded by the Home prerender; asset fetch does not prove every JavaScript interaction or login'}
  $uasPrivateApi=Get-UasPage ('https://'+$uasDomain+'/api/profiles/')
  Add-UasClientCheck 'ANONYMOUS_PRIVATE_API_DENIED' $(if($uasPrivateApi.http -in @(401,403)){'PASS'}else{'FAIL'}) @{http=$uasPrivateApi.http}
 }
 # Fixed read-only connection probes against the authorized domain's A only.
 # No scans/ranges, authentication, protocol payloads or attempts to exploit services.
 foreach($uasPort in @(5432,6379,2375,2376,22,3389)){
  $uasProbe=[Net.Sockets.TcpClient]::new();$uasOpen=$false
  try{$uasConnect=$uasProbe.ConnectAsync($uasPublic[0],$uasPort);$uasOpen=$uasConnect.Wait(2500) -and $uasProbe.Connected}catch{$uasOpen=$false}finally{$uasProbe.Dispose()}
  Add-UasClientCheck ('INTERNAL_PORT_NOT_REACHABLE:'+ $uasPort) $(if($uasOpen){'FAIL'}else{'PASS'}) @{reachable=$uasOpen;limit='Connection not established; no host/ISP cause or absence of other services inferred'}
 }
}catch{Add-UasClientCheck 'CLIENT_DIAGNOSTIC_DEPENDENCY' 'BLOCKED' @{error=$_.Exception.GetType().Name}}
$uasReport.status=if(@($uasReport.checks | Where-Object status -EQ 'FAIL').Count){'FAIL'}elseif(@($uasReport.checks | Where-Object status -EQ 'BLOCKED').Count){'BLOCKED'}else{'PASS_SCOPED_DIAGNOSTIC_ONLY'}
$uasReport.browser_login_page='NOT_RUN: confirm real rendering and login control separately in the browser'
if($OutputPath){$uasReport | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $OutputPath -Encoding UTF8}
$uasReport | ConvertTo-Json -Depth 8
if($uasReport.status -ne 'PASS_SCOPED_DIAGNOSTIC_ONLY'){exit 1}
