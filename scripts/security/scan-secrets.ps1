param(
    [ValidateSet("tree", "history", "staged")]
    [string]$Mode = "tree"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command gitleaks -ErrorAction SilentlyContinue)) {
    throw "gitleaks no esta instalado"
}

$common = @(
    "--config", ".gitleaks.toml",
    "--redact",
    "--no-banner",
    "--no-color"
)

switch ($Mode) {
    "tree" { & gitleaks dir . @common }
    "history" { & gitleaks git . @common }
    "staged" { & gitleaks protect --staged @common }
}

if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
