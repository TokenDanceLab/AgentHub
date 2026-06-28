#!/usr/bin/env pwsh
<#
AgentHub TokenDanceID no-secret login readiness gate.

This script only checks whether an operator has supplied approved login test
metadata and whether TokenDanceID OIDC discovery is readable. It does not open
a browser, submit credentials, exchange authorization codes, or accept fixture
data as proof of real login.
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = ".",
    [string]$IssuerUrl = "",
    [string]$ClientId = "",
    [string]$TestAccountRef = "",
    [string]$DiscoveryDocumentPath = "",
    [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
$Failures = @()
$Warnings = @()

function Add-Failure([string]$Text) {
    $script:Failures += $Text
    Write-Host "FAIL: $Text" -ForegroundColor Red
}

function Add-Warning([string]$Text) {
    $script:Warnings += $Text
    Write-Host "WARN: $Text" -ForegroundColor Yellow
}

function Pass([string]$Text) {
    Write-Host "PASS: $Text" -ForegroundColor Green
}

function First-Value([string]$Current, [string]$EnvName) {
    if (-not [string]::IsNullOrWhiteSpace($Current)) {
        return $Current
    }
    return [string][Environment]::GetEnvironmentVariable($EnvName)
}

function Resolve-RepoPath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return ""
    }
    if ([System.IO.Path]::IsPathRooted($Path)) {
        return $Path
    }
    return Join-Path $RepoRoot $Path
}

function Test-HttpUrl([string]$Url) {
    try {
        $uri = [System.Uri]::new($Url)
        return $uri.Scheme -eq "http" -or $uri.Scheme -eq "https"
    } catch {
        return $false
    }
}

function Test-SecretLike([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $false
    }

    return $Value -match '(?i)(sk-[a-z0-9_-]{8,}|eyJ[a-z0-9_-]{12,}|bearer\s+[a-z0-9._-]{12,}|refresh[_-]?token\s*=|access[_-]?token\s*=|id[_-]?token\s*=|password\s*=|client_secret\s*=|secret[_-]?[a-z0-9]*\s*=)'
}

function Assert-NoSecretLike([string]$Name, [string]$Value) {
    if (Test-SecretLike $Value) {
        Add-Failure "$Name contains secret-like material; pass a public identifier or private evidence reference, not token/password/secret values"
    }
}

function Assert-Required([string]$Name, [string]$Value, [string]$EnvName) {
    if ([string]::IsNullOrWhiteSpace($Value)) {
        Add-Failure "$Name is required; set $EnvName or pass the matching parameter"
    } else {
        Pass "$Name supplied"
    }
}

function Read-DiscoveryDocument {
    param(
        [string]$Issuer,
        [string]$Path
    )

    if (-not [string]::IsNullOrWhiteSpace($Path)) {
        $fullPath = Resolve-RepoPath $Path
        if (-not (Test-Path -LiteralPath $fullPath)) {
            Add-Failure "discovery document fixture path does not exist"
            return $null
        }
        try {
            return Get-Content -Raw -LiteralPath $fullPath | ConvertFrom-Json
        } catch {
            Add-Failure "discovery document fixture must be valid JSON"
            return $null
        }
    }

    if ([string]::IsNullOrWhiteSpace($Issuer)) {
        return $null
    }
    if (-not (Test-HttpUrl $Issuer)) {
        Add-Failure "issuer URL must be an http(s) URL"
        return $null
    }

    $discoveryUrl = $Issuer.TrimEnd("/") + "/.well-known/openid-configuration"
    try {
        return Invoke-RestMethod -Method Get -Uri $discoveryUrl -TimeoutSec 10
    } catch {
        Add-Failure "OIDC discovery is not reachable at configured issuer"
        return $null
    }
}

function Assert-Discovery {
    param(
        [object]$Discovery,
        [string]$ExpectedIssuer
    )

    if ($null -eq $Discovery) {
        return
    }

    foreach ($field in @("issuer", "authorization_endpoint", "token_endpoint", "jwks_uri")) {
        if ($null -eq $Discovery.$field -or [string]::IsNullOrWhiteSpace([string]$Discovery.$field)) {
            Add-Failure "OIDC discovery missing $field"
        } elseif ($field -ne "issuer" -and -not (Test-HttpUrl ([string]$Discovery.$field))) {
            Add-Failure "OIDC discovery $field must be an http(s) URL"
        } else {
            Pass "OIDC discovery has $field"
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($ExpectedIssuer) -and $null -ne $Discovery.issuer) {
        $actual = ([string]$Discovery.issuer).TrimEnd("/")
        $expected = $ExpectedIssuer.TrimEnd("/")
        if ($actual -ne $expected) {
            Add-Failure "discovery issuer does not match configured issuer"
        } else {
            Pass "discovery issuer matches configured issuer"
        }
    }

    if ($null -ne $Discovery.response_types_supported) {
        if (@($Discovery.response_types_supported) -contains "code") {
            Pass "OIDC discovery supports authorization code response type"
        } else {
            Add-Failure "OIDC discovery does not advertise authorization code response type"
        }
    } else {
        Add-Warning "OIDC discovery response_types_supported is absent; operator must verify authorization code support before real login"
    }

    if ($null -ne $Discovery.code_challenge_methods_supported) {
        if (@($Discovery.code_challenge_methods_supported) -contains "S256") {
            Pass "OIDC discovery supports PKCE S256"
        } else {
            Add-Failure "OIDC discovery does not advertise PKCE S256"
        }
    } else {
        Add-Warning "OIDC discovery code_challenge_methods_supported is absent; operator must verify PKCE S256 before real login"
    }
}

$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
$IssuerUrl = First-Value $IssuerUrl "AGENTHUB_TDID_LOGIN_ISSUER_URL"
$ClientId = First-Value $ClientId "AGENTHUB_TDID_LOGIN_CLIENT_ID"
$TestAccountRef = First-Value $TestAccountRef "AGENTHUB_TDID_LOGIN_TEST_ACCOUNT_REF"
$DiscoveryDocumentPath = First-Value $DiscoveryDocumentPath "AGENTHUB_TDID_LOGIN_DISCOVERY_DOCUMENT"

Write-Host "AgentHub TokenDanceID no-secret login readiness" -ForegroundColor Magenta
Write-Host "Schema: agenthub-token-dance-id-login-readiness-v1" -ForegroundColor White
Write-Host "No browser, credential submission, code exchange, token exchange, or real login is performed by this script." -ForegroundColor White

Assert-Required "TokenDanceID issuer URL" $IssuerUrl "AGENTHUB_TDID_LOGIN_ISSUER_URL"
Assert-Required "approved TokenDanceID OIDC client id" $ClientId "AGENTHUB_TDID_LOGIN_CLIENT_ID"
Assert-Required "approved/disposable test account reference" $TestAccountRef "AGENTHUB_TDID_LOGIN_TEST_ACCOUNT_REF"

Assert-NoSecretLike "IssuerUrl" $IssuerUrl
Assert-NoSecretLike "ClientId" $ClientId
Assert-NoSecretLike "TestAccountRef" $TestAccountRef
Assert-NoSecretLike "DiscoveryDocumentPath" $DiscoveryDocumentPath

if (-not [string]::IsNullOrWhiteSpace($IssuerUrl) -and -not (Test-HttpUrl $IssuerUrl)) {
    Add-Failure "issuer URL must be an http(s) URL"
}

if (-not [string]::IsNullOrWhiteSpace($TestAccountRef) -and $TestAccountRef -notmatch '(?i)(approved|test|disposable|sandbox|throwaway)') {
    Add-Failure "test account reference must clearly identify an approved test/disposable/sandbox account without containing credentials"
}

$discovery = Read-DiscoveryDocument -Issuer $IssuerUrl -Path $DiscoveryDocumentPath
Assert-Discovery -Discovery $discovery -ExpectedIssuer $IssuerUrl

$status = if ($Failures.Count -eq 0) { "READY_FOR_OPERATOR" } else { "BLOCKED" }

$summary = [ordered]@{
    schema = "agenthub-token-dance-id-login-readiness-v1"
    status = $status
    issuer_configured = -not [string]::IsNullOrWhiteSpace($IssuerUrl)
    approved_client_id_configured = -not [string]::IsNullOrWhiteSpace($ClientId)
    approved_test_account_ref_configured = -not [string]::IsNullOrWhiteSpace($TestAccountRef)
    discovery_checked = $null -ne $discovery
    discovery_source = if (-not [string]::IsNullOrWhiteSpace($DiscoveryDocumentPath)) { "fixture" } elseif (-not [string]::IsNullOrWhiteSpace($IssuerUrl)) { "issuer" } else { "none" }
    real_login_executed_by_script = $false
    fixture_login_accepted_as_real = $false
    secret_values_logged = $false
    generated_at = (Get-Date).ToString("o")
    required_operator_next_steps = @(
        "Verify the configured client id is the approved AgentHub TokenDanceID client",
        "Verify the test account reference maps to an approved disposable or pre-approved test account",
        "Run the separate approved real-login harness only after operator approval and without committing credentials or tokens"
    )
    failures = @($Failures)
    warnings = @($Warnings)
}

if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
    $fullOutputPath = Resolve-RepoPath $OutputPath
    $parent = Split-Path -Parent $fullOutputPath
    if (-not [string]::IsNullOrWhiteSpace($parent)) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    $summary | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $fullOutputPath -Encoding UTF8
}

Write-Host "Status: $status" -ForegroundColor $(if ($status -eq "READY_FOR_OPERATOR") { "Green" } else { "Red" })
Write-Host "RealLoginExecutedByScript=false" -ForegroundColor White
Write-Host "FixtureLoginAcceptedAsReal=false" -ForegroundColor White
Write-Host "SecretValuesLogged=false" -ForegroundColor White

if ($Failures.Count -gt 0) {
    exit 1
}

exit 0
