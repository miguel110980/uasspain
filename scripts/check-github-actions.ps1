param([string]$Repository = 'miguel110980/uasspain', [long]$RunId = 0, [switch]$CheckAccount)

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
    $Headers = @{ Authorization = ('Bearer ' + $Credential.password); Accept = 'application/vnd.github+json'; 'User-Agent' = 'UASSpain-Actions-diagnostic'; 'X-GitHub-Api-Version' = '2026-03-10' }
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
    $Account = $null
    if ($CheckAccount) {
        $Repo = Invoke-RestMethod -Uri $Base -Headers $Headers
        $WorkflowPermission = Invoke-RestMethod -Uri "$Base/actions/permissions/workflow" -Headers $Headers
        $Runners = Invoke-RestMethod -Uri "$Base/actions/runners" -Headers $Headers
        $Billing = @()
        if ($Repo.owner.type -eq 'User') {
            $Owner = $Repo.owner.login
            foreach ($Endpoint in @("https://api.github.com/users/$Owner/settings/billing/usage", "https://api.github.com/users/$Owner/settings/billing/usage/summary")) {
                try {
                    $Usage = Invoke-RestMethod -Uri $Endpoint -Headers $Headers
                    # Report availability only; never dump personal billing data.
                    $Billing += [pscustomobject]@{ endpoint = $Endpoint; status = 200; actions_usage_rows = @($Usage.usageItems | Where-Object { $_.product -eq 'Actions' }).Count }
                } catch {
                    $Status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 'network_error' }
                    $Billing += [pscustomobject]@{ endpoint = $Endpoint; status = $Status }
                }
            }
        }
        $Account = [pscustomobject]@{
            owner_type = $Repo.owner.type; repository_admin = $Repo.permissions.admin
            archived = $Repo.archived; disabled = $Repo.disabled
            default_workflow_permissions = $WorkflowPermission.default_workflow_permissions
            self_hosted_runners = $Runners.total_count
            billing_api = $Billing
            note = 'Zero self-hosted runners is normal for ubuntu-latest. Billing 404 does not prove a billing lock; user billing endpoints require Plan read permission and supported billing access.'
        }
    }
    [pscustomobject]@{
        repository = $Repository
        enabled = $Permission.enabled
        allowed_actions = $Permission.allowed_actions
        workflows = @($Workflows.workflows | Select-Object name, path, state)
        runs = @($Evidence)
        account = $Account
        note = 'startup_failure with zero jobs does not prove a YAML or billing cause. Check account billing status and use Actions diagnostics to test runner allocation.'
    } | ConvertTo-Json -Depth 8
} finally {
    $Credential.Clear(); $Headers.Clear(); $RawCredential = $null
    $env:GIT_TERMINAL_PROMPT = $PreviousPrompt
    $env:GCM_INTERACTIVE = $PreviousInteractive
}
