param([string]$Repository = 'miguel110980/uasspain', [long]$RunId = 0)

$ErrorActionPreference = 'Stop'
if ($Repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'Invalid repository name' }
$PreviousPrompt = $env:GIT_TERMINAL_PROMPT
$PreviousInteractive = $env:GCM_INTERACTIVE
$Credential = @{}
$Headers = @{}
try {
    $env:GIT_TERMINAL_PROMPT = '0'
    $env:GCM_INTERACTIVE = 'Never'
    # Keep credentials in memory. Never print the credential helper response.
    $RawCredential = "protocol=https`nhost=github.com`n`n" | git credential fill 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Existing Git credential unavailable' }
    foreach ($Line in $RawCredential) {
        if ($Line -match '^([^=]+)=(.*)$') { $Credential[$Matches[1]] = $Matches[2] }
    }
    $Headers = @{ Authorization = ('Bearer ' + $Credential.password); Accept = 'application/vnd.github+json'; 'User-Agent' = 'UASSpain-Actions-diagnostic'; 'X-GitHub-Api-Version' = '2022-11-28' }
    $Base = "https://api.github.com/repos/$Repository"
    $Permission = Invoke-RestMethod -Uri "$Base/actions/permissions" -Headers $Headers
    $Workflows = Invoke-RestMethod -Uri "$Base/actions/workflows" -Headers $Headers
    if ($RunId) {
        $Runs = @((Invoke-RestMethod -Uri "$Base/actions/runs/$RunId" -Headers $Headers))
    } else {
        $Runs = @((Invoke-RestMethod -Uri "$Base/actions/runs?per_page=10" -Headers $Headers).workflow_runs)
    }
    $Evidence = foreach ($Run in $Runs) {
        $Jobs = Invoke-RestMethod -Uri "$Base/actions/runs/$($Run.id)/jobs?per_page=100" -Headers $Headers
        $Checks = Invoke-RestMethod -Uri "$Base/check-suites/$($Run.check_suite_id)/check-runs" -Headers $Headers
        $Annotations = foreach ($Check in $Checks.check_runs) {
            if ($Check.output.annotations_count -gt 0) {
                Invoke-RestMethod -Uri $Check.output.annotations_url -Headers $Headers | Select-Object title, message
            }
        }
        [pscustomobject]@{ id = $Run.id; url = $Run.html_url; sha = $Run.head_sha; workflow = $Run.path; event = $Run.event; status = $Run.status; conclusion = $Run.conclusion; jobs = $Jobs.total_count; annotations = @($Annotations) }
    }
    [pscustomobject]@{
        repository = $Repository
        enabled = $Permission.enabled
        allowed_actions = $Permission.allowed_actions
        workflows = @($Workflows.workflows | Select-Object name, path, state)
        runs = @($Evidence)
        note = 'startup_failure with zero jobs does not prove a YAML or billing cause. Check account billing status and use Actions diagnostics to test runner allocation.'
    } | ConvertTo-Json -Depth 8
} finally {
    $Credential.Clear(); $Headers.Clear(); $RawCredential = $null
    $env:GIT_TERMINAL_PROMPT = $PreviousPrompt
    $env:GCM_INTERACTIVE = $PreviousInteractive
}
