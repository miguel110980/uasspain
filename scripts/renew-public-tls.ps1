param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$workspace = (Get-Location).Path
$privateRoot = Join-Path $workspace '.secrets/acme-duckdns-20261023'
$tokenPath = Join-Path $env:LOCALAPPDATA 'UASSpain/secrets/duckdns-token.txt'
$hook = Join-Path $workspace 'tools/duckdns-acme-hook.py'
$image = 'certbot/certbot@sha256:f70ad0adbb7e117f0fe42a63c553f28ea451edabc0148757b6efcd9735acaa20'
foreach ($required in @($tokenPath, $hook, (Join-Path $privateRoot 'config'))) {
    if (-not (Test-Path -LiteralPath $required)) { throw 'Required protected ACME configuration is unavailable.' }
}
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$tokenAcl = Get-Acl -LiteralPath $tokenPath
$rules = @($tokenAcl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
if (-not $tokenAcl.AreAccessRulesProtected -or $rules.Count -ne 1 -or $rules[0].IdentityReference -ne $sid -or $rules[0].AccessControlType -ne 'Allow') {
    throw 'DuckDNS token must remain accessible only to the current user.'
}
$common = @('run','--rm','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--tmpfs','/tmp:rw,nosuid,size=64m',
    '--mount',"type=bind,source=$privateRoot\config,target=/etc/letsencrypt",
    '--mount',"type=bind,source=$privateRoot\work,target=/var/lib/letsencrypt",
    '--mount',"type=bind,source=$privateRoot\logs,target=/var/log/letsencrypt",
    '--mount',"type=bind,source=$hook,target=/hooks/duckdns-hook.py,readonly",
    '--mount',"type=bind,source=$tokenPath,target=/run/secrets/duckdns-token.txt,readonly")
$arguments = $common + @($image,'renew','--non-interactive','--quiet',
    '--manual-auth-hook','python /hooks/duckdns-hook.py auth',
    '--manual-cleanup-hook','python /hooks/duckdns-hook.py cleanup')
if ($DryRun) { $arguments += @('--dry-run','--no-random-sleep-on-renew') }
& docker @arguments
$renewExit = $LASTEXITCODE
if (Test-Path -LiteralPath (Join-Path $privateRoot 'config/duckdns-owned-txt.json')) {
    $cleanup = $common + @('--entrypoint','python',$image,'/hooks/duckdns-hook.py','cleanup')
    & docker @cleanup
    if ($LASTEXITCODE -ne 0) { throw 'Owned ACME TXT cleanup remains blocked; foreign records preserved.' }
}
if ($renewExit -ne 0) { throw 'ACME renewal failed; deployed certificates have not been replaced.' }
if ($DryRun) {
    Write-Output 'RENEWAL_DRY_RUN=PASS; DEPLOYED_CERTIFICATES_UNCHANGED'
    exit 0
}
& node tools/publish-public-tls.mjs
if ($LASTEXITCODE -ne 0) { throw 'Public certificate validation/publishing failed.' }
& docker exec uasspain-nginx nginx -t
if ($LASTEXITCODE -ne 0) { throw 'Nginx validation failed; reload not performed.' }
& docker exec uasspain-nginx nginx -s reload
if ($LASTEXITCODE -ne 0) { throw 'Nginx reload failed.' }
Write-Output 'PUBLIC_TLS_RENEWAL=PASS'
