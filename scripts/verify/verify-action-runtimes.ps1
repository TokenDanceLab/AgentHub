#!/usr/bin/env pwsh
<#
Action runtime deprecation gate (#1580).

Prevents re-introducing JavaScript action majors that run on the deprecated
Node.js 20 runtime into any live workflow under `.github/workflows/`.

Policy: every `uses: owner/name@ref` in a workflow is matched against an
allow-list of (action, permitted version prefixes). A reference outside the
permitted set FAILS closed:

- known Node-20-era majors are rejected by name (e.g. `actions/checkout@v4`),
- actions that have no Node-runtime concern (composite actions such as
  `dtolnay/rust-toolchain@stable`) are listed explicitly,
- unknown third-party actions fail closed too: they must be audited and
  registered here before being used, so a silently-Node-20 action cannot
  sneak back in.

The gate is intentionally conservative; registering a new action requires
confirming its `runs.using` runtime is `node24` (or composite with no JS
runtime).
#>
[CmdletBinding()]
param(
    [string]$WorkflowsRoot = (Join-Path $PSScriptRoot "..\..\.github\workflows")
)

$ErrorActionPreference = "Stop"

$script:Failed = 0
function Fail-Verifier([string]$Message) {
    $script:Failed++
    Write-Host "  FAIL  $Message" -ForegroundColor Red
}

# action -> allowed version prefixes (exact string match on the @ref)
$AllowedActions = @{
    "actions/checkout"                = @("v5", "v6", "v7")
    "actions/setup-node"              = @("v5", "v6", "v7")
    "actions/setup-go"                = @("v6", "v7")
    "actions/upload-artifact"         = @("v5", "v6", "v7")
    "actions/download-artifact"       = @("v5", "v6", "v7", "v8")
    "dorny/paths-filter"              = @("v4")
    "pnpm/action-setup"               = @("v5", "v6")
    "golangci/golangci-lint-action"   = @("v9")
    "docker/build-push-action"        = @("v7")
    "docker/login-action"             = @("v4")
    "docker/metadata-action"          = @("v6")
    "docker/setup-buildx-action"      = @("v4")
    "softprops/action-gh-release"     = @("v3")
    # composite actions have no JS runtime; @stable is a moving tag
    "dtolnay/rust-toolchain"          = @("stable")
}

$AllowedFlat = @()
foreach ($action in $AllowedActions.Keys) {
    foreach ($prefix in $AllowedActions[$action]) {
        $AllowedFlat += "$action@$prefix"
    }
}

Write-Host "Action runtime deprecation gate (workflows: $WorkflowsRoot)"

$workflowFiles = @(Get-ChildItem -LiteralPath $WorkflowsRoot -Filter "*.yml" -File -ErrorAction SilentlyContinue)
if ($workflowFiles.Count -eq 0) {
    Fail-Verifier "no workflow files found under $WorkflowsRoot"
    exit 1
}

$seen = @{}
foreach ($wf in $workflowFiles) {
    $content = [System.IO.File]::ReadAllText($wf.FullName)
    foreach ($m in [regex]::Matches($content, 'uses:\s*([^\s]+)')) {
        $ref = $m.Groups[1].Value.Trim()
        if ($seen.ContainsKey($ref)) { continue }
        $seen[$ref] = $true

        $at = $ref.IndexOf('@')
        if ($at -le 0) {
            Fail-Verifier "$($wf.Name): unversioned action reference '$ref' (must pin a registered major)"
            continue
        }
        $action = $ref.Substring(0, $at)
        $version = $ref.Substring($at + 1)
        $candidate = "$action@$version"
        $matched = $false
        foreach ($allowed in $AllowedFlat) {
            if ($candidate -eq $allowed) { $matched = $true; break }
        }
        if (-not $matched) {
            Fail-Verifier "$($wf.Name): action '$ref' is not on the node24 allow-list (register after confirming runtime)"
        }
    }
}

foreach ($wf in $workflowFiles) {
    Write-Host "  checked  $($wf.Name)"
}

if ($script:Failed -gt 0) {
    Write-Host "Action runtime gate FAILED ($($script:Failed) issue(s))." -ForegroundColor Red
    exit 1
}
Write-Host "Action runtime gate PASS — all action references are on the node24 allow-list." -ForegroundColor Green
exit 0
