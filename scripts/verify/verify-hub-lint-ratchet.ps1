#!/usr/bin/env pwsh
<#
Hub golangci-lint finding fingerprint ratchet (#1573).

Prevents Hub lint findings from growing or silently changing identity:
- every current finding is fingerprinted as (linter, relative file, message);
  the fingerprint EXCLUDES line/column so moves within a file do not reset debt;
- the baseline lives in scripts/verify/hub-lint-baseline.json;
- any finding NOT in the baseline FAILS closed (new finding, new linter rule,
  escalated severity all produce a new fingerprint);
- findings may only disappear from the live output (repayment); the baseline
  is then regenerated explicitly via -UpdateBaseline as the recorded approval
  step. Removing an entry without the linter no longer emitting it is a policy
  violation.

This is NOT a count ratchet: replacing one old finding with a different new
finding fails even when the total is unchanged.

Test seam: pass -LintJsonPath to compare against a pre-generated golangci-lint
JSON report instead of shelling out to the linter (used by the self-tests).
#>
[CmdletBinding()]
param(
    [string]$RepoRootPath = (Get-Location),
    [string]$LintJsonPath = "",
    [switch]$UpdateBaseline
)

$ErrorActionPreference = "Stop"
$HubDir = Join-Path $RepoRootPath "hub-server"
$BaselinePath = Join-Path $PSScriptRoot "hub-lint-baseline.json"
$LintVersion = "v2.12.2"

function Fail-Verifier([string]$Message) {
    throw "hub lint ratchet check failed: $Message"
}

function Get-LiveFingerprints([object]$Report) {
    $live = @{}
    foreach ($issue in $Report.Issues) {
        $file = ($issue.Pos.Filename -replace "\\", "/")
        $live["$($issue.FromLinter)|$file|$($issue.Text)"] = $true
    }
    return $live
}

function Get-BaselineFingerprints([string]$BaselineFilePath) {
    $baseline = Get-Content -LiteralPath $BaselineFilePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $set = @{}
    foreach ($entry in $baseline.findings) {
        $file = ($entry.file -replace "\\", "/")
        $set["$($entry.linter)|$file|$($entry.message)"] = $true
    }
    return $set
}

function Find-UnexpectedFingerprints([hashtable]$Live, [hashtable]$Baseline) {
    $unexpected = @()
    foreach ($fp in $Live.Keys) {
        if (-not $Baseline.ContainsKey($fp)) {
            $unexpected += $fp
        }
    }
    return ($unexpected | Sort-Object)
}

if (-not (Test-Path -LiteralPath $HubDir)) {
    Fail-Verifier "hub-server directory not found at $HubDir"
}

$jsonPath = $LintJsonPath
if ([string]::IsNullOrEmpty($jsonPath)) {
    $jsonPath = Join-Path $env:TEMP "hub-lint-ratchet.json"
    $lintArgs = @(
        "run", "./...",
        "--output.json.path=$jsonPath"
    )
    $lintExit = 0
    $lintOut = & go run "github.com/golangci/golangci-lint/v2/cmd/golangci-lint@$LintVersion" @lintArgs 2>&1
    $lintExit = $LASTEXITCODE
    # exit code 1 means findings were reported (expected); anything else is a real failure
    if ($lintExit -gt 1) {
        Fail-Verifier "golangci-lint crashed: $($lintOut -join "`n")"
    }
}

if (-not (Test-Path -LiteralPath $jsonPath)) {
    Fail-Verifier "golangci-lint JSON report not found at $jsonPath"
}
$raw = Get-Content -LiteralPath $jsonPath -Raw -Encoding UTF8
$report = $raw | ConvertFrom-Json
$live = Get-LiveFingerprints $report

if (-not (Test-Path -LiteralPath $BaselinePath)) {
    Fail-Verifier "baseline not found at $BaselinePath (run with -UpdateBaseline to create)"
}
$baselineSet = Get-BaselineFingerprints $BaselinePath

if ($UpdateBaseline) {
    $entries = @()
    foreach ($fp in ($live.Keys | Sort-Object)) {
        $parts = $fp -split "\|", 3
        $entries += [pscustomobject]@{
            linter  = $parts[0]
            file    = $parts[1]
            message = $parts[2]
        }
    }
    $payload = [pscustomobject]@{
        _comment       = "Hub golangci-lint finding fingerprint baseline (#1573). Regenerated $([DateTime]::UtcNow.ToString('yyyy-MM-dd')) with golangci-lint $LintVersion."
        linter_version = $LintVersion
        findings       = $entries
    }
    $payload | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $BaselinePath -Encoding UTF8
    Write-Host "Hub lint baseline updated ($($entries.Count) fingerprints)." -ForegroundColor Green
    exit 0
}

$unexpected = Find-UnexpectedFingerprints $live $baselineSet
if ($unexpected.Count -gt 0) {
    Write-Host "New Hub lint finding(s) not in the fingerprint baseline:" -ForegroundColor Red
    foreach ($fp in $unexpected) {
        Write-Host "  $fp"
    }
    Fail-Verifier "$($unexpected.Count) new finding(s) — repay or explicitly regenerate baseline with -UpdateBaseline"
}

Write-Host "Hub lint fingerprint ratchet PASS ($($live.Count) findings, all baseline-registered)." -ForegroundColor Green
exit 0
