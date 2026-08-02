#Requires -Version 5.1
<#
.SYNOPSIS
  Frontend coverage baseline gate (baseline must not regress).

.DESCRIPTION
  Runs vitest --coverage for the four frontend packages (@agenthub/shared,
  agenthub-web, agenthub-desktop, agenthub-mobile-rn), parses the json-summary
  coverage report and the json test-results report, then asserts:
    1. Every coverage metric (lines/branches/functions/statements) is >= the
       value recorded in scripts/verify/coverage-baseline.json (no regression).
    2. Every coverage.include file with statements but 0% lines is an
       imported-by-nobody production module; their count must not grow past
       the baseline's uncoveredFiles (0% ratchet — new untested code or a
       deleted test both trip it). production_files == 0 (include glob broken)
       is a failure.
    3. Skipped test count == 0 for every package (defeats .skip / .todo as a
       way to silently mask a coverage drop).
  Exit 0 on pass, exit 1 on any regression, uncovered growth, or skipped test.

  Reproducible: v8 coverage is execution-path based, so the numbers are
  cross-platform deterministic (Windows measure == ubuntu CI).

.PARAMETER BaselinePath
  Path to the baseline JSON. Defaults to scripts/verify/coverage-baseline.json
  relative to the repository root (the parent of the parent of this script).

.PARAMETER AppDir
  Workspace root (the `app` dir). Defaults to <repoRoot>/app.

.PARAMETER KeepReports
  Do not delete the generated coverage/ dirs and test-results.json files after
  parsing. Useful for local inspection.
#>
param(
    [string]$BaselinePath = "",
    [string]$AppDir = "",
    [switch]$KeepReports
)

$ErrorActionPreference = "Stop"

# --- locate repo root --------------------------------------------------------
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)
if (-not $AppDir) { $AppDir = Join-Path $repoRoot "app" }
if (-not $BaselinePath) { $BaselinePath = Join-Path $repoRoot "scripts/verify/coverage-baseline.json" }

if (-not (Test-Path -LiteralPath $BaselinePath)) {
    throw "baseline file not found: $BaselinePath"
}
if (-not (Test-Path -LiteralPath $AppDir)) {
    throw "app dir not found: $AppDir"
}

$baseline = Get-Content -LiteralPath $BaselinePath -Raw | ConvertFrom-Json

# v8 coverage has a small run-to-run variance (a few async setup/teardown paths
# execute non-deterministically). The baseline JSON declares a tolerance field
# (default 0.08pp) tuned to absorb this noise while still catching any deleted
# test that covers more than a handful of unique statements. See the baseline
# file's toleranceNote for the measurement basis.
$epsilon = if ($null -ne $baseline.tolerance) { [double]$baseline.tolerance } else { 0.08 }

$metrics = @('lines', 'statements', 'functions', 'branches')

$failures = New-Object System.Collections.Generic.List[string]
$packageSummaries = New-Object System.Collections.Generic.List[string]

function Invoke-VitestCoverage {
    param(
        [string]$AppDir,
        [string]$Filter,
        [string]$Config
    )
    $args = @('exec', 'vitest', 'run')
    if ($Config) { $args += @('--config', $Config) }
    $args += @(
        '--coverage',
        '--coverage.reporter=json-summary',
        '--coverage.reporter=text',
        '--reporter=json',
        '--outputFile=test-results.json',
        '--hookTimeout=120000'
    )
    Push-Location -LiteralPath $AppDir
    try {
        & pnpm --filter $Filter @args 2>&1 | Out-Host
        $code = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
    return $code
}

# Iterate packages in baseline order.
foreach ($pkgProp in $baseline.packages.PSObject.Properties) {
    $pkgFilter = $pkgProp.Name
    $pkg = $pkgProp.Value
    $pkgDir = $pkg.dir
    $config = $pkg.config
    $absPkgDir = Join-Path $repoRoot $pkgDir

    Write-Host ""
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host "  coverage gate: $pkgFilter" -ForegroundColor Cyan
    if ($config) { Write-Host "  config: $config" -ForegroundColor DarkGray }
    Write-Host "================================================================" -ForegroundColor Cyan

    $exitCode = Invoke-VitestCoverage -AppDir $AppDir -Filter $pkgFilter -Config $config

    $testResultsPath = Join-Path $absPkgDir "test-results.json"
    $coverageSummaryPath = Join-Path $absPkgDir "coverage" "coverage-summary.json"

    $parsedTests = $false
    $parsedCoverage = $false
    $skippedCount = -1
    $totals = $null

    if (Test-Path -LiteralPath $testResultsPath) {
        try {
            $tr = Get-Content -LiteralPath $testResultsPath -Raw | ConvertFrom-Json
            $numTotal = [int]$tr.numTotalTests
            $numPassed = [int]$tr.numPassedTests
            $numFailed = [int]$tr.numFailedTests
            # vitest's json reporter has no numSkippedTests key; skipped/todo/
            # pending tests are the ones that are neither passed nor failed.
            $skippedCount = $numTotal - $numPassed - $numFailed
            $parsedTests = $true
        } catch {
            $failures.Add("[$pkgFilter] failed to parse $testResultsPath : $($_.Exception.Message)")
        }
    } else {
        $failures.Add("[$pkgFilter] vitest did not produce test-results.json (vitest exit=$exitCode); the run likely failed to start")
    }

    if (Test-Path -LiteralPath $coverageSummaryPath) {
        try {
            $cs = Get-Content -LiteralPath $coverageSummaryPath -Raw | ConvertFrom-Json
            $totals = $cs.total
            $parsedCoverage = $true
        } catch {
            $failures.Add("[$pkgFilter] failed to parse $coverageSummaryPath : $($_.Exception.Message)")
        }
    } else {
        # vitest skips writing coverage when tests fail; that is itself a gate
        # failure (tests cannot fail on the baseline).
        $failures.Add("[$pkgFilter] vitest did not produce coverage-summary.json (vitest exit=$exitCode); tests likely failed or coverage instrumentation aborted")
    }

    # --- skipped assertion (defeats .skip / .todo) -------------------------
    if ($parsedTests) {
        if ($skippedCount -ne 0) {
            $failures.Add("[$pkgFilter] skipped tests must be 0 (anti-.skip gate); got skipped=$skippedCount (total=$numTotal passed=$numPassed failed=$numFailed)")
        }
    }

    # --- baseline comparison ------------------------------------------------
    if ($parsedCoverage -and $totals) {
        foreach ($m in $metrics) {
            $current = [double]$totals.$m.pct
            $base = [double]$pkg.coverage.$m
            if ($current -lt ($base - $epsilon)) {
                $failures.Add("[$pkgFilter] $m coverage regressed: current $current% < baseline $base%")
            }
        }
    }

    # --- uncovered production modules (include contract, #1535) -------------
    # coverage-summary.json lists every file matched by coverage.include.
    # Files with statements but 0% lines are production modules no test
    # imports. The baseline records uncoveredFiles; it must not grow (new
    # untested code or a deleted test both trip it). production_files == 0
    # means the include glob matched nothing — broken config, fail-closed.
    if ($parsedCoverage -and $totals) {
        $productionFiles = 0
        $uncoveredFiles = 0
        foreach ($prop in $cs.PSObject.Properties) {
            if ($prop.Name -eq 'total') { continue }
            $productionFiles++
            $linesInfo = $prop.Value.lines
            if ($null -ne $linesInfo -and [int]$linesInfo.total -gt 0 -and [double]$linesInfo.pct -eq 0.0) {
                $uncoveredFiles++
            }
        }
        if ($productionFiles -eq 0) {
            $failures.Add("[$pkgFilter] coverage include matched 0 production files — include glob broken (fail-closed)")
        }
        if ($null -ne $pkg.uncoveredFiles) {
            $baseUncovered = [int]$pkg.uncoveredFiles
            if ($uncoveredFiles -gt $baseUncovered) {
                $failures.Add("[$pkgFilter] uncovered (0%) production modules grew: $uncoveredFiles > baseline $baseUncovered (new untested code or deleted test)")
            }
        }
        $uncLine = "$pkgFilter coverage: production_files=$productionFiles uncovered_files=$uncoveredFiles"
        $packageSummaries.Add($uncLine)
        Write-Host $uncLine -ForegroundColor DarkYellow
    }

    # --- console summary line ----------------------------------------------
    if ($parsedTests -and $parsedCoverage) {
        $line = "{0,-22} tests={1} skipped={2} | lines={3}% stmt={4}% fn={5}% br={6}% (base lines={7}% stmt={8}% fn={9}% br={10}%)" -f `
            $pkgFilter, $numTotal, $skippedCount, `
            $totals.lines.pct, $totals.statements.pct, $totals.functions.pct, $totals.branches.pct, `
            $pkg.coverage.lines, $pkg.coverage.statements, $pkg.coverage.functions, $pkg.coverage.branches
        $packageSummaries.Add($line)
        Write-Host $line -ForegroundColor Green
    } else {
        Write-Host "[$pkgFilter] FAILED to produce complete reports (see errors above)" -ForegroundColor Red
    }

    # --- cleanup ------------------------------------------------------------
    if (-not $KeepReports) {
        if (Test-Path -LiteralPath $testResultsPath) { Remove-Item -LiteralPath $testResultsPath -Force -EA SilentlyContinue }
        $covDir = Join-Path $absPkgDir "coverage"
        if (Test-Path -LiteralPath $covDir) { Remove-Item -LiteralPath $covDir -Recurse -Force -EA SilentlyContinue }
    }
}

Write-Host ""
Write-Host "================ Coverage baseline gate summary ================" -ForegroundColor Cyan
foreach ($line in $packageSummaries) { Write-Host $line }
Write-Host "================================================================"

# Drop the stray placeholder loop's leftover (no-op safeguard).
if ($failures.Count -gt 0) {
    Write-Host ""
    Write-Host "Coverage baseline gate FAILED:" -ForegroundColor Red
    foreach ($f in $failures) { Write-Host "  - $f" -ForegroundColor Red }
    Write-Host ""
    throw "coverage baseline gate failed with $($failures.Count) issue(s)"
}

Write-Host ""
Write-Host "coverage baseline gate ok — no regression, zero skipped" -ForegroundColor Green
