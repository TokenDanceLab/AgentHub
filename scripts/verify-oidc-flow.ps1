#!/usr/bin/env pwsh
<#
AgentHub TokenDance ID OIDC Full-Link Smoke Verification

Verifies the complete OIDC PKCE flow from Desktop → Hub → TokenDance ID.
Connects to live running services. All checks are read-only except the
token exchange simulation which requires valid credentials.

Prerequisites:
  - TokenDance ID running on http://localhost:3000
  - Hub Server running on http://localhost:8080
  - Valid OAuth client registered in TokenDance ID (run setup-tokendance-oidc.sh)
  - Hub Server .env configured with AGENTHUB_TOKENDANCE_ID_* vars

Usage:
  .\scripts\verify-oidc-flow.ps1                        # Full check
  .\scripts\verify-oidc-flow.ps1 -LocalOnly             # Local fake/static gate; no live Hub/TokenDance ID calls
  .\scripts\verify-oidc-flow.ps1 -SkipHub               # Check only TokenDance ID
  .\scripts\verify-oidc-flow.ps1 -SkipTD                # Check only Hub Server
  .\scripts\verify-oidc-flow.ps1 -Interactive            # Run manual browser flow guide
#>

[CmdletBinding()]
param(
    [switch]$LocalOnly,
    [switch]$SkipHub,
    [switch]$SkipTD,
    [switch]$Interactive,
    [string]$HubUrl = "http://localhost:8080",
    [string]$TdUrl = "http://localhost:3000",
    [int]$TimeoutSec = 10,
    [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $scriptDir = if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
        $PSScriptRoot
    } else {
        Split-Path -Parent $MyInvocation.MyCommand.Path
    }
    $RepoRoot = (Resolve-Path (Join-Path $scriptDir "..")).ProviderPath
}

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

function Warn([string]$Text) {
    Write-Host "  WARN  $Text" -ForegroundColor Yellow
}

function Step([string]$Text) {
    Write-Host "`n=== $Text ===" -ForegroundColor Cyan
}

function Banner([string]$Text) {
    Write-Host "`n$('=' * 60)" -ForegroundColor Magenta
    Write-Host "  $Text" -ForegroundColor Magenta
    Write-Host "$('=' * 60)" -ForegroundColor Magenta
}

function Fetch-Json([string]$Url, [string]$Label) {
    try {
        $response = Invoke-RestMethod -Uri $Url -TimeoutSec $TimeoutSec -ErrorAction Stop
        Pass "$Label — $Url"
        return $response
    } catch {
        Fail "$Label — $Url ($($_.Exception.Message))"
        return $null
    }
}

function Unwrap-Envelope([object]$Obj) {
    if ($null -ne $Obj -and $null -ne $Obj.PSObject.Properties["data"] -and $null -ne $Obj.PSObject.Properties["code"]) {
        return $Obj.data
    }
    return $Obj
}

function Test-HealthOk([object]$Health) {
    $body = Unwrap-Envelope $Health
    if ($body -is [string]) {
        return $body.Trim() -eq "ok"
    }
    return $null -ne $body -and $body.status -eq "ok"
}

function Assert-Field([object]$Obj, [string]$Field, [string]$Label) {
    if ($null -ne $Obj -and $Obj.$Field) {
        Pass "$Label = $($Obj.$Field)"
    } else {
        Fail "$Label — field '$Field' missing or empty"
    }
}

function Assert-Contains([string]$Haystack, [string]$Needle, [string]$Label) {
    if ($Haystack -match [regex]::Escape($Needle)) {
        Pass $Label
    } else {
        Fail "$Label — expected '$Needle' not found"
    }
}

function Assert-Status([int]$Actual, [int]$Expected, [string]$Label) {
    if ($Actual -eq $Expected) {
        Pass "$Label (HTTP $Actual)"
    } else {
        Fail "$Label — expected HTTP $Expected, got $Actual"
    }
}

function Assert-FieldPresent([object]$Obj, [string]$Field, [string]$Label) {
    if ($null -ne $Obj -and $Obj.$Field) {
        Pass "$Label is present"
    } else {
        Fail "$Label — field '$Field' missing or empty"
    }
}

function Get-Sha256Prefix([string]$Text) {
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text))
        return ([BitConverter]::ToString($hash).Replace("-", "").ToLowerInvariant()).Substring(0, 12)
    } finally {
        $sha256.Dispose()
    }
}

function Redact-OidcConfigValue([string]$Name, [string]$Value) {
    if ($Name -match "(?i)secret|token|password|key") {
        return "<redacted len=$($Value.Length) sha256_prefix=$(Get-Sha256Prefix $Value)>"
    }
    return $Value
}

function Redact-UrlQuery([string]$Url) {
    $queryStart = $Url.IndexOf("?")
    if ($queryStart -lt 0) {
        return $Url
    }

    $prefix = $Url.Substring(0, $queryStart)
    $queryAndFragment = $Url.Substring($queryStart + 1)
    $fragment = ""
    $fragmentStart = $queryAndFragment.IndexOf("#")
    if ($fragmentStart -ge 0) {
        $fragment = $queryAndFragment.Substring($fragmentStart)
        $queryAndFragment = $queryAndFragment.Substring(0, $fragmentStart)
    }

    $redactedPairs = @()
    foreach ($pair in $queryAndFragment.Split("&")) {
        if ([string]::IsNullOrWhiteSpace($pair)) {
            continue
        }
        $key = $pair.Split("=", 2)[0]
        if ([string]::IsNullOrWhiteSpace($key)) {
            $redactedPairs += "<redacted>"
        } else {
            $redactedPairs += "$key=<redacted>"
        }
    }

    if ($redactedPairs.Count -eq 0) {
        return "$prefix?$fragment"
    }
    return "$prefix?$($redactedPairs -join '&')$fragment"
}

Banner "TokenDance ID OIDC Full-Link Smoke Verification"

if ($LocalOnly) {
    $SkipHub = $true
    $SkipTD = $true
    Step "Local-only fake/static gate"
    Pass "Live Hub and TokenDance ID phases are skipped"
}

# ═══════════════════════════════════════════════════
# Phase 1: TokenDance ID Provider
# ═══════════════════════════════════════════════════

if (-not $SkipTD) {
    Step "Phase 1 — TokenDance ID OIDC Provider ($TdUrl)"

    # 1.1 Health / reachability
    try {
        $health = Invoke-RestMethod -Uri "$TdUrl/health" -TimeoutSec 5 -ErrorAction Stop
        if (Test-HealthOk $health) {
            Pass "TokenDance ID health endpoint reachable"
        } else {
            Fail "TokenDance ID health returned: $($health | ConvertTo-Json)"
        }
    } catch {
        Fail "TokenDance ID health endpoint unreachable — is it running? (cd tokendance-id && go run ./cmd/tokendance-id)"
    }

    # 1.2 OIDC Discovery document
    $discovery = Fetch-Json "$TdUrl/.well-known/openid-configuration" "OIDC Discovery document"
    if ($discovery) {
        Assert-Field $discovery "issuer"                    "  issuer"
        Assert-Field $discovery "authorization_endpoint"    "  authorization_endpoint"
        Assert-Field $discovery "token_endpoint"           "  token_endpoint"
        Assert-Field $discovery "jwks_uri"                 "  jwks_uri"
        Assert-Field $discovery "userinfo_endpoint"        "  userinfo_endpoint"
        $codeChallengeMethods = $discovery.code_challenge_methods_supported -join ","
        Assert-Contains $codeChallengeMethods "S256"        "  code_challenge_methods_supported includes S256"
        $grantTypes = $discovery.grant_types_supported -join ","
        Assert-Contains $grantTypes "authorization_code"    "  grant_types_supported includes authorization_code"
        $scopes = $discovery.scopes_supported -join ","
        Assert-Contains $scopes "openid"                    "  scopes_supported includes openid"
        Assert-Contains $scopes "profile"                   "  scopes_supported includes profile"
        Assert-Contains $scopes "email"                     "  scopes_supported includes email"
    }

    # 1.3 JWKS endpoint
    $jwks = Fetch-Json "$TdUrl/oidc/jwks" "JWKS endpoint"
    if ($jwks) {
        if ($jwks.keys -and $jwks.keys.Count -gt 0) {
            Pass "  JWKS has $($jwks.keys.Count) key(s)"
            $rsaKeys = $jwks.keys | Where-Object { $_.kty -eq "RSA" }
            if ($rsaKeys) {
                Pass "  JWKS contains RSA key(s): $($rsaKeys.Count) found"
            } else {
                Fail "  JWKS has no RSA keys"
            }
        } else {
            Fail "  JWKS keys array empty or missing"
        }
    }

    # 1.4 CORS headers for Hub Server
    try {
        $corsResp = Invoke-WebRequest -Uri "$TdUrl/.well-known/openid-configuration" `
            -Method Options `
            -Headers @{ "Origin" = $HubUrl; "Access-Control-Request-Method" = "GET" } `
            -TimeoutSec 5 -ErrorAction SilentlyContinue
        if ($corsResp.Headers["Access-Control-Allow-Origin"] -or $corsResp.StatusCode -eq 204) {
            Pass "  TokenDance ID responds to CORS preflight from Hub"
        } else {
            Warn "  TokenDance ID CORS headers not verified (may need allowed_origins config)"
        }
    } catch {
        Warn "  CORS preflight check skipped ($($_.Exception.Message))"
    }
}

# ═══════════════════════════════════════════════════
# Phase 2: Hub Server OIDC Endpoints
# ═══════════════════════════════════════════════════

if (-not $SkipHub) {
    Step "Phase 2 — Hub Server ($HubUrl)"

    # 2.1 Hub health
    try {
        $hubHealth = Invoke-RestMethod -Uri "$HubUrl/health" -TimeoutSec 5 -ErrorAction Stop
        if (Test-HealthOk $hubHealth) {
            Pass "Hub Server health endpoint reachable"
        } else {
            Fail "Hub Server health returned: $($hubHealth | ConvertTo-Json)"
        }
    } catch {
        Fail "Hub Server unreachable — start with: docker compose up -d postgres redis && cd hub-server && go run ./cmd/server-hub"
    }

    # 2.2 OIDC Authorize endpoint
    $authorizeUrl = "$HubUrl/client/auth/oidc/authorize"
    try {
        # Generate PKCE parameters
        $verifierBytes = New-Object byte[] 32
        [Security.Cryptography.RandomNumberGenerator]::Fill($verifierBytes)
        $codeVerifier = [Convert]::ToBase64String($verifierBytes).Replace('+', '-').Replace('/', '_').Replace('=', '')

        $sha256 = [Security.Cryptography.SHA256]::Create()
        $hash = $sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($codeVerifier))
        $codeChallenge = [Convert]::ToBase64String($hash).Replace('+', '-').Replace('/', '_').Replace('=', '')

        $deviceId = [Guid]::NewGuid().ToString()

        $authorizeBody = @{
            code_challenge        = $codeChallenge
            code_challenge_method = "S256"
            device_type           = "desktop"
            device_id             = $deviceId
            redirect_uri          = "http://127.0.0.1/callback"
        } | ConvertTo-Json

        $authResp = Invoke-RestMethod -Uri $authorizeUrl `
            -Method Post `
            -Body $authorizeBody `
            -ContentType "application/json" `
            -TimeoutSec $TimeoutSec `
            -ErrorAction Stop

        $authData = Unwrap-Envelope $authResp

        if ($authData.state -and $authData.authorization_url) {
            Pass "  POST /client/auth/oidc/authorize — returns state + authorization_url"
            Assert-FieldPresent $authData "state" "    state"
            Assert-FieldPresent $authData "authorization_url" "    authorization_url"

            # Verify authorization URL structure
            $authUrlParsed = $authData.authorization_url
            Assert-Contains $authUrlParsed "response_type=code"         "    auth URL includes response_type=code"
            Assert-Contains $authUrlParsed "client_id="                 "    auth URL includes client_id"
            Assert-Contains $authUrlParsed "redirect_uri="              "    auth URL includes redirect_uri"
            Assert-Contains $authUrlParsed "scope=openid"               "    auth URL includes scope=openid"
            Assert-Contains $authUrlParsed "code_challenge="            "    auth URL includes code_challenge"
            Assert-Contains $authUrlParsed "code_challenge_method=S256" "    auth URL includes code_challenge_method=S256"

            # Store for later phases
            $global:VerifyState = $authData.state
            $global:VerifyAuthUrl = Redact-UrlQuery $authData.authorization_url
            $global:VerifyCodeVerifier = $codeVerifier
            $global:VerifyDeviceId = $deviceId
            Pass "  Authorization URL is well-formed OIDC PKCE request"
        } else {
            Fail "  POST /client/auth/oidc/authorize — missing state or authorization_url"
        }
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        if ($statusCode) {
            Assert-Status $statusCode 400 "  POST /client/auth/oidc/authorize"
        }
        Fail "  OIDC authorize failed: $($_.Exception.Message)"
    }

    # 2.3 OIDC Callback endpoint (negative test — should reject bad code)
    $callbackUrl = "$HubUrl/client/auth/oidc/callback"
    try {
        $badCallback = @{
            code          = "invalid-code-abc123"
            state         = "invalid-state"
            code_verifier = "invalid-verifier"
            device_type   = "desktop"
            device_id     = [Guid]::NewGuid().ToString()
        } | ConvertTo-Json

        $callbackResp = Invoke-RestMethod -Uri $callbackUrl `
            -Method Post `
            -Body $badCallback `
            -ContentType "application/json" `
            -TimeoutSec $TimeoutSec `
            -ErrorAction Stop

        Fail "  POST /client/auth/oidc/callback — expected rejection but got 200"
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        if ($statusCode -ge 400) {
            Pass "  POST /client/auth/oidc/callback — correctly rejects invalid code (HTTP $statusCode)"
        } else {
            Fail "  OIDC callback test failed: $($_.Exception.Message)"
        }
    }

    # 2.4 CORS headers for Desktop dev
    try {
        $corsResp = Invoke-WebRequest -Uri "$HubUrl/health" `
            -Method Options `
            -Headers @{ "Origin" = "http://localhost:5173"; "Access-Control-Request-Method" = "GET" } `
            -TimeoutSec 5 -ErrorAction SilentlyContinue
        $allowOrigin = $corsResp.Headers["Access-Control-Allow-Origin"]
        if ($allowOrigin -eq "http://localhost:5173") {
            Pass "  Hub CORS allows Desktop Vite dev origin (localhost:5173)"
        } else {
            Warn "  Hub CORS origin for localhost:5173 = $allowOrigin (expected http://localhost:5173)"
        }
    } catch {
        Warn "  Hub CORS check skipped ($($_.Exception.Message))"
    }
}

# ═══════════════════════════════════════════════════
# Phase 3: Full Flow Simulation
# ═══════════════════════════════════════════════════

Step "Phase 3 — Full-Flow Diagnostics"

# 3.1 Verify auth URL can be opened
if ($global:VerifyAuthUrl) {
    Pass "  Authorization URL generated — redacted diagnostic form:"
    Write-Host "    $(Redact-UrlQuery $global:VerifyAuthUrl)" -ForegroundColor Cyan
} else {
    if ($LocalOnly) {
        Warn "  Authorization URL not available because live Hub authorize is skipped"
    } else {
        Warn "  Authorization URL not available because Hub authorize did not complete"
    }
}

# 3.2 Check required env vars in hub-server/.env
$hubEnvPath = Join-Path $RepoRoot "hub-server\.env"
if (Test-Path $hubEnvPath) {
    $hubEnv = Get-Content -Raw $hubEnvPath
    $envVars = @(
        @{Name="AGENTHUB_TOKENDANCE_ID_ISSUER_URL"; Pattern="AGENTHUB_TOKENDANCE_ID_ISSUER_URL=(.+)"},
        @{Name="AGENTHUB_TOKENDANCE_ID_CLIENT_ID"; Pattern="AGENTHUB_TOKENDANCE_ID_CLIENT_ID=(.+)"},
        @{Name="AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET"; Pattern="AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET=(.+)"},
        @{Name="AGENTHUB_TOKENDANCE_ID_REDIRECT_URI"; Pattern="AGENTHUB_TOKENDANCE_ID_REDIRECT_URI=(.+)"}
    )

    foreach ($var in $envVars) {
        if ($hubEnv -match $var.Pattern) {
            $value = $Matches[1].Trim()
            $displayValue = Redact-OidcConfigValue $var.Name $value
            if ($value -and $value -notlike "*fill in*" -and $value -notlike "*your-*" -and $value -notlike "<*") {
                Pass "  $($var.Name) is configured ($displayValue)"
            } else {
                Fail "  $($var.Name) has placeholder value: `"$displayValue`" — fill in real value"
            }
        } else {
            Fail "  $($var.Name) is not in hub-server/.env"
        }
    }
} else {
    Warn "  hub-server/.env not found — copy from .env.example and fill in TokenDance ID values"
}

# 3.3 Config code validation
$configGoPath = Join-Path $RepoRoot "hub-server\internal\config\config.go"
if (Test-Path $configGoPath) {
    $configGo = Get-Content -Raw $configGoPath
    if ($configGo -match "tokendance_id\.issuer_url is required when") {
        Pass "  Hub config validates interdependency (issuer_url required when client_id set)"
    } else {
        Fail "  Hub config missing interdependency validation"
    }
    if ($configGo -match "tokendance_id\.client_secret is required when") {
        Pass "  Hub config validates client_secret required when client_id set"
    } else {
        Fail "  Hub config missing client_secret validation"
    }
    if ($configGo -match "tokendance_id\.redirect_uri is required when") {
        Pass "  Hub config validates redirect_uri required when client_id set"
    } else {
        Fail "  Hub config missing redirect_uri validation"
    }
}

# ═══════════════════════════════════════════════════
# Phase 4: Interactive Manual Flow Guide
# ═══════════════════════════════════════════════════

if ($Interactive) {
    Step "Phase 4 — Interactive Manual Flow"

    Write-Host "`n  Manual OIDC flow verification:" -ForegroundColor Yellow
    Write-Host "  1. Make sure TokenDance ID is running:  cd tokendance-id && go run ./cmd/tokendance-id" -ForegroundColor White
    Write-Host "  2. Make sure Hub Server is running:     cd hub-server && go run ./cmd/server-hub" -ForegroundColor White
    Write-Host "  3. Make sure Desktop dev is running:    cd app/desktop && pnpm dev" -ForegroundColor White

    Write-Host "`n  Steps:" -ForegroundColor Yellow
    Write-Host "  a) Open http://localhost:5173 in browser" -ForegroundColor White
    Write-Host "  b) Click 'TokenDance ID 登录' button" -ForegroundColor White
    Write-Host "  c) Browser opens TokenDance ID authorization page" -ForegroundColor White
    Write-Host "  d) Login to TokenDance ID (create account if needed)" -ForegroundColor White
    Write-Host "  e) Approve authorization consent screen" -ForegroundColor White
    Write-Host "  f) Browser redirects back — Desktop receives Hub tokens" -ForegroundColor White
    Write-Host "  g) Verify /client/auth/me returns user profile" -ForegroundColor White

    Write-Host "`n  Check Hub Server logs:" -ForegroundColor Yellow
    Write-Host "  docker compose logs -f hub-server" -ForegroundColor White

    Write-Host "`n  Check TokenDance ID logs:" -ForegroundColor Yellow
    Write-Host "  cd tokendance-id && go run ./cmd/tokendance-id (attached)" -ForegroundColor White

    Write-Host "`n  Expected log lines in Hub Server:" -ForegroundColor Yellow
    Write-Host "  - 'stored PKCE state in redis'" -ForegroundColor Gray
    Write-Host "  - 'token exchange: HTTP 200'" -ForegroundColor Gray
    Write-Host "  - 'ID token validated, sub=...'" -ForegroundColor Gray
    Write-Host "  - 'user found/created by TokenDance sub'" -ForegroundColor Gray
    Write-Host "  - 'Hub access token issued'" -ForegroundColor Gray

    Write-Host "`n  Curl to verify Hub session:" -ForegroundColor Yellow
    Write-Host "  curl -H 'Authorization: Bearer <access_token>' http://localhost:8080/client/auth/me" -ForegroundColor White
}

# ═══════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════

Write-Host "`n$('=' * 60)" -ForegroundColor Magenta
Write-Host "  Passed: $Passed  |  Failed: $Failed  |  Total: $($Passed + $Failed)" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "$('=' * 60)" -ForegroundColor Magenta

if ($Failed -eq 0) {
    if ($LocalOnly) {
        Write-Host "`n  Local-only fake/static OIDC checks passed. No live Hub or TokenDance ID calls were made.`n" -ForegroundColor Green
    } else {
        Write-Host "`n  All checks passed. The OIDC infrastructure is correctly wired.`n" -ForegroundColor Green
        Write-Host "  Next step: run Desktop app for end-to-end browser flow.`n" -ForegroundColor Green
    }
} elseif ($Failed -le 2) {
    Write-Host "`n  Minor issues found. Review warnings above and re-run.`n" -ForegroundColor Yellow
} else {
    Write-Host "`n  Multiple issues found. Ensure both TokenDance ID and Hub Server are running,`n" -ForegroundColor Red
    Write-Host "  and the OIDC client is registered (run: hub-server/scripts/setup-tokendance-oidc.sh)`n" -ForegroundColor Red
}

exit $(if ($Failed -gt 0) { 1 } else { 0 })
