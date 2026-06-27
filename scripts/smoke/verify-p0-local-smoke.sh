#!/usr/bin/env bash
# AgentHub P0 localhost smoke harness.
#
# Default mode is plan/dry-run: runs structural checks and reports localhost
# service probes as blocked. Use -RunLocalhost only after local Hub/Web/Desktop/
# Edge fixture services are already running.
#
# This script does not start real TokenDanceID, run real CLI/model adapters,
# deploy public surfaces, sign packages, upload releases, or touch Mobile.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN_LOCALHOST=false
EVIDENCE_PATH=""
HUB_PORT=8080
WEB_PORT=5174
DESKTOP_PORT=5173
EDGE_PORT=3210
TIMEOUT_MS=500

PASSED=0
FAILED=0
WARNED=0
BLOCKED=0
SKIPPED=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        -RunLocalhost) RUN_LOCALHOST=true; shift ;;
        -EvidencePath) EVIDENCE_PATH="$2"; shift 2 ;;
        -HubPort) HUB_PORT="$2"; shift 2 ;;
        -WebPort) WEB_PORT="$2"; shift 2 ;;
        -DesktopPort) DESKTOP_PORT="$2"; shift 2 ;;
        -EdgePort) EDGE_PORT="$2"; shift 2 ;;
        -TimeoutMs) TIMEOUT_MS="$2"; shift 2 ;;
        -RepoRoot) REPO_ROOT="$2"; shift 2 ;;
        *) echo "Unknown argument: $1"; exit 2 ;;
    esac
done

MODE="Plan"
if [[ "$RUN_LOCALHOST" == "true" ]]; then MODE="RunLocalhost"; fi

if [[ -z "$EVIDENCE_PATH" ]]; then
    EVIDENCE_PATH="/tmp/agenthub-p0-local-smoke-$$.json"
fi

pass_check() { PASSED=$((PASSED + 1)); printf '\e[32m  PASS  %s\e[0m\n' "$1"; }
fail_check() { FAILED=$((FAILED + 1)); printf '\e[31m  FAIL  %s\e[0m\n' "$1"; }
warn_check() { WARNED=$((WARNED + 1)); printf '\e[33m  WARN  %s\e[0m\n' "$1"; }
block_check() { BLOCKED=$((BLOCKED + 1)); printf '\e[35m  BLOCK %s\e[0m\n' "$1"; }
skip_check() { SKIPPED=$((SKIPPED + 1)); printf '\e[90m  SKIP  %s\e[0m\n' "$1"; }

step() { printf '\n\e[36m=== %s ===\e[0m\n' "$1"; }

assert_file() {
    if [[ -f "$REPO_ROOT/$1" ]]; then pass_check "$2"; else fail_check "$2 (missing $1)"; fi
}

assert_grep() {
    if grep -qE "$2" "$REPO_ROOT/$1" 2>/dev/null; then pass_check "$3"; else fail_check "$3 ($1)"; fi
}

# Health probe with identity marker check
probe_localhost() {
    local url="$1" marker="$2" label="$3"
    local resp
    resp="$(curl -sS --max-time 3 "$url" 2>/dev/null)" || true
    if [[ -z "$resp" ]]; then
        if [[ "$MODE" == "RunLocalhost" ]]; then
            fail_check "$label not reachable"
        else
            block_check "$label (not running — expected in Plan mode)"
        fi
    elif echo "$resp" | grep -qF "$marker" 2>/dev/null; then
        pass_check "$label healthy ($marker)"
    else
        warn_check "$label returned but missing marker: $marker"
    fi
}

echo ""
echo "AgentHub P0 Local Smoke | Mode: $MODE"
echo ""

# === Structural Checks ===
step "Repository structure"
assert_file "AGENTS.md" "AGENTS.md exists"
assert_file "README.md" "README.md exists"
assert_file "docs/architecture.md" "Architecture doc exists"
assert_file "api/openapi.yaml" "OpenAPI spec exists"
assert_file "hub-server/cmd/server-hub/main.go" "Hub server entry exists"
assert_file "edge-server/cmd/agenthub-edge/main.go" "Edge server entry exists"
assert_file "docker-compose.yml" "Docker compose exists"
assert_file ".env.example" ".env.example exists"

step "Configuration hygiene"
assert_grep ".env.example" "AGENTHUB_JWT_SECRET" ".env.example documents JWT_SECRET"
assert_grep ".env.example" "AGENTHUB_DB_PASSWORD" ".env.example documents DB_PASSWORD"
assert_grep ".gitignore" ".env" ".gitignore excludes .env"
assert_grep ".gitignore" ".worktrees" ".gitignore excludes .worktrees"

step "Go module coherence"
if grep -q "go 1." "$REPO_ROOT/go.work" 2>/dev/null; then pass_check "go.work exists"; else fail_check "go.work missing"; fi
assert_file "go.work.sum" "go.work.sum exists"
assert_file "hub-server/go.mod" "hub-server go.mod exists"
assert_file "edge-server/go.mod" "edge-server go.mod exists"

step "Frontend package integrity"
assert_file "app/desktop/package.json" "Desktop package.json exists"
assert_file "app/web/package.json" "Web package.json exists"
assert_file "app/shared/package.json" "Shared package.json exists"

step "CI and hooks"
assert_file ".github/workflows/checks.yml" "CI checks workflow exists"
assert_file "scripts/git-hooks/commit-msg" "commit-msg hook exists"
assert_file "scripts/setup.sh" "setup.sh exists"

# === Localhost probes ===
step "Localhost service probes"
probe_localhost "http://127.0.0.1:${HUB_PORT}/health" '"status":"ok"' "Hub Server :${HUB_PORT}"
probe_localhost "http://127.0.0.1:${EDGE_PORT}/v1/health" '"status":"ok"' "Edge Server :${EDGE_PORT}"
probe_localhost "http://127.0.0.1:${WEB_PORT}" "app" "Web frontend :${WEB_PORT}"

# Generate evidence
cat > "$EVIDENCE_PATH" << EOF
{
  "mode": "$MODE",
  "passed": $PASSED, "failed": $FAILED, "warned": $WARNED, "blocked": $BLOCKED, "skipped": $SKIPPED,
  "ports": {"hub": $HUB_PORT, "web": $WEB_PORT, "desktop": $DESKTOP_PORT, "edge": $EDGE_PORT},
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo ""
echo "========================================"
printf "  Passed: %d | Failed: %d | Warned: %d | Blocked: %d | Skipped: %d\n" "$PASSED" "$FAILED" "$WARNED" "$BLOCKED" "$SKIPPED"
echo "  Evidence: $EVIDENCE_PATH"
echo "========================================"

if [[ "$FAILED" -gt 0 ]]; then exit 1; fi
