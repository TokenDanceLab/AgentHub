#!/usr/bin/env bash
# AgentHub TokenDance ID OIDC release-readiness checks.
#
# This script is intentionally secret-free. It checks public repository wiring,
# examples, and boundary docs only. It does not connect to production and does
# not require or print a real OAuth client secret.
set -euo pipefail

SKIP_WORKSPACE_DOCS=false
REPO_ROOT=""
PASSED=0
FAILED=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        -SkipWorkspaceDocs) SKIP_WORKSPACE_DOCS=true; shift ;;
        *) echo "Unknown argument: $1"; exit 2 ;;
    esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

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
    local relative_path="$1"
    local pattern="$2"
    local label="$3"
    local content
    content="$(read_repo_file "$relative_path" 2>/dev/null)" || true
    if echo "$content" | grep -qF "$pattern" 2>/dev/null; then
        pass_check "$label"
    else
        fail_check "$label ($relative_path missing pattern: $pattern)"
    fi
}

assert_not_contains() {
    local relative_path="$1"
    local pattern="$2"
    local label="$3"
    local content
    content="$(read_repo_file "$relative_path" 2>/dev/null)" || true
    if echo "$content" | grep -qF "$pattern" 2>/dev/null; then
        fail_check "$label ($relative_path contains pattern: $pattern)"
    else
        pass_check "$label"
    fi
}

WORKSPACE_DOC_CANDIDATES=("docs/identity/relying-party.md" "docs/relying-party-readiness.md")

find_workspace_docs() {
    local current="$REPO_ROOT"
    while [[ -n "$current" ]]; do
        for rel in "${WORKSPACE_DOC_CANDIDATES[@]}"; do
            local candidate="$current/$rel"
            if [[ -f "$candidate" ]]; then
                echo "$candidate"
                return 0
            fi
        done
        local parent
        parent="$(dirname "$current")"
        if [[ "$parent" == "$current" || -z "$parent" ]]; then
            break
        fi
        current="$parent"
    done
    return 1
}

# === Checks ===

step "Hub OIDC API contract"
assert_contains "api/openapi.yaml" "/client/auth/oidc/authorize" "OpenAPI documents OIDC authorize endpoint"
assert_contains "api/openapi.yaml" "/client/auth/oidc/callback" "OpenAPI documents OIDC callback endpoint"
assert_contains "api/openapi.yaml" "HubOIDCAuthorizeRequest" "OpenAPI includes authorize schema"
assert_contains "api/openapi.yaml" "HubOIDCCallbackResponse" "OpenAPI includes callback response schema"

step "Hub OIDC server wiring"
assert_contains "hub-server/internal/config/config.go" "AGENTHUB_TOKENDANCE_ID_ISSUER_URL" "canonical TokenDance ID issuer env is loaded"
assert_contains "hub-server/internal/config/config.go" "AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS" "allowed redirect URI env is loaded"
assert_contains "hub-server/internal/config/config.go" "redirect_uri is required" "Hub validates redirect URI when OIDC client is enabled"
assert_contains "hub-server/internal/service/oidc.go" "ParseTokenDanceJWT" "Hub validates TokenDance ID token"
assert_contains "hub-server/internal/service/oidc.go" "FindOrCreateByTokenDanceSub" "Hub maps tokendance_sub to Hub user"
assert_contains "hub-server/internal/service/oidc.go" "UpsertRefreshToken" "Hub issues Hub-local refresh session"
assert_contains "hub-server/internal/middleware/auth.go" "func RequireHubSession" "Hub has explicit Hub-session-only middleware"
assert_contains "hub-server/internal/router/router.go" "middleware.RequireHubSession()" "contacts require Hub-issued session"
assert_contains "hub-server/internal/router/router.go" "middleware.RequireHubSession()" "sessions require Hub-issued session"
assert_contains "hub-server/internal/router/router.go" "middleware.RequireHubSession()" "messages require Hub-issued session"
assert_contains "hub-server/internal/router/router.go" "middleware.RequireHubSession()" "web routes require Hub-issued session"
assert_contains "hub-server/internal/router/router.go" "middleware.RequireHubSession()" "edge routes require Hub-issued session"

step "Secret-free deployment examples"
assert_contains ".env.example" "AGENTHUB_TOKENDANCE_ID_ISSUER_URL" ".env.example documents TokenDance ID issuer"
assert_contains ".env.example" "AGENTHUB_TOKENDANCE_ID_CLIENT_ID" ".env.example documents Hub OIDC client id"
assert_contains ".env.example" "AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET" ".env.example documents client secret placeholder"
assert_contains ".env.example" "AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS" ".env.example documents allowed redirect list"
assert_contains "docker-compose.yml" "AGENTHUB_TOKENDANCE_ID_CLIENT_ID" "docker compose passes OIDC client id through env"
assert_contains "docker-compose.yml" "AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET" "docker compose passes OIDC client secret through env"

step "Desktop/Web client boundaries"
assert_contains "app/desktop/src/api/hubAuth.ts" "start_oidc_callback_server" "Desktop uses local callback server in Tauri"
assert_contains "app/desktop/src/api/hubAuth.ts" "redirect_uri" "Desktop sends redirect_uri through Hub OIDC APIs"
assert_contains "app/desktop/src/api/hubTokenStorage.ts" "sessionStorage" "Desktop browser fallback keeps Hub access token tab-scoped"
assert_not_contains "app/desktop/src/api/hubTokenStorage.ts" "localStorage.setItem('agenthub_hub_token'" "Desktop fallback does not persist Hub access token in localStorage"
assert_contains "app/web/src/api/hubAuth.ts" "/auth/tokendance/callback" "Web owns browser callback route"
assert_contains "app/web/src/api/hubTokenStorage.ts" "sessionStorage" "Web stores Hub session material in sessionStorage"
assert_not_contains "app/web/src/api/hubTokenStorage.ts" "localStorage.setItem" "Web storage helper does not write Hub tokens to localStorage"
assert_contains "app/desktop/src/api/hubWS.ts" "access_token" "Desktop Hub WebSocket sends Hub access token during upgrade"
assert_contains "app/web/src/api/hubWS.ts" "access_token" "Web Hub WebSocket sends Hub access token during upgrade"
assert_contains "hub-server/internal/handler/ws_test.go" "TestWebSocketRouteAcceptsHubLocalQueryTokenBeforeUpgrade" "Hub tests accept Hub-issued query token before WebSocket upgrade"
assert_contains "hub-server/internal/middleware/auth_test.go" "TestRequireHubSessionBlocksTokenDanceAuth" "Hub session middleware tests reject TokenDance bearer source"
assert_contains "app/web/README.md" "BFF/HttpOnly cookie" "Web README keeps high-trust session caveat"

if [[ "$SKIP_WORKSPACE_DOCS" != "true" ]]; then
    step "Workspace governance docs"
    WORKSPACE_DOCS="$(find_workspace_docs)" || true
    if [[ -z "$WORKSPACE_DOCS" ]]; then
        SEARCHED=$(printf '%s' "${WORKSPACE_DOC_CANDIDATES[*]}")
        fail_check "workspace docs not found. Searched: $SEARCHED. Rerun with -SkipWorkspaceDocs for AgentHub-only clones."
    else
        pass_check "workspace docs source: $WORKSPACE_DOCS"
        if grep -qF "AgentHub Hub Server | Partial" "$WORKSPACE_DOCS" 2>/dev/null; then
            pass_check "root relying-party matrix still marks AgentHub Hub Server Partial"
        else
            fail_check "root readiness matrix must not mark AgentHub Hub Server release-ready without live evidence"
        fi
        if grep -qE "BFF/HttpOnly.cookie|BFF/HttpOnly cookie" "$WORKSPACE_DOCS" 2>/dev/null; then
            pass_check "root readiness matrix keeps Web high-trust session caveat"
        else
            fail_check "root readiness matrix missing Web high-trust session caveat"
        fi
    fi
fi

echo ""
echo "========================================"
printf "  Passed: %d  |  Failed: %d\n" "$PASSED" "$FAILED"
echo "========================================"

if [[ "$FAILED" -ne 0 ]]; then
    exit 1
fi
