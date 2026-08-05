#!/usr/bin/env python3
# KNOWN-OBSOLETE (2026-08-02): asserts hub-server/internal/service/oidc.go (removed) and old ws_test.go test names; not wired to CI; rewrite tracked separately.
"""AgentHub TokenDance ID OIDC release-readiness checks（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

本脚本刻意保持无 secret。只检查公开的仓库 wiring、examples 与 boundary docs；
不连接生产环境，不要求也不打印真实 OAuth client secret。

用法：
  python scripts/verify/verify-oidc-readiness.py
  python scripts/verify/verify-oidc-readiness.py --SkipWorkspaceDocs   # AgentHub-only clone 跳过 workspace docs
"""

import argparse
import os
import re
import sys

PASSED = 0
FAILED = 0


def pass_check(text):
    global PASSED
    PASSED += 1
    print(f"  PASS  {text}")


def fail_check(text):
    global FAILED
    FAILED += 1
    print(f"  FAIL  {text}")


def step(text):
    print(f"\n=== {text} ===")


def read_repo_file(relative_path):
    path = os.path.join(REPO_ROOT, relative_path.replace("\\", os.sep))
    if not os.path.isfile(path):
        fail_check(f"missing {relative_path}")
        return ""
    try:
        with open(path, encoding="utf-8") as handle:
            return handle.read()
    except OSError as exc:
        fail_check(f"unreadable {relative_path}: {exc}")
        return ""


def assert_contains(relative_path, pattern, label):
    content = read_repo_file(relative_path)
    if re.search(pattern, content):
        pass_check(label)
    else:
        fail_check(f"{label} ({relative_path} missing pattern: {pattern})")


def assert_not_contains(relative_path, pattern, label):
    content = read_repo_file(relative_path)
    if not re.search(pattern, content):
        pass_check(label)
    else:
        fail_check(f"{label} ({relative_path} contains pattern: {pattern})")


def find_workspace_docs(repo_root):
    workspace_doc_candidates = (
        os.path.join("docs", "identity", "relying-party.md"),
        os.path.join("docs", "relying-party-readiness.md"),
    )
    current = repo_root
    while current:
        for relative_path in workspace_doc_candidates:
            candidate = os.path.join(current, relative_path)
            if os.path.isfile(candidate):
                return {
                    "Root": current,
                    "RelativePath": relative_path.replace(os.sep, "\\"),
                    "Path": candidate,
                }
        parent = os.path.dirname(current)
        if parent == current or not parent:
            return None
        current = parent
    return None


def main() -> int:
    global PASSED, FAILED, REPO_ROOT
    parser = argparse.ArgumentParser(
        description="AgentHub TokenDance ID OIDC release-readiness checks (ps1 migration)"
    )
    parser.add_argument("--SkipWorkspaceDocs", action="store_true", help="skip the workspace governance docs phase")
    args = parser.parse_args()

    repo_root = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    REPO_ROOT = repo_root

    step("Hub OIDC API contract")
    assert_contains("api/openapi.yaml", r"/client/auth/oidc/authorize", "OpenAPI documents OIDC authorize endpoint")
    assert_contains("api/openapi.yaml", r"/client/auth/oidc/callback", "OpenAPI documents OIDC callback endpoint")
    assert_contains("api/openapi.yaml", r"HubOIDCAuthorizeRequest", "OpenAPI includes authorize schema")
    assert_contains("api/openapi.yaml", r"HubOIDCCallbackResponse", "OpenAPI includes callback response schema")

    step("Hub OIDC server wiring")
    assert_contains("hub-server/internal/config/config.go", r"AGENTHUB_TOKENDANCE_ID_ISSUER_URL", "canonical TokenDance ID issuer env is loaded")
    assert_contains("hub-server/internal/config/config.go", r"AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS", "allowed redirect URI env is loaded")
    assert_contains("hub-server/internal/config/config.go", r"tokendance_id\.redirect_uri is required", "Hub validates redirect URI when OIDC client is enabled")
    assert_contains("hub-server/internal/service/oidc.go", r"ParseTokenDanceJWT", "Hub validates TokenDance ID token")
    assert_contains("hub-server/internal/service/oidc.go", r"FindOrCreateByTokenDanceSub", "Hub maps tokendance_sub to Hub user")
    assert_contains("hub-server/internal/service/oidc.go", r"UpsertRefreshToken", "Hub issues Hub-local refresh session")
    assert_contains("hub-server/internal/middleware/auth.go", r"func RequireHubSession", "Hub has explicit Hub-session-only middleware")
    assert_contains("hub-server/internal/router/router.go", r"contacts\.Use\(middleware\.RequireHubSession\(\)\)", "client contacts require Hub-issued session")
    assert_contains("hub-server/internal/router/router.go", r"sessions\.Use\(middleware\.RequireHubSession\(\)\)", "client sessions require Hub-issued session")
    assert_contains("hub-server/internal/router/router.go", r"messages\.Use\(middleware\.RequireHubSession\(\)\)", "client messages require Hub-issued session")
    assert_contains("hub-server/internal/router/router.go", r"web\.Use\(middleware\.RequireHubSession\(\)\)", "web routes require Hub-issued session")
    assert_contains("hub-server/internal/router/router.go", r"edge\.Use\(middleware\.RequireHubSession\(\)\)", "edge routes require Hub-issued session")

    step("Secret-free deployment examples")
    assert_contains(".env.example", r"AGENTHUB_TOKENDANCE_ID_ISSUER_URL", ".env.example documents TokenDance ID issuer")
    assert_contains(".env.example", r"AGENTHUB_TOKENDANCE_ID_CLIENT_ID", ".env.example documents Hub OIDC client id")
    assert_contains(".env.example", r"AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET", ".env.example documents client secret placeholder")
    assert_contains(".env.example", r"AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS", ".env.example documents allowed redirect list")
    assert_contains("docker-compose.yml", r"AGENTHUB_TOKENDANCE_ID_CLIENT_ID", "docker compose passes OIDC client id through env")
    assert_contains("docker-compose.yml", r"AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET", "docker compose passes OIDC client secret through env")

    step("Desktop/Web client boundaries")
    assert_contains("app/desktop/src/api/hubAuth.ts", r"start_oidc_callback_server", "Desktop uses local callback server in Tauri")
    assert_contains("app/desktop/src/api/hubAuth.ts", r"redirect_uri", "Desktop sends redirect_uri through Hub OIDC APIs")
    assert_contains("app/desktop/src/api/hubTokenStorage.ts", r"sessionStorage", "Desktop browser fallback keeps Hub access token tab-scoped")
    assert_not_contains("app/desktop/src/api/hubTokenStorage.ts", r"localStorage\.setItem\('agenthub_hub_token'", "Desktop fallback does not persist Hub access token in localStorage")
    assert_contains("app/web/src/api/hubAuth.ts", r"/auth/tokendance/callback", "Web owns browser callback route")
    assert_contains("app/web/src/api/hubTokenStorage.ts", r"sessionStorage", "Web stores Hub session material in sessionStorage")
    assert_not_contains("app/web/src/api/hubTokenStorage.ts", r"localStorage\.setItem", "Web storage helper does not write Hub tokens to localStorage")
    assert_contains("app/desktop/src/api/hubWS.ts", r"access_token", "Desktop Hub WebSocket sends Hub access token during upgrade")
    assert_contains("app/web/src/api/hubWS.ts", r"access_token", "Web Hub WebSocket sends Hub access token during upgrade")
    assert_contains("hub-server/internal/handler/ws_test.go", r"TestWebSocketRouteAcceptsHubLocalQueryTokenBeforeUpgrade", "Hub tests accept Hub-issued query token before WebSocket upgrade")
    assert_contains("hub-server/internal/middleware/auth_test.go", r"TestRequireHubSessionBlocksTokenDanceAuth", "Hub session middleware tests reject TokenDance bearer source")
    assert_contains("app/web/README.md", r"BFF/HttpOnly cookie", "Web README keeps high-trust session caveat")

    if not args.SkipWorkspaceDocs:
        step("Workspace governance docs")
        workspace_docs = find_workspace_docs(repo_root)
        if workspace_docs is None:
            searched = ", ".join([
                os.path.join("docs", "identity", "relying-party.md").replace("\\", "/"),
                os.path.join("docs", "relying-party-readiness.md").replace("\\", "/"),
            ])
            fail_check(
                f"workspace docs not found. Searched workspace docs: {searched}. "
                "Rerun with -SkipWorkspaceDocs only for AgentHub-only clones."
            )
        else:
            pass_check(f"workspace docs source: {workspace_docs['RelativePath']}")
            try:
                with open(workspace_docs["Path"], encoding="utf-8") as handle:
                    readiness = handle.read()
            except OSError as exc:
                fail_check(f"workspace docs unreadable: {exc}")
                readiness = ""
            if re.search(r"AgentHub Hub Server \| Partial", readiness):
                pass_check("root relying-party matrix still marks AgentHub Hub Server Partial")
            else:
                fail_check("root readiness matrix must not mark AgentHub Hub Server release-ready without live evidence")
            if re.search(r"BFF/HttpOnly-cookie|BFF/HttpOnly cookie", readiness):
                pass_check("root readiness matrix keeps Web high-trust session caveat")
            else:
                fail_check("root readiness matrix missing Web high-trust session caveat")

    print("\n========================================")
    print(f"  Passed: {PASSED}  |  Failed: {FAILED}")
    print("========================================")

    if FAILED != 0:
        return 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
