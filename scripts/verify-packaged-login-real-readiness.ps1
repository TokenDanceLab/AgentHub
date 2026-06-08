#!/usr/bin/env pwsh
<#
AgentHub packaged real login E2E readiness proposal gate.

This is a dry repository verifier for the next safe step toward real packaged
TokenDance ID login integration. It reads source and docs only. It does not
connect to Hub, TokenDance ID, production, local services, browsers, secrets,
or Agent runtimes.
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

function Warn([string]$Text) {
    Write-Host "  WARN  $Text" -ForegroundColor Yellow
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

Write-Host "AgentHub packaged real login E2E readiness proposal gate" -ForegroundColor Magenta
Write-Host "No live Hub, TokenDance ID, browser, secret, or CLI/model calls were made." -ForegroundColor Magenta

Step "fake/local gate"
Assert-Contains "scripts\verify-oidc-flow.ps1" '\[switch\]\$LocalOnly' "OIDC flow verifier exposes -LocalOnly"
Assert-Contains "scripts\verify-oidc-flow.ps1" '\$SkipHub\s*=\s*\$true' "-LocalOnly skips live Hub"
Assert-Contains "scripts\verify-oidc-flow.ps1" '\$SkipTD\s*=\s*\$true' "-LocalOnly skips live TokenDance ID"
Assert-Contains "scripts\verify-oidc-flow.ps1" "Test-PackagedDesktopReadiness" "-LocalOnly includes packaged Desktop static readiness"
Assert-Contains "tests\scripts\verify-oidc-flow.ps1" "local-only mode skips live TokenDance ID phase" "script tests assert TokenDance ID phase is skipped"
Assert-Contains "tests\scripts\verify-oidc-flow.ps1" "local-only mode skips live Hub phase" "script tests assert Hub phase is skipped"

Step "packaged readiness gate"
Assert-Contains "app\desktop\src-tauri\src\oidc_server.rs" 'TcpListener::bind\("127\.0\.0\.1:0"\)' "Desktop callback server binds random loopback port"
Assert-Contains "app\desktop\src-tauri\src\oidc_server.rs" 'http://127\.0\.0\.1:\{port\}/callback' "Desktop readiness reports loopback callback redirect URI"
Assert-Contains "app\desktop\src-tauri\src\secure_store.rs" "check_credential_store_readiness" "Desktop credential-store readiness function exists"
Assert-Contains "app\desktop\src-tauri\src\secure_store.rs" "Entry::new\(SERVICE, HUB_REFRESH_TOKEN_USER\)" "Desktop readiness probes Hub refresh-token credential entry"
Assert-Contains "app\desktop\src-tauri\src\commands.rs" "get_packaged_login_readiness" "Tauri command exposes packaged login readiness"
Assert-Contains "app\desktop\src-tauri\src\commands.rs" 'status: "proposal_only"\.to_string\(\)' "Tauri command keeps real packaged E2E proposal-only"
Assert-Contains "app\desktop\src-tauri\src\lib.rs" "commands::get_packaged_login_readiness" "Tauri invoke handler registers packaged login readiness command"
Assert-Contains "scripts\verify-tauri-package-readiness.ps1" "Desktop version metadata" "Tauri package readiness gate exists"
Assert-Contains "scripts\verify-tauri-package-readiness.ps1" "Generated artifact ignore policy" "Tauri package gate blocks generated artifact drift"

Step "Desktop/Web auth boundary"
Assert-Contains "app\desktop\src\api\hubAuth.ts" "start_oidc_callback_server" "Desktop login uses Tauri loopback callback server"
Assert-Contains "app\desktop\src\api\hubAuth.ts" "device_type:\s*'desktop'" "Desktop OIDC exchange uses desktop device type"
Assert-Contains "app\desktop\src\api\hubAuth.ts" "redirect_uri" "Desktop sends redirect_uri through Hub OIDC APIs"
Assert-Contains "app\desktop\src\api\hubTokenStorage.ts" "sessionStorage" "Desktop fallback stores Hub access token in tab-scoped storage"
Assert-NotContains "app\desktop\src\api\hubTokenStorage.ts" "localStorage\.setItem\('agenthub_hub_token'" "Desktop fallback does not persist Hub access token in localStorage"
Assert-Contains "app\web\src\api\hubAuth.ts" "/auth/tokendance/callback" "Web login owns browser callback route"
Assert-Contains "app\web\src\api\hubAuth.ts" "device_type:\s*'web'" "Web OIDC exchange uses web device type"
Assert-Contains "app\web\src\api\hubTokenStorage.ts" "sessionStorage" "Web stores Hub session material in sessionStorage"
Assert-NotContains "app\web\src\api\hubTokenStorage.ts" "localStorage\.setItem" "Web storage helper does not write Hub tokens to localStorage"

Step "future real E2E gate"
Assert-Contains "docs\roadmap.md" "Real TokenDanceID/OIDC login.*remain explicit approval gates" "roadmap keeps real OIDC login approval-gated"
Assert-Contains "docs\roadmap.md" "Real TokenDanceID login: requires approved OAuth client" "roadmap lists real login approval prerequisites"
Assert-Contains "docs\backend-integration-governance.md" "Packaged Desktop OIDC readiness.*proposal-only gate" "governance keeps real packaged E2E proposal-only"
Assert-Contains "docs\backend-integration-governance.md" "Packaged real login dry readiness.*Hub/TokenDance ID.*secrets" "governance records no live TokenDance ID or browser action"
Assert-Contains ".env.example" "AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET" "example config names OIDC client secret without requiring a real value"
Assert-Contains ".env.example" "AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS" "example config names allowed redirect URI boundary"

Step "future real E2E proposal commands"
Write-Host "  fake/local: pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-oidc-flow.ps1 -LocalOnly" -ForegroundColor White
Write-Host "  packaged readiness: pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-tauri-package-readiness.ps1 -RepoRoot ." -ForegroundColor White
Write-Host "  dry real-readiness: pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-packaged-login-real-readiness.ps1 -RepoRoot ." -ForegroundColor White

Step "future real E2E blockers"
Warn "requires explicit operator approval to open the system browser and run a real TokenDance ID login"
Warn "requires a dedicated non-production TokenDance ID OAuth client with the packaged Desktop loopback redirect policy confirmed"
Warn "requires a disposable test user or pre-approved manual account, never committed or printed"
Warn "requires a packaged Desktop artifact and Hub test environment chosen before the browser flow"
Warn "requires evidence boundaries for callback URL, state, token exchange, keyring write, and /client/auth/me without exposing tokens"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -eq 0) {
    Write-Host "`nDry readiness gate passed. Future real E2E remains proposal-only until the blockers above are intentionally cleared.`n" -ForegroundColor Green
} else {
    Write-Host "`nDry readiness gate failed. Keep real packaged login E2E blocked until these static gaps are fixed.`n" -ForegroundColor Red
}

exit $(if ($Failed -gt 0) { 1 } else { 0 })
