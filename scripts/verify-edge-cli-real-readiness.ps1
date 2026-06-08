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
    [string]$RuntimeId = "",
    [string]$RuntimePath = "",
    [string]$RuntimeEnvManifest = "",
    [string]$BudgetPlan = "",
    [string]$RedactionPlan = "",
    [string]$ArtifactRoot = "",
    [string]$EvidenceMode = "",
    [string]$OperatorApprovalId = "",
    [string]$RealExecutionEvidenceManifest = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path $RepoRoot).ProviderPath

$Passed = 0
$Failed = 0
$Warnings = 0
$Blocks = 0

$SupportedRuntimeIds = @("codex", "claude-code", "opencode")

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

function Add-PrerequisiteResult {
    param(
        [bool]$Condition,
        [string]$PassText,
        [string]$BlockText
    )

    if ($Condition) {
        Pass $PassText
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
Assert-Contains "docs\backend-integration-governance.md" "unknown runtime.*fallback|未知 runtime.*fallback" "governance docs require no fallback for unknown runtimes"

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
$runtimeIdKnown = (Test-NonEmpty $RuntimeId) -and ($SupportedRuntimeIds -contains $RuntimeId)
Add-PrerequisiteResult $runtimeIdKnown "runtime id is one of: codex, claude-code, opencode" "runtime id missing or unsupported; pass -RuntimeId codex|claude-code|opencode"
Add-PrerequisiteResult (Test-NonEmpty $RuntimePath) "runtime path is named for approval evidence" "runtime path missing; provide a redacted path/owner, not CLI auth contents"
Add-PrerequisiteResult (Test-NonEmpty $RuntimeEnvManifest) "runtime env manifest is named for approval evidence" "runtime path/env missing; provide required env names and owners without values"
Add-PrerequisiteResult (Test-NonEmpty $BudgetPlan) "budget/request limit plan is named" "budget missing; provide max calls/tokens/cost/time and stop policy"
Add-PrerequisiteResult (Test-NonEmpty $RedactionPlan) "redaction plan is named" "redaction missing; provide stdout/stderr/env/artifact redaction policy"
Add-PrerequisiteResult (Test-NonEmpty $ArtifactRoot) "artifact root is named" "artifact root missing; provide isolated output directory for real-run evidence"
Add-PrerequisiteResult (Test-NonEmpty $EvidenceMode) "evidence mode is named" "evidence mode missing; provide redacted-log/hash-only/operator-reviewed mode"
Add-PrerequisiteResult (Test-NonEmpty $OperatorApprovalId) "operator approval id is named" "operator approval missing; provide approval id before RealTested or Submission"

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
