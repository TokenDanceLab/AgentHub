#!/usr/bin/env pwsh
<#
AgentHub P0 remote-control auth/topology prerequisite gate.

This gate verifies the auth/topology prerequisite for the 48h remote-control
chain: Web has a Hub-issued session, and Hub can address a registered
Desktop/Edge target. It reads source and docs only. It does not connect to
live Hub, TokenDance ID, browsers, secrets, Local Edge, or Agent runtimes.
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = "."
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath

$Passed = 0
$Failed = 0

function Step([string]$Text) {
    Write-Host "`n=== $Text ===" -ForegroundColor Cyan
}

function Pass([string]$Text) {
    $script:Passed++
    Write-Host "  PASS  $Text" -ForegroundColor Green
}

function Fail([string]$Text) {
    $script:Failed++
    Write-Host "  FAIL  $Text" -ForegroundColor Red
}

function Read-RepoFile([string]$RelativePath) {
    $path = Join-Path $RepoRoot $RelativePath
    if (-not (Test-Path -LiteralPath $path)) {
        Fail "missing $RelativePath"
        return ""
    }

    return Get-Content -LiteralPath $path -Raw -Encoding UTF8
}

function Assert-Contains([string]$RelativePath, [string]$Pattern, [string]$Label) {
    $content = Read-RepoFile $RelativePath
    if ($content -match $Pattern) {
        Pass $Label
    } else {
        Fail "$Label ($RelativePath missing pattern: $Pattern)"
    }
}

function Assert-NotContains([string]$RelativePath, [string]$Pattern, [string]$Label) {
    $content = Read-RepoFile $RelativePath
    if ($content -notmatch $Pattern) {
        Pass $Label
    } else {
        Fail "$Label ($RelativePath contains pattern: $Pattern)"
    }
}

Write-Host "AgentHub P0 remote-control auth/topology prerequisite gate" -ForegroundColor Magenta
Write-Host "No live Hub, TokenDance ID, browser, secret, Local Edge, or CLI/model calls were made." -ForegroundColor Magenta

Step "Web authenticated Hub session to Desktop/Edge target"
Assert-Contains "app\web\src\hooks\useWebAuth.ts" "tryAutoLogin\(\)" "Web has an existing auth auto-login/callback hook available for Hub session bootstrap"
Assert-Contains "app\web\src\api\hubAuth.test.ts" "uses Hub-issued OIDC session to address a registered Desktop Edge target" "agenthub-web focused auth fixture covers Hub session to registered Desktop Edge target"
Assert-Contains "app\web\src\api\hubAuth.test.ts" "web/execution-targets.pageSize=50" "Web fixture reads Hub execution targets after auth"
Assert-Contains "app\web\src\api\hubAuth.test.ts" "Authorization: 'Bearer web-fixture-access-token'" "Web fixture uses Hub-issued Bearer token for target inventory"
Assert-Contains "app\web\src\api\hubAuth.test.ts" "Packaged Desktop Edge" "Web fixture addresses a registered packaged Desktop Edge target"
Assert-Contains "app\web\src\api\hubAuth.test.ts" "device_type:\s*'web'" "Web callback fixture uses web device type"
Assert-Contains "app\web\src\api\hubAuth.test.ts" "agenthub_hub_token" "Web callback fixture asserts Hub access-token storage"
Assert-Contains "app\web\src\api\hubAuth.test.ts" "agenthub_hub_refresh_token" "Web callback fixture asserts Hub refresh-token storage"
Assert-Contains "app\web\src\api\hubAuth.test.ts" "agenthub_token_source" "Web callback fixture asserts TokenDance token source hint"
Assert-Contains "app\web\src\api\hubAuth.test.ts" "localEdgeLoopback" "Web callback fixture asserts forbidden Local Edge loopback without embedding the forbidden URL"
Assert-Contains "app\web\src\api\hubAuth.test.ts" "edgeRunApi" "Web callback fixture asserts forbidden Local Edge run API without embedding the forbidden path"
Assert-Contains "scripts\verify-web-hub-boundary.ps1" "Local Edge loopback URL" "Web boundary gate owns direct Local Edge URL scanning"
Assert-NotContains "app\web\src\api\hubAuth.test.ts" "id\.vectorcontrol\.tech.*fetch|window\.open\(" "Web focused fixture does not open real TokenDance ID"

Step "Desktop packaged host and fake login boundary"
Assert-Contains "app\desktop\src\api\hubAuth.test.ts" "Desktop browser-dev OIDC fixture boundary" "agenthub-desktop focused auth fixture exists"
Assert-Contains "app\desktop\src\api\hubAuth.test.ts" "device_type:\s*'desktop'" "Desktop callback fixture uses desktop device type"
Assert-Contains "app\desktop\src\api\hubAuth.test.ts" "agenthub_hub_token" "Desktop callback fixture asserts Hub access-token storage"
Assert-Contains "app\desktop\src\api\hubAuth.test.ts" "agenthub_hub_refresh_token" "Desktop callback fixture checks refresh-token localStorage boundary"
Assert-Contains "app\desktop\src\api\hubAuth.test.ts" "not\.toMatch" "Desktop callback fixture asserts forbidden request URLs"
Assert-Contains "app\desktop\src\api\hubAuth.test.ts" "localhost:3210" "Desktop callback fixture names Local Edge loopback as forbidden"
Assert-Contains "app\desktop\src\api\hubAuth.test.ts" "spawn\|Command" "Desktop callback fixture names CLI bypass patterns as forbidden"
Assert-NotContains "app\desktop\src\api\hubAuth.test.ts" "id\.vectorcontrol\.tech.*fetch" "Desktop focused fixture does not fetch real TokenDance ID"
Assert-Contains "app\desktop\src\platform\desktopPlatform.test.ts" "<app-data>/agenthub-edge\.sqlite" "Desktop packaged host readiness keeps Local Edge SQLite app-data path"
Assert-Contains "app\desktop\src\platform\desktopPlatform.test.ts" "--store-backend" "Desktop packaged host readiness passes explicit store backend"
Assert-Contains "app\desktop\src\platform\desktopPlatform.test.ts" "direct_cli_spawn:\s*false" "Desktop packaged host readiness does not grant UI CLI spawn inputs"

Step "Existing local/dry gates"
Assert-Contains "scripts\verify-oidc-flow.ps1" '\[switch\]\$LocalOnly' "OIDC flow verifier exposes -LocalOnly"
Assert-Contains "scripts\verify-oidc-flow.ps1" '\$SkipHub\s*=\s*\$true' "-LocalOnly skips live Hub"
Assert-Contains "scripts\verify-oidc-flow.ps1" '\$SkipTD\s*=\s*\$true' "-LocalOnly skips live TokenDance ID"
Assert-Contains "scripts\verify-packaged-login-real-readiness.ps1" "No live Hub, TokenDance ID, browser, secret, or CLI/model calls were made" "packaged real-readiness gate is dry"
Assert-Contains "scripts\verify-web-hub-boundary.ps1" "Web Hub-only boundary" "Web Hub-only boundary gate exists"
Assert-Contains "scripts\verify-tauri-package-readiness.ps1" "macOS unsigned dry policy boundary" "macOS unsigned dry policy gate remains present"
Assert-Contains "edge-server\internal\adapters\sdk_fixture_mapper_test.go" "TestSDKFixtureMapperClaudeGolden" "SDK fixture mapper Claude golden evidence remains fixture-only"
Assert-Contains "edge-server\internal\adapters\sdk_fixture_mapper_test.go" "TestSDKFixtureMapperOpenAIGolden" "SDK fixture mapper OpenAI golden evidence remains fixture-only"

Step "Topology docs"
Assert-Contains "docs\roadmap.md" "Web -> Hub -> registered Desktop/Edge -> Local Edge -> CLI/SDK adapter" "roadmap records P0 remote-control auth/topology prerequisite"
Assert-Contains "docs\backend-integration-governance.md" "Login fixture topology gate" "governance records login fixture topology gate"
Assert-Contains "docs\backend-integration-governance.md" "Desktop receives Hub dispatch -> Local Edge starts CLI adapter" "governance keeps dispatch/CLI start outside this login slice"
Assert-Contains "docs\backend-integration-governance.md" "future real TokenDanceID/OIDC login remains approval-gated" "governance keeps real TokenDanceID/OIDC approval gate"

Step "Focused verification commands"
Write-Host "  agenthub-web: pnpm test -- src/api/hubAuth.test.ts" -ForegroundColor White
Write-Host "  agenthub-web: pnpm typecheck" -ForegroundColor White
Write-Host "  agenthub-desktop: pnpm test -- src/api/hubAuth.test.ts" -ForegroundColor White
Write-Host "  agenthub-desktop: pnpm test -- src/platform/desktopPlatform.test.ts" -ForegroundColor White
Write-Host "  local OIDC: pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-oidc-flow.ps1 -LocalOnly" -ForegroundColor White
Write-Host "  packaged dry: pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-packaged-login-real-readiness.ps1 -RepoRoot ." -ForegroundColor White
Write-Host "  Web boundary: pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-web-hub-boundary.ps1" -ForegroundColor White
Write-Host "  Tauri package readiness: pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-tauri-package-readiness.ps1 -RepoRoot ." -ForegroundColor White

Step "Evidence boundaries"
Write-Host "  Mock-only: fake OIDC callback, Hub-issued fixture tokens, and Hub execution-target inventory fixture" -ForegroundColor Yellow
Write-Host "  Real-mode ready: source gates for Web Hub-only boundary, Desktop packaged Local Edge SQLite path, packaged OIDC readiness, SDK fixture mapper, and macOS dry policy" -ForegroundColor Yellow
Write-Host "  future real TokenDanceID/OIDC login remains approval-gated" -ForegroundColor Yellow
Write-Host "  real Desktop dispatch -> Local Edge CLI adapter start remains outside this login/topology slice" -ForegroundColor Yellow

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -eq 0) {
    Write-Host "`nP0 remote-control auth/topology prerequisite gate passed. Real TokenDanceID/OIDC and real CLI/model execution remain blocked on explicit approval.`n" -ForegroundColor Green
} else {
    Write-Host "`nP0 remote-control auth/topology prerequisite gate failed. Keep real TokenDanceID/OIDC and real CLI/model execution blocked until fixture gaps are fixed.`n" -ForegroundColor Red
}

exit $(if ($Failed -gt 0) { 1 } else { 0 })
