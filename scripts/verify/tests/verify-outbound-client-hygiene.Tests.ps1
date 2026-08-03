#!/usr/bin/env pwsh
<#
Negative self-tests for verify-outbound-client-hygiene.ps1 (#1549 + #1564).

Cases:
1. positive: clean fixture (body-limited read, no env, no clients) -> 0
2. bare &http.Client{ in scope -> 1
3. service-layer os.Getenv (request-path env read) -> 1
4. anonymous allowlist entry (no issue) -> 1
5. unbounded io.ReadAll(resp.Body) (no body limit) -> 1
6. unbudgeted retry loop in an HTTP-carrying file -> 1
7. allowlisted bare client with issue + reason -> 0 (format is the gate)
#>

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$VerifierRelative = "scripts/verify/verify-outbound-client-hygiene.ps1"
$Passed = 0

function Fail([string]$Message) {
    throw "outbound-client-hygiene self-test failed: $Message"
}

function Pass([string]$Message) {
    $script:Passed++
    Write-Host "  PASS  $Message" -ForegroundColor Green
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
    [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
}

function New-Fixture([string]$GoFile, [string]$GoContent) {
    $fixture = Join-Path ([IO.Path]::GetTempPath()) ("agenthub-outbound-hygiene-" + [guid]::NewGuid().ToString("N"))
    $dir = Join-Path $fixture "hub-server/internal/service"
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Copy-RepoFile $fixture $VerifierRelative
    Write-Utf8NoBom (Join-Path $dir $GoFile) $GoContent
    return $fixture
}

function Copy-RepoFile([string]$FixtureRoot, [string]$RelativePath) {
    $source = Join-Path $RepoRoot $RelativePath
    $destination = Join-Path $FixtureRoot $RelativePath
    $parent = Split-Path -Parent $destination
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination
}

function Invoke-FixtureVerifier([string]$FixtureRoot, [string[]]$Allowlist) {
    # Fixtures are isolated: never evaluate the repo-residual default
    # allowlist; pass entries explicitly when a case needs them.
    $args = @(
        "-Scopes", "hub-server/internal/service"
        "-NoDefaultAllowlist"
    )
    if ($null -ne $Allowlist -and $Allowlist.Count -gt 0) {
        $args += "-ClientAllowlist"
        $args += $Allowlist
    }
    $output = & pwsh -NoProfile -File (Join-Path $FixtureRoot $VerifierRelative) @args 2>&1
    return [pscustomobject]@{
        ExitCode = $LASTEXITCODE
        Output = ($output -join "`n")
    }
}

$cleanGo = @"
package service

import "io"

// fixture: the only sanctioned unbounded-read form is a body-limited read.
var _ = io.ReadAll(io.LimitReader(nil, 1024))
"@

# ── Positive case ──────────────────────────────────────────────────────────
$fixture = New-Fixture "clean_fixture.go" $cleanGo
try {
    $result = Invoke-FixtureVerifier $fixture
    if ($result.ExitCode -ne 0) {
        Fail "positive fixture unexpectedly failed:`n$($result.Output)"
    }
    Pass "positive fixture (clean service file)"
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}

# ── Negative 1: bare http.Client ────────────────────────────────────────────
$fixture = New-Fixture "bare_client_fixture.go" @"
package service

import "net/http"

var c = &http.Client{Timeout: 1}
"@
try {
    $result = Invoke-FixtureVerifier $fixture
    if ($result.ExitCode -eq 0) {
        Fail "bare &http.Client{ must FAIL but verifier exited 0"
    }
    if ($result.Output -notmatch "bare &http\.Client") {
        Fail "bare client failed for the wrong reason:`n$($result.Output)"
    }
    Pass "bare &http.Client{ fails closed"
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}

# ── Negative 2: request-path env read in the service layer ─────────────────
$fixture = New-Fixture "env_fixture.go" @"
package service

import "os"

var url = os.Getenv("AGENTHUB_EDGE_URL")
"@
try {
    $result = Invoke-FixtureVerifier $fixture
    if ($result.ExitCode -eq 0) {
        Fail "service-layer os.Getenv must FAIL but verifier exited 0"
    }
    if ($result.Output -notmatch "os\.Getenv") {
        Fail "os.Getenv failed for the wrong reason:`n$($result.Output)"
    }
    Pass "service-layer os.Getenv fails closed"
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}

# ── Negative 3: anonymous allowlist entry (no issue) ────────────────────────
$fixture = New-Fixture "allowlisted_bare_fixture.go" @"
package service

import "net/http"

var c = &http.Client{Timeout: 1}
"@
try {
    $result = Invoke-FixtureVerifier $fixture @("hub-server/internal/service/allowlisted_bare_fixture.go|no-issue|bare client exception")
    if ($result.ExitCode -eq 0) {
        Fail "anonymous allowlist entry must FAIL but verifier exited 0"
    }
    if ($result.Output -notmatch "anonymous allowlist") {
        Fail "anonymous allowlist failed for the wrong reason:`n$($result.Output)"
    }
    Pass "anonymous allowlist entry fails closed"
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}

# ── Negative 4: unbounded response read (no body limit) ─────────────────────
$fixture = New-Fixture "nobodylimit_fixture.go" @"
package service

import "io"

func readAll(respBody interface{ Close() (int64, error) }) {
    _ = io.ReadAll(respBody)
}
"@
try {
    $result = Invoke-FixtureVerifier $fixture
    if ($result.ExitCode -eq 0) {
        Fail "unbounded io.ReadAll must FAIL but verifier exited 0"
    }
    if ($result.Output -notmatch "unbounded response read") {
        Fail "unbounded read failed for the wrong reason:`n$($result.Output)"
    }
    Pass "unbounded external response read fails closed"
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}

# ── Negative 5: unbudgeted retry loop in an HTTP-carrying file ──────────────
$fixture = New-Fixture "unbudgeted_retry_fixture.go" @"
package service

import "net/http"

func post() error {
    client := &http.Client{Timeout: 1}
    for attempt := 0; attempt < 3; attempt++ {
        _, err := client.Do(nil)
        if err == nil {
            return nil
        }
    }
    return nil
}
"@
try {
    $result = Invoke-FixtureVerifier $fixture
    if ($result.ExitCode -eq 0) {
        Fail "unbudgeted retry loop must FAIL but verifier exited 0"
    }
    if ($result.Output -notmatch "retry loop without a retry budget") {
        Fail "unbudgeted retry failed for the wrong reason:`n$($result.Output)"
    }
    Pass "unbudgeted retry loop fails closed"
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}

# ── Positive 2: allowlisted bare client with issue + reason ─────────────────
$fixture = New-Fixture "allowlisted_bare_fixture.go" @"
package service

import "net/http"

var c = &http.Client{Timeout: 1}
"@
try {
    $result = Invoke-FixtureVerifier $fixture @("hub-server/internal/service/allowlisted_bare_fixture.go|#1564|fixture: tracked exception")
    if ($result.ExitCode -ne 0) {
        Fail "allowlisted entry with issue + reason unexpectedly failed:`n$($result.Output)"
    }
    Pass "allowlisted client with issue + reason passes"
} finally {
    Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Outbound client hygiene self-tests PASSED ($Passed cases)." -ForegroundColor Green
exit 0
