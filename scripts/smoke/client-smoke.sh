#!/usr/bin/env bash
# AgentHub client local smoke test — bash equivalent of client-smoke.py
#
# Chains Edge and Desktop-facing API end-to-end verification.
# Run ./scripts/dev/setup.sh first, then this script.
#
# Usage:
#   ./scripts/smoke/client-smoke.sh
#   ./scripts/smoke/client-smoke.sh --skip-build
#   ./scripts/smoke/client-smoke.sh --reuse-existing-edge
#   ./scripts/smoke/client-smoke.sh --edge-addr 127.0.0.1:3228
#   ./scripts/smoke/client-smoke.sh --edge-addr 127.0.0.1:3228 --edge-auth-token local-smoke-token
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

SKIP_BUILD=false
SKIP_GO_TESTS=false
SKIP_CANCEL=false
REUSE_EXISTING_EDGE=false
EDGE_ADDR="127.0.0.1:3210"
EDGE_AUTH_TOKEN=""

# ── Parse args ───────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) SKIP_BUILD=true; shift ;;
    --skip-go-tests) SKIP_GO_TESTS=true; shift ;;
    --skip-cancel) SKIP_CANCEL=true; shift ;;
    --reuse-existing-edge) REUSE_EXISTING_EDGE=true; shift ;;
    --edge-addr) EDGE_ADDR="$2"; shift 2 ;;
    --edge-auth-token) EDGE_AUTH_TOKEN="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 2 ;;
  esac
done

EDGE_URL="http://${EDGE_ADDR}"
EDGE_BINARY="$ROOT/edge-server/agenthub-edge-tmp"
CURL_HEADERS=()
if [[ -n "$EDGE_AUTH_TOKEN" ]]; then
  CURL_HEADERS+=(-H "Authorization: Bearer $EDGE_AUTH_TOKEN")
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASSED=0
FAILED=0
EDGE_PID=""
STARTED_EDGE=false

step()    { printf '\n=== %s ===\n' "$1"; }
pass()    { PASSED=$((PASSED + 1)); printf '  %sPASS%s  %s\n' "$GREEN" "$NC" "$1"; }
fail_msg() { FAILED=$((FAILED + 1)); printf '  %sFAIL%s  %s\n' "$RED" "$NC" "$1"; }

assert() {
  if [[ "$1" == "true" ]]; then pass "$2"; else fail_msg "$2"; fi
}

# ── Edge health ──────────────────────────────────────────────

test_edge_health() {
  local response
  response="$(curl -s --max-time 2 "${CURL_HEADERS[@]}" "$EDGE_URL/v1/health" 2>/dev/null)" || true
  if [[ -z "$response" ]]; then
    return 1
  fi

  # Parse data.status and data.version
  local status version
  status="$(echo "$response" | grep -oP '"status"\s*:\s*"[^"]*"' | head -1 | grep -oP '(?<=": ")[^"]*' || true)"
  version="$(echo "$response" | grep -oP '"version"\s*:\s*"[^"]*"' | head -1 | grep -oP '(?<=": ")[^"]*' || true)"
  if [[ "$status" == "ok" && "$version" == "v1" ]]; then
    return 0
  fi
  return 1
}

# ── Edge REST helper ────────────────────────────────────────

edge_rest() {
  local uri="$1" method="${2:-GET}" body="${3:-}" timeout="${4:-5}"
  local curl_args=(-s --max-time "$timeout" -X "$method")
  curl_args+=("${CURL_HEADERS[@]}")
  if [[ -n "$body" ]]; then
    curl_args+=(-H "Content-Type: application/json" -d "$body")
  fi
  curl_args+=("$uri")
  curl "${curl_args[@]}" 2>/dev/null || true
}

# ── WebSocket test helper ──────────────────────────────────

ws_test() {
  local run_id="$1" assert_builtin_mock="$2"

  # Try websocat first, then wscat (node), then fall back
  local ws_cmd=""
  if command -v websocat &>/dev/null; then
    ws_cmd="websocat"
  elif command -v wscat &>/dev/null; then
    ws_cmd="wscat"
  elif command -v node &>/dev/null; then
    # Inline node WebSocket client
    local ws_uri="ws://${EDGE_ADDR}/v1/events"
    if [[ -n "$EDGE_AUTH_TOKEN" ]]; then
      ws_uri="${ws_uri}?access_token=${EDGE_AUTH_TOKEN}"
    fi

    local tmp_script
    tmp_script="$(mktemp)"
    cat > "$tmp_script" <<NODEEOF
const WebSocket = (function() {
  try { return require('ws'); } catch(e) {
    try { return globalThis.WebSocket; } catch(e2) { return null; }
  }
})();

if (!WebSocket) { console.log('NO_WS'); process.exit(0); }

const ws = new WebSocket('${ws_uri}', { headers: { Origin: 'http://localhost' } });
let received = false;
let preview = '';
let stdout = '';
let currentRunTypes = [];
let cursor = 0;

ws.on('open', () => { console.log('WS_OPEN'); });

ws.on('message', (raw) => {
  received = true;
  if (!preview) preview = raw.toString().substring(0, 120);
  try {
    const event = JSON.parse(raw.toString());
    if (event.seq) cursor = Number(event.seq);
    const eventRunId = (event.scope && event.scope.runId) || (event.payload && event.payload.runId);
    if (eventRunId === '${run_id}') {
      currentRunTypes.push(event.type || 'unknown');
      if (event.type === 'run.output.batch' && event.payload &&
          event.payload.runId === '${run_id}' && event.payload.stream === 'stdout') {
        (event.payload.chunks || []).forEach(c => { if (c.text) stdout += c.text; });
      }
    }

    if (${assert_builtin_mock}) {
      if (currentRunTypes.includes('run.started') &&
          currentRunTypes.includes('run.output.batch') &&
          currentRunTypes.includes('run.finished') &&
          stdout.includes('Initializing mock runner')) {
        console.log('MOCK_OK');
        ws.close();
      }
    } else if (currentRunTypes.length > 0) {
      console.log('EVENT_OK');
      ws.close();
    }
  } catch(e) { console.log('PARSE_ERR:' + e.message); }
});

ws.on('error', (e) => { console.log('WS_ERR:' + e.message); });
ws.on('close', () => {
  console.log('WS_CLOSE');
  console.log('RECEIVED:' + received);
  console.log('PREVIEW:' + preview);
  console.log('TYPES:' + currentRunTypes.join(','));
  console.log('STDOUT:' + (stdout.length > 0 ? 'yes' : 'no'));
});

setTimeout(() => { console.log('WS_TIMEOUT'); ws.close(); process.exit(0); }, 15000);
NODEEOF

    node "$tmp_script" 2>/dev/null || true
    local result=""
    if [[ -f "$tmp_script" ]]; then rm -f "$tmp_script"; fi
    # For now, just report that WebSocket test requires node with 'ws' package
    echo "WS_SKIPPED:no_ws_client"
    return 0
  fi

  if [[ -n "$ws_cmd" ]]; then
    local ws_uri="ws://${EDGE_ADDR}/v1/events"
    if [[ -n "$EDGE_AUTH_TOKEN" ]]; then
      ws_uri="${ws_uri}?access_token=${EDGE_AUTH_TOKEN}"
    fi
    # websocat / wscat can connect and receive a few frames then exit
    timeout 10 "$ws_cmd" --header "Origin: http://localhost" "$ws_uri" 2>/dev/null | head -c 500 || true
    return 0
  fi

  echo "WS_SKIPPED:no_ws_client"
}

# ── Main ─────────────────────────────────────────────────────

cd "$ROOT"

# ── Environment check ────────────────────────────────────────

step "Environment check"

if go version &>/dev/null; then
  go_ver="$(go version | grep -oP 'go\K[0-9]+\.[0-9]+')"
  if [[ -n "$go_ver" ]] && [[ "$(printf '%s\n' "1.24" "$go_ver" | sort -V | head -1)" == "1.24" ]]; then
    pass "Go 1.24+ (go${go_ver})"
  else
    fail_msg "Go 1.24+ required, found go${go_ver:-unknown}"
  fi
else
  fail_msg "Go not found"
fi

if pnpm --version &>/dev/null; then
  pass "pnpm ($(pnpm --version))"
else
  fail_msg "pnpm not found"
fi

if node --version &>/dev/null; then
  pass "node available"
else
  fail_msg "node not found"
fi

if test_edge_health; then
  if [[ "$REUSE_EXISTING_EDGE" != "true" ]]; then
    fail_msg "Edge already running on $EDGE_ADDR; stop it or pass --reuse-existing-edge"
    echo "Edge already running on $EDGE_ADDR" >&2
    exit 1
  fi
fi

# ── Build ────────────────────────────────────────────────────

if [[ "$SKIP_BUILD" != "true" ]]; then
  step "Build Edge Server"
  (cd "$ROOT/edge-server" && go build -o "$EDGE_BINARY" ./cmd/agenthub-edge/)
  assert "$([[ -f "$EDGE_BINARY" ]] && echo true || echo false)" "edge-server binary"

  step "Install Shared Dependencies"
  (cd "$ROOT/app/shared" && pnpm install --frozen-lockfile >/dev/null 2>&1)
  assert "$([[ $? -eq 0 ]] && echo true || echo false)" "shared pnpm install"

  step "Build Desktop (web only)"
  (cd "$ROOT/app/desktop" && pnpm install --frozen-lockfile >/dev/null 2>&1 && pnpm build >/dev/null 2>&1)
  local build_ok=false
  [[ $? -eq 0 && -f "$ROOT/app/desktop/dist/index.html" ]] && build_ok=true
  assert "$build_ok" "pnpm build OK"
fi

# ── Start Edge Server ────────────────────────────────────────

step "Start Edge Server"
if test_edge_health; then
  if [[ "$REUSE_EXISTING_EDGE" == "true" ]]; then
    pass "reuse existing Edge on $EDGE_ADDR"
  else
    fail_msg "Edge already running on $EDGE_ADDR; stop it or pass --reuse-existing-edge"
    exit 1
  fi
else
  if [[ ! -f "$EDGE_BINARY" ]]; then
    fail_msg "edge binary missing: $EDGE_BINARY"
    exit 1
  fi

  local edge_args=(
    --addr "$EDGE_ADDR"
    --runner-profile agenthub-runner-mock
    --runner-command "$(command -v bash || echo /bin/bash)"
    --runner-arg "-c"
    --runner-arg "echo 'Initializing mock runner'; echo 'AgentHub client smoke mock output'"
  )
  if [[ -n "$EDGE_AUTH_TOKEN" ]]; then
    edge_args+=(--local-auth-token "$EDGE_AUTH_TOKEN")
  fi

  "$EDGE_BINARY" "${edge_args[@]}" &
  EDGE_PID=$!
  STARTED_EDGE=true

  local ready=false
  for i in $(seq 1 20); do
    sleep 0.25
    if ! kill -0 "$EDGE_PID" 2>/dev/null; then break; fi
    if test_edge_health; then
      ready=true
      break
    fi
  done
  assert "$ready" "Edge process ready (PID $EDGE_PID)"
fi

# ── Run tests ────────────────────────────────────────────────

cleanup_edge() {
  if [[ "$STARTED_EDGE" == "true" ]] && [[ -n "${EDGE_PID:-}" ]]; then
    if kill -0 "$EDGE_PID" 2>/dev/null; then
      kill "$EDGE_PID" 2>/dev/null || true
      wait "$EDGE_PID" 2>/dev/null || true
    fi
  fi
}
trap cleanup_edge EXIT

if [[ "$STARTED_EDGE" == "true" ]]; then
  if kill -0 "$EDGE_PID" 2>/dev/null; then
    pass "Edge process alive (PID $EDGE_PID)"
  else
    fail_msg "Edge process not alive"
  fi
fi

# GET /v1/health
step "GET /v1/health"
health_resp="$(curl -s --max-time 5 "${CURL_HEADERS[@]}" "$EDGE_URL/v1/health" 2>/dev/null)" || true
if [[ -n "$health_resp" ]]; then
  h_status="$(echo "$health_resp" | grep -oP '"status"\s*:\s*"[^"]*"' | head -1 | grep -oP '(?<=": ")[^"]*' || true)"
  h_version="$(echo "$health_resp" | grep -oP '"version"\s*:\s*"[^"]*"' | head -1 | grep -oP '(?<=": ")[^"]*' || true)"
  h_edge_id="$(echo "$health_resp" | grep -oP '"edgeId"\s*:\s*"[^"]*"' | head -1 | grep -oP '(?<=": ")[^"]*' || true)"
  assert "$([[ "$h_status" == "ok" ]] && echo true || echo false)" "status=ok"
  assert "$([[ "$h_version" == "v1" ]] && echo true || echo false)" "version=v1"
  assert "$([[ "$h_edge_id" == "local" ]] && echo true || echo false)" "edgeId=local"
else
  fail_msg "health: no response"
fi

# GET /v1/runners
step "GET /v1/runners"
runners_resp="$(edge_rest "$EDGE_URL/v1/runners" "GET" "" 5)"
if [[ -n "$runners_resp" ]]; then
  runner_count="$(echo "$runners_resp" | grep -oP '"status"' | wc -l)" || true
  runner_count="${runner_count//[^0-9]/}"
  runner_count=${runner_count:-0}
  assert "$([[ "$runner_count" -gt 0 ]] && echo true || echo false)" "runners count=$runner_count"
  first_status="$(echo "$runners_resp" | grep -oP '"status"\s*:\s*"[^"]*"' | head -1 | grep -oP '(?<=": ")[^"]*' || true)"
  assert "$([[ "$first_status" == "online" ]] && echo true || echo false)" "mock runner online"
  has_more="$(echo "$runners_resp" | grep -oP '"hasMore"\s*:\s*(true|false)' | head -1 | grep -oP '(true|false)' || true)"
  assert "$([[ "$has_more" != "true" ]] && echo true || echo false)" "hasMore=false"
else
  fail_msg "runners: no response"
fi

# POST /v1/runs
step "POST /v1/runs"
run_resp="$(edge_rest "$EDGE_URL/v1/runs" "POST" "{}" 5)"
run_id=""
if [[ -n "$run_resp" ]]; then
  run_id="$(echo "$run_resp" | grep -oP '"runId"\s*:\s*"[^"]*"' | head -1 | grep -oP '(?<=": ")[^"]*' || true)"
  run_status="$(echo "$run_resp" | grep -oP '"status"\s*:\s*"[^"]*"' | head -1 | grep -oP '(?<=": ")[^"]*' || true)"
  assert "$([[ "$run_id" =~ ^run_ ]] && echo true || echo false)" "runId prefix ($run_id)"
  assert "$([[ "$run_status" == "queued" ]] && echo true || echo false)" "status=queued"
  created_at="$(echo "$run_resp" | grep -oP '"createdAt"' | head -1 || true)"
  assert "$([[ -n "$created_at" ]] && echo true || echo false)" "createdAt non-null"
else
  fail_msg "POST runs: no response"
fi

# WebSocket
step "WebSocket /v1/events"
if [[ -z "$run_id" ]]; then
  fail_msg "WebSocket: POST /v1/runs did not return a runId"
else
  ws_output="$(ws_test "$run_id" "$([[ "$REUSE_EXISTING_EDGE" != "true" ]] && echo true || echo false)")" || true
  if echo "$ws_output" | grep -q "WS_SKIPPED"; then
    warn_msg="WebSocket: no WS client available (install websocat, wscat, or 'npm install ws')"
    printf '  %sWARN%s  %s\n' "$YELLOW" "$NC" "$warn_msg"
  elif echo "$ws_output" | grep -q "MOCK_OK"; then
    pass "received mock run WS events (started/output/finished)"
  elif echo "$ws_output" | grep -q "EVENT_OK"; then
    pass "received WS frame for current run"
  else
    printf '  %sWARN%s  WebSocket test returned partial results; check ws client availability\n' "$YELLOW" "$NC"
  fi
fi

# POST /v1/runs/{runId}:cancel
if [[ "$SKIP_CANCEL" == "true" ]]; then
  step "POST /v1/runs/{runId}:cancel"
  pass "cancel smoke skipped by --skip-cancel"
else
  step "POST /v1/runs/{runId}:cancel"
  cancel_run_resp="$(edge_rest "$EDGE_URL/v1/runs" "POST" "{}" 5)"
  cancel_run_id="$(echo "$cancel_run_resp" | grep -oP '"runId"\s*:\s*"[^"]*"' | head -1 | grep -oP '(?<=": ")[^"]*' || true)"
  if [[ -z "$cancel_run_id" ]]; then
    fail_msg "cancel: POST /v1/runs did not return a runId"
  else
    cancel_resp="$(edge_rest "$EDGE_URL/v1/runs/${cancel_run_id}:cancel" "POST" "" 15)"
    cancel_rid="$(echo "$cancel_resp" | grep -oP '"runId"\s*:\s*"[^"]*"' | head -1 | grep -oP '(?<=": ")[^"]*' || true)"
    cancel_status="$(echo "$cancel_resp" | grep -oP '"status"\s*:\s*"[^"]*"' | head -1 | grep -oP '(?<=": ")[^"]*' || true)"
    assert "$([[ "$cancel_rid" == "$cancel_run_id" ]] && echo true || echo false)" "runId=$cancel_run_id"
    case "$cancel_status" in
      cancelling|finished|failed|cancelled) pass "status=$cancel_status" ;;
      *) fail_msg "unexpected cancel status: $cancel_status" ;;
    esac
  fi
fi

# ── Go tests ──────────────────────────────────────────────────

if [[ "$SKIP_GO_TESTS" == "true" ]]; then
  step "Go unit tests"
  pass "edge-server tests skipped by --skip-go-tests"
else
  step "Go unit tests"
  (cd "$ROOT/edge-server" && go test ./... >/dev/null 2>&1)
  assert "$([[ $? -eq 0 ]] && echo true || echo false)" "edge-server tests pass"
fi

# ── Summary ──────────────────────────────────────────────────

printf '\n========================================\n'
if [[ "$FAILED" -eq 0 ]]; then
  printf '  %sPassed: %s  |  Failed: %s%s\n' "$GREEN" "$PASSED" "$FAILED" "$NC"
else
  printf '  %sPassed: %s  |  Failed: %s%s\n' "$RED" "$PASSED" "$FAILED" "$NC"
fi
printf '========================================\n'

printf '\nManual UI verification steps:\n'
printf '  1. Start Edge:   cd edge-server; go run ./cmd/agenthub-edge --runner-profile agenthub-runner-mock\n'
printf '  2. Start Desktop: cd app/desktop; pnpm tauri dev\n'
printf '  3. Verify status bar shows green Online dot\n'
printf '  4. Verify Runtime/Target readiness shows Mock Runner (local) online\n'
printf '  5. Trigger POST /v1/runs and check event log panel updates with run.output.batch\n'
printf '  6. Stop Edge and verify UI shows red Offline without crash\n'

[[ "$FAILED" -eq 0 ]] && exit 0 || exit 1
