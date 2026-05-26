#!/usr/bin/env pwsh
<#
AgentHub TokenDance ID OIDC release-readiness checks.

This script is intentionally secret-free. It checks public repository wiring,
examples, and boundary docs only. It does not connect to production and does
not require or print a real OAuth client secret.
#>

[CmdletBinding()]
param(
    [switch]$SkipWorkspaceDocs
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

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

function Step([string]$Text) {
    Write-Host "`n=== $Text ===" -ForegroundColor Cyan
}

function Read-RepoFile([string]$RelativePath) {
    $path = Join-Path $RepoRoot $RelativePath
    if (-not (Test-Path -LiteralPath $path)) {
        Fail "missing $RelativePath"
        return ""
    }
    return Get-Content -Raw -LiteralPath $path
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

function Find-WorkspaceRoot {
    $current = $RepoRoot
    while ($null -ne $current) {
        $candidate = Join-Path $current "docs/relying-party-readiness.md"
        if (Test-Path -LiteralPath $candidate) {
            return $current
        }
        $parent = Split-Path -Parent $current
        if ($parent -eq $current -or [string]::IsNullOrWhiteSpace($parent)) {
            return $null
        }
        $current = $parent
    }
    return $null
}

Step "Hub OIDC API contract"
Assert-Contains "api/openapi.yaml" "/client/auth/oidc/authorize" "OpenAPI documents OIDC authorize endpoint"
Assert-Contains "api/openapi.yaml" "/client/auth/oidc/callback" "OpenAPI documents OIDC callback endpoint"
Assert-Contains "api/openapi.yaml" "HubOIDCAuthorizeRequest" "OpenAPI includes authorize schema"
Assert-Contains "api/openapi.yaml" "HubOIDCCallbackResponse" "OpenAPI includes callback response schema"

Step "Hub OIDC server wiring"
Assert-Contains "hub-server/internal/config/config.go" "AGENTHUB_TOKENDANCE_ID_ISSUER_URL" "canonical TokenDance ID issuer env is loaded"
Assert-Contains "hub-server/internal/config/config.go" "AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS" "allowed redirect URI env is loaded"
Assert-Contains "hub-server/internal/config/config.go" "tokendance_id\.redirect_uri is required" "Hub validates redirect URI when OIDC client is enabled"
Assert-Contains "hub-server/internal/service/oidc.go" "ParseTokenDanceJWT" "Hub validates TokenDance ID token"
Assert-Contains "hub-server/internal/service/oidc.go" "FindOrCreateByTokenDanceSub" "Hub maps tokendance_sub to Hub user"
Assert-Contains "hub-server/internal/service/oidc.go" "UpsertRefreshToken" "Hub issues Hub-local refresh session"
Assert-Contains "hub-server/internal/middleware/auth.go" "func RequireHubSession" "Hub has explicit Hub-session-only middleware"
Assert-Contains "hub-server/internal/router/router.go" "contacts\.Use\(middleware\.RequireHubSession\(\)\)" "client contacts require Hub-issued session"
Assert-Contains "hub-server/internal/router/router.go" "sessions\.Use\(middleware\.RequireHubSession\(\)\)" "client sessions require Hub-issued session"
Assert-Contains "hub-server/internal/router/router.go" "messages\.Use\(middleware\.RequireHubSession\(\)\)" "client messages require Hub-issued session"
Assert-Contains "hub-server/internal/router/router.go" "web\.Use\(middleware\.RequireHubSession\(\)\)" "web routes require Hub-issued session"
Assert-Contains "hub-server/internal/router/router.go" "edge\.Use\(middleware\.RequireHubSession\(\)\)" "edge routes require Hub-issued session"

Step "Secret-free deployment examples"
Assert-Contains ".env.example" "AGENTHUB_TOKENDANCE_ID_ISSUER_URL" ".env.example documents TokenDance ID issuer"
Assert-Contains ".env.example" "AGENTHUB_TOKENDANCE_ID_CLIENT_ID" ".env.example documents Hub OIDC client id"
Assert-Contains ".env.example" "AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET" ".env.example documents client secret placeholder"
Assert-Contains ".env.example" "AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS" ".env.example documents allowed redirect list"
Assert-Contains "docker-compose.yml" "AGENTHUB_TOKENDANCE_ID_CLIENT_ID" "docker compose passes OIDC client id through env"
Assert-Contains "docker-compose.yml" "AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET" "docker compose passes OIDC client secret through env"

Step "Desktop/Web client boundaries"
Assert-Contains "app/desktop/src/api/hubAuth.ts" "start_oidc_callback_server" "Desktop uses local callback server in Tauri"
Assert-Contains "app/desktop/src/api/hubAuth.ts" "redirect_uri" "Desktop sends redirect_uri through Hub OIDC APIs"
Assert-Contains "app/desktop/src/api/hubTokenStorage.ts" "sessionStorage" "Desktop browser fallback keeps Hub access token tab-scoped"
Assert-NotContains "app/desktop/src/api/hubTokenStorage.ts" "localStorage\.setItem\('agenthub_hub_token'" "Desktop fallback does not persist Hub access token in localStorage"
Assert-Contains "app/web/src/api/hubAuth.ts" "/auth/tokendance/callback" "Web owns browser callback route"
Assert-Contains "app/web/src/api/hubTokenStorage.ts" "sessionStorage" "Web stores Hub session material in sessionStorage"
Assert-NotContains "app/web/src/api/hubTokenStorage.ts" "localStorage\.setItem" "Web storage helper does not write Hub tokens to localStorage"
Assert-Contains "app/desktop/src/api/hubWS.ts" "access_token" "Desktop Hub WebSocket sends Hub access token during upgrade"
Assert-Contains "app/web/src/api/hubWS.ts" "access_token" "Web Hub WebSocket sends Hub access token during upgrade"
Assert-Contains "hub-server/internal/handler/ws_test.go" "TestWebSocketRouteAcceptsHubLocalQueryTokenBeforeUpgrade" "Hub tests accept Hub-issued query token before WebSocket upgrade"
Assert-Contains "hub-server/internal/middleware/auth_test.go" "TestRequireHubSessionBlocksTokenDanceAuth" "Hub session middleware tests reject TokenDance bearer source"
Assert-Contains "app/web/README.md" "BFF/HttpOnly cookie" "Web README keeps high-trust session caveat"

if (-not $SkipWorkspaceDocs) {
    Step "Workspace governance docs"
    $workspaceRoot = Find-WorkspaceRoot
    if ($null -eq $workspaceRoot) {
        Fail "workspace docs not found; rerun with -SkipWorkspaceDocs only for AgentHub-only clones"
    } else {
        $readiness = Get-Content -Raw -LiteralPath (Join-Path $workspaceRoot "docs/relying-party-readiness.md")
        if ($readiness -match "AgentHub Hub Server \| Partial") {
            Pass "root readiness matrix still marks AgentHub Hub Server Partial"
        } else {
            Fail "root readiness matrix must not mark AgentHub Hub Server release-ready without live evidence"
        }
        if ($readiness -match "BFF/HttpOnly-cookie|BFF/HttpOnly cookie") {
            Pass "root readiness matrix keeps Web high-trust session caveat"
        } else {
            Fail "root readiness matrix missing Web high-trust session caveat"
        }
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -ne 0) {
    exit 1
}
