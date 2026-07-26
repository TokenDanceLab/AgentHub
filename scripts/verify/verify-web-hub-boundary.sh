#!/usr/bin/env bash
# Verify that the browser Web app stays Hub-only.
#
# The Web client may use Hub REST/WS and Hub-issued sessions. It must not open
# Local Edge event streams or invoke Edge run-control APIs directly; Desktop owns
# the Local Edge bridge.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WEB_SRC="$REPO_ROOT/app/web/src"

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

relative() {
    local path="$1"
    printf '%s' "${path#$REPO_ROOT/}"
}

echo ""
echo "=== Web Hub-only boundary ==="

REMOVED_EDGE_FILES=(
    "app/web/src/api/edgeAuth.ts"
    "app/web/src/api/eventClient.ts"
    "app/web/src/hooks/useChatMessages.ts"
    "app/web/src/hooks/useEdgeStatus.ts"
    "app/web/src/hooks/useEventStream.ts"
    "app/web/src/hooks/useHubIntegration.ts"
    "app/web/src/hooks/useRunners.ts"
)

for rel in "${REMOVED_EDGE_FILES[@]}"; do
    if [[ -f "$REPO_ROOT/$rel" ]]; then
        fail_check "$rel should not exist in browser Web"
    else
        pass_check "$rel remains removed"
    fi
done

# Scan source files for forbidden patterns
FORBIDDEN_PATTERNS=(
    "127.0.0.1:3210|localhost:3210|Local Edge loopback URL"
    "/v1/events|/v1/runs|Local Edge event/run API"
    "edgeBaseUrl|edgeAuthHeaders|withEdgeAuthQuery|createEventStream|legacy Edge bridge helper"
    "@tauri-apps/|app/desktop/|src-tauri|desktopHost|localEdgeRuntime|Desktop/Tauri import or runtime reference"
)

for entry in "${FORBIDDEN_PATTERNS[@]}"; do
    IFS='|' read -ra parts <<< "$entry"
    pattern="${parts[0]}"
    label="${parts[1]}"
    # Search all source files
    hits=""
    hits="$(grep -rn "$pattern" "$WEB_SRC" --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' --include='*.json' 2>/dev/null)" || true
    if [[ -n "$hits" ]]; then
        while IFS= read -r line; do
            fail_check "$label found in $(relative "$(echo "$line" | cut -d: -f1)"):$(echo "$line" | cut -d: -f2)"
        done <<< "$hits"
    else
        pass_check "$label absent from app/web/src"
    fi
done

# Check JSON files for Local Edge user-facing copy
JSON_HITS=""
JSON_HITS="$(grep -rn "Local Edge\|本地 Edge\|Edge unavailable\|Edge API did not respond" "$WEB_SRC" --include='*.json' 2>/dev/null)" || true
if [[ -n "$JSON_HITS" ]]; then
    while IFS= read -r line; do
        fail_check "Local Edge user-facing copy found in $(relative "$(echo "$line" | cut -d: -f1)"):$(echo "$line" | cut -d: -f2)"
    done <<< "$JSON_HITS"
else
    pass_check "Local Edge user-facing copy absent from app/web/src JSON"
fi

# Check webPlatform.ts capabilities
WEB_PLATFORM="$REPO_ROOT/app/web/src/platform/webPlatform.ts"
if [[ ! -f "$WEB_PLATFORM" ]]; then
    fail_check "app/web/src/platform/webPlatform.ts missing"
else
    if grep -q "localEdge: false" "$WEB_PLATFORM" 2>/dev/null && grep -q "localFiles: false" "$WEB_PLATFORM" 2>/dev/null; then
        pass_check "app/web/src/platform/webPlatform.ts declares no Local Edge or local file capability"
    else
        fail_check "app/web/src/platform/webPlatform.ts must declare localEdge: false and localFiles: false"
    fi
fi

echo ""
echo "========================================"
printf "  Passed: %d  |  Failed: %d\n" "$PASSED" "$FAILED"
echo "========================================"

if [[ "$FAILED" -ne 0 ]]; then
    exit 1
fi
