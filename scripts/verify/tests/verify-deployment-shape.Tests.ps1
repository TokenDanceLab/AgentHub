#!/usr/bin/env pwsh
<#
Negative self-tests for verify-deployment-shape.py (#1527 PR1, inventory
closed in PR2; ps1 迁移).

Each case runs against an isolated minimal repository fixture. A negative
case passes only when the verifier exits non-zero for the expected policy
reason. Cases:

1. positive: intact authoritative template + empty legacy dir -> 0
2. second hand-maintained production compose under deployments/production/ -> 1
3. any compose file under hub-server/deployments/ (legacy resurrection) -> 1
4. authoritative template missing required service -> 1
5. hub-server image off product SSOT -> 1
#>

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$VerifierRelative = "scripts/verify/verify-deployment-shape.py"
$Passed = 0

function Fail([string]$Message) {
    throw "deployment-shape self-test failed: $Message"
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
    $fixture = Join-Path ([IO.Path]::GetTempPath()) ("agenthub-deploy-shape-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $fixture | Out-Null

    Copy-RepoFile $fixture "deployments/production/docker-compose.yml"
    Copy-RepoFile $fixture $VerifierRelative
    return $fixture
}

function Invoke-FixtureVerifier([string]$FixtureRoot) {
    $output = & python (Join-Path $FixtureRoot $VerifierRelative) --RepoRootPath $FixtureRoot 2>&1
    return [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Output = ($output -join "`n")
    }
}

# ── Positive case ──────────────────────────────────────────────────────────
$fixture = New-Fixture
try {
    $result = Invoke-FixtureVerifier $fixture
    if ($result.ExitCode -ne 0) {
        Fail "positive fixture unexpectedly failed:`n$($result.Output)"
    }
    Pass "positive fixture (authoritative + empty legacy dir)"
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}

# ── Negative 1: second hand-maintained production compose ──────────────────
$fixture = New-Fixture
try {
    Write-Utf8NoBom (Join-Path $fixture "deployments/production/docker-compose.us2.yml") @"
services:
  hub-server:
    image: ghcr.io/tokendancelab/agenthub-hub-server:latest
  redis:
    image: redis:7-alpine
"@
    $result = Invoke-FixtureVerifier $fixture
    if ($result.ExitCode -eq 0) {
        Fail "second production compose must FAIL but verifier exited 0"
    }
    if ($result.Output -notmatch "second hand-maintained production compose") {
        Fail "second production compose failed for the wrong reason:`n$($result.Output)"
    }
    Pass "second hand-maintained production compose fails closed"
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}

# ── Negative 2: compose resurrected under legacy build-input dir ───────────
$fixture = New-Fixture
try {
    New-Item -ItemType Directory -Force -Path (Join-Path $fixture "hub-server/deployments") | Out-Null
    Write-Utf8NoBom (Join-Path $fixture "hub-server/deployments/docker-compose.eu1.yml") @"
services:
  hub-server:
    image: ghcr.io/tokendancelab/agenthub-hub-server:latest
"@
    $result = Invoke-FixtureVerifier $fixture
    if ($result.ExitCode -eq 0) {
        Fail "legacy compose resurrection must FAIL but verifier exited 0"
    }
    if ($result.Output -notmatch "legacy compose inventory closed") {
        Fail "legacy compose resurrection failed for the wrong reason:`n$($result.Output)"
    }
    Pass "compose under hub-server/deployments/ fails closed"
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}

# ── Negative 3: authoritative template missing required service ────────────
$fixture = New-Fixture
try {
    Write-Utf8NoBom (Join-Path $fixture "deployments/production/docker-compose.yml") @"
services:
  hub-server:
    image: ghcr.io/tokendancelab/agenthub-hub-server:latest
"@
    $result = Invoke-FixtureVerifier $fixture
    if ($result.ExitCode -eq 0) {
        Fail "missing redis service must FAIL but verifier exited 0"
    }
    if ($result.Output -notmatch "missing service 'redis'") {
        Fail "missing redis service failed for the wrong reason:`n$($result.Output)"
    }
    Pass "authoritative template missing required service fails"
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}

# ── Negative 4: hub-server image off product SSOT ──────────────────────────
$fixture = New-Fixture
try {
    Write-Utf8NoBom (Join-Path $fixture "deployments/production/docker-compose.yml") @"
services:
  hub-server:
    image: ghcr.io/example/agenthub-hub:latest
  redis:
    image: redis:7-alpine
"@
    $result = Invoke-FixtureVerifier $fixture
    if ($result.ExitCode -eq 0) {
        Fail "off-SSOT image must FAIL but verifier exited 0"
    }
    if ($result.Output -notmatch "off SSOT") {
        Fail "off-SSOT image failed for the wrong reason:`n$($result.Output)"
    }
    Pass "hub-server image off product SSOT fails"
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Deployment shape self-tests PASSED ($Passed cases)." -ForegroundColor Green
exit 0
