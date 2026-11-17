# Real response-shape regression with NO domain/token/IP parameters: no DNS update.
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$uasRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$uasResponse=Invoke-WebRequest -UseBasicParsing -Uri 'https://www.duckdns.org/update' -TimeoutSec 15
$uasLegacyFailure=$false
try { [void]$uasResponse.Content.Trim() } catch { $uasLegacyFailure=$true }
$uasText=$(if($uasResponse.Content -is [byte[]]){[Text.Encoding]::UTF8.GetString($uasResponse.Content)}else{[string]$uasResponse.Content}).Trim()
$uasReport=[ordered]@{observed_at=[DateTime]::UtcNow.ToString('o');status=$(if($uasResponse.StatusCode -eq 200 -and $uasText -eq 'KO'){'PASS'}else{'FAIL'});scope='Unauthenticated update endpoint without required parameters; verifies response decoding only, no domain or credentials sent';http=[int]$uasResponse.StatusCode;body_type=$uasResponse.Content.GetType().FullName;old_trim_reader_fails=$uasLegacyFailure;decoded_rejection_is_ko=($uasText -eq 'KO');dns_updates=0}
$uasReport | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $uasRoot 'docs/audits/evidence/2026-11-16-duckdns-response.json') -Encoding UTF8
$uasReport | ConvertTo-Json
if($uasReport.status -ne 'PASS'){exit 1}
