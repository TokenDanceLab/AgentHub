#!/usr/bin/env pwsh
<#
Negative self-tests for verify-orchestrator-deps.ps1 (#1566).

Each case runs against an isolated minimal Go module fixture that mimics the
edge-server layout. A negative case passes only when the verifier exits
non-zero for the expected policy reason. Cases:

1. positive: intact direction (leaf without root import) -> 0
2. fixture: leaf package imports root internal/adapters -> 1
3. fixture: internal/orchestration imports internal/adapters -> 1
#>

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$VerifierRelative = "scripts/verify/verify-orchestrator-deps.ps1"
$Passed = 0

function Fail([string]$Message) {
    throw "orchestrator-deps self-test failed: $Message"
}

function Pass([string]$Message) {
    $script:Passed++
    Write-Host "  PASS  $Message" -ForegroundColor Green
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
    [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
}

function Copy-RepoFile([string]$FixtureRoot, [string]$RelativePath) {
    $source = Join-Path $RepoRoot $RelativePath
    $destination = Join-Path $FixtureRoot $RelativePath
    $parent = Split-Path -Parent $destination
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination
}

function New-Fixture {
    $fixture = Join-Path ([IO.Path]::GetTempPath()) ("agenthub-orch-deps-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $fixture | Out-Null

    # Minimal self-contained module mirroring edge-server layout. The fixture
    # only needs stdlib imports so go list works offline with no go.sum.
    Write-Utf8NoBom (Join-Path $fixture "go.mod") @"
module github.com/agenthub/edge-server

go 1.25.0
"@
    New-Item -ItemType Directory -Force -Path (Join-Path $fixture "edge-server") | Out-Null
    Copy-RepoFile $fixture $VerifierRelative
    return $fixture
}

function Invoke-FixtureVerifier([string]$FixtureRoot) {
    $output = & pwsh -NoProfile -File (Join-Path $FixtureRoot $VerifierRelative) -EdgeServerRoot $FixtureRoot 2>&1
    return [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Output = ($output -join "`n")
    }
}

# ── Positive case: intact one-way direction ───────────────────────────────
$fixture = New-Fixture
try {
    New-Item -ItemType Directory -Force -Path (Join-Path $fixture "internal/orchestration") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $fixture "internal/adapters") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $fixture "internal/adapters/orchestrator") | Out-Null
    Write-Utf8NoBom (Join-Path $fixture "internal/adapters/root.go") @"
package adapters
"@
    Write-Utf8NoBom (Join-Path $fixture "internal/orchestration/contract.go") @"
package orchestration
"@
    Write-Utf8NoBom (Join-Path $fixture "internal/adapters/orchestrator/leaf.go") @"
package orchestrator

import (
	"github.com/agenthub/edge-server/internal/orchestration"
)

var _ = orchestration.TaskStatus("pending")
"@
    $result = Invoke-FixtureVerifier $fixture
    if ($result.ExitCode -ne 0) {
        Fail "positive fixture unexpectedly failed:`n$($result.Output)"
    }
    Pass "positive fixture (one-way direction holds)"
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}

# ── Negative 1: leaf imports root adapters ──────────────────────────────────
$fixture = New-Fixture
try {
    New-Item -ItemType Directory -Force -Path (Join-Path $fixture "internal/orchestration") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $fixture "internal/adapters/orchestrator") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $fixture "internal/adapters") | Out-Null
    Write-Utf8NoBom (Join-Path $fixture "internal/orchestration/contract.go") @"
package orchestration
"@
    Write-Utf8NoBom (Join-Path $fixture "internal/adapters/root.go") @"
package adapters
"@
    Write-Utf8NoBom (Join-Path $fixture "internal/adapters/orchestrator/leaf.go") @"
package orchestrator

import (
	_ "github.com/agenthub/edge-server/internal/adapters"
)
"@
    $result = Invoke-FixtureVerifier $fixture
    if ($result.ExitCode -eq 0) {
        Fail "leaf importing root adapters must FAIL but verifier exited 0"
    }
    if ($result.Output -notmatch "imports root implementation package") {
        Fail "leaf-imports-root failed for the wrong reason:`n$($result.Output)"
    }
    Pass "leaf imports root adapters fails closed"
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}

# ── Negative 2: orchestration imports adapters ──────────────────────────────
$fixture = New-Fixture
try {
    New-Item -ItemType Directory -Force -Path (Join-Path $fixture "internal/orchestration") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $fixture "internal/adapters") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $fixture "internal/adapters/orchestrator") | Out-Null
    Write-Utf8NoBom (Join-Path $fixture "internal/adapters/root.go") @"
package adapters
"@
    Write-Utf8NoBom (Join-Path $fixture "internal/adapters/orchestrator/leaf.go") @"
package orchestrator
"@
    Write-Utf8NoBom (Join-Path $fixture "internal/orchestration/contract.go") @"
package orchestration

import (
	_ "github.com/agenthub/edge-server/internal/adapters"
)
"@
    $result = Invoke-FixtureVerifier $fixture
    if ($result.ExitCode -eq 0) {
        Fail "orchestration importing adapters must FAIL but verifier exited 0"
    }
    if ($result.Output -notmatch "imports adapters") {
        Fail "orchestration-imports-adapters failed for the wrong reason:`n$($result.Output)"
    }
    Pass "orchestration imports adapters fails closed"
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Orchestrator deps self-tests PASSED ($Passed cases)." -ForegroundColor Green
exit 0
