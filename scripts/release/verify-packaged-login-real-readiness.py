#!/usr/bin/env python3
"""AgentHub packaged real login E2E readiness proposal gate — ps1 迁移。

Dry repository verifier for the next safe step toward real packaged TokenDance
ID login integration. It reads source and docs only. It does not connect to
Hub, TokenDance ID, production, local services, browsers, secrets, or Agent
runtimes.

Exit 0 on pass, exit 1 if any static gap is found.
"""

import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))

passed = 0
failed = 0


def step(text: str) -> None:
    print(f"\n=== {text} ===", flush=True)


def pass_check(text: str) -> None:
    global passed
    passed += 1
    print(f"  PASS  {text}", flush=True)


def fail_check(text: str) -> None:
    global failed
    failed += 1
    print(f"  FAIL  {text}", flush=True)


def warn_check(text: str) -> None:
    print(f"  WARN  {text}", flush=True)


def read_repo_file(relative_path: str) -> str:
    full_path = os.path.join(REPO_ROOT, relative_path.replace("/", os.sep).replace("\\", os.sep))
    if not os.path.exists(full_path):
        fail_check(f"missing {relative_path.replace('/', '\\')}")
        return ""
    with open(full_path, encoding="utf-8", errors="replace") as handle:
        return handle.read()


def assert_contains(relative_path: str, pattern: str, label: str) -> None:
    content = read_repo_file(relative_path)
    label_path = relative_path.replace("/", "\\")
    if re.search(pattern, content, re.IGNORECASE):
        pass_check(label)
    else:
        fail_check(f"{label} ({label_path} missing pattern: {pattern})")


def assert_not_contains(relative_path: str, pattern: str, label: str) -> None:
    content = read_repo_file(relative_path)
    label_path = relative_path.replace("/", "\\")
    if not re.search(pattern, content, re.IGNORECASE):
        pass_check(label)
    else:
        fail_check(f"{label} ({label_path} contains pattern: {pattern})")


def main() -> int:
    print("AgentHub packaged real login E2E readiness proposal gate", flush=True)
    print("No live Hub, TokenDance ID, browser, secret, or CLI/model calls were made.", flush=True)

    step("fake/local gate")
    assert_contains("scripts/verify/verify-oidc-flow.py", r"LocalOnly", "OIDC flow verifier exposes --LocalOnly")
    assert_contains("scripts/verify/verify-oidc-flow.py", r"args\.SkipHub\s*=\s*True", "--LocalOnly skips live Hub")
    assert_contains("scripts/verify/verify-oidc-flow.py", r"args\.SkipTD\s*=\s*True", "--LocalOnly skips live TokenDance ID")
    assert_contains("scripts/verify/verify-oidc-flow.py", "PackagedDesktop", "--LocalOnly includes packaged Desktop static readiness")

    step("packaged readiness gate")
    assert_contains("app/desktop/src-tauri/src/oidc_server.rs", r'TcpListener::bind\("127\.0\.0\.1:0"\)', "Desktop callback server binds random loopback port")
    assert_contains("app/desktop/src-tauri/src/oidc_server.rs", r"http://127\.0\.0\.1:\{port\}/callback", "Desktop readiness reports loopback callback redirect URI")
    assert_contains("app/desktop/src-tauri/src/secure_store.rs", "check_credential_store_readiness", "Desktop credential-store readiness function exists")
    assert_contains("app/desktop/src-tauri/src/secure_store.rs", r"Entry::new\(SERVICE, HUB_REFRESH_TOKEN_USER\)", "Desktop readiness probes Hub refresh-token credential entry")
    assert_contains("app/desktop/src-tauri/src/host/edge.rs", "get_packaged_login_readiness", "Tauri command exposes packaged login readiness")
    assert_contains("app/desktop/src-tauri/src/host/auth.rs", r'status: "proposal_only"\.to_string\(\)', "Tauri command keeps real packaged E2E proposal-only")
    assert_contains("app/desktop/src-tauri/src/lib.rs", "crate::host::edge::get_packaged_login_readiness", "Tauri invoke handler registers packaged login readiness command")
    assert_contains("scripts/release/verify-tauri-package-readiness.py", "Desktop version metadata", "Tauri package readiness gate exists")
    assert_contains("scripts/release/verify-tauri-package-readiness.py", "Generated artifact ignore policy", "Tauri package gate blocks generated artifact drift")

    step("Desktop/Web auth boundary")
    assert_contains("app/desktop/src/api/hubAuth.ts", "start_oidc_callback_server", "Desktop login uses Tauri loopback callback server")
    assert_contains("app/desktop/src/api/hubAuth.ts", r"device_type:\s*'desktop'", "Desktop OIDC exchange uses desktop device type")
    assert_contains("app/desktop/src/api/hubAuth.ts", "redirect_uri", "Desktop sends redirect_uri through Hub OIDC APIs")
    assert_contains("app/desktop/src/api/hubTokenStorage.ts", "sessionStorage", "Desktop fallback stores Hub access token in tab-scoped storage")
    assert_not_contains("app/desktop/src/api/hubTokenStorage.ts", r"localStorage\.setItem\('agenthub_hub_token'", "Desktop fallback does not persist Hub access token in localStorage")
    assert_contains("app/web/src/api/hubAuth.ts", "/auth/tokendance/callback", "Web login owns browser callback route")
    assert_contains("app/web/src/api/hubAuth.ts", r"device_type:\s*'web'", "Web OIDC exchange uses web device type")
    assert_contains("app/web/src/api/hubTokenStorage.ts", "sessionStorage", "Web stores Hub session material in sessionStorage")
    assert_not_contains("app/web/src/api/hubTokenStorage.ts", r"localStorage\.setItem", "Web storage helper does not write Hub tokens to localStorage")

    step("future real E2E gate")
    assert_contains("docs/governance/README.md", r"Packaged Desktop OIDC readiness.*proposal-only gate", "governance keeps real packaged E2E proposal-only")
    assert_contains("docs/governance/README.md", r"Packaged real login dry readiness.*Hub/TokenDance ID.*secrets", "governance records no live TokenDance ID or browser action")
    assert_contains(".env.example", "AGENTHUB_TOKENDANCE_ID_CLIENT_SECRET", "example config names OIDC client secret without requiring a real value")
    assert_contains(".env.example", "AGENTHUB_TOKENDANCE_ID_ALLOWED_REDIRECT_URIS", "example config names allowed redirect URI boundary")

    step("future real E2E proposal commands")
    print("  fake/local: python .\\scripts\\verify\\verify-oidc-flow.py --LocalOnly", flush=True)
    print("  packaged readiness: python .\\scripts\\release\\verify-tauri-package-readiness.py -RepoRoot .", flush=True)
    print("  dry real-readiness: python .\\scripts\\release\\verify-packaged-login-real-readiness.py -RepoRoot .", flush=True)

    step("future real E2E blockers")
    warn_check("requires explicit operator approval to open the system browser and run a real TokenDance ID login")
    warn_check("requires a dedicated non-production TokenDance ID OAuth client with the packaged Desktop loopback redirect policy confirmed")
    warn_check("requires a disposable test user or pre-approved manual account, never committed or printed")
    warn_check("requires a packaged Desktop artifact and Hub test environment chosen before the browser flow")
    warn_check("requires evidence boundaries for callback URL, state, token exchange, keyring write, and /client/auth/me without exposing tokens")

    print("\n========================================", flush=True)
    print(f"  Passed: {passed}  |  Failed: {failed}", flush=True)
    print("========================================", flush=True)

    if failed == 0:
        print("\nDry readiness gate passed. Future real E2E remains proposal-only until the blockers above are intentionally cleared.\n", flush=True)
    else:
        print("\nDry readiness gate failed. Keep real packaged login E2E blocked until these static gaps are fixed.\n", flush=True)

    return 1 if failed > 0 else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr, flush=True)
        sys.exit(1)
