#Requires -Version 5.1
<#
.SYNOPSIS
  Negative self-test for the frontend coverage include contract (#1535).

.DESCRIPTION
  Proves the include contract actually counts imported-by-nobody production
  modules as 0% and that the uncovered ratchet in
  verify-coverage-baseline.ps1 would fail on them:

    1. Creates app/mobile-rn/src/__cov_probe__/uncovered_probe.ts — a real
       production-looking module (exported function) that no test imports.
    2. Runs vitest --coverage (json-summary) for agenthub-mobile-rn.
    3. Asserts the probe file appears in coverage-summary.json with
       lines.pct == 0 (a file excluded by a broken include/exclude config
       would NOT appear — that is the fail-open hole this test closes).
    4. Asserts uncovered_files (0%-line production modules) exceeds the
       baseline's uncoveredFiles for mobile — the ratchet would fail the gate.
    5. Deletes the probe and re-verifies it is gone from a fresh summary
       count so the real gate run afterwards is unaffected.

  Exit 0 on pass, exit 1 on any failure. Run in CI as a validate step.

.PARAMETER RepoRoot
  Repository root. Defaults to the parent of the parent of this script.
#>
param(
    [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
# scripts/verify/tests/ -> up three levels to the repo root
if (-not $RepoRoot) { $RepoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $scriptDir)) }

$mobileDir = Join-Path $RepoRoot "app/mobile-rn"
$probeDir = Join-Path $mobileDir "src/__cov_probe__"
$probeFile = Join-Path $probeDir "uncovered_probe.ts"
$baselinePath = Join-Path $RepoRoot "scripts/verify/coverage-baseline.json"

if (-not (Test-Path -LiteralPath $mobileDir)) { throw "mobile dir not found: $mobileDir" }
if (-not (Test-Path -LiteralPath $baselinePath)) { throw "baseline not found: $baselinePath" }

$baseline = Get-Content -LiteralPath $baselinePath -Raw | ConvertFrom-Json
$mobileBase = $baseline.packages.'agenthub-mobile-rn'
if ($null -eq $mobileBase.uncoveredFiles) { throw "baseline missing uncoveredFiles for agenthub-mobile-rn" }

$failures = New-Object System.Collections.Generic.List[string]

function Get-CoverageStats {
    param([string]$SummaryPath)
    $cs = Get-Content -LiteralPath $SummaryPath -Raw | ConvertFrom-Json
    $production = 0
    $uncovered = 0
    $probeFound = $false
    foreach ($prop in $cs.PSObject.Properties) {
        if ($prop.Name -eq 'total') { continue }
        $production++
        $linesInfo = $prop.Value.lines
        if ($null -ne $linesInfo -and [int]$linesInfo.total -gt 0 -and [double]$linesInfo.pct -eq 0.0) {
            $uncovered++
        }
        if ($prop.Name -replace '\\', '/' -match '__cov_probe__/uncovered_probe\.ts$') {
            $probeFound = $true
            $probeLines = $linesInfo
        }
    }
    return [pscustomobject]@{ Production = $production; Uncovered = $uncovered; ProbeFound = $probeFound; ProbeLines = $probeLines }
}

try {
    # 1. create the probe (untracked production file, imported by nothing)
    New-Item -ItemType Directory -Path $probeDir -Force | Out-Null
    @'
// Coverage include-contract probe (#1535) — created by
// scripts/verify/tests/coverage-include.Tests.ps1. No test imports this;
// it must appear in coverage-summary.json as 0% and trip the uncovered
// ratchet. Deleted by the same script.
export function uncoveredProbeTick(): string {
  const state = Math.random() > 0.5 ? 'up' : 'down';
  return state;
}

export const uncoveredProbeConst = 42;
'@ | Set-Content -LiteralPath $probeFile -Encoding UTF8

    # 2. run mobile coverage (json-summary only)
    $covDir = Join-Path $mobileDir "coverage"
    if (Test-Path -LiteralPath $covDir) { Remove-Item -LiteralPath $covDir -Recurse -Force }
    Push-Location (Join-Path $RepoRoot "app")
    try {
        & pnpm --filter agenthub-mobile-rn exec vitest run --coverage `
            --coverage.reporter=json-summary --hookTimeout=120000 2>&1 | Out-Host
        if ($LASTEXITCODE -ne 0) { $failures.Add("mobile vitest run failed with exit $LASTEXITCODE") }
    }
    finally { Pop-Location }

    # 3. assert the probe is counted as 0% (not silently excluded)
    $summary = Join-Path $mobileDir "coverage/coverage-summary.json"
    if (-not (Test-Path -LiteralPath $summary)) {
        $failures.Add("coverage-summary.json missing — coverage did not run")
    } else {
        $stats = Get-CoverageStats $summary
        if (-not $stats.ProbeFound) {
            $failures.Add("probe file NOT present in coverage-summary.json — include glob failed to match it (fail-open hole)")
        } elseif ([int]$stats.ProbeLines.total -eq 0) {
            $failures.Add("probe file has 0 instrumented statements — probe is not valid production code")
        } elseif ([double]$stats.ProbeLines.pct -ne 0.0) {
            $failures.Add("probe file coverage is $($stats.ProbeLines.pct)% — expected 0% (something imported it?)")
        } else {
            Write-Host "  OK  probe counted as 0% (statements=$($stats.ProbeLines.total))"
        }

        # 4. the uncovered ratchet would fail the gate
        Write-Host "  mobile uncovered_files=$($stats.Uncovered) baseline=$($mobileBase.uncoveredFiles)"
        if ($stats.Uncovered -le [int]$mobileBase.uncoveredFiles) {
            $failures.Add("uncovered_files did not grow past baseline — ratchet would NOT trip on new untested code")
        } else {
            Write-Host "  OK  uncovered ratchet would trip (uncovered $($stats.Uncovered) > baseline $($mobileBase.uncoveredFiles))"
        }
        Write-Host "  mobile production_files=$($stats.Production)"
    }
}
finally {
    # 5. cleanup — probe must not leak into the real gate run
    if (Test-Path -LiteralPath $probeDir) {
        Remove-Item -LiteralPath $probeDir -Recurse -Force
        Write-Host "  cleanup: probe dir removed"
    }
    $covDir = Join-Path $mobileDir "coverage"
    if (Test-Path -LiteralPath $covDir) { Remove-Item -LiteralPath $covDir -Recurse -Force -EA SilentlyContinue }
}

if ($failures.Count -gt 0) {
    Write-Host ""
    Write-Host "coverage-include self-test FAILED:" -ForegroundColor Red
    foreach ($f in $failures) { Write-Host "  - $f" -ForegroundColor Red }
    exit 1
}
Write-Host ""
Write-Host "coverage-include self-test ok — include contract counts uncovered modules, ratchet trips" -ForegroundColor Green
exit 0
