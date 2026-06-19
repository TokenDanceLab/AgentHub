#!/usr/bin/env bash
# AgentHub Agent Runtime readiness checks.
#
# This script is intentionally secret-free and structural. It verifies repository
# wiring for real Claude Code / Codex / OpenCode runtime adapters, Edge APIs,
# Desktop/Web display boundaries, and docs. It does not execute agent CLIs, call
# models, read CLI auth files, or connect to production.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PASSED=0
FAILED=0

pass_check() {
    PASSED=$((PASSED + 1))
    printf '\e[32m  PASS  %s\e[0m\n' "$1"
}

fail_check() {
    FAILED=$((FAILED + 1))
    printf '\e[31m  FAIL  %s\e[0m\n' "$1"
}

step() {
    printf '\n\e[36m=== %s ===\e[0m\n' "$1"
}

read_repo_file() {
    local path="$REPO_ROOT/$1"
    if [[ ! -f "$path" ]]; then
        fail_check "missing $1"
        return 1
    fi
    cat "$path"
}

assert_contains() {
    local path="$1" pattern="$2" label="$3"
    local content
    content="$(read_repo_file "$path" 2>/dev/null)" || return
    if echo "$content" | grep -qE "$pattern" 2>/dev/null; then
        pass_check "$label"
    else
        fail_check "$label ($path missing pattern: $pattern)"
    fi
}

assert_not_contains() {
    local path="$1" pattern="$2" label="$3"
    local content
    content="$(read_repo_file "$path" 2>/dev/null)" || return
    if echo "$content" | grep -qE "$pattern" 2>/dev/null; then
        fail_check "$label ($path contains pattern: $pattern)"
    else
        pass_check "$label"
    fi
}

assert_literal_contains() {
    local path="$1" text="$2" label="$3"
    local content
    content="$(read_repo_file "$path" 2>/dev/null)" || return
    if echo "$content" | grep -qF "$text" 2>/dev/null; then
        pass_check "$label"
    else
        fail_check "$label ($path missing text: $text)"
    fi
}

assert_literal_not_contains() {
    local path="$1" text="$2" label="$3"
    local content
    content="$(read_repo_file "$path" 2>/dev/null)" || return
    if echo "$content" | grep -qF "$text" 2>/dev/null; then
        fail_check "$label ($path contains text: $text)"
    else
        pass_check "$label"
    fi
}

assert_path_missing() {
    local path="$1" label="$2"
    if [[ ! -e "$REPO_ROOT/$path" ]]; then
        pass_check "$label"
    else
        fail_check "$label ($path should not exist)"
    fi
}

step "Runtime architecture boundary"
assert_path_missing "runner" "standalone root runner component is absent"
assert_contains "README.md" "Agent Runtime" "README uses Agent Runtime terminology"
assert_contains "README.md" "internal/lifecycle/" "README points execution lifecycle at Edge lifecycle"
assert_contains "README.md" "internal/adapters/" "README points protocol adapters at Edge adapters"
assert_contains "edge-server/README.md" "internal/runners/.*兼容旧 UI|internal/runners/.*compat" "Edge README marks runner registry as compatibility layer"
assert_contains "api/deprecations.md" "/v1/runners.*Keep.*compatibility" "API deprecations mark /v1/runners as compatibility"

step "AgentAdapter interface and event taxonomy"
assert_contains "edge-server/internal/adapters/adapter.go" "type AgentAdapter interface" "AgentAdapter interface exists"
assert_literal_contains "edge-server/internal/adapters/adapter.go" "BuildCommand(ctx RunProcessContext)" "AgentAdapter exposes BuildCommand"
assert_literal_contains "edge-server/internal/adapters/adapter.go" "ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer" "AgentAdapter exposes ParseStream"
assert_literal_contains "edge-server/internal/adapters/adapter.go" "NeedsStdin() bool" "AgentAdapter exposes NeedsStdin"
assert_literal_contains "edge-server/internal/adapters/adapter.go" "Available() bool" "AgentAdapter exposes Available"
assert_literal_contains "edge-server/internal/adapters/adapter.go" 'BusEventTextDelta           = "run.agent.text_delta"' "unified text_delta event exists"
assert_literal_contains "edge-server/internal/adapters/adapter.go" 'BusEventToolCall            = "run.agent.tool_call"' "unified tool_call event exists"
assert_literal_contains "edge-server/internal/adapters/adapter.go" 'BusEventFileChange          = "run.agent.file_change"' "unified file_change event exists"
assert_literal_contains "edge-server/internal/adapters/adapter.go" 'BusEventPermissionRequested = "run.agent.permission_requested"' "unified permission_requested event exists"

step "Real runtime adapters"
assert_contains "edge-server/internal/adapters/claude_code.go" "NewClaudeCodeAdapter" "Claude Code adapter constructor exists"
assert_literal_contains "edge-server/internal/adapters/claude_code.go" "exec.LookPath" "Claude Code adapter checks binary availability"
assert_contains "edge-server/internal/adapters/claude_code.go" 'output-format.*stream-json' "Claude Code adapter uses stream-json protocol"
assert_literal_contains "edge-server/internal/adapters/claude_code.go" "func (a *ClaudeCodeAdapter) NeedsStdin() bool { return true }" "Claude Code adapter declares stdin need"
assert_literal_contains "edge-server/internal/adapters/claude_code.go" "func (a *ClaudeCodeAdapter) Available() bool" "Claude Code adapter exposes availability"

assert_contains "edge-server/internal/adapters/codex.go" "NewCodexAdapter" "Codex adapter constructor exists"
assert_literal_contains "edge-server/internal/adapters/codex.go" "exec.LookPath" "Codex adapter checks binary availability"
assert_contains "edge-server/internal/adapters/codex.go" 'args := \[\]string\{"exec"\}' "Codex adapter invokes codex exec"
assert_contains "edge-server/internal/adapters/codex.go" 'args = append\(args, "--json"\)' "Codex adapter requests JSONL output"
assert_literal_contains "edge-server/internal/adapters/codex.go" "func (a *CodexAdapter) NeedsStdin() bool { return false }" "Codex adapter does not require stdin"
assert_literal_contains "edge-server/internal/adapters/codex.go" "func (a *CodexAdapter) Available() bool" "Codex adapter exposes availability"

assert_contains "edge-server/internal/adapters/opencode.go" "NewOpenCodeAdapter" "OpenCode adapter constructor exists"
assert_literal_contains "edge-server/internal/adapters/opencode.go" "exec.LookPath" "OpenCode adapter checks binary availability"
assert_contains "edge-server/internal/adapters/opencode.go" 'args := \[\]string\{"run", "--format", "json"\}' "OpenCode adapter requests JSON output"
assert_literal_contains "edge-server/internal/adapters/opencode.go" "func (a *OpenCodeAdapter) NeedsStdin() bool { return false }" "OpenCode adapter does not require stdin"
assert_literal_contains "edge-server/internal/adapters/opencode.go" "func (a *OpenCodeAdapter) Available() bool" "OpenCode adapter exposes availability"

step "Edge CLI configuration and registry"
assert_contains "edge-server/cmd/agenthub-edge/main.go" "AGENTHUB_AGENT_DEFAULT" "Edge supports AGENTHUB_AGENT_DEFAULT"
assert_contains "edge-server/cmd/agenthub-edge/main.go" "AGENTHUB_RUNNER_PROFILE" "Edge supports compatibility runner profile env"
assert_contains "edge-server/cmd/agenthub-edge/main.go" "AGENTHUB_CLAUDE_CODE_PATH" "Edge supports Claude Code path env"
assert_contains "edge-server/cmd/agenthub-edge/main.go" "AGENTHUB_CODEX_PATH" "Edge supports Codex path env"
assert_contains "edge-server/cmd/agenthub-edge/main.go" "AGENTHUB_OPENCODE_PATH" "Edge supports OpenCode path env"
assert_contains "edge-server/cmd/agenthub-edge/main.go" "func applyRunnerProfile" "runner profile compatibility mapper exists"
assert_contains "edge-server/cmd/agenthub-edge/main.go" "runnerProfileClaudeCode" "runner profile maps Claude Code"
assert_contains "edge-server/cmd/agenthub-edge/main.go" "runnerProfileCodex" "runner profile maps Codex"
assert_contains "edge-server/cmd/agenthub-edge/main.go" "runnerProfileOpenCode" "runner profile maps OpenCode"
assert_literal_contains "edge-server/cmd/agenthub-edge/main.go" "adapters.NewClaudeCodeAdapter" "Edge registers Claude Code adapter"
assert_literal_contains "edge-server/cmd/agenthub-edge/main.go" "adapters.NewCodexAdapter" "Edge registers Codex adapter"
assert_literal_contains "edge-server/cmd/agenthub-edge/main.go" "adapters.NewOpenCodeAdapter" "Edge registers OpenCode adapter"

step "Edge API and frontend display contracts"
assert_literal_contains "edge-server/internal/api/handlers.go" "func (h *Handler) GetAgents" "Edge exposes /v1/agents"
assert_literal_contains "edge-server/internal/api/handlers.go" "func (h *Handler) GetRunners" "Edge exposes /v1/runners compatibility endpoint"
assert_contains "edge-server/internal/api/handlers.go" 'runners' "Edge health includes runner/runtime summary"
assert_contains "api/openapi.yaml" "/v1/agents" "OpenAPI documents /v1/agents"
assert_contains "api/openapi.yaml" "/v1/runners" "OpenAPI documents /v1/runners compatibility endpoint"
assert_contains "api/openapi.yaml" "AgentInfo" "OpenAPI documents AgentInfo"
assert_contains "app/shared/src/types.ts" "interface RunnerHealthItem" "shared types include runner health items"
assert_contains "app/shared/src/types.ts" "interface AgentInfo" "shared types include AgentInfo"
assert_contains "app/desktop/src/api/edgeClient.ts" "/v1/agents" "Desktop client fetches real Edge agents"
assert_contains "app/desktop/src/api/edgeClient.ts" "/v1/runners" "Desktop client fetches Edge runner compatibility endpoint"

step "Web Hub-only boundary"
assert_contains "app/web/src/api/edgeClient.ts" "hub-only" "Web Edge client is explicitly Hub-only"
assert_contains "app/web/src/api/edgeClient.ts" "stubbed" "Web runtime inventory is marked stubbed"
assert_path_missing "app/web/src/api/edgeAuth.ts" "Web has no Edge auth helper"
assert_path_missing "app/web/src/api/eventClient.ts" "Web has no Local Edge event stream client"
assert_path_missing "app/web/src/hooks/useHubIntegration.ts" "Web has no Desktop-only Hub-Edge bridge hook"
assert_path_missing "app/web/src/hooks/useChatMessages.ts" "Web has no legacy Local Edge chat event reducer"
assert_path_missing "app/web/src/hooks/useEventStream.ts" "Web has no Local Edge event stream hook"
assert_path_missing "app/web/src/hooks/useEdgeStatus.ts" "Web has no Local Edge status hook"
assert_path_missing "app/web/src/hooks/useRunners.ts" "Web has no Local Edge runner hook"
assert_contains "scripts/verify-web-hub-boundary.sh" "Hub-only boundary" "focused Web Hub-only boundary checker exists"

step "Permission and release boundary caveats"
assert_contains "edge-server/internal/api/handlers.go" "/v1/permissions/decide" "Edge exposes REST permission decision endpoint"
assert_contains "app/desktop/src/api/edgeClient.ts" "/v1/permissions/decide" "Desktop client posts permission decisions over REST"
assert_contains "edge-server/internal/lifecycle/process_executor.go" "permission bridge" "ProcessExecutor documents stdin permission bridge gap"
assert_contains "docs/governance/security-risk-register.md" "blocking approval" "risk register keeps blocking approval gap"
assert_contains "app/web/README.md" "BFF/HttpOnly cookie" "Web README keeps browser session release caveat"
assert_literal_contains "docs/roadmap.md" "verify-runtime-readiness.ps1" "roadmap references runtime readiness checker"

echo ""
echo "========================================"
printf "  Passed: %d  |  Failed: %d\n" "$PASSED" "$FAILED"
echo "========================================"

if [[ "$FAILED" -ne 0 ]]; then
    exit 1
fi
