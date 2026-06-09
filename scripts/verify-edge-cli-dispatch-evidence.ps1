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

function Get-RequiredManifestProperty {
    param(
        [object]$Manifest,
        [string]$Name
    )

    $prop = $Manifest.PSObject.Properties[$Name]
    if ($null -eq $prop) {
        Block "observed manifest $Name is missing"
        return $null
    }
    return $prop.Value
}

function Test-RequiredManifestBoolTrue {
    param(
        [object]$Manifest,
        [string]$Name
    )

    $value = Get-RequiredManifestProperty $Manifest $Name
    if ($null -eq $value) {
        return $false
    }
    if ($value -isnot [bool]) {
        Block "observed manifest $Name must be boolean true"
        return $false
    }
    if ($value -ne $true) {
        Block "observed manifest $Name is not true"
        return $false
    }
    Pass "observed manifest $Name=true"
    return $true
}

function Test-RequiredManifestString {
    param(
        [object]$Manifest,
        [string]$Name
    )

    $value = Get-RequiredManifestProperty $Manifest $Name
    if ($null -eq $value) {
        return $null
    }
    if ($value -isnot [string] -or [string]::IsNullOrWhiteSpace($value)) {
        Block "observed manifest $Name must be a non-empty string"
        return $null
    }
    Pass "observed manifest $Name is present"
    return $value
}

function Test-RequiredManifestExitCodeZero {
    param([object]$Manifest)

    $value = Get-RequiredManifestProperty $Manifest "exitCode"
    if ($null -eq $value) {
        return $false
    }
    if (-not ($value -is [int] -or $value -is [long])) {
        Block "observed manifest exitCode must be integer 0"
        return $false
    }
    if ([long]$value -ne 0) {
        Block "observed manifest exitCode is not 0"
        return $false
    }
    Pass "observed manifest exitCode=0"
    return $true
}

function Test-ObservedChain {
    param([object]$Manifest)

    if ($null -eq $Manifest) {
        return $false
    }

    $ok = $true
    foreach ($field in @("requestMapped", "invocationPlanObserved", "eventReplayObserved", "realCliObserved", "redacted", "noSecrets")) {
        if (-not (Test-RequiredManifestBoolTrue $Manifest $field)) {
            $ok = $false
        }
    }

    $adapterId = Test-RequiredManifestString $Manifest "adapterId"
    if ($adapterId -in @("codex", "claude-code", "opencode")) {
        Pass "observed manifest adapterId is supported"
    } else {
        Block "observed manifest adapterId is unsupported"
        $ok = $false
    }

    if ($null -eq (Test-RequiredManifestString $Manifest "approvalId")) {
        $ok = $false
    }

    $observedEvidenceRef = Test-RequiredManifestString $Manifest "observedEvidenceRef"
    if ($null -eq $observedEvidenceRef) {
        $ok = $false
    } elseif ($observedEvidenceRef -notmatch '^(edge-event-log|event-log|artifact|sha256):.+') {
        Block "observed manifest observedEvidenceRef must name an edge-event-log, event-log, artifact, or sha256 reference"
        $ok = $false
    } else {
        Pass "observed manifest observedEvidenceRef has concrete reference prefix"
    }

    $correlationId = Test-RequiredManifestString $Manifest "correlationId"
    if ($null -eq $correlationId) {
        $ok = $false
    }
    $invocationPlanEventId = Test-RequiredManifestString $Manifest "invocationPlanEventId"
    if ($null -eq $invocationPlanEventId) {
        $ok = $false
    }
    $terminalEventId = Test-RequiredManifestString $Manifest "terminalEventId"
    if ($null -eq $terminalEventId) {
        $ok = $false
    }
    if ($null -ne $invocationPlanEventId -and $null -ne $terminalEventId) {
        if ($invocationPlanEventId -eq $terminalEventId) {
            Block "observed manifest invocationPlanEventId and terminalEventId must be distinct"
            $ok = $false
        } else {
            Pass "observed manifest event ids are distinct"
        }
    }

    $terminalStatus = Test-RequiredManifestString $Manifest "terminalStatus"
    if ($terminalStatus -eq "finished") {
        Pass "observed manifest terminalStatus=finished"
    } else {
        Block "observed manifest terminalStatus is not finished"
        $ok = $false
    }

    if (-not (Test-RequiredManifestExitCodeZero $Manifest)) {
        $ok = $false
    }

    return $ok
}

Write-Host "AgentHub P1 Edge CLI dispatch evidence verifier" -ForegroundColor Magenta
Write-Host "Mode: $Mode" -ForegroundColor Magenta
Write-Host "No real CLI/model command was executed by this verifier." -ForegroundColor Magenta

Invoke-GoFixtureTest "./internal/adapters" "TestCLIInvocationPlanRedactsPromptEnvAndPaths"
Invoke-GoFixtureTest "./internal/lifecycle" "TestProcessExecutorPublishesCLIInvocationPlanAndReplaysFixtureStatus"

$observedManifestAccepted = $false
if ($Mode -ne "Fixture") {
    $approved = Test-ApprovalMarker
    $manifest = Test-ObservedManifest
    $observedOK = Test-ObservedChain $manifest
    $observedManifestAccepted = $approved -and $observedOK
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed  |  Blocks: $Blocks" -ForegroundColor $(if ($Failed -eq 0 -and ($Mode -eq "Fixture" -or $observedManifestAccepted)) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($observedManifestAccepted) {
    Write-Host "real_tested=false" -ForegroundColor Yellow
    Write-Host "observed_manifest_accepted=true" -ForegroundColor Green
    Write-Host "Status: OBSERVED_MANIFEST_ACCEPTED" -ForegroundColor Green
    Write-Host "RealTested promotion requires a separate verifier: scripts\verify-approved-real-edge-cli-evidence.ps1 must dereference the observed evidence artifact/log/hash." -ForegroundColor Yellow
    exit $(if ($Failed -eq 0) { 0 } else { 1 })
}

Write-Host "real_tested=false" -ForegroundColor Yellow
if ($Mode -eq "Fixture") {
    Write-Host "Status: FIXTURE_DISPATCH_VERIFIED" -ForegroundColor Yellow
    exit $(if ($Failed -eq 0) { 0 } else { 1 })
}

Write-Host "Status: OBSERVED_DISPATCH_BLOCKED" -ForegroundColor Red
exit 1
