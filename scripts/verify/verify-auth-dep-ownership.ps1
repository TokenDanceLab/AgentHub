#!/usr/bin/env pwsh
<#
Auth dependency ownership verifier (#1551).

The auth middleware and JWT utilities must not carry package-level mutable
service dependencies (callback globals, shared verifier/config state) —
multiple Apps in one process (parallel tests, in-process servers) would
overwrite each other's security configuration. This verifier fails CI when
new package-level `var` declarations appear in middleware/jwtutil.

Scope: non-test .go files under hub-server/internal/middleware and
hub-server/internal/jwtutil. Allowlist covers the one remaining intentional
global (a pure atomic counter for rate-limit ZSET uniqueness, not a service
dependency); it shrinks, never grows.

Usage:
  pwsh scripts/verify/verify-auth-dep-ownership.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")

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

# Files allowed to hold package-level vars, with the reason.
$Allowlist = @(
    # rateLimitMemberID: pure atomic counter for ZSET member uniqueness —
    # not a service dependency (mutable service deps are forbidden).
    "hub-server/internal/middleware/rate_limit.go",
    # wsIPRL: WS rate-limit limiter instance with its own cleanup goroutine.
    # Not an auth security dependency — tracked for #1551 follow-up
    # (instance-own + lifecycle shutdown; currently out of the auth scope).
    "hub-server/internal/middleware/ws_rate_limit.go"
)

$Dirs = @(
    "hub-server/internal/middleware",
    "hub-server/internal/jwtutil"
)

$hits = @()
foreach ($dir in $Dirs) {
    $full = Join-Path $RepoRoot $dir
    if (-not (Test-Path -LiteralPath $full)) { continue }
    Get-ChildItem -LiteralPath $full -Filter "*.go" | Where-Object { $_.Name -notmatch "_test\.go$" } | ForEach-Object {
        $rel = ($_.FullName.Substring($RepoRoot.Path.Length + 1) -replace '\\', '/')
        if ($Allowlist -contains $rel) { return }
        $line = 0
        foreach ($l in (Get-Content -LiteralPath $_.FullName)) {
            $line++
            if ($l -match '^var\s+[A-Za-z_]') {
                $hits += "{0}:{1}: {2}" -f $rel, $line, $l.Trim()
            }
        }
    }
}

if ($hits.Count -eq 0) {
    Pass "no package-level vars in middleware/jwtutil (auth deps are instance-owned)"
} else {
    foreach ($h in $hits) {
        Fail "package-level var found: $h"
    }
    Write-Host "  #1551: auth security dependencies must be instance-owned (AuthDependencies /" -ForegroundColor Yellow
    Write-Host "        TokenDanceVerifier constructed in the composition root)." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "Auth dependency ownership: $Passed pass" -ForegroundColor Green
