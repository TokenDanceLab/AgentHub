#!/usr/bin/env pwsh
<#
AgentHub P0 Edge CLI real-readiness proposal gate.

This script is intentionally secret-free. By default it reads repository files
and proposal parameters only. With -DiscoverCommands it may run Get-Command plus
runtime --version/--help probes; it never executes prompt-bearing CLI, network,
secret, workspace, or model/API commands.
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
    [string]$OutputManifestPath = "",
    [switch]$RequireApprovalInputs,
    [switch]$DiscoverCommands,
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
$RuntimeReadinessDescriptors = @(
    [ordered]@{
        RuntimeId = "codex"
        CommandName = "codex"
        VersionArgs = @("--version")
        HelpArgs = @("--help")
        JsonMode = "codex exec --json"
        PermissionBoundary = "operator-approved mode only; never infer approval from CLI defaults"
        DryPlan = "discover command, inspect --version/--help, record future codex exec --json command shape without prompt"
        EnvNames = @("AGENTHUB_CODEX_PATH", "OPENAI_API_KEY")
    },
    [ordered]@{
        RuntimeId = "claude-code"
        CommandName = "claude"
        VersionArgs = @("--version")
        HelpArgs = @("--help")
        JsonMode = "claude --output-format stream-json"
        PermissionBoundary = "operator-approved permission mode only; approval bridge must be reviewed before real prompt"
        DryPlan = "discover command, inspect --version/--help, record future claude stream-json command shape without prompt"
        EnvNames = @("AGENTHUB_CLAUDE_CODE_PATH", "ANTHROPIC_API_KEY")
    },
    [ordered]@{
        RuntimeId = "opencode"
        CommandName = "opencode"
        VersionArgs = @("--version")
        HelpArgs = @("--help")
        JsonMode = "opencode JSON event stream"
        PermissionBoundary = "default must not enable dangerously-skip-permissions; bypass requires explicit approval"
        DryPlan = "discover command, inspect --version/--help, record future opencode JSON command shape without prompt"
        EnvNames = @("AGENTHUB_OPENCODE_PATH")
    }
)
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

function ConvertTo-SafeProbeText([object[]]$Output) {
    $text = (($Output | ForEach-Object { [string]$_ }) -join "`n").Trim()
    if ([string]::IsNullOrWhiteSpace($text)) {
        return ""
    }
    $text = $text -replace $SecretLikePattern, "[redacted]"
    $text = $text -replace [regex]::Escape($RepoRoot), "[repo-root]"
    $text = $text -replace [regex]::Escape($env:USERPROFILE), "[user-profile]"
    if ($text.Length -gt 300) {
        return $text.Substring(0, 300) + "...[truncated]"
    }
    return $text
}

function Invoke-NoSpendCliProbe {
    param(
        [string]$CommandPath,
        [string[]]$Arguments
    )

    try {
        $output = & $CommandPath @Arguments 2>&1
        return [ordered]@{
            attempted = $true
            exit_code = $LASTEXITCODE
            output_preview = ConvertTo-SafeProbeText @($output)
        }
    } catch {
        return [ordered]@{
            attempted = $true
            exit_code = $null
            output_preview = "probe failed: " + (ConvertTo-SafeProbeText @($_.Exception.Message))
        }
    }
}

function New-RuntimeReadinessManifest {
    $runtimes = @()
    foreach ($descriptor in $RuntimeReadinessDescriptors) {
        $command = Get-Command $descriptor.CommandName -ErrorAction SilentlyContinue | Select-Object -First 1
        $installed = $null -ne $command
        $versionProbe = [ordered]@{ attempted = $false; exit_code = $null; output_preview = "" }
        $helpProbe = [ordered]@{ attempted = $false; exit_code = $null; output_preview = "" }
        if ($DiscoverCommands -and $installed) {
            $versionProbe = Invoke-NoSpendCliProbe -CommandPath $command.Source -Arguments $descriptor.VersionArgs
            $helpProbe = Invoke-NoSpendCliProbe -CommandPath $command.Source -Arguments $descriptor.HelpArgs
        }

        $runtimes += [ordered]@{
            runtime_id = $descriptor.RuntimeId
            command_discovery = [ordered]@{
                command_name = $descriptor.CommandName
                installed = $installed
                resolved_path_kind = if ($installed) { "basename-only-redacted" } else { "missing" }
                resolved_path = if ($installed) { Split-Path -Leaf $command.Source } else { "" }
                version_probe = $versionProbe
                help_probe = $helpProbe
            }
            json_mode = [ordered]@{
                expected_flag_or_mode = $descriptor.JsonMode
                dry_plan_only = $true
            }
            permission_boundary = [ordered]@{
                expected_mode = $descriptor.PermissionBoundary
                approval_required = $true
            }
            budget = [ordered]@{
                max_requests_before_real_approval = 0
                max_usd_before_real_approval = 0
                stop_policy = "no prompt/model/API execution in readiness; approved-real run must provide explicit budget"
            }
            timeouts = [ordered]@{
                discovery_probe = "version/help only; no prompt stdin"
                kill_policy = "future real run must provide hard timeout and process-tree kill policy"
            }
            artifacts = [ordered]@{
                root_policy = ".tmp/edge-cli-real-readiness or temp AgentHub edge-cli-real-readiness only"
                manifest_required = $true
            }
            redaction_manifest = [ordered]@{
                policy = "env names only; stdout/stderr/artifacts redacted before publication"
                secret_values_allowed = $false
            }
            dry_plan = $descriptor.DryPlan
            env_names = $descriptor.EnvNames
        }
    }

    return [ordered]@{
        schema = "agenthub-edge-cli-approved-real-readiness-v1"
        generated_at = (Get-Date).ToUniversalTime().ToString("o")
        mode = $Mode
        real_tested = $false
        model_api_consumed = $false
        prompt_executed = $false
        discovery_commands_attempted = [bool]$DiscoverCommands
        no_spend_boundary = "command discovery, --version, and --help only; no prompt/model/API call"
        runtimes = $runtimes
    }
}

function Write-ReadinessManifest {
    param([object]$Manifest)

    if ([string]::IsNullOrWhiteSpace($OutputManifestPath)) {
        return
    }

    $resolved = if ([System.IO.Path]::IsPathRooted($OutputManifestPath)) { $OutputManifestPath } else { Join-Path $RepoRoot $OutputManifestPath }
    $resolved = [System.IO.Path]::GetFullPath($resolved)
    $parent = Split-Path -Parent $resolved
    if (-not [string]::IsNullOrWhiteSpace($parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $Manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resolved -Encoding UTF8
    Pass "wrote per-runtime readiness manifest to $resolved"
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
if ($DiscoverCommands) {
    Write-Host "Codex, Claude Code, and OpenCode probes are limited to Get-Command, --version, and --help." -ForegroundColor Magenta
    Write-Host "No prompt, model, API, secret, approval, or workspace command is executed." -ForegroundColor Magenta
} else {
    Write-Host "No Codex, Claude Code, or OpenCode command was executed." -ForegroundColor Magenta
}
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
Assert-Contains "docs\governance\governance-execution.md" "unknown runtime.*fallback|agentId.*adapter registry.*fallback" "governance docs require no fallback for unknown runtimes"

Step "proposal/readiness artifact"
Assert-Contains "docs\governance\governance-execution.md" "No real CLI/model run" "governance doc records no real CLI/model run"
Assert-Contains "docs\governance\governance-execution.md" "operator approval" "governance doc records operator approval prerequisite"
Assert-Contains "docs\governance\governance-execution.md" "runtime path/env" "governance doc records runtime path/env prerequisite"
Assert-Contains "docs\governance\governance-execution.md" "budget/redaction" "governance doc records budget/redaction prerequisite"
Assert-Contains "docs\governance\governance-execution.md" "artifact root" "governance doc records artifact root prerequisite"
Assert-Contains "docs\governance\governance-execution.md" "evidence mode" "governance doc records evidence mode prerequisite"
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

Step "per-runtime readiness manifest"
$readinessManifest = New-RuntimeReadinessManifest
foreach ($runtime in $readinessManifest.runtimes) {
    $status = if ($runtime.command_discovery.installed) { "installed" } else { "missing" }
    Pass "$($runtime.runtime_id) readiness manifest prepared ($status)"
}
Write-ReadinessManifest $readinessManifest

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
