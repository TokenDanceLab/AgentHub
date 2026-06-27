#!/usr/bin/env pwsh
<#
AgentHub product-loop fixture/observed E2E verifier.

This gate composes existing focused checks plus a fixture chain manifest:
Web -> Hub -> Desktop/Tauri sidecar readiness -> Local Edge -> adapter fixture
-> Hub events/replay -> Web transcript/approval/artifact render.

It does not run real login, real CLI/model/API calls, deployment, signing,
notarization, updater metadata, or release upload.
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = ".",
    [string]$ReportDir = "",
    [switch]$SkipFocusedTests,
    [switch]$SkipCargoTest
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
if ([string]::IsNullOrWhiteSpace($ReportDir)) {
    $ReportDir = Join-Path $RepoRoot ".tmp\product-loop-observed-e2e"
}

$Passed = 0
$Failed = 0

function Step([string]$Text) {
    Write-Host "`n>>> $Text" -ForegroundColor Cyan
}

function Pass([string]$Text) {
    $script:Passed++
    Write-Host "PASS $Text" -ForegroundColor Green
}

function Fail([string]$Text) {
    $script:Failed++
    Write-Host "FAIL $Text" -ForegroundColor Red
}

function Invoke-Checked {
    param(
        [string]$Label,
        [scriptblock]$Body
    )

    Step $Label
    & $Body
    if ($LASTEXITCODE -ne 0) {
        Fail $Label
        throw "$Label failed with exit code $LASTEXITCODE"
    }
    Pass $Label
}

function Invoke-NodeFixture {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        throw "node executable is required for fixture manifest validation"
    }
    $script = Join-Path $RepoRoot "tests\contract\scripts\product-loop-observed-e2e.fixture.mjs"
    & node $script --output-dir $ReportDir
}

function Invoke-GoFocused {
    Push-Location (Join-Path $RepoRoot "hub-server")
    try {
        & go test ./internal/handler -run "TestAgentHandler_(TriggerTask|TaskAck|TaskStream|TaskEventSummary|TaskApprovals|DecideTaskApproval|TaskArtifacts|TaskDone)$" -count=1
    }
    finally {
        Pop-Location
    }
}

function Invoke-WebFocused {
    Ensure-AppDependencies
    Push-Location (Join-Path $RepoRoot "app\web")
    try {
        & corepack.cmd pnpm exec vitest run src\utils\hubAdapters.test.ts src\platform\useWebWorkbenchModel.test.ts src\platform\webHubRealtime.test.ts --reporter=dot
    }
    finally {
        Pop-Location
    }
}

function Invoke-SharedFocused {
    Ensure-AppDependencies
    Push-Location (Join-Path $RepoRoot "app\shared")
    try {
        & corepack.cmd pnpm exec vitest run src\transcript\normalizeHubRuntimeEvents.test.ts src\workbench\blocks\ApprovalCardBlock.test.tsx src\workbench\blocks\RunSessionCard.test.tsx --reporter=dot
    }
    finally {
        Pop-Location
    }
}

function Ensure-AppDependencies {
    $vitestCmd = Join-Path $RepoRoot "app\node_modules\.bin\vitest.cmd"
    if (Test-Path -LiteralPath $vitestCmd -PathType Leaf) {
        return
    }

    Step "Install app workspace dependencies for focused Vitest checks"
    Push-Location (Join-Path $RepoRoot "app")
    try {
        & corepack.cmd pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) {
            throw "pnpm install --frozen-lockfile failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}

Write-Host "AgentHub Product-loop observed E2E fixture gate" -ForegroundColor Magenta
Write-Host "RepoRoot: $RepoRoot" -ForegroundColor Magenta
Write-Host "ReportDir: $ReportDir" -ForegroundColor Magenta
Write-Host "Boundary: fixture/observed only; no real login, CLI/model/API, deploy, signing, notarization, or release upload." -ForegroundColor Magenta

Invoke-Checked "fixture chain manifest: Web -> Hub -> Desktop -> Edge -> fixture -> replay -> Web" {
    Invoke-NodeFixture
}

Invoke-Checked "Web Hub-only boundary" {
    & (Join-Path $RepoRoot "scripts\verify\verify-web-hub-boundary.ps1")
}

Invoke-Checked "Desktop/Tauri sidecar observed fixture readiness" {
    $sidecarScript = Join-Path $RepoRoot "scripts\smoke\verify-desktop-sidecar-observed-smoke.ps1"
    if ($SkipCargoTest -or $SkipFocusedTests) {
        & $sidecarScript -RepoRoot $RepoRoot -SkipCargoTest
    } else {
        & $sidecarScript -RepoRoot $RepoRoot
    }
}

Invoke-Checked "Local Edge adapter fixture dispatch/replay evidence" {
    & (Join-Path $RepoRoot "scripts\verify\verify-edge-cli-dispatch-evidence.ps1") -RepoRoot $RepoRoot -Mode Fixture
}

if (-not $SkipFocusedTests) {
    Invoke-Checked "Hub single-task task/replay/approval/artifact focused handler tests" {
        Invoke-GoFocused
    }

    Invoke-Checked "Web Hub replay/transcript/artifact focused tests" {
        Invoke-WebFocused
    }

    Invoke-Checked "Shared transcript approval/artifact render focused tests" {
        Invoke-SharedFocused
    }
} else {
    Write-Host "`nFocused tests skipped by -SkipFocusedTests; source and fixture gates still ran." -ForegroundColor Yellow
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -ne 0) {
    exit 1
}

Write-Host "Status: PRODUCT_LOOP_FIXTURE_OBSERVED_E2E_VERIFIED" -ForegroundColor Green
Write-Host "real_tested=false" -ForegroundColor Yellow
