#!/usr/bin/env pwsh
<#
AgentHub approved-real preflight manifest gate.

This script validates the operator-approved manifest needed before any real
login, CLI/model/API, deploy, signing, notarization, updater, release, or
production action can be attempted. It never executes those actions.
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = ".",
    [string]$ManifestPath = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath
$Passed = 0
$Failed = 0
$Blocks = 0

$SecretLikePattern = '(?i)(sk-[a-z0-9_-]{8,}|gh[pousr]_[a-z0-9_]{8,}|xox[baprs]-[a-z0-9-]+|AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|(?:token|secret|api[_-]?key|password|authorization)\s*[:=]\s*\S+)'
$SensitiveNamePattern = '(?i)(access[_-]?token|refresh[_-]?token|secret|password|authorization|api[_-]?key|private[_-]?key)'
$ProductionActionNamePattern = '(?i)(production|deploy|sign|notar|release|updater)'
$SafeSensitiveValuePattern = '(?i)^(redacted|<redacted>|placeholder|not provided|none|n/a|identifier-only|owned by .+|operator-owned .+|.+ owner only|.+ names only)$'

function Pass([string]$Text) {
    $script:Passed++
    Write-Host "PASS $Text" -ForegroundColor Green
}

function Fail([string]$Text) {
    $script:Failed++
    Write-Host "FAIL $Text" -ForegroundColor Red
}

function Block([string]$Text) {
    $script:Blocks++
    Write-Host "BLOCK $Text" -ForegroundColor Yellow
}

function Test-NonEmptyString([object]$Value) {
    return ($Value -is [string] -and -not [string]::IsNullOrWhiteSpace($Value))
}

function Get-ValueAtPath {
    param(
        [object]$Object,
        [string]$Path
    )

    $current = $Object
    foreach ($part in $Path.Split(".")) {
        if ($null -eq $current) {
            return $null
        }
        $prop = $current.PSObject.Properties[$part]
        if ($null -eq $prop) {
            return $null
        }
        $current = $prop.Value
    }
    return $current
}

function Require-StringPath {
    param(
        [object]$Object,
        [string]$Path,
        [string]$Label
    )

    $value = Get-ValueAtPath $Object $Path
    if (Test-NonEmptyString $value) {
        Pass "$Label is declared"
        return [string]$value
    }

    Fail "$Label missing or not a non-empty string ($Path)"
    return $null
}

function Require-ObjectPath {
    param(
        [object]$Object,
        [string]$Path,
        [string]$Label
    )

    $value = Get-ValueAtPath $Object $Path
    if ($null -ne $value -and $value -isnot [string] -and $value -isnot [array]) {
        Pass "$Label is declared"
        return $value
    }

    Fail "$Label missing or not an object ($Path)"
    return $null
}

function Require-NumberPath {
    param(
        [object]$Object,
        [string]$Path,
        [string]$Label
    )

    $value = Get-ValueAtPath $Object $Path
    if (($value -is [int] -or $value -is [long] -or $value -is [double]) -and [double]$value -gt 0) {
        Pass "$Label is declared"
        return [double]$value
    }

    Fail "$Label missing or not a positive number ($Path)"
    return $null
}

function Require-ArrayPath {
    param(
        [object]$Object,
        [string]$Path,
        [string]$Label
    )

    $value = Get-ValueAtPath $Object $Path
    if ($null -ne $value -and $value -is [array] -and $value.Count -gt 0) {
        Pass "$Label is declared"
        return @($value)
    }

    Fail "$Label missing or not a non-empty array ($Path)"
    return @()
}

function Test-ApprovedActionObject {
    param([object]$Value)

    if ($Value -is [bool]) {
        return (-not $Value)
    }
    if ($Value -is [string]) {
        return ($Value -match '(?i)^(false|blocked|disallowed|not_approved|none|n/a)$')
    }
    if ($null -ne $Value) {
        $approved = $Value.PSObject.Properties["approved"]
        $approvalId = $Value.PSObject.Properties["approval_id"]
        return ($null -ne $approved -and $approved.Value -eq $true -and $null -ne $approvalId -and (Test-NonEmptyString $approvalId.Value))
    }
    return $true
}

function Inspect-JsonTree {
    param(
        [object]$Node,
        [string]$Path = "$"
    )

    if ($null -eq $Node) {
        return
    }

    if ($Node -is [array]) {
        for ($i = 0; $i -lt $Node.Count; $i++) {
            Inspect-JsonTree $Node[$i] "$Path[$i]"
        }
        return
    }

    if ($Node -is [string]) {
        if ($Node -match $SecretLikePattern) {
            Fail "$Path contains secret-like content; use identifiers, owners, hashes, or redacted placeholders only"
        }
        return
    }

    if ($Node -is [bool] -or $Node -is [int] -or $Node -is [long] -or $Node -is [double]) {
        return
    }

    foreach ($prop in $Node.PSObject.Properties) {
        $childPath = "$Path.$($prop.Name)"
        if ($prop.Name -match $SensitiveNamePattern -and $prop.Value -is [string]) {
            $value = [string]$prop.Value
            if (-not [string]::IsNullOrWhiteSpace($value) -and $value -notmatch $SafeSensitiveValuePattern) {
                Fail "$childPath declares a sensitive value; use owner-only or redacted text, never a secret"
            }
        }

        if ($prop.Name -match $ProductionActionNamePattern) {
            if (-not (Test-ApprovedActionObject $prop.Value)) {
                Block "$childPath is production/deploy/sign/release/updater scoped but lacks explicit approval_id"
            }
        }

        Inspect-JsonTree $prop.Value $childPath
    }
}

function Assert-UriLike {
    param(
        [string]$Value,
        [string]$Label
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return
    }
    if ($Value -match '^(https?://|file://|app://|tauri://|ws://|wss://|localhost:|127\.0\.0\.1:)') {
        Pass "$Label has an explicit URL/origin shape"
    } else {
        Fail "$Label must be an explicit URL/origin, not a vague environment name"
    }
}

function Test-RuntimeReadinessEntry {
    param([object]$Runtime)

    $runtimeId = Require-StringPath $Runtime "runtime_id" "runtime_readiness.runtime_id"
    if (@("codex", "claude-code", "opencode") -contains $runtimeId) {
        Pass "runtime_readiness $runtimeId is supported"
    } elseif (-not [string]::IsNullOrWhiteSpace($runtimeId)) {
        Fail "runtime_readiness runtime_id must be codex, claude-code, or opencode, got '$runtimeId'"
    }

    Require-StringPath $Runtime "command_discovery.command_name" "runtime_readiness.$runtimeId command_discovery.command_name" | Out-Null
    $installed = Get-ValueAtPath $Runtime "command_discovery.installed"
    if ($installed -is [bool]) {
        Pass "runtime_readiness.$runtimeId command_discovery.installed is boolean"
    } else {
        Fail "runtime_readiness.$runtimeId command_discovery.installed missing or not boolean"
    }
    Require-StringPath $Runtime "json_mode.expected_flag_or_mode" "runtime_readiness.$runtimeId json_mode.expected_flag_or_mode" | Out-Null
    Require-StringPath $Runtime "permission_boundary.expected_mode" "runtime_readiness.$runtimeId permission_boundary.expected_mode" | Out-Null
    Require-StringPath $Runtime "budget.stop_policy" "runtime_readiness.$runtimeId budget.stop_policy" | Out-Null
    Require-StringPath $Runtime "timeouts.kill_policy" "runtime_readiness.$runtimeId timeouts.kill_policy" | Out-Null
    Require-StringPath $Runtime "artifacts.root_policy" "runtime_readiness.$runtimeId artifacts.root_policy" | Out-Null
    Require-StringPath $Runtime "redaction_manifest.policy" "runtime_readiness.$runtimeId redaction_manifest.policy" | Out-Null
}

Write-Host "AgentHub approved-real preflight manifest gate" -ForegroundColor Magenta
Write-Host "Input kind: manifest/preflight only" -ForegroundColor Magenta
Write-Host "No login, CLI/model/API, deploy, sign, notarization, updater, release upload, network, or production command was executed." -ForegroundColor Magenta
Write-Host "real_tested=false" -ForegroundColor Magenta

if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    Fail "explicit -ManifestPath is required"
    Write-Host "Status: APPROVED_REAL_PREFLIGHT_BLOCKED" -ForegroundColor Red
    exit 1
}

$resolvedManifest = if ([System.IO.Path]::IsPathRooted($ManifestPath)) { $ManifestPath } else { Join-Path $RepoRoot $ManifestPath }
$resolvedManifest = [System.IO.Path]::GetFullPath($resolvedManifest)
if (-not (Test-Path -LiteralPath $resolvedManifest -PathType Leaf)) {
    Fail "manifest file not found: $resolvedManifest"
    Write-Host "Status: APPROVED_REAL_PREFLIGHT_BLOCKED" -ForegroundColor Red
    exit 1
}

$raw = Get-Content -LiteralPath $resolvedManifest -Raw -Encoding UTF8
if ($raw -match $SecretLikePattern) {
    Fail "manifest contains secret-like content; provide identifiers, owners, hashes, or redacted placeholders only"
}

try {
    $manifest = $raw | ConvertFrom-Json
    Pass "manifest JSON parsed"
} catch {
    Fail "manifest is not valid JSON"
    Write-Host "Status: APPROVED_REAL_PREFLIGHT_BLOCKED" -ForegroundColor Red
    exit 1
}

Inspect-JsonTree $manifest

$mode = Require-StringPath $manifest "mode" "mode"
if ($mode -eq "approved-real") {
    Pass "mode=approved-real"
} elseif (-not [string]::IsNullOrWhiteSpace($mode)) {
    Fail "mode must be approved-real, got '$mode'"
}

Require-StringPath $manifest "approved_by" "approved_by" | Out-Null
Require-StringPath $manifest "approval_id" "approval_id" | Out-Null
Require-StringPath $manifest "artifact_root" "artifact_root" | Out-Null

$redaction = Require-ObjectPath $manifest "redaction_policy" "redaction_policy"
if ($null -ne $redaction) {
    foreach ($path in @("stdout", "stderr", "env", "artifacts")) {
        Require-StringPath $manifest "redaction_policy.$path" "redaction_policy.$path" | Out-Null
    }
}

Require-ObjectPath $manifest "timeouts" "timeouts" | Out-Null
Require-NumberPath $manifest "timeouts.total_seconds" "timeouts.total_seconds" | Out-Null
Require-NumberPath $manifest "timeouts.per_step_seconds" "timeouts.per_step_seconds" | Out-Null
Require-StringPath $manifest "timeouts.kill_policy" "timeouts.kill_policy" | Out-Null

Require-ObjectPath $manifest "budget" "budget" | Out-Null
Require-NumberPath $manifest "budget.max_usd" "budget.max_usd" | Out-Null
Require-NumberPath $manifest "budget.max_requests" "budget.max_requests" | Out-Null
Require-StringPath $manifest "budget.stop_policy" "budget.stop_policy" | Out-Null

Require-StringPath $manifest "target_runtime.id" "target runtime id" | Out-Null
Require-StringPath $manifest "target_runtime.kind" "target runtime kind" | Out-Null
Require-StringPath $manifest "cli.command_path" "CLI command path" | Out-Null
Require-StringPath $manifest "cli.command_plan" "future CLI command plan" | Out-Null

$runtimeReadiness = Require-ArrayPath $manifest "runtime_readiness" "runtime_readiness"
$seenRuntimeIds = @{}
foreach ($runtime in $runtimeReadiness) {
    Test-RuntimeReadinessEntry $runtime
    $runtimeId = [string](Get-ValueAtPath $runtime "runtime_id")
    if (-not [string]::IsNullOrWhiteSpace($runtimeId)) {
        $seenRuntimeIds[$runtimeId] = $true
    }
}
foreach ($runtimeId in @("codex", "claude-code", "opencode")) {
    if ($seenRuntimeIds.ContainsKey($runtimeId)) {
        Pass "runtime_readiness includes $runtimeId"
    } else {
        Fail "runtime_readiness missing $runtimeId"
    }
}

$hubUrl = Require-StringPath $manifest "urls.hub" "Hub URL"
$webUrl = Require-StringPath $manifest "urls.web" "Web URL"
$desktopUrl = Require-StringPath $manifest "urls.desktop" "Desktop URL"
$edgeUrl = Require-StringPath $manifest "urls.edge" "Local Edge URL"
Assert-UriLike $hubUrl "Hub URL"
Assert-UriLike $webUrl "Web URL"
Assert-UriLike $desktopUrl "Desktop URL"
Assert-UriLike $edgeUrl "Local Edge URL"

Require-StringPath $manifest "test_identifiers.account_id" "test account identifier" | Out-Null
Require-StringPath $manifest "test_identifiers.client_id" "test client identifier" | Out-Null
Require-StringPath $manifest "test_identifiers.target_id" "target identifier" | Out-Null

Write-Host "`nMode boundaries:" -ForegroundColor Cyan
Write-Host "  fixture=not-run" -ForegroundColor White
Write-Host "  observed=not-run" -ForegroundColor White
Write-Host "  approved-real=manifest-validated-only" -ForegroundColor White
Write-Host "  production=blocked-unless-separately-approved" -ForegroundColor White
Write-Host "  real_tested=false" -ForegroundColor White

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed  |  Blocks: $Blocks" -ForegroundColor $(if ($Failed -eq 0 -and $Blocks -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -gt 0 -or $Blocks -gt 0) {
    Write-Host "Status: APPROVED_REAL_PREFLIGHT_BLOCKED" -ForegroundColor Red
    exit 1
}

Write-Host "Status: APPROVED_REAL_PREFLIGHT_MANIFEST_OK" -ForegroundColor Green
Write-Host "Approved-real preflight manifest is complete; this is not evidence that real login, CLI/model/API, deploy, signing, notarization, release upload, or production execution occurred." -ForegroundColor Yellow
exit 0
