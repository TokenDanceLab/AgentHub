#!/usr/bin/env pwsh
<#
AgentHub P0 Edge CLI real-readiness proposal gate.

This script is intentionally static and secret-free. It reads repository files
and proposal parameters only. It does not execute Codex, Claude Code, OpenCode,
PowerShell child processes, network calls, or model/API commands.
#>

[CmdletBinding()]
param(
    [string]$RepoRoot = ".",
    [ValidateSet("ProposalOnly", "RealTested", "Submission")]
    [string]$Mode = "ProposalOnly",
    [string]$AdapterId = "",
    [string]$RuntimeId = "",
    [string]$RuntimePath = "",
    [string]$RuntimeEnvManifest = "",
    [string]$BudgetPlan = "",
    [string]$CommandPlan = "",
    [string]$TimeoutPlan = "",
    [string]$RedactionPlan = "",
    [string]$RedactionPolicy = "",
    [string]$ArtifactRoot = "",
    [string]$ArtifactRetention = "",
    [string]$EnvVarOwnership = "",
    [string]$EvidenceMode = "",
    [string]$OperatorApprovalId = "",
    [string]$RealExecutionEvidenceManifest = "",
    [switch]$RequireApprovalInputs,
    [switch]$ApproveNoRealExecution,
    [switch]$ApproveRedactionPolicy,
    [switch]$ApproveArtifactRetention,
    [switch]$ApproveEnvVarOwnership
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath

$Passed = 0
$Failed = 0
$Warnings = 0
$Blocks = 0

$SupportedRuntimeIds = @("codex", "claude-code", "opencode")
$EffectiveAdapterId = if (-not [string]::IsNullOrWhiteSpace($AdapterId)) { $AdapterId } else { $RuntimeId }
$EffectiveRedactionPolicy = if (-not [string]::IsNullOrWhiteSpace($RedactionPolicy)) { $RedactionPolicy } else { $RedactionPlan }
$TempBase = if (-not [string]::IsNullOrWhiteSpace($env:TEMP)) { $env:TEMP } else { [System.IO.Path]::GetTempPath() }
$AllowedArtifactRoots = @(
    [System.IO.Path]::GetFullPath((Join-Path $RepoRoot ".tmp\edge-cli-real-readiness")),
    [System.IO.Path]::GetFullPath((Join-Path $TempBase "AgentHub\edge-cli-real-readiness"))
)
$SecretLikePattern = '(?i)(sk-[a-z0-9_-]{8,}|gh[pousr]_[a-z0-9_]{8,}|xox[baprs]-[a-z0-9-]+|AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|(?:token|secret|api[_-]?key|password|authorization)\s*[:=]\s*\S+)'

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
    $script:Warnings++
    Write-Host "  WARN  $Text" -ForegroundColor Yellow
}

function Block([string]$Text) {
    $script:Blocks++
    Write-Host "  BLOCK real execution: $Text" -ForegroundColor Yellow
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

function Test-NonEmpty([string]$Value) {
    return -not [string]::IsNullOrWhiteSpace($Value)
}

function Get-NormalizedProposedPath([string]$Path) {
    if (-not (Test-NonEmpty $Path)) {
        return ""
    }

    $candidate = if ([System.IO.Path]::IsPathRooted($Path)) { $Path } else { Join-Path $RepoRoot $Path }
    return [System.IO.Path]::GetFullPath($candidate)
}

function Test-PathUnderAllowedRoot([string]$Path) {
    if (-not (Test-NonEmpty $Path)) {
        return $false
    }

    $normalized = Get-NormalizedProposedPath $Path
    foreach ($root in $AllowedArtifactRoots) {
        $normalizedRoot = [System.IO.Path]::GetFullPath($root)
        if ([string]::Equals($normalized, $normalizedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }

        $rootPrefix = $normalizedRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
        if ($normalized.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }

    return $false
}

function Assert-NoSecretLikeInput([string]$Name, [string]$Value) {
    if (-not (Test-NonEmpty $Value)) {
        return
    }

    if ($Value -match $SecretLikePattern) {
        Fail "$Name contains secret-like content; provide names, owners, hashes, or redacted placeholders only"
    } else {
        Pass "$Name contains no secret-like content"
    }
}

function Add-PrerequisiteResult {
    param(
        [bool]$Condition,
        [string]$PassText,
        [string]$BlockText,
        [switch]$FailWhenMissing
    )

    if ($Condition) {
        Pass $PassText
        return
    }

    if ($FailWhenMissing) {
        Fail "missing required approval input: $BlockText"
        return
    }

    Warn $BlockText
    Block $BlockText
}

Write-Host "AgentHub P0 Edge CLI real-readiness proposal gate" -ForegroundColor Magenta
Write-Host "Mode: $Mode" -ForegroundColor Magenta
Write-Host "No Codex, Claude Code, or OpenCode command was executed." -ForegroundColor Magenta
Write-Host "No network, secret, model, or API budget was consumed." -ForegroundColor Magenta

Step "supported adapter/runtime ids"
Assert-Contains "edge-server\internal\adapters\registry.go" 'cliAdapterIDs\s*=\s*map\[string\]struct\{\}' "CLI adapter id allowlist exists"
foreach ($id in $SupportedRuntimeIds) {
    Assert-Contains "edge-server\internal\adapters\registry.go" ('"' + [regex]::Escape($id) + '"') "registry allows $id"
}
Assert-Contains "edge-server\internal\adapters\registry.go" "ValidateCLIAdapterID" "ValidateCLIAdapterID exists"
Assert-Contains "edge-server\internal\adapters\registry_test.go" "TestValidateCLIAdapterID" "supported/unsupported runtime ids are unit-tested"
Assert-Contains "edge-server\internal\adapters\registry_test.go" "agenthub-runner-mock" "mock runner is excluded from real CLI adapter ids"
Assert-Contains "edge-server\cmd\agenthub-edge\main.go" "runnerProfileCodex" "Edge config supports codex runtime profile"
Assert-Contains "edge-server\cmd\agenthub-edge\main.go" "runnerProfileClaudeCode" "Edge config supports claude-code runtime profile"
Assert-Contains "edge-server\cmd\agenthub-edge\main.go" "runnerProfileOpenCode" "Edge config supports opencode runtime profile"
Assert-Contains "edge-server\cmd\agenthub-edge\main.go" "AGENTHUB_CODEX_PATH" "Codex runtime path env is named"
Assert-Contains "edge-server\cmd\agenthub-edge\main.go" "AGENTHUB_CLAUDE_CODE_PATH" "Claude Code runtime path env is named"
Assert-Contains "edge-server\cmd\agenthub-edge\main.go" "AGENTHUB_OPENCODE_PATH" "OpenCode runtime path env is named"

Step "explicit unknown runtime no-fallback evidence"
Assert-Contains "edge-server\internal\adapters\registry.go" 'agent adapter %q not found' "registry resolves explicit unknown adapter as an error"
Assert-Contains "edge-server\internal\lifecycle\process_executor.go" "adapterReg.Resolve\(runCtx.AgentID\)" "process executor resolves explicit run agent id through registry"
Assert-Contains "edge-server\internal\lifecycle\process_executor_test.go" "TestProcessExecutorFailsUnknownExplicitAdapterWithoutDefaultFallback" "lifecycle test covers explicit unknown runtime"
Assert-Contains "edge-server\internal\lifecycle\process_executor_test.go" "unknown-runtime" "lifecycle test uses explicit unknown-runtime id"
Assert-Contains "edge-server\internal\lifecycle\process_executor_test.go" "default adapter was invoked for unknown runtime" "lifecycle test proves no default fallback"
Assert-Contains "docs\backend-integration-governance.md" "unknown runtime.*fallback|agentId.*adapter registry.*fallback" "governance docs require no fallback for unknown runtimes"

Step "proposal/readiness artifact"
Assert-Contains "docs\audit\p0-edge-cli-real-readiness.md" "No real CLI/model run" "audit doc records no real CLI/model run"
Assert-Contains "docs\audit\p0-edge-cli-real-readiness.md" "operator approval" "audit doc records operator approval prerequisite"
Assert-Contains "docs\audit\p0-edge-cli-real-readiness.md" "runtime path/env" "audit doc records runtime path/env prerequisite"
Assert-Contains "docs\audit\p0-edge-cli-real-readiness.md" "budget/redaction" "audit doc records budget/redaction prerequisite"
Assert-Contains "docs\audit\p0-edge-cli-real-readiness.md" "artifact root" "audit doc records artifact root prerequisite"
Assert-Contains "docs\audit\p0-edge-cli-real-readiness.md" "evidence mode" "audit doc records evidence mode prerequisite"
$forbiddenPrimitivePattern = @(
    ("Start" + "-Process"),
    ("Invoke" + "-Expression"),
    ("Invoke" + "-Command"),
    ("Invoke" + "-WebRequest"),
    ("Invoke" + "-RestMethod"),
    ("System" + "\.Diagnostics" + "\.Process"),
    ("Process" + "StartInfo")
) -join "|"
Assert-NotContains "scripts\verify-edge-cli-real-readiness.ps1" $forbiddenPrimitivePattern "this readiness script has no process/network execution primitive"
Assert-NotContains "scripts\verify-edge-cli-real-readiness.ps1" '(?m)^\s*(?:&\s*)?(?:codex|claude|opencode)\b' "this readiness script has no direct real CLI command pattern"

Step "real run approval prerequisites"
$failMissingApprovalInputs = [bool]$RequireApprovalInputs
$runtimeIdKnown = (Test-NonEmpty $EffectiveAdapterId) -and ($SupportedRuntimeIds -contains $EffectiveAdapterId)

if ((Test-NonEmpty $EffectiveAdapterId) -and (-not $runtimeIdKnown)) {
    Fail "unsupported adapter/runtime id; allowed adapters are codex, claude-code, opencode"
}

Assert-NoSecretLikeInput "adapter/runtime id" $EffectiveAdapterId
Assert-NoSecretLikeInput "runtime path" $RuntimePath
Assert-NoSecretLikeInput "runtime env manifest" $RuntimeEnvManifest
Assert-NoSecretLikeInput "budget plan" $BudgetPlan
Assert-NoSecretLikeInput "command plan" $CommandPlan
Assert-NoSecretLikeInput "timeout plan" $TimeoutPlan
Assert-NoSecretLikeInput "redaction policy" $EffectiveRedactionPolicy
Assert-NoSecretLikeInput "artifact root" $ArtifactRoot
Assert-NoSecretLikeInput "artifact retention" $ArtifactRetention
Assert-NoSecretLikeInput "env var ownership" $EnvVarOwnership
Assert-NoSecretLikeInput "evidence mode" $EvidenceMode
Assert-NoSecretLikeInput "operator approval id" $OperatorApprovalId
Assert-NoSecretLikeInput "real execution evidence manifest" $RealExecutionEvidenceManifest

if (Test-NonEmpty $ArtifactRoot) {
    if (Test-PathUnderAllowedRoot $ArtifactRoot) {
        Pass "artifact root is inside allowed temp dirs"
    } else {
        Fail "artifact root is outside allowed temp dirs; use .tmp\edge-cli-real-readiness or `$env:TEMP\AgentHub\edge-cli-real-readiness"
    }
}

Add-PrerequisiteResult $runtimeIdKnown "adapter/runtime id is one of: codex, claude-code, opencode" "adapter/runtime id missing or unsupported; pass -AdapterId codex|claude-code|opencode" -FailWhenMissing:$failMissingApprovalInputs
Add-PrerequisiteResult (Test-NonEmpty $RuntimePath) "runtime path is named for approval evidence" "runtime path missing; provide a redacted path/owner, not CLI auth contents" -FailWhenMissing:$failMissingApprovalInputs
Add-PrerequisiteResult (Test-NonEmpty $RuntimeEnvManifest) "runtime env manifest is named for approval evidence" "runtime path/env missing; provide required env names and owners without values" -FailWhenMissing:$failMissingApprovalInputs
Add-PrerequisiteResult (Test-NonEmpty $EnvVarOwnership) "env var ownership is named" "env var ownership missing; name each required env var owner without values" -FailWhenMissing:$failMissingApprovalInputs
Add-PrerequisiteResult (Test-NonEmpty $BudgetPlan) "budget/request limit plan is named" "budget missing; provide max calls/tokens/cost/time and stop policy" -FailWhenMissing:$failMissingApprovalInputs
Add-PrerequisiteResult (Test-NonEmpty $CommandPlan) "future command plan is named" "command missing; provide exact future CLI command shape without executing it" -FailWhenMissing:$failMissingApprovalInputs
Add-PrerequisiteResult (Test-NonEmpty $TimeoutPlan) "timeout/kill policy is named" "timeout missing; provide hard timeout and process-tree kill policy" -FailWhenMissing:$failMissingApprovalInputs
Add-PrerequisiteResult (Test-NonEmpty $EffectiveRedactionPolicy) "redaction policy is named" "redaction missing; provide stdout/stderr/env/artifact redaction policy" -FailWhenMissing:$failMissingApprovalInputs
Add-PrerequisiteResult ((Test-NonEmpty $ArtifactRoot) -and (Test-PathUnderAllowedRoot $ArtifactRoot)) "artifact root is named and inside allowed temp dirs" "artifact root missing or outside allowed temp dirs; provide isolated output directory for real-run evidence" -FailWhenMissing:$failMissingApprovalInputs
Add-PrerequisiteResult (Test-NonEmpty $ArtifactRetention) "artifact retention policy is named" "artifact retention missing; provide retention owner, duration, and raw-artifact deletion policy" -FailWhenMissing:$failMissingApprovalInputs
Add-PrerequisiteResult (Test-NonEmpty $EvidenceMode) "evidence mode is named" "evidence mode missing; provide redacted-log/hash-only/operator-reviewed mode" -FailWhenMissing:$failMissingApprovalInputs
Add-PrerequisiteResult (Test-NonEmpty $OperatorApprovalId) "operator approval id is named" "operator approval missing; provide approval id before RealTested or Submission" -FailWhenMissing:$failMissingApprovalInputs
Add-PrerequisiteResult ([bool]$ApproveNoRealExecution) "approval flag confirms this verifier is static and ran no real CLI/model call" "approval flag missing: -ApproveNoRealExecution" -FailWhenMissing:$failMissingApprovalInputs
Add-PrerequisiteResult ([bool]$ApproveRedactionPolicy) "approval flag confirms redaction policy review" "approval flag missing: -ApproveRedactionPolicy" -FailWhenMissing:$failMissingApprovalInputs
Add-PrerequisiteResult ([bool]$ApproveArtifactRetention) "approval flag confirms artifact retention review" "approval flag missing: -ApproveArtifactRetention" -FailWhenMissing:$failMissingApprovalInputs
Add-PrerequisiteResult ([bool]$ApproveEnvVarOwnership) "approval flag confirms env var ownership review" "approval flag missing: -ApproveEnvVarOwnership" -FailWhenMissing:$failMissingApprovalInputs

if ($Mode -ne "ProposalOnly") {
    if (Test-NonEmpty $RealExecutionEvidenceManifest) {
        Warn "real execution evidence manifest parameter was provided but is not validated by this static proposal gate"
    } else {
        Warn "real execution evidence manifest missing"
    }
    Block "RealTested/Submission require an independent real-run verifier; this static gate cannot prove real CLI/model execution"
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed  |  Warnings: $Warnings  |  Blocks: $Blocks" -ForegroundColor $(if ($Failed -eq 0 -and ($Mode -eq "ProposalOnly" -or $Blocks -eq 0)) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Mode -eq "ProposalOnly") {
    Write-Host "Status: PROPOSAL_ONLY" -ForegroundColor Yellow
    if ($Blocks -gt 0) {
        Write-Host "Real execution remains blocked until every prerequisite above is cleared by operator approval." -ForegroundColor Yellow
    }
    exit $(if ($Failed -gt 0) { 1 } else { 0 })
}

if ($Failed -gt 0 -or $Blocks -gt 0) {
    Write-Host "Status: BLOCKED_FOR_REAL_EXECUTION" -ForegroundColor Red
    Write-Host "RealTested/Submission modes require a separate approved real-run verifier with redacted evidence." -ForegroundColor Red
    exit 1
}

Write-Host "Status: BLOCKED_FOR_REAL_EXECUTION" -ForegroundColor Red
Write-Host "Non-proposal modes are not successful in this static verifier." -ForegroundColor Red
exit 1
