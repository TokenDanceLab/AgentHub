#!/usr/bin/env pwsh
<#
AgentHub real login and remote-control E2E readiness verifier.

This script is an approval gate and evidence-shape verifier. It does not open
a browser, perform TokenDanceID login, dispatch Hub work, or call live services.
Real login/dispatch remains blocked unless the operator provides explicit
approval metadata and the Playwright harness is run separately.
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = ".",
    [ValidateSet("ProposalOnly", "RealApproved", "EvidenceReview")]
    [string]$Mode = "ProposalOnly",
    [switch]$UseEnvironment,

    [string]$OAuthClientId = "",
    [string]$CallbackUrl = "",
    [string]$HubBaseUrl = "",
    [string]$WebUrl = "",
    [string]$TestAccountIndicator = "",
    [string]$ArtifactRoot = "",
    [ValidateSet("", "metadata-only", "redacted-screenshots")]
    [string]$BrowserEvidenceBoundary = "",
    [string]$OperatorApprovalId = "",
    [switch]$ApproveRealLogin,
    [switch]$ApproveRemoteDispatch,

    [string]$HubSessionProof = "",
    [string]$TargetInventoryProof = "",
    [string]$SelectedDesktopTargetProof = "",
    [string]$DispatchRequestProof = "",
    [string]$EventReplayProof = "",
    [string]$EvidenceManifest = "",
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

function First-Value([string]$Current, [string]$Name) {
    if (-not [string]::IsNullOrWhiteSpace($Current)) {
        return $Current
    }
    if ($UseEnvironment) {
        return [string][Environment]::GetEnvironmentVariable($Name)
    }
    return ""
}

function Test-HttpUrl([string]$Url) {
    try {
        $uri = [System.Uri]::new($Url)
        return $uri.Scheme -eq "http" -or $uri.Scheme -eq "https"
    } catch {
        return $false
    }
}

function Get-Origin([string]$Url) {
    try {
        $uri = [System.Uri]::new($Url)
        $port = if ($uri.IsDefaultPort) {
            if ($uri.Scheme -eq "https") { 443 } else { 80 }
        } else {
            $uri.Port
        }
        return ("{0}://{1}:{2}" -f $uri.Scheme.ToLowerInvariant(), $uri.Host.ToLowerInvariant(), $port)
    } catch {
        return ""
    }
}

function Test-LoopbackUrl([string]$Url) {
    try {
        $uri = [System.Uri]::new($Url)
        $host = $uri.Host.ToLowerInvariant()
        return @("127.0.0.1", "localhost", "::1") -contains $host
    } catch {
        return $false
    }
}

function Test-SecretLike([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $false
    }
    return $Value -match '(?i)(sk-[a-z0-9_-]{8,}|eyJ[a-z0-9_-]{12,}|bearer\s+[a-z0-9._-]{12,}|refresh[_-]?token\s*=|access[_-]?token\s*=|id[_-]?token\s*=|password\s*=|client_secret\s*=)'
}

function Assert-NoSecretLike([string]$Name, [string]$Value) {
    if (Test-SecretLike $Value) {
        Add-Failure "$Name contains secret-like material; pass ownership/proof references, not token values"
    }
}

function Assert-Required([string]$Name, [string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) {
        Add-Failure "$Name is required"
    } else {
        Pass "$Name supplied"
    }
}

function Assert-Url([string]$Name, [string]$Value) {
    Assert-Required $Name $Value
    if (-not [string]::IsNullOrWhiteSpace($Value) -and -not (Test-HttpUrl $Value)) {
        Add-Failure "$Name must be an http(s) URL"
    }
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

function Test-AllowedArtifactRoot([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $false
    }
    $full = [System.IO.Path]::GetFullPath((Resolve-RepoPath $Path))
    $allowed = @(
        [System.IO.Path]::GetFullPath((Join-Path $RepoRoot ".tmp")),
        [System.IO.Path]::GetFullPath((Join-Path $RepoRoot "tmp"))
    )
    foreach ($root in $allowed) {
        if ($full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }
    return $false
}

function Read-JsonFile([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $null
    }
    $full = Resolve-RepoPath $Path
    if (-not (Test-Path -LiteralPath $full)) {
        Add-Failure "evidence manifest not found"
        return $null
    }
    try {
        return Get-Content -Raw -LiteralPath $full | ConvertFrom-Json
    } catch {
        Add-Failure "evidence manifest must be valid JSON"
        return $null
    }
}

function Test-JsonForSecretLike([object]$Node) {
    $json = $Node | ConvertTo-Json -Depth 30 -Compress
    return Test-SecretLike $json
}

function Test-ManifestEvidence([object]$Manifest) {
    if ($null -eq $Manifest) {
        return
    }

    if (Test-JsonForSecretLike $Manifest) {
        Add-Failure "evidence manifest contains secret-like material"
    }

    foreach ($field in @("hub_session", "target_inventory", "selected_desktop_target", "dispatch_request", "event_replay")) {
        if ($null -eq $Manifest.$field) {
            Add-Failure "evidence manifest missing $field proof"
        } else {
            Pass "evidence manifest contains $field proof"
        }
    }

    if ($Manifest.real_login_approved -ne $true) {
        Add-Failure "evidence manifest must record real_login_approved=true"
    }
    if ($Manifest.remote_dispatch_approved -ne $true) {
        Add-Failure "evidence manifest must record remote_dispatch_approved=true"
    }
    if ($Manifest.redaction_status -ne "redacted") {
        Add-Failure "evidence manifest redaction_status must be redacted"
    }
    if ($Manifest.web_to_local_edge_direct -eq $true) {
        Add-Failure "evidence manifest must not prove a direct Web-to-LocalEdge path"
    }
}

$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
$OAuthClientId = First-Value $OAuthClientId "AGENTHUB_LOGIN_E2E_OAUTH_CLIENT_ID"
$CallbackUrl = First-Value $CallbackUrl "AGENTHUB_LOGIN_E2E_CALLBACK_URL"
$HubBaseUrl = First-Value $HubBaseUrl "AGENTHUB_LOGIN_E2E_HUB_BASE_URL"
$WebUrl = First-Value $WebUrl "AGENTHUB_LOGIN_E2E_WEB_URL"
$TestAccountIndicator = First-Value $TestAccountIndicator "AGENTHUB_LOGIN_E2E_TEST_ACCOUNT_INDICATOR"
$ArtifactRoot = First-Value $ArtifactRoot "AGENTHUB_LOGIN_E2E_ARTIFACT_ROOT"
$BrowserEvidenceBoundary = First-Value $BrowserEvidenceBoundary "AGENTHUB_LOGIN_E2E_BROWSER_EVIDENCE_BOUNDARY"
$OperatorApprovalId = First-Value $OperatorApprovalId "AGENTHUB_LOGIN_E2E_OPERATOR_APPROVAL_ID"
$HubSessionProof = First-Value $HubSessionProof "AGENTHUB_LOGIN_E2E_HUB_SESSION_PROOF"
$TargetInventoryProof = First-Value $TargetInventoryProof "AGENTHUB_LOGIN_E2E_TARGET_INVENTORY_PROOF"
$SelectedDesktopTargetProof = First-Value $SelectedDesktopTargetProof "AGENTHUB_LOGIN_E2E_SELECTED_DESKTOP_TARGET_PROOF"
$DispatchRequestProof = First-Value $DispatchRequestProof "AGENTHUB_LOGIN_E2E_DISPATCH_REQUEST_PROOF"
$EventReplayProof = First-Value $EventReplayProof "AGENTHUB_LOGIN_E2E_EVENT_REPLAY_PROOF"
$EvidenceManifest = First-Value $EvidenceManifest "AGENTHUB_LOGIN_E2E_EVIDENCE_MANIFEST"
if ($UseEnvironment) {
    $ApproveRealLogin = $ApproveRealLogin -or ([Environment]::GetEnvironmentVariable("AGENTHUB_LOGIN_E2E_APPROVE_REAL_LOGIN") -eq "true")
    $ApproveRemoteDispatch = $ApproveRemoteDispatch -or ([Environment]::GetEnvironmentVariable("AGENTHUB_LOGIN_E2E_APPROVE_REMOTE_DISPATCH") -eq "true")
}

Write-Host "AgentHub login E2E readiness verifier" -ForegroundColor Magenta
Write-Host "Mode: $Mode" -ForegroundColor White
Write-Host "No browser, real login, dispatch, token exchange, or live endpoint call is performed by this script." -ForegroundColor White

foreach ($input in @(
    @{ Name = "OAuthClientId"; Value = $OAuthClientId },
    @{ Name = "CallbackUrl"; Value = $CallbackUrl },
    @{ Name = "HubBaseUrl"; Value = $HubBaseUrl },
    @{ Name = "WebUrl"; Value = $WebUrl },
    @{ Name = "TestAccountIndicator"; Value = $TestAccountIndicator },
    @{ Name = "ArtifactRoot"; Value = $ArtifactRoot },
    @{ Name = "BrowserEvidenceBoundary"; Value = $BrowserEvidenceBoundary },
    @{ Name = "OperatorApprovalId"; Value = $OperatorApprovalId },
    @{ Name = "HubSessionProof"; Value = $HubSessionProof },
    @{ Name = "TargetInventoryProof"; Value = $TargetInventoryProof },
    @{ Name = "SelectedDesktopTargetProof"; Value = $SelectedDesktopTargetProof },
    @{ Name = "DispatchRequestProof"; Value = $DispatchRequestProof },
    @{ Name = "EventReplayProof"; Value = $EventReplayProof }
)) {
    Assert-NoSecretLike $input.Name $input.Value
}

if ($Mode -eq "ProposalOnly") {
    Add-Warning "ProposalOnly blocks real login and records the required approval/evidence contract."
} else {
    Assert-Required "OAuth client id" $OAuthClientId
    Assert-Url "Callback URL" $CallbackUrl
    Assert-Url "Hub base URL" $HubBaseUrl
    Assert-Url "Web URL" $WebUrl
    Assert-Required "disposable/test account indicator" $TestAccountIndicator
    Assert-Required "artifact redaction root" $ArtifactRoot
    Assert-Required "browser evidence boundary" $BrowserEvidenceBoundary
    Assert-Required "operator approval id" $OperatorApprovalId

    if ($TestAccountIndicator -notmatch '(?i)(disposable|test|throwaway|sandbox)') {
        Add-Failure "test account indicator must clearly name a disposable/test/sandbox account"
    }
    if (-not (Test-AllowedArtifactRoot $ArtifactRoot)) {
        Add-Failure "artifact root must stay under .tmp or tmp so redacted evidence cannot enter Git"
    }
    if ($BrowserEvidenceBoundary -notin @("metadata-only", "redacted-screenshots")) {
        Add-Failure "browser evidence boundary must be metadata-only or redacted-screenshots"
    }
    if (-not $ApproveRealLogin) {
        Add-Failure "real login requires -ApproveRealLogin or AGENTHUB_LOGIN_E2E_APPROVE_REAL_LOGIN=true"
    }
    if (-not $ApproveRemoteDispatch) {
        Add-Failure "remote-control dispatch requires -ApproveRemoteDispatch or AGENTHUB_LOGIN_E2E_APPROVE_REMOTE_DISPATCH=true"
    }

    $webOrigin = Get-Origin $WebUrl
    $hubOrigin = Get-Origin $HubBaseUrl
    if (-not [string]::IsNullOrWhiteSpace($webOrigin) -and $webOrigin -eq (Get-Origin "http://127.0.0.1:3210")) {
        Add-Failure "Web URL must not point directly at Local Edge"
    }
    if (-not [string]::IsNullOrWhiteSpace($hubOrigin) -and $hubOrigin -eq (Get-Origin "http://127.0.0.1:3210")) {
        Add-Failure "Hub base URL must not point directly at Local Edge"
    }
    if (Test-LoopbackUrl $HubBaseUrl -and -not (Test-LoopbackUrl $WebUrl)) {
        Add-Warning "Hub is loopback while Web is not; verify this is an approved test topology"
    }
}

if ($Mode -eq "RealApproved") {
    foreach ($proof in @(
        @{ Name = "Hub session proof"; Value = $HubSessionProof },
        @{ Name = "target inventory proof"; Value = $TargetInventoryProof },
        @{ Name = "selected Desktop target proof"; Value = $SelectedDesktopTargetProof },
        @{ Name = "dispatch request proof"; Value = $DispatchRequestProof },
        @{ Name = "event replay proof"; Value = $EventReplayProof }
    )) {
        Assert-Required $proof.Name $proof.Value
    }
}

if ($Mode -eq "EvidenceReview") {
    $manifest = Read-JsonFile $EvidenceManifest
    Test-ManifestEvidence $manifest
}

$status = if ($Failures.Count -eq 0) {
    if ($Mode -eq "ProposalOnly") { "BLOCKED_UNTIL_APPROVED" }
    elseif ($Mode -eq "EvidenceReview") { "EVIDENCE_CONTRACT_ACCEPTED" }
    else { "READY_FOR_APPROVED_REAL_LOGIN_E2E" }
} else {
    "BLOCKED"
}

$summary = [ordered]@{
    schema = "agenthub-login-e2e-readiness-v1"
    mode = $Mode
    status = $status
    real_login_executed_by_script = $false
    remote_dispatch_executed_by_script = $false
    token_values_logged = $false
    generated_at = (Get-Date).ToString("o")
    required_prerequisites = @(
        "OAuth client id",
        "exact callback URL",
        "Hub base URL",
        "Web URL",
        "disposable/test account indicator",
        "artifact redaction root under .tmp or tmp",
        "browser evidence boundary",
        "operator approval id",
        "separate real login and remote dispatch approvals"
    )
    required_remote_control_evidence = @(
        "Hub-issued session proof",
        "Hub /web/execution-targets inventory proof",
        "selected online local_edge Desktop target proof",
        "Hub dispatch request proof with target_id",
        "Hub event replay proof after dispatch"
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

Write-Host "Status: $status" -ForegroundColor $(if ($Failures.Count -eq 0) { "Green" } else { "Red" })
Write-Host "RealLoginExecutedByScript=false" -ForegroundColor White
Write-Host "RemoteDispatchExecutedByScript=false" -ForegroundColor White
Write-Host "TokenValuesLogged=false" -ForegroundColor White

if ($Failures.Count -gt 0) {
    exit 1
}

if ($Mode -eq "ProposalOnly") {
    exit 2
}

exit 0
