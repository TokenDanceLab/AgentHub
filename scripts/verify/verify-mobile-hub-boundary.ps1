#!/usr/bin/env pwsh
<#
Verify that the Mobile RN app stays Hub-only.

The Mobile client may use Hub REST/WS and Hub-issued sessions. It must not open
Local Edge event streams or invoke Edge run-control APIs directly; Desktop owns
the Local Edge bridge. Mobile declares localEdge: false in mobilePlatform.ts,
and this gate keeps that declaration honest plus blocks any Local Edge URL or
legacy Edge helper symbol from creeping back into app/mobile-rn/src.

Scope: app/mobile-rn/src only. scripts/, README, mock-hub, and docs copy live
outside src/ and are not scanned (matching the existing allow/exclude pattern
in verify-boundaries.mjs).
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$MobileSrc = Join-Path $RepoRoot "app/mobile-rn/src"

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

function Relative([string]$Path) {
    return [System.IO.Path]::GetRelativePath($RepoRoot, $Path).Replace("\", "/")
}

Write-Host "`n=== Mobile RN Hub-only boundary ===" -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath $MobileSrc)) {
    Fail "app/mobile-rn/src missing — cannot verify Mobile Hub-only boundary"
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Cyan
    exit 1
}

# Scan runtime source files (.ts/.tsx/.js/.jsx). scripts/, README, mock-hub and
# docs copy live outside src/ and are not in scope.
$BoundaryFiles = Get-ChildItem -LiteralPath $MobileSrc -Recurse -File |
    Where-Object { $_.Extension -in @(".ts", ".tsx", ".js", ".jsx") }

$ForbiddenPatterns = @(
    @{ Pattern = "127\.0\.0\.1:3210|localhost:3210"; Label = "Local Edge loopback URL" },
    @{ Pattern = "/v1/events|/v1/runs"; Label = "Local Edge event/run API" },
    @{ Pattern = "edgeAuth|createEventStream|edgeBaseUrl"; Label = "legacy Edge bridge helper or symbol" }
)

foreach ($entry in $ForbiddenPatterns) {
    $matches = $BoundaryFiles | Select-String -Pattern $entry.Pattern
    if ($matches) {
        foreach ($match in $matches) {
            Fail "$($entry.Label) found in $(Relative $match.Path):$($match.LineNumber)"
        }
    } else {
        Pass "$($entry.Label) absent from app/mobile-rn/src"
    }
}

$MobilePlatformPath = Join-Path $RepoRoot "app/mobile-rn/src/platform/mobilePlatform.ts"
if (-not (Test-Path -LiteralPath $MobilePlatformPath)) {
    Fail "app/mobile-rn/src/platform/mobilePlatform.ts missing"
} else {
    $mobilePlatform = Get-Content -Raw -LiteralPath $MobilePlatformPath
    if ($mobilePlatform.Contains("localEdge: false")) {
        Pass "app/mobile-rn/src/platform/mobilePlatform.ts declares localEdge: false"
    } else {
        Fail "app/mobile-rn/src/platform/mobilePlatform.ts must declare localEdge: false"
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -ne 0) {
    exit 1
}
