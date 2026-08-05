#!/usr/bin/env pwsh
<#
Negative self-tests for verify-action-runtimes.py (#1580, ps1 迁移).

Cases:
1. positive: fixture workflow using only node24 allow-listed actions -> 0
2. re-introduce a Node-20-era major (actions/checkout@v4) -> 1
3. unregistered third-party action (potential silent Node-20) -> 1
4. unversioned action reference -> 1
#>

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$VerifierRelative = "scripts/verify/verify-action-runtimes.py"
$Passed = 0

function Fail([string]$Message) {
    throw "action-runtimes self-test failed: $Message"
}

function Pass([string]$Message) {
    $script:Passed++
    Write-Host "  PASS  $Message" -ForegroundColor Green
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
    [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
}

function New-Fixture([string]$WorkflowContent) {
    $fixture = Join-Path ([IO.Path]::GetTempPath()) ("agenthub-actions-runtime-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path (Join-Path $fixture ".github/workflows") | Out-Null
    Copy-RepoFile $fixture $VerifierRelative
    Write-Utf8NoBom (Join-Path $fixture ".github/workflows/fixture.yml") $WorkflowContent
    return $fixture
}

function Copy-RepoFile([string]$FixtureRoot, [string]$RelativePath) {
    $source = Join-Path $RepoRoot $RelativePath
    $destination = Join-Path $FixtureRoot $RelativePath
    $parent = Split-Path -Parent $destination
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination
}

function Invoke-FixtureVerifier([string]$FixtureRoot) {
    $output = & python (Join-Path $FixtureRoot $VerifierRelative) --WorkflowsRoot (Join-Path $FixtureRoot ".github/workflows") 2>&1
    return [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Output = ($output -join "`n")
    }
}

$positiveWorkflow = @"
name: fixture
on:
  push:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 20
          cache: pnpm
          cache-dependency-path: app/pnpm-lock.yaml
      - uses: actions/setup-go@v7
        with:
          go-version: "1.25"
      - uses: actions/upload-artifact@v7
        with:
          name: out
          path: dist/
      - uses: actions/download-artifact@v8
        with:
          name: out
          path: dist
      - uses: dorny/paths-filter@v4
        with:
          filters: |
            app:
              - 'app/**'
      - uses: pnpm/action-setup@v6
        with:
          version: 10
      - uses: golangci/golangci-lint-action@v9
      - uses: docker/build-push-action@v7
      - uses: docker/login-action@v4
      - uses: docker/metadata-action@v6
      - uses: docker/setup-buildx-action@v4
      - uses: softprops/action-gh-release@v3
      - uses: dtolnay/rust-toolchain@stable
"@

# ── Positive case ──────────────────────────────────────────────────────────
$fixture = New-Fixture $positiveWorkflow
try {
    $result = Invoke-FixtureVerifier $fixture
    if ($result.ExitCode -ne 0) {
        Fail "positive fixture unexpectedly failed:`n$($result.Output)"
    }
    Pass "positive fixture (all node24 allow-listed actions)"
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}

# ── Negative 1: Node-20-era major re-introduced ────────────────────────────
$fixture = New-Fixture @"
name: fixture
on:
  push:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
"@
try {
    $result = Invoke-FixtureVerifier $fixture
    if ($result.ExitCode -eq 0) {
        Fail "Node-20-era checkout@v4 must FAIL but verifier exited 0"
    }
    if ($result.Output -notmatch "actions/checkout@v4") {
        Fail "checkout@v4 failed for the wrong reason:`n$($result.Output)"
    }
    Pass "Node-20-era actions/checkout@v4 fails closed"
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}

# ── Negative 2: unregistered third-party action ────────────────────────────
$fixture = New-Fixture @"
name: fixture
on:
  push:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: some/unknown-action@v1
"@
try {
    $result = Invoke-FixtureVerifier $fixture
    if ($result.ExitCode -eq 0) {
        Fail "unregistered action must FAIL but verifier exited 0"
    }
    if ($result.Output -notmatch "some/unknown-action@v1") {
        Fail "unregistered action failed for the wrong reason:`n$($result.Output)"
    }
    Pass "unregistered third-party action fails closed"
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}

# ── Negative 3: unversioned action reference ───────────────────────────────
$fixture = New-Fixture @"
name: fixture
on:
  push:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout
"@
try {
    $result = Invoke-FixtureVerifier $fixture
    if ($result.ExitCode -eq 0) {
        Fail "unversioned action must FAIL but verifier exited 0"
    }
    if ($result.Output -notmatch "unversioned action reference") {
        Fail "unversioned action failed for the wrong reason:`n$($result.Output)"
    }
    Pass "unversioned action reference fails closed"
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Action runtime self-tests PASSED ($Passed cases)." -ForegroundColor Green
exit 0
