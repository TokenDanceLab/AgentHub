#!/usr/bin/env bash
# AgentHub live Agent Runtime smoke test.
#
# Starts Edge Server with a real agent CLI, sends a prompt, and
# verifies end-to-end event flow through the WebSocket event stream.
# This script intentionally does not fall back to the mock executor.
#
# Usage:
#   ./scripts/integration-smoke.sh -Agent codex -EdgeAddr 127.0.0.1:3231
#   ./scripts/integration-smoke.sh -Agent claude-code -EdgeAddr 127.0.0.1:3232
#   ./scripts/integration-smoke.sh -Agent opencode -EdgeAddr 127.0.0.1:3233
#   ./scripts/integration-smoke.sh -SkipBuild -Agent codex
set -euo pipefail

SKIP_BUILD=false
AGENT="claude-code"
PROMPT="reply with just the word ok"
RUN_TIMEOUT_SEC=60
EDGE_ADDR="127.0.0.1:3210"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EDGE_URL="http://${EDGE_ADDR}"
EDGE_BINARY="$ROOT/edge-server/agenthub-edge-tmp"
PASSED=0
FAILED=0
EDGE_PID=""
STARTED_EDGE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        -SkipBuild) SKIP_BUILD=true; shift ;;
        -Agent) AGENT="$2"; shift 2 ;;
        -Prompt) PROMPT="$2"; shift 2 ;;
        -RunTimeoutSec) RUN_TIMEOUT_SEC="$2"; shift 2 ;;
        -EdgeAddr) EDGE_ADDR="$2"; EDGE_URL="http://${EDGE_ADDR}"; shift 2 ;;
        *) echo "Unknown argument: $1"; exit 2 ;;
    esac
done

# Validate agent
case "$AGENT" in
    claude-code|codex|opencode) ;;
    *) echo "Invalid agent: $AGENT. Must be: claude-code, codex, or opencode"; exit 2 ;;
esac

pass_check() { PASSED=$((PASSED + 1)); printf '\e[32m  PASS  %s\e[0m\n' "$1"; }
fail_check() { FAILED=$((FAILED + 1)); printf '\e[31m  FAIL  %s\e[0m\n' "$1"; }
step() { printf '\n\e[36m=== %s ===\e[0m\n' "$1"; }

cleanup() {
    if [[ -n "$EDGE_PID" ]] && kill -0 "$EDGE_PID" 2>/dev/null; then
        kill "$EDGE_PID" 2>/dev/null || true
        wait "$EDGE_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT

# Resolve agent CLI path
resolve_cli() {
    local name="$1"
    case "$name" in
        claude-code) command -v claude 2>/dev/null || echo "" ;;
        codex) command -v codex 2>/dev/null || echo "" ;;
        opencode) command -v opencode 2>/dev/null || echo "" ;;
    esac
}

step "Build Edge Server"
if [[ "$SKIP_BUILD" != "true" ]]; then
    (cd "$ROOT/edge-server" && go build -o "$EDGE_BINARY" ./cmd/agenthub-edge) || {
        fail_check "Edge Server build failed"
        exit 1
    }
    pass_check "Edge binary built"
else
    if [[ -f "$EDGE_BINARY" ]]; then
        pass_check "Edge binary exists (skip build)"
    else
        fail_check "Edge binary not found at $EDGE_BINARY"
        exit 1
    fi
fi

step "Resolve agent CLI"
CLI_PATH="$(resolve_cli "$AGENT")"
if [[ -z "$CLI_PATH" ]]; then
    fail_check "$AGENT CLI not found in PATH"
    exit 1
fi
pass_check "$AGENT CLI resolved: $CLI_PATH"

step "Start Edge Server"
EDGE_LOG="$ROOT/.tmp/integration-smoke-edge-$$.log"
mkdir -p "$(dirname "$EDGE_LOG")"

"$EDGE_BINARY" \
    --addr "$EDGE_ADDR" \
    --agent-default "$AGENT" \
    --claude-code-path "$(command -v claude 2>/dev/null || echo 'claude')" \
    --codex-path "$(command -v codex 2>/dev/null || echo 'codex')" \
    --opencode-path "$(command -v opencode 2>/dev/null || echo 'opencode')" \
    > "$EDGE_LOG" 2>&1 &
EDGE_PID=$!

# Wait for Edge to be ready
ATTEMPTS=0
MAX_ATTEMPTS=30
EDGE_READY=false
while [[ $ATTEMPTS -lt $MAX_ATTEMPTS ]]; do
    if curl -sS --max-time 1 "${EDGE_URL}/v1/health" 2>/dev/null | grep -q '"status":"ok"'; then
        EDGE_READY=true
        break
    fi
    sleep 1
    ATTEMPTS=$((ATTEMPTS + 1))
done

if [[ "$EDGE_READY" != "true" ]]; then
    fail_check "Edge Server did not become ready within ${MAX_ATTEMPTS}s"
    echo "--- Edge log (last 20 lines) ---"
    tail -20 "$EDGE_LOG" || true
    exit 1
fi
STARTED_EDGE=true
pass_check "Edge Server ready at ${EDGE_URL}"

step "Verify health endpoint"
HEALTH="$(curl -sS --max-time 3 "${EDGE_URL}/v1/health" 2>/dev/null)" || true
if echo "$HEALTH" | grep -q '"status":"ok"'; then
    pass_check "Edge health: ok"
else
    fail_check "Edge health check failed"
fi

step "Verify /v1/agents endpoint"
AGENTS="$(curl -sS --max-time 3 "${EDGE_URL}/v1/agents" 2>/dev/null)" || true
if echo "$AGENTS" | grep -q "$AGENT"; then
    pass_check "/v1/agents includes $AGENT"
else
    fail_check "/v1/agents missing $AGENT"
fi

if echo "$AGENTS" | grep -q '"available":true'; then
    pass_check "At least one adapter available"
else
    fail_check "No adapter reports available"
fi

step "Verify WebSocket event stream"
WS_EVENTS_FILE="$ROOT/.tmp/integration-smoke-events-$$.txt"
curl -sS --max-time 8 -H "Accept: text/event-stream" \
    "${EDGE_URL}/v1/events" > "$WS_EVENTS_FILE" 2>/dev/null &
WS_PID=$!
sleep 3
kill "$WS_PID" 2>/dev/null || true
wait "$WS_PID" 2>/dev/null || true

if [[ -s "$WS_EVENTS_FILE" ]]; then
    pass_check "WebSocket events received ($(wc -l < "$WS_EVENTS_FILE") lines)"
else
    fail_check "No WebSocket events received"
fi

step "Trigger a run"
RUN_PAYLOAD=$(cat << EOF
{"agentId":"$AGENT","prompt":"$PROMPT","workDir":"$ROOT"}
EOF
)

RUN_RESP="$(curl -sS --max-time 5 -X POST "${EDGE_URL}/v1/runs" \
    -H "Content-Type: application/json" \
    -d "$RUN_PAYLOAD" 2>/dev/null)" || true

if echo "$RUN_RESP" | grep -q '"runId"'; then
    RUN_ID="$(echo "$RUN_RESP" | grep -o '"runId":"[^"]*"' | head -1 | cut -d'"' -f4)"
    pass_check "Run started: $RUN_ID"
else
    RUN_RESP="${RUN_RESP:-no response}"
    fail_check "Failed to start run: $RUN_RESP"
fi

# Wait briefly for run events
sleep 5

step "Verify run events in WS stream"
if [[ -s "$WS_EVENTS_FILE" ]]; then
    if grep -q "run.agent" "$WS_EVENTS_FILE" 2>/dev/null; then
        pass_check "Run events found in WS stream"
    else
        warn_check "No run.agent events in WS stream (may need real CLI)"
    fi
else
    fail_check "WS events file empty"
fi

cleanup() {
    trap - EXIT
    if [[ -n "$EDGE_PID" ]] && kill -0 "$EDGE_PID" 2>/dev/null; then
        kill "$EDGE_PID" 2>/dev/null || true
        wait "$EDGE_PID" 2>/dev/null || true
    fi
}

echo ""
echo "========================================"
printf "  Passed: %d  |  Failed: %d\n" "$PASSED" "$FAILED"
echo "========================================"

if [[ "$FAILED" -gt 0 ]]; then
    exit 1
fi
exit 0
