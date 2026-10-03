param()
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$path = Join-Path $PSScriptRoot '../.secrets/test-accounts.dpapi'
$entropy = [Text.Encoding]::UTF8.GetBytes('UASSpain|local-test-accounts|v1')
$plain = $null
try {
    $plain = [Security.Cryptography.ProtectedData]::Unprotect(
        [IO.File]::ReadAllBytes($path), $entropy,
        [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $accounts = [Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json
    $accounts | Select-Object role, email, username, password | Format-List
} finally {
    if ($null -ne $plain) { [Array]::Clear($plain, 0, $plain.Length) }
}
