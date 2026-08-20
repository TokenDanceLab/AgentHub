#!/usr/bin/env python3
"""AgentHub P0 remote-control auth/topology prerequisite gate（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

验证 48h remote-control 链的 auth/topology 前置条件：Web 有 Hub 签发的
session，Hub 能寻址已注册的 Desktop/Edge target。只读 source 与 docs；
不连接 live Hub、TokenDance ID、浏览器、secrets、Local Edge 或 Agent runtime。

用法：
  python scripts/verify/verify-login-fixture-topology.py
"""

import argparse
import os
import re
import sys

PASSED = 0
FAILED = 0


def step(text):
    print(f"\n=== {text} ===")


def pass_check(text):
    global PASSED
    PASSED += 1
    print(f"  PASS  {text}")


def fail_check(text):
    global FAILED
    FAILED += 1
    print(f"  FAIL  {text}")


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


def main() -> int:
    global REPO_ROOT
    parser = argparse.ArgumentParser(
        description="AgentHub P0 remote-control auth/topology prerequisite gate (ps1 migration)"
    )
    parser.add_argument("--RepoRoot", default=".", help="repository root (defaults to the current directory)")
    args = parser.parse_args()
    REPO_ROOT = os.path.abspath(args.RepoRoot)

    print("AgentHub P0 remote-control auth/topology prerequisite gate")
    print("No live Hub, TokenDance ID, browser, secret, Local Edge, or CLI/model calls were made.")

    step("Web authenticated Hub session to Desktop/Edge target")
    assert_contains("app/web/src/hooks/useWebAuth.ts", r"tryAutoLogin\(\)", "Web has an existing auth auto-login/callback hook available for Hub session bootstrap")
    assert_contains("app/web/src/api/hubAuth.test.ts", r"uses Hub-issued OIDC session to address a registered Desktop Edge target", "agenthub-web focused auth fixture covers Hub session to registered Desktop Edge target")
    assert_contains("app/web/src/api/hubAuth.test.ts", r"web/execution-targets.pageSize=50", "Web fixture reads Hub execution targets after auth")
    assert_contains("app/web/src/api/hubAuth.test.ts", r"getAuthorization\(init\)\)\.toBe\('Bearer web-fixture-access-token'\)", "Web fixture uses Hub-issued Bearer token for target inventory")
    assert_contains("app/web/src/api/hubAuth.test.ts", r"Packaged Desktop Edge", "Web fixture addresses a registered packaged Desktop Edge target")
    assert_contains("app/web/src/api/hubAuth.test.ts", r"device_type:\s*'web'", "Web callback fixture uses web device type")
    assert_contains("app/web/src/api/hubAuth.test.ts", r"agenthub_hub_token", "Web callback fixture asserts Hub access-token storage")
    assert_contains("app/web/src/api/hubAuth.test.ts", r"agenthub_hub_refresh_token", "Web callback fixture asserts Hub refresh-token storage")
    assert_contains("app/web/src/api/hubAuth.test.ts", r"agenthub_token_source", "Web callback fixture asserts TokenDance token source hint")
    assert_contains("app/web/src/api/hubAuth.test.ts", r"localEdgeLoopback", "Web callback fixture asserts forbidden Local Edge loopback without embedding the forbidden URL")
    assert_contains("app/web/src/api/hubAuth.test.ts", r"edgeRunApi", "Web callback fixture asserts forbidden Local Edge run API without embedding the forbidden path")
    assert_contains("scripts/verify/verify-web-hub-boundary.py", r"Local Edge loopback URL", "Web boundary gate owns direct Local Edge URL scanning")
    assert_not_contains("app/web/src/api/hubAuth.test.ts", r"id\.vectorcontrol\.tech.*fetch|window\.open\(", "Web focused fixture does not open real TokenDance ID")

    step("Desktop packaged host and fake login boundary")
    assert_contains("app/desktop/src/api/hubAuth.test.ts", r"Desktop browser-dev OIDC fixture boundary", "agenthub-desktop focused auth fixture exists")
    assert_contains("app/desktop/src/api/hubAuth.test.ts", r"device_type:\s*'desktop'", "Desktop callback fixture uses desktop device type")
    assert_contains("app/desktop/src/api/hubAuth.test.ts", r"agenthub_hub_token", "Desktop callback fixture asserts Hub access-token storage")
    assert_contains("app/desktop/src/api/hubAuth.test.ts", r"agenthub_hub_refresh_token", "Desktop callback fixture checks refresh-token localStorage boundary")
    assert_contains("app/desktop/src/api/hubAuth.test.ts", r"not\.toMatch", "Desktop callback fixture asserts forbidden request URLs")
    assert_contains("app/desktop/src/api/hubAuth.test.ts", r"localhost:3210", "Desktop callback fixture names Local Edge loopback as forbidden")
    assert_contains("app/desktop/src/api/hubAuth.test.ts", r"spawn\|Command", "Desktop callback fixture names CLI bypass patterns as forbidden")
    assert_not_contains("app/desktop/src/api/hubAuth.test.ts", r"id\.vectorcontrol\.tech.*fetch", "Desktop focused fixture does not fetch real TokenDance ID")
    assert_contains("app/desktop/src/platform/desktopPlatform.test.ts", r"<app-data>/agenthub-edge\.sqlite", "Desktop packaged host readiness keeps Local Edge SQLite app-data path")
    assert_contains("app/desktop/src/platform/desktopPlatform.test.ts", r"--store-backend", "Desktop packaged host readiness passes explicit store backend")
    assert_contains("app/desktop/src/platform/desktopPlatform.test.ts", r"direct_cli_spawn:\s*false", "Desktop packaged host readiness does not grant UI CLI spawn inputs")

    step("Existing local/dry gates")
    assert_contains("scripts/verify/verify-oidc-flow.py", r"--LocalOnly", "OIDC flow verifier exposes -LocalOnly")
    assert_contains("scripts/verify/verify-oidc-flow.py", r"args\.SkipHub\s*=\s*True", "-LocalOnly skips live Hub")
    assert_contains("scripts/verify/verify-oidc-flow.py", r"args\.SkipTD\s*=\s*True", "-LocalOnly skips live TokenDance ID")
    assert_contains("scripts/release/verify-packaged-login-real-readiness.py", r"No live Hub, TokenDance ID, browser, secret, or CLI/model calls were made", "packaged real-readiness gate is dry")
    assert_contains("scripts/verify/verify-web-hub-boundary.py", r"Web Hub-only boundary", "Web Hub-only boundary gate exists")
    assert_contains("scripts/release/verify-tauri-package-readiness.py", r"macOS unsigned dry policy boundary", "macOS unsigned dry policy gate remains present")
    assert_contains("edge-server/internal/adapters/sdk/sdk_fixture_mapper_test.go", r"TestSDKFixtureMapperClaudeGolden", "SDK fixture mapper Claude golden evidence remains fixture-only")
    assert_contains("edge-server/internal/adapters/sdk/sdk_fixture_mapper_test.go", r"TestSDKFixtureMapperOpenAIGolden", "SDK fixture mapper OpenAI golden evidence remains fixture-only")

    step("Topology docs")
    assert_contains("docs/governance/README.md", r"Login fixture topology gate", "governance records login fixture topology gate")
    assert_contains("docs/governance/README.md", r"Desktop receives Hub dispatch -> Local Edge starts CLI adapter", "governance keeps dispatch/CLI start outside this login slice")
    assert_contains("docs/governance/README.md", r"future real TokenDanceID/OIDC login remains approval-gated", "governance keeps real TokenDanceID/OIDC approval gate")

    step("Focused verification commands")
    print("  agenthub-web: pnpm test -- src/api/hubAuth.test.ts")
    print("  agenthub-web: pnpm typecheck")
    print("  agenthub-desktop: pnpm test -- src/api/hubAuth.test.ts")
    print("  agenthub-desktop: pnpm test -- src/platform/desktopPlatform.test.ts")
    print("  local OIDC: python scripts/verify/verify-oidc-flow.py --LocalOnly")
    print("  packaged dry: python scripts/release/verify-packaged-login-real-readiness.py --RepoRoot .")
    print("  Web boundary: python scripts/verify/verify-web-hub-boundary.py")
    print("  Tauri package readiness: python scripts/release/verify-tauri-package-readiness.py --RepoRoot .")

    step("Evidence boundaries")
    print("  Mock-only: fake OIDC callback, Hub-issued fixture tokens, and Hub execution-target inventory fixture")
    print("  Real-mode ready: source gates for Web Hub-only boundary, Desktop packaged Local Edge SQLite path, packaged OIDC readiness, SDK fixture mapper, and macOS dry policy")
    print("  future real TokenDanceID/OIDC login remains approval-gated")
    print("  real Desktop dispatch -> Local Edge CLI adapter start remains outside this login/topology slice")

    print("\n========================================")
    print(f"  Passed: {PASSED}  |  Failed: {FAILED}")
    print("========================================")

    if FAILED == 0:
        print("\nP0 remote-control auth/topology prerequisite gate passed. Real TokenDanceID/OIDC and real CLI/model execution remain blocked on explicit approval.\n")
    else:
        print("\nP0 remote-control auth/topology prerequisite gate failed. Keep real TokenDanceID/OIDC and real CLI/model execution blocked until fixture gaps are fixed.\n")

    if FAILED > 0:
        return 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
