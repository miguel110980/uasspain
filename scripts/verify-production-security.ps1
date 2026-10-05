# Read-only source/history and running-image scans. Reports remain outside Git.
param([string]$ReportDirectory = '.run/home100/security')
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Output = [IO.Path]::GetFullPath((Join-Path $Root $ReportDirectory))
if (-not $Output.StartsWith($Root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Report directory must be inside the workspace' }
New-Item -ItemType Directory -Force -Path $Output | Out-Null
$Trivy = 'aquasec/trivy@sha256:af6acf9a6b85dfe389a1941505c0ce9efef52a4719635e1a962f022a3d855daa'
$Gitleaks = 'zricethezav/gitleaks@sha256:cdbb7c955abce02001a9f6c9f602fb195b7fadc1e812065883f695d1eeaba854'
$Common = @('run', '--rm', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--tmpfs', '/tmp', '-v', "${Root}:/workspace:ro", '-v', "${Output}:/out")
$Findings = 0
# Local secrets are legitimate untracked inputs, but would be exposed if they
# ever appeared in a commit. Do not carry their worktree exclusion into history.
$HistoryConfig = (Get-Content -LiteralPath (Join-Path $Root '.gitleaks.toml') | Where-Object { $_ -notmatch '\[\.\](run|secrets)/|\[\.\]env' }) -join "`n"
[IO.File]::WriteAllText((Join-Path $Output 'history-config.toml'), $HistoryConfig)
foreach ($Mode in @('dir', 'git')) {
    $Config = if ($Mode -eq 'git') { '/out/history-config.toml' } else { '/workspace/.gitleaks.toml' }
    & docker @Common --network none -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=/workspace $Gitleaks $Mode /workspace --config $Config --redact --no-banner --report-format json --report-path "/out/secrets-$Mode.json"
    if ($LASTEXITCODE -notin @(0, 1)) { throw "Gitleaks $Mode scan could not complete" }
    $Leaks = Get-Content -LiteralPath (Join-Path $Output "secrets-$Mode.json") -Raw | ConvertFrom-Json
    $Findings += $Leaks.Count
}
$Images = @()
foreach ($Service in @('nginx', 'frontend', 'backend', 'postgres', 'redis')) {
    $Info = @( & docker inspect "uasspain-$Service" | ConvertFrom-Json )[0]
    if ($LASTEXITCODE -ne 0) { throw "Cannot inspect running $Service" }
    $BuiltImage = @(& docker image inspect $Info.Config.Image | ConvertFrom-Json)[0]
    if ($LASTEXITCODE -ne 0) { throw "Cannot inspect rebuilt image for $Service" }
    $ScanImage = $BuiltImage.Id
    # The containerd image store can retain a container's config digest in Image,
    # while image inspect resolves the tag to an OCI index. Inspect its actual
    # platform and verify the running manifest before scanning the immutable index.
    if ($Info.ImageManifestDescriptor -and $Info.ImageManifestDescriptor.platform) {
        $PlatformInfo = $Info.ImageManifestDescriptor.platform
        $Platform = (@($PlatformInfo.os, $PlatformInfo.architecture, $PlatformInfo.variant) | Where-Object { $_ }) -join '/'
        $PlatformImage = @(& docker image inspect --platform $Platform $Info.Config.Image | ConvertFrom-Json)[0]
        if ($LASTEXITCODE -ne 0) { throw "Cannot resolve running platform for $Service" }
        if ($PlatformImage.Descriptor.digest -ne $Info.ImageManifestDescriptor.digest) {
            throw "Running $Service does not match the rebuilt image tag"
        }
    } elseif ($BuiltImage.Id -ne $Info.Image) {
        throw "Running $Service does not match the rebuilt image tag"
    }
    $Images += @{ service = $Service; image = $Info.Image; scannedImage = $ScanImage; configuredImage = $Info.Config.Image }
    & docker @Common -v /var/run/docker.sock:/var/run/docker.sock:ro -v uasspain-trivy-cache:/cache $Trivy image --cache-dir /cache --timeout 10m --skip-version-check --scanners vuln --severity HIGH,CRITICAL --format json --output "/out/image-$Service.json" $ScanImage
    if ($LASTEXITCODE -ne 0) { throw "Trivy $Service scan could not complete" }
}
$SourceMounts = @()
foreach ($Manifest in @('backend-rust/Cargo.toml', 'backend-rust/Cargo.lock', 'frontend/package.json', 'frontend/package-lock.json')) {
    $SourceMounts += @('-v', ((Join-Path $Root $Manifest) + ":/scan/${Manifest}:ro"))
}
# Dependency advisories need the real manifests and lockfiles, not installed
# caches or local secret inputs. Scan every locked runtime and dev dependency.
& docker @Common @SourceMounts -v uasspain-trivy-cache:/cache $Trivy fs --cache-dir /cache --timeout 10m --skip-version-check --include-dev-deps --scanners vuln --severity HIGH,CRITICAL --format json --output /out/source.json /scan
if ($LASTEXITCODE -ne 0) { throw 'Source dependency scan could not complete' }
$SourceReport = Get-Content -LiteralPath (Join-Path $Output 'source.json') -Raw | ConvertFrom-Json
foreach ($Required in @('Cargo.lock', 'package-lock.json')) {
    if (-not @($SourceReport.Results | Where-Object { $_.Target -like "*$Required" }).Count) { throw "Missing dependency report for $Required" }
}
$Vulnerabilities = @()
foreach ($File in Get-ChildItem -LiteralPath $Output -Filter '*.json') {
    if ($File.Name -notmatch '^(image-|source)') { continue }
    $Scan = Get-Content -LiteralPath $File.FullName -Raw | ConvertFrom-Json
    foreach ($Result in $Scan.Results) {
        foreach ($Item in $Result.Vulnerabilities) {
            $Vulnerabilities += @{ report = $File.Name; id = $Item.VulnerabilityID; package = $Item.PkgName; severity = $Item.Severity; installed = $Item.InstalledVersion; fixed = $Item.FixedVersion }
        }
    }
}
$Correctable = @($Vulnerabilities | Where-Object { $_.fixed })
$Summary = @{ images = $Images; secrets = $Findings; rotationRequired = $Findings -gt 0; correctableHighCritical = $Correctable.Count; allHighCritical = $Vulnerabilities.Count; vulnerabilities = $Vulnerabilities }
$Summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $Output 'summary.json') -Encoding UTF8
Write-Host "SECRETS=$Findings CORRECTABLE_HIGH_CRITICAL=$($Correctable.Count) ALL_HIGH_CRITICAL=$($Vulnerabilities.Count)"
if ($Findings -gt 0 -or $Correctable.Count -gt 0) { throw 'Security gate failed; see redacted reports' }
