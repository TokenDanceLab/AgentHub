#!/usr/bin/env pwsh
<#
Integration/test lane time budget verifier (#1565).

Asserts lane wall-clock budgets recorded in scripts/verify/integration-time-budget.json:

- default (validate job): structure + contract checks — every lane has a
  budget_seconds strictly below its hard_cap_seconds, has owner/review/rationale,
  and budget covers observed evidence (budget >= max observed duration);
- measured mode (CI lane step): `-Lane <name> -MeasuredSeconds <n>` fails
  closed when the measured lane exceeds the lane budget, with a stable error
  code so growth requires an explicit baseline update (tracked approval).

Lane budgets are telemetry with a ratchet: generous vs observed durations so
ordinary CI jitter never trips them, but unapproved lane growth fails.

Usage:
  pwsh scripts/verify/verify-integration-time-budget.ps1                          # check baseline contract
  pwsh scripts/verify/verify-integration-time-budget.ps1 -Lane hub-integration -MeasuredSeconds 41
  pwsh scripts/verify/verify-integration-time-budget.ps1 -BaselinePath <path>    # fixture mode (self-tests)
#>

[CmdletBinding()]
param(
    [string]$Lane,
    [int]$MeasuredSeconds = -1,
    [string]$BaselinePath
)

$ErrorActionPreference = "Stop"

if (-not $BaselinePath) {
    $BaselinePath = Join-Path $PSScriptRoot "integration-time-budget.json"
}
if (-not (Test-Path -LiteralPath $BaselinePath)) {
    Write-Host "  FAIL  lane budget baseline missing: $BaselinePath" -ForegroundColor Red
    exit 1
}
$baseline = Get-Content -Raw -LiteralPath $BaselinePath | ConvertFrom-Json -AsHashtable

$Passed = 0
$Failed = 0

function Pass([string]$Text) {
    $script:Passed++
    Write-Host "  PASS  $Text" -ForegroundColor Green
}

function Fail([string]$Text) {
    $script:Failed++
    Write-Host "  FAIL  $Text" -ForegroundColor Red
}

# ── Measured mode ─────────────────────────────────────────────────────
if ($MeasuredSeconds -ge 0) {
    if (-not $Lane) {
        Fail "-Lane is required with -MeasuredSeconds"
        exit 1
    }
    if (-not $baseline.ContainsKey($Lane)) {
        Fail "[lane-time-budget] lane '$Lane' has no budget entry in integration-time-budget.json"
        exit 1
    }
    $laneEntry = $baseline[$Lane]
    $budget = [int]$laneEntry["budget_seconds"]
    if ($MeasuredSeconds -gt $budget) {
        Fail ("[lane-time-budget] lane '{0}' took {1}s, budget {2}s — lane growth needs an explicit baseline update" -f $Lane, $MeasuredSeconds, $budget)
        exit 1
    }
    Pass ("lane '{0}' measured {1}s within budget {2}s" -f $Lane, $MeasuredSeconds, $budget)
    exit 0
}

# ── Baseline contract check (validate job) ────────────────────────────
$violations = @()
foreach ($laneName in ($baseline.Keys | Where-Object { $_ -ne "_comment" } | Sort-Object)) {
    $laneEntry = $baseline[$laneName]

    foreach ($field in @("budget_seconds", "hard_cap_seconds", "owner", "review", "rationale")) {
        if (-not $laneEntry.ContainsKey($field) -or [string]$laneEntry[$field] -eq "" -or [string]$laneEntry[$field] -eq "TODO") {
            $violations += "lane '$laneName' missing $field"
        }
    }

    $budget = [double]$laneEntry["budget_seconds"]
    $cap = [double]$laneEntry["hard_cap_seconds"]
    if ($budget -ge $cap) {
        $violations += "lane '$laneName' budget $budget s must be strictly below hard cap $cap s"
    }

    if ($laneEntry.ContainsKey("evidence")) {
        foreach ($ev in $laneEntry["evidence"]) {
            if ([int]$ev["seconds"] -gt $budget) {
                $violations += "lane '$laneName' observed $($ev['seconds'])s (run $($ev['run'])) exceeds budget $budget s"
            }
        }
    }
}

if ($violations.Count -eq 0) {
    Pass ("lane time budget contract holds for {0} lanes" -f @($baseline.Keys | Where-Object { $_ -ne "_comment" }).Count)
    foreach ($laneName in ($baseline.Keys | Where-Object { $_ -ne "_comment" } | Sort-Object)) {
        $laneEntry = $baseline[$laneName]
        $evs = @($laneEntry["evidence"] | ForEach-Object { $_.seconds })
        $maxObs = if ($evs.Count -gt 0) { ($evs | Measure-Object -Maximum).Maximum } else { "n/a" }
        Write-Host ("    {0,-16} budget {1,4}s  cap {2,4}s  observed max {3}" -f $laneName, $laneEntry["budget_seconds"], $laneEntry["hard_cap_seconds"], $maxObs)
    }
} else {
    foreach ($v in ($violations | Sort-Object -Unique)) {
        Fail $v
    }
    Write-Host "  #1565: lane budget changes need owner/review/rationale + before/after evidence." -ForegroundColor Yellow
    exit 1
}
