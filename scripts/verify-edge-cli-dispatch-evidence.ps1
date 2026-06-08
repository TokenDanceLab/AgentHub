#!/usr/bin/env pwsh
<#
AgentHub P1 Edge CLI dispatch evidence verifier.

Default mode runs fixture-only Go tests that prove request -> CLI invocation
plan -> fixture event replay/status. Observed/RealTested modes validate a
redacted manifest only when an explicit approval marker is provided.
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = ".",
    [ValidateSet("Fixture", "Observed", "RealTested")]
    [string]$Mode = "Fixture",
    [string]$ObservedManifest = "",
    [string]$ApprovalMarker = "",
    [switch]$ApproveObservedCLI
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
$Passed = 0
$Failed = 0
$Blocks = 0

$SecretLikePattern = '(?i)(sk-[a-z0-9_-]{8,}|gh[pousr]_[a-z0-9_]{8,}|xox[baprs]-[a-z0-9-]+|AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|(?:token|secret|api[_-]?key|password|authorization)\s*[:=]\s*\S+)'

function Pass([string]$Text) {
    $script:Passed++
    Write-Host "PASS $Text" -ForegroundColor Green
}

function Fail([string]$Text) {
    $script:Failed++
    Write-Host "FAIL $Text" -ForegroundColor Red
}

function Block([string]$Text) {
    $script:Blocks++
    Write-Host "BLOCK $Text" -ForegroundColor Yellow
}

function Invoke-GoFixtureTest {
    param(
        [string]$Package,
        [string]$Run
    )

    $edgeRoot = Join-Path $RepoRoot "edge-server"
    Push-Location $edgeRoot
    try {
        $output = & go test $Package -run $Run -short -count=1 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }

    if ($exitCode -eq 0) {
        Pass "fixture Go test passed: $Package -run $Run"
        return
    }

    Fail "fixture Go test failed: $Package -run $Run"
    Write-Host ($output -join "`n") -ForegroundColor DarkGray
}

function Test-ApprovalMarker {
    if (-not $ApproveObservedCLI) {
        Block "approval marker gate is closed: pass -ApproveObservedCLI with -ApprovalMarker"
        return $false
    }
    if ([string]::IsNullOrWhiteSpace($ApprovalMarker)) {
        Block "approval marker missing"
        return $false
    }
    if (-not (Test-Path -LiteralPath $ApprovalMarker -PathType Leaf)) {
        Block "approval marker file does not exist"
        return $false
    }
    Pass "approval marker exists"
    return $true
}

function Test-ObservedManifest {
    if ([string]::IsNullOrWhiteSpace($ObservedManifest)) {
        Block "observed manifest missing"
        return $null
    }
    if (-not (Test-Path -LiteralPath $ObservedManifest -PathType Leaf)) {
        Block "observed manifest file does not exist"
        return $null
    }

    $raw = Get-Content -LiteralPath $ObservedManifest -Raw -Encoding UTF8
    if ($raw -match $SecretLikePattern) {
        Fail "observed manifest contains secret-like content"
        return $null
    }

    try {
        $manifest = $raw | ConvertFrom-Json
    } catch {
        Fail "observed manifest is not valid JSON"
        return $null
    }
    Pass "observed manifest JSON parsed"
    return $manifest
}

function Get-ManifestBool {
    param(
        [object]$Manifest,
        [string]$Name
    )
    $prop = $Manifest.PSObject.Properties[$Name]
    if ($null -eq $prop) {
        return $false
    }
    return [bool]$prop.Value
}

function Test-ObservedChain {
    param([object]$Manifest)

    if ($null -eq $Manifest) {
        return $false
    }

    $ok = $true
    foreach ($field in @("requestMapped", "invocationPlanObserved", "eventReplayObserved", "realCliObserved", "redacted", "noSecrets")) {
        if (Get-ManifestBool $Manifest $field) {
            Pass "observed manifest $field=true"
        } else {
            Block "observed manifest $field is not true"
            $ok = $false
        }
    }

    if ($Manifest.adapterId -in @("codex", "claude-code", "opencode")) {
        Pass "observed manifest adapterId is supported"
    } else {
        Block "observed manifest adapterId is unsupported"
        $ok = $false
    }

    if (-not [string]::IsNullOrWhiteSpace([string]$Manifest.approvalId)) {
        Pass "observed manifest approvalId is present"
    } else {
        Block "observed manifest approvalId is missing"
        $ok = $false
    }

    if ([string]$Manifest.terminalStatus -eq "finished") {
        Pass "observed manifest terminalStatus=finished"
    } else {
        Block "observed manifest terminalStatus is not finished"
        $ok = $false
    }

    if ([int]$Manifest.exitCode -eq 0) {
        Pass "observed manifest exitCode=0"
    } else {
        Block "observed manifest exitCode is not 0"
        $ok = $false
    }

    return $ok
}

Write-Host "AgentHub P1 Edge CLI dispatch evidence verifier" -ForegroundColor Magenta
Write-Host "Mode: $Mode" -ForegroundColor Magenta
Write-Host "No real CLI/model command was executed by this verifier." -ForegroundColor Magenta

Invoke-GoFixtureTest "./internal/adapters" "TestCLIInvocationPlanRedactsPromptEnvAndPaths"
Invoke-GoFixtureTest "./internal/lifecycle" "TestProcessExecutorPublishesCLIInvocationPlanAndReplaysFixtureStatus"

$realTested = $false
if ($Mode -ne "Fixture") {
    $approved = Test-ApprovalMarker
    $manifest = Test-ObservedManifest
    $observedOK = Test-ObservedChain $manifest
    $realTested = $approved -and $observedOK
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed  |  Blocks: $Blocks" -ForegroundColor $(if ($Failed -eq 0 -and ($Mode -eq "Fixture" -or $realTested)) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($realTested) {
    Write-Host "real_tested=true" -ForegroundColor Green
    Write-Host "Status: OBSERVED_DISPATCH_VERIFIED" -ForegroundColor Green
    exit $(if ($Failed -eq 0) { 0 } else { 1 })
}

Write-Host "real_tested=false" -ForegroundColor Yellow
if ($Mode -eq "Fixture") {
    Write-Host "Status: FIXTURE_DISPATCH_VERIFIED" -ForegroundColor Yellow
    exit $(if ($Failed -eq 0) { 0 } else { 1 })
}

Write-Host "Status: OBSERVED_DISPATCH_BLOCKED" -ForegroundColor Red
exit 1
