#!/usr/bin/env pwsh
<#
Verify the A-V1 orchestrator dependency direction (#1566).

Target direction (machine gate):

    internal/orchestration            # neutral contracts (SSOT)
        ↑
    internal/adapters/orchestrator    # leaf implementation, contracts + narrow ports only
        ↑
    composition root / registry       # injects concrete deps

Assertions:
  1. The leaf package (internal/adapters/orchestrator) must NOT import the
     root implementation package `github.com/agenthub/edge-server/internal/adapters`.
  2. internal/orchestration must NOT import any `internal/adapters` package.
  3. The root `internal/adapters` package must NOT import the leaf
     (no root -> leaf coupling; the seam is one-way).

Usage:
  pwsh scripts/verify/verify-orchestrator-deps.ps1            # check real repo
  pwsh scripts/verify/verify-orchestrator-deps.ps1 -EdgeServerRoot <dir>  # fixture
#>

[CmdletBinding()]
param(
    [string]$EdgeServerRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\edge-server"))
)

$ErrorActionPreference = "Stop"

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

function Get-GoListDeps([string]$Pattern) {
    # Run with GOWORK=off and inside the target root (-C) so the target's own
    # go.mod (real repo or fixture) governs; the repo-root go.work and the
    # caller's cwd must not leak into the check.
    $oldGowork = $env:GOWORK
    $env:GOWORK = "off"
    try {
        $output = & go -C $EdgeServerRoot list -deps $Pattern 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "go list -deps $Pattern failed:`n$($output -join "`n")"
        }
        return $output
    } finally {
        if ($null -eq $oldGowork) { Remove-Item Env:GOWORK -ErrorAction SilentlyContinue } else { $env:GOWORK = $oldGowork }
    }
}

if (-not (Test-Path -LiteralPath (Join-Path $EdgeServerRoot "go.mod"))) {
    Fail "edge-server root missing go.mod: $EdgeServerRoot"
    exit 1
}

Write-Host "`n=== Orchestrator dependency direction (A-V1 Step 2, #1566) ===" -ForegroundColor Cyan
Write-Host "Edge server root: $EdgeServerRoot"

$leafPattern = "./internal/adapters/orchestrator/..."
$rootPkg = "github.com/agenthub/edge-server/internal/adapters"
$orchestrationPattern = "./internal/orchestration/"

# ── Assertion 1: leaf must not import root implementation package ───────────
$leafDeps = Get-GoListDeps $leafPattern
$leafViolations = @($leafDeps | Where-Object { $_ -eq $rootPkg })
if ($leafViolations.Count -gt 0) {
    Fail "leaf internal/adapters/orchestrator imports root implementation package: $($leafViolations -join ', ')"
} else {
    Pass "leaf package does not import root internal/adapters (go list -deps clean)"
}

# ── Assertion 2: orchestration must not import adapters at all ──────────────
$orchDeps = Get-GoListDeps $orchestrationPattern
$orchViolations = @($orchDeps | Where-Object { $_ -like "*internal/adapters*" })
if ($orchViolations.Count -gt 0) {
    Fail "neutral contract package internal/orchestration imports adapters: $($orchViolations -join ', ')"
} else {
    Pass "internal/orchestration has no adapters dependency"
}

# ── Assertion 3: root adapters must not import the leaf (one-way seam) ──────
$rootDeps = Get-GoListDeps "./internal/adapters"
$rootViolations = @($rootDeps | Where-Object { $_ -like "*internal/adapters/orchestrator*" })
if ($rootViolations.Count -gt 0) {
    Fail "root internal/adapters imports the orchestrator leaf: $($rootViolations -join ', ')"
} else {
    Pass "root adapters does not import the orchestrator leaf"
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -ne 0) {
    exit 1
}
