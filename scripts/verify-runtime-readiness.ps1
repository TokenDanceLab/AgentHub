#!/usr/bin/env pwsh
<#
AgentHub Agent Runtime readiness checks.

This script is intentionally secret-free and structural. It verifies repository
wiring for real Claude Code / Codex / OpenCode runtime adapters, Edge APIs,
Desktop/Web display boundaries, and docs. It does not execute agent CLIs, call
models, read CLI auth files, or connect to production.
#>

[CmdletBinding()]
param()

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

function Assert-LiteralContains([string]$RelativePath, [string]$Text, [string]$Label) {
    $content = Read-RepoFile $RelativePath
    if ($content.Contains($Text)) {
        Pass $Label
    } else {
        Fail "$Label ($RelativePath missing text: $Text)"
    }
}

function Assert-LiteralNotContains([string]$RelativePath, [string]$Text, [string]$Label) {
    $content = Read-RepoFile $RelativePath
    if (-not $content.Contains($Text)) {
        Pass $Label
    } else {
        Fail "$Label ($RelativePath contains text: $Text)"
    }
}

function Assert-PathMissing([string]$RelativePath, [string]$Label) {
    $path = Join-Path $RepoRoot $RelativePath
    if (-not (Test-Path -LiteralPath $path)) {
        Pass $Label
    } else {
        Fail "$Label ($RelativePath should not exist)"
    }
}

Step "Runtime architecture boundary"
Assert-PathMissing "runner" "standalone root runner component is absent"
Assert-Contains "README.md" "Agent Runtime" "README uses Agent Runtime terminology"
Assert-Contains "README.md" "internal/lifecycle/" "README points execution lifecycle at Edge lifecycle"
Assert-Contains "README.md" "internal/adapters/" "README points protocol adapters at Edge adapters"
Assert-Contains "edge-server/README.md" "internal/runners/.*兼容旧 UI|internal/runners/.*compat" "Edge README marks runner registry as compatibility layer"
Assert-Contains "api/deprecations.md" "/v1/runners.*Keep \(Edge compatibility\)" "API deprecations mark /v1/runners as compatibility"

Step "AgentAdapter interface and event taxonomy"
Assert-Contains "edge-server/internal/adapters/adapter.go" "type AgentAdapter interface" "AgentAdapter interface exists"
Assert-LiteralContains "edge-server/internal/adapters/adapter.go" "BuildCommand(ctx RunProcessContext)" "AgentAdapter exposes BuildCommand"
Assert-LiteralContains "edge-server/internal/adapters/adapter.go" "ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer" "AgentAdapter exposes ParseStream"
Assert-LiteralContains "edge-server/internal/adapters/adapter.go" "NeedsStdin() bool" "AgentAdapter exposes NeedsStdin"
Assert-LiteralContains "edge-server/internal/adapters/adapter.go" "Available() bool" "AgentAdapter exposes Available"
Assert-LiteralContains "edge-server/internal/adapters/adapter.go" 'BusEventTextDelta           = "run.agent.text_delta"' "unified text_delta event exists"
Assert-LiteralContains "edge-server/internal/adapters/adapter.go" 'BusEventToolCall            = "run.agent.tool_call"' "unified tool_call event exists"
Assert-LiteralContains "edge-server/internal/adapters/adapter.go" 'BusEventFileChange          = "run.agent.file_change"' "unified file_change event exists"
Assert-LiteralContains "edge-server/internal/adapters/adapter.go" 'BusEventPermissionRequested = "run.agent.permission_requested"' "unified permission_requested event exists"

Step "Real runtime adapters"
Assert-Contains "edge-server/internal/adapters/claude_code.go" "NewClaudeCodeAdapter" "Claude Code adapter constructor exists"
Assert-LiteralContains "edge-server/internal/adapters/claude_code.go" "exec.LookPath" "Claude Code adapter checks binary availability"
Assert-Contains "edge-server/internal/adapters/claude_code.go" '--output-format", "stream-json"' "Claude Code adapter uses stream-json protocol"
Assert-LiteralContains "edge-server/internal/adapters/claude_code.go" "func (a *ClaudeCodeAdapter) NeedsStdin() bool { return true }" "Claude Code adapter declares stdin need"
Assert-LiteralContains "edge-server/internal/adapters/claude_code.go" "func (a *ClaudeCodeAdapter) Available() bool" "Claude Code adapter exposes availability"

Assert-Contains "edge-server/internal/adapters/codex.go" "NewCodexAdapter" "Codex adapter constructor exists"
Assert-LiteralContains "edge-server/internal/adapters/codex.go" "exec.LookPath" "Codex adapter checks binary availability"
Assert-Contains "edge-server/internal/adapters/codex.go" 'args := \[\]string\{"exec"\}' "Codex adapter invokes codex exec"
Assert-Contains "edge-server/internal/adapters/codex.go" 'args = append\(args, "--json"\)' "Codex adapter requests JSONL output"
Assert-LiteralContains "edge-server/internal/adapters/codex.go" "func (a *CodexAdapter) NeedsStdin() bool { return false }" "Codex adapter does not require stdin"
Assert-LiteralContains "edge-server/internal/adapters/codex.go" "func (a *CodexAdapter) Available() bool" "Codex adapter exposes availability"

Assert-Contains "edge-server/internal/adapters/opencode.go" "NewOpenCodeAdapter" "OpenCode adapter constructor exists"
Assert-LiteralContains "edge-server/internal/adapters/opencode.go" "exec.LookPath" "OpenCode adapter checks binary availability"
Assert-Contains "edge-server/internal/adapters/opencode.go" 'args := \[\]string\{"run", "--format", "json"\}' "OpenCode adapter requests JSON output"
Assert-LiteralContains "edge-server/internal/adapters/opencode.go" "func (a *OpenCodeAdapter) NeedsStdin() bool { return false }" "OpenCode adapter does not require stdin"
Assert-LiteralContains "edge-server/internal/adapters/opencode.go" "func (a *OpenCodeAdapter) Available() bool" "OpenCode adapter exposes availability"

Step "Edge CLI configuration and registry"
Assert-Contains "edge-server/cmd/agenthub-edge/main.go" "AGENTHUB_AGENT_DEFAULT" "Edge supports AGENTHUB_AGENT_DEFAULT"
Assert-Contains "edge-server/cmd/agenthub-edge/main.go" "AGENTHUB_RUNNER_PROFILE" "Edge supports compatibility runner profile env"
Assert-Contains "edge-server/cmd/agenthub-edge/main.go" "AGENTHUB_CLAUDE_CODE_PATH" "Edge supports Claude Code path env"
Assert-Contains "edge-server/cmd/agenthub-edge/main.go" "AGENTHUB_CODEX_PATH" "Edge supports Codex path env"
Assert-Contains "edge-server/cmd/agenthub-edge/main.go" "AGENTHUB_OPENCODE_PATH" "Edge supports OpenCode path env"
Assert-Contains "edge-server/cmd/agenthub-edge/main.go" "func applyRunnerProfile" "runner profile compatibility mapper exists"
Assert-Contains "edge-server/cmd/agenthub-edge/main.go" "runnerProfileClaudeCode" "runner profile maps Claude Code"
Assert-Contains "edge-server/cmd/agenthub-edge/main.go" "runnerProfileCodex" "runner profile maps Codex"
Assert-Contains "edge-server/cmd/agenthub-edge/main.go" "runnerProfileOpenCode" "runner profile maps OpenCode"
Assert-LiteralContains "edge-server/cmd/agenthub-edge/main.go" "adapters.NewClaudeCodeAdapter" "Edge registers Claude Code adapter"
Assert-LiteralContains "edge-server/cmd/agenthub-edge/main.go" "adapters.NewCodexAdapter" "Edge registers Codex adapter"
Assert-LiteralContains "edge-server/cmd/agenthub-edge/main.go" "adapters.NewOpenCodeAdapter" "Edge registers OpenCode adapter"

Step "Run lifecycle and Hub bridge"
Assert-LiteralContains "edge-server/internal/api/handlers.go" 'AgentID           string `json:"agentId"`' "POST /v1/runs accepts agentId"
Assert-LiteralContains "edge-server/internal/api/handlers.go" 'HubTaskID         string `json:"hubTaskId"`' "POST /v1/runs accepts hubTaskId"
Assert-Contains "edge-server/internal/api/handlers.go" "invalid_agent_id" "unknown agentId is rejected"
Assert-LiteralContains "edge-server/internal/api/handlers.go" "h.Executor.Start(run, runCtx)" "POST /v1/runs starts executor"
Assert-LiteralContains "edge-server/internal/lifecycle/process_executor.go" "adapter.BuildCommand(adapters.RunProcessContext{" "ProcessExecutor calls adapter BuildCommand"
Assert-LiteralContains "edge-server/internal/lifecycle/process_executor.go" "adapter.ParseStream(ctx, stdout, stdin, emitter, run)" "ProcessExecutor calls adapter ParseStream"
Assert-Contains "edge-server/internal/lifecycle/process_executor.go" "TaskStream" "Edge Hub callback can stream task output"
Assert-Contains "edge-server/internal/lifecycle/process_executor.go" "finalContent" "Edge Hub callback uses final visible content"
Assert-LiteralContains "app/desktop/src/hooks/useHubIntegration.ts" "agent.dispatch" "Desktop bridge listens for Hub agent.dispatch"
Assert-LiteralContains "app/desktop/src/hooks/useHubIntegration.ts" "run.agent.text_delta" "Desktop bridge streams structured text_delta to Hub"
Assert-LiteralContains "app/desktop/src/hooks/useHubIntegration.ts" "run.agent.text_block" "Desktop bridge streams structured text_block to Hub"
Assert-LiteralContains "app/desktop/src/hooks/useHubIntegration.ts" "run.output.batch" "Desktop bridge streams stdout batches to Hub"
Assert-Contains "hub-server/internal/service/agent.go" "HandleTaskStream" "Hub persists streamed task output"
Assert-Contains "hub-server/internal/service/agent.go" "HandleTaskDone" "Hub persists task completion output"

Step "Edge API and frontend display contracts"
Assert-LiteralContains "edge-server/internal/api/handlers.go" "func (h *Handler) GetAgents" "Edge exposes /v1/agents"
Assert-LiteralContains "edge-server/internal/api/handlers.go" "func (h *Handler) GetRunners" "Edge exposes /v1/runners compatibility endpoint"
Assert-Contains "edge-server/internal/api/handlers.go" 'checks\["runners"\]' "Edge health includes runner/runtime summary"
Assert-Contains "api/openapi.yaml" "/v1/agents:" "OpenAPI documents /v1/agents"
Assert-Contains "api/openapi.yaml" "/v1/runners:" "OpenAPI documents /v1/runners compatibility endpoint"
Assert-Contains "api/openapi.yaml" "AgentInfo:" "OpenAPI documents AgentInfo"
Assert-Contains "app/shared/src/types.ts" "interface RunnerHealthItem" "shared types include runner health items"
Assert-Contains "app/shared/src/types.ts" "interface AgentCapabilities" "shared types include runtime capabilities"
Assert-Contains "app/shared/src/types.ts" "interface AgentInfo" "shared types include AgentInfo"
Assert-Contains "app/desktop/src/api/edgeClient.ts" "/v1/agents" "Desktop client fetches real Edge agents"
Assert-Contains "app/desktop/src/api/edgeClient.ts" "/v1/runners" "Desktop client fetches Edge runner compatibility endpoint"
Assert-LiteralContains "app/desktop/src/components/SettingsPage.tsx" "useAgentList(edgeOnline)" "Desktop Settings consumes runtime inventory"
Assert-LiteralContains "app/desktop/src/components/SettingsPage.tsx" "health?.checks?.runners" "Desktop Settings consumes runner health summary"
Assert-Contains "app/desktop/src/components/SettingsPage.tsx" "RuntimeInventoryCard" "Desktop Settings renders runtime inventory cards"
Assert-Contains "app/desktop/src/components/SettingsPage.tsx" "RunnerRow" "Desktop Settings renders runner compatibility rows"
Assert-Contains "app/web/src/api/edgeClient.ts" "status: 'hub-only'" "Web Edge client is explicitly Hub-only"
Assert-Contains "app/web/src/api/edgeClient.ts" "stubbed" "Web runtime inventory is marked stubbed"

Step "Permission and release boundary caveats"
Assert-Contains "edge-server/internal/api/handlers.go" "/v1/permissions/decide" "Edge exposes REST permission decision endpoint"
Assert-Contains "app/desktop/src/api/edgeClient.ts" "/v1/permissions/decide" "Desktop client posts permission decisions over REST"
Assert-NotContains "app/desktop/src/hooks/useChatMessages.ts" "type:\s*'run\.agent\.permission_decide'" "Desktop chat hook no longer sends ignored WS permission_decide frames"
Assert-Contains "edge-server/internal/lifecycle/process_executor.go" "will be re-enabled when the full permission bridge is implemented" "ProcessExecutor documents stdin permission bridge gap"
Assert-Contains "docs/security-risk-register.md" "true blocking approval" "risk register keeps blocking approval gap"
Assert-Contains "app/web/README.md" "BFF/HttpOnly cookie" "Web README keeps browser session release caveat"
Assert-LiteralContains "docs/roadmap.md" "scripts/verify-runtime-readiness.ps1" "roadmap references runtime readiness checker"
Assert-LiteralContains "docs/handoff/STATE.md" "verify-runtime-readiness.ps1" "STATE references runtime readiness checker"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Passed: $Passed  |  Failed: $Failed" -ForegroundColor $(if ($Failed -eq 0) { "Green" } else { "Red" })
Write-Host "========================================" -ForegroundColor Cyan

if ($Failed -ne 0) {
    exit 1
}
