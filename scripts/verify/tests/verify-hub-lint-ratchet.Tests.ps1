#!/usr/bin/env pwsh
<#
Negative self-tests for verify-hub-lint-ratchet.ps1 (#1573).

Cases (each builds a temp fixture with hub-server/ + scripts/verify/ + a
baseline + a pre-generated golangci-lint JSON report, then runs the verifier
with -LintJsonPath so the heavy linter run is bypassed):
1. positive: live findings exactly match baseline -> 0
2. new finding (not in baseline) -> 1
3. replace old finding with a different new finding (same total count) -> 1
   (proves fingerprint identity, not a count ratchet)
4. same finding, different line number -> 0 (fingerprint excludes line)
#>

$ErrorActionPreference = "Stop"
$Passed = 0

function Fail([string]$Message) {
    throw "hub-lint-ratchet self-test failed: $Message"
}

function Pass([string]$Message) {
    $script:Passed++
    Write-Host "  PASS  $Message" -ForegroundColor Green
}

function New-Fixture {
    $fixture = Join-Path ([IO.Path]::GetTempPath()) ("agenthub-hub-lint-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path (Join-Path $fixture "scripts/verify") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $fixture "hub-server") | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "..\verify-hub-lint-ratchet.ps1") -Destination (Join-Path $fixture "scripts/verify/")
    return $fixture
}

function Write-JsonFile([string]$Path, [object]$Payload) {
    $Payload | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function New-Report([object[]]$Issues) {
    return [pscustomobject]@{ Issues = $Issues }
}

function New-Issue([string]$Linter, [string]$File, [string]$Text, [int]$Line = 1) {
    return [pscustomobject]@{
        FromLinter = $Linter
        Pos        = [pscustomobject]@{ Filename = $File; Line = $Line }
        Text       = $Text
    }
}

function Invoke-Verifier([string]$FixtureRoot, [string]$LintJsonPath, [switch]$ExpectFail) {
    $output = & pwsh -NoProfile -File (Join-Path $FixtureRoot "scripts/verify/verify-hub-lint-ratchet.ps1") `
        -RepoRootPath $FixtureRoot -LintJsonPath $LintJsonPath 2>&1
    $exit = $LASTEXITCODE
    if ($ExpectFail) {
        if ($exit -eq 0) {
            Fail "verifier must FAIL for this fixture, exited 0: $($output -join "`n")"
        }
    } else {
        if ($exit -ne 0) {
            Fail "verifier must PASS for this fixture, exited ${exit}: $($output -join "`n")"
        }
    }
    return $output
}

# ── Positive case ──────────────────────────────────────────────────────────
$fixture = New-Fixture
try {
    $issue = New-Issue "gocognit" "internal/service/agent_dispatch.go" "cognitive complexity 98 of func is high (> 30)" 42
    $baseline = [pscustomobject]@{
        _comment       = "fixture baseline"
        linter_version = "v2.12.2"
        findings       = @(
            [pscustomobject]@{ linter = "gocognit"; file = "internal/service/agent_dispatch.go"; message = "cognitive complexity 98 of func is high (> 30)" }
        )
    }
    Write-JsonFile (Join-Path $fixture "scripts/verify/hub-lint-baseline.json") $baseline
    Write-JsonFile (Join-Path $fixture "lint-report.json") (New-Report @($issue))
    Invoke-Verifier $fixture (Join-Path $fixture "lint-report.json")
    Pass "positive fixture (live == baseline)"
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}

# ── Negative 1: new finding not in baseline ────────────────────────────────
$fixture = New-Fixture
try {
    $oldIssue = New-Issue "gocognit" "internal/service/agent_dispatch.go" "cognitive complexity 98 of func is high (> 30)" 42
    $newIssue = New-Issue "staticcheck" "internal/service/agent_profile.go" "new SA1xxx finding" 7
    $baseline = [pscustomobject]@{
        findings = @(
            [pscustomobject]@{ linter = "gocognit"; file = "internal/service/agent_dispatch.go"; message = "cognitive complexity 98 of func is high (> 30)" }
        )
    }
    Write-JsonFile (Join-Path $fixture "scripts/verify/hub-lint-baseline.json") $baseline
    Write-JsonFile (Join-Path $fixture "lint-report.json") (New-Report @($oldIssue, $newIssue))
    $output = Invoke-Verifier $fixture (Join-Path $fixture "lint-report.json") -ExpectFail
    if (($output -join "`n") -notmatch "staticcheck") {
        Fail "new finding must be named in failure output"
    }
    Pass "new finding (not in baseline) fails closed"
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}

# ── Negative 2: replace old finding with different new finding, same count ──
$fixture = New-Fixture
try {
    $replacement = New-Issue "gocognit" "internal/service/agent_dispatch.go" "cognitive complexity 97 of func is high (> 30)" 42
    $baseline = [pscustomobject]@{
        findings = @(
            [pscustomobject]@{ linter = "gocognit"; file = "internal/service/agent_dispatch.go"; message = "cognitive complexity 98 of func is high (> 30)" }
        )
    }
    Write-JsonFile (Join-Path $fixture "scripts/verify/hub-lint-baseline.json") $baseline
    Write-JsonFile (Join-Path $fixture "lint-report.json") (New-Report @($replacement))
    $output = Invoke-Verifier $fixture (Join-Path $fixture "lint-report.json") -ExpectFail
    if (($output -join "`n") -notmatch "97") {
        Fail "replacement finding must be named in failure output"
    }
    Pass "replaced finding (same total count) fails — fingerprint identity, not count ratchet"
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}

# ── Positive 2: same finding moved to a different line ─────────────────────
$fixture = New-Fixture
try {
    $moved = New-Issue "gocognit" "internal/service/agent_dispatch.go" "cognitive complexity 98 of func is high (> 30)" 999
    $baseline = [pscustomobject]@{
        findings = @(
            [pscustomobject]@{ linter = "gocognit"; file = "internal/service/agent_dispatch.go"; message = "cognitive complexity 98 of func is high (> 30)" }
        )
    }
    Write-JsonFile (Join-Path $fixture "scripts/verify/hub-lint-baseline.json") $baseline
    Write-JsonFile (Join-Path $fixture "lint-report.json") (New-Report @($moved))
    Invoke-Verifier $fixture (Join-Path $fixture "lint-report.json")
    Pass "line-number move does not reset debt (fingerprint excludes line)"
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Hub lint ratchet self-tests PASSED ($Passed cases)." -ForegroundColor Green
exit 0
