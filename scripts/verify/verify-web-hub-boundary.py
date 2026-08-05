#!/usr/bin/env python3
"""verify-web-hub-boundary — Web Hub-only boundary 门禁（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

Web 客户端只允许使用 Hub REST/WS 与 Hub 签发的会话；不得打开 Local Edge
事件流或直接调用 Edge run-control API（Desktop 独占 Local Edge bridge）。
"""

import argparse
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
for _ in range(4):
    if os.path.isfile(os.path.join(REPO_ROOT, "AGENTS.md")):
        break
    REPO_ROOT = os.path.dirname(REPO_ROOT)
else:
    raise RuntimeError("cannot locate AgentHub repository root")
WEB_SRC = os.path.join(REPO_ROOT, "app", "web", "src")

SOURCE_EXTENSIONS = (".ts", ".tsx", ".js", ".jsx")
JSON_EXTENSION = ".json"

REMOVED_EDGE_FILES = [
    "app/web/src/api/edgeAuth.ts",
    "app/web/src/api/eventClient.ts",
    "app/web/src/hooks/useChatMessages.ts",
    "app/web/src/hooks/useEdgeStatus.ts",
    "app/web/src/hooks/useEventStream.ts",
    "app/web/src/hooks/useHubIntegration.ts",
    "app/web/src/hooks/useRunners.ts",
]

# 与 ps1 一一对应：(正则, 输出标签)。Select-String 默认忽略大小写，此处同。
FORBIDDEN_PATTERNS = [
    (r"127\.0\.0\.1:3210|localhost:3210", "Local Edge loopback URL"),
    (r"/v1/events|/v1/runs", "Local Edge event/run API"),
    (r"edgeBaseUrl|edgeAuthHeaders|withEdgeAuthQuery|createEventStream", "legacy Edge bridge helper"),
    (r"@tauri-apps/|app/desktop/|src-tauri|desktopHost|localEdgeRuntime", "Desktop/Tauri import or runtime reference"),
]

FORBIDDEN_JSON_COPY_PATTERNS = [
    (r"Local Edge|本地 Edge|Workbench Edge|工作台 Edge|Edge unavailable/error|Edge 不可用/错误|Edge API did not respond", "Local Edge user-facing copy"),
]


def collect_files(root, extensions):
    files = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for name in sorted(filenames):
            if name.endswith(extensions):
                files.append(os.path.join(dirpath, name))
    return files


def read_lines(path):
    with open(path, encoding="utf-8-sig", errors="replace") as handle:
        return handle.read().splitlines()


def relative(path):
    return os.path.relpath(path, REPO_ROOT).replace("\\", "/")


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify that the browser Web app stays Hub-only.")
    parser.parse_args()

    passed = 0
    failed = 0

    def pass_check(text):
        nonlocal passed
        passed += 1
        print(f"  PASS  {text}")

    def fail_check(text):
        nonlocal failed
        failed += 1
        print(f"  FAIL  {text}")

    print("\n=== Web Hub-only boundary ===")

    for rel in REMOVED_EDGE_FILES:
        if os.path.exists(os.path.join(REPO_ROOT, rel.replace("/", os.sep))):
            fail_check(f"{rel} should not exist in browser Web")
        else:
            pass_check(f"{rel} remains removed")

    boundary_files = collect_files(WEB_SRC, SOURCE_EXTENSIONS)
    json_files = collect_files(WEB_SRC, (JSON_EXTENSION,))

    for pattern, label in FORBIDDEN_PATTERNS:
        matches = []
        for path in boundary_files:
            for lineno, line in enumerate(read_lines(path), start=1):
                if re.search(pattern, line, re.IGNORECASE):
                    matches.append((path, lineno))
        if matches:
            for path, lineno in matches:
                fail_check(f"{label} found in {relative(path)}:{lineno}")
        else:
            pass_check(f"{label} absent from app/web/src")

    for pattern, label in FORBIDDEN_JSON_COPY_PATTERNS:
        matches = []
        for path in json_files:
            for lineno, line in enumerate(read_lines(path), start=1):
                if re.search(pattern, line, re.IGNORECASE):
                    matches.append((path, lineno))
        if matches:
            for path, lineno in matches:
                fail_check(f"{label} found in {relative(path)}:{lineno}")
        else:
            pass_check(f"{label} absent from app/web/src JSON")

    web_platform_path = os.path.join(REPO_ROOT, "app", "web", "src", "platform", "webPlatform.ts")
    if not os.path.exists(web_platform_path):
        fail_check("app/web/src/platform/webPlatform.ts missing")
    else:
        with open(web_platform_path, encoding="utf-8-sig", errors="replace") as handle:
            web_platform = handle.read()
        if "localEdge: false" in web_platform and "localFiles: false" in web_platform:
            pass_check("app/web/src/platform/webPlatform.ts declares no Local Edge or local file capability")
        else:
            fail_check("app/web/src/platform/webPlatform.ts must declare localEdge: false and localFiles: false")

    print("\n========================================")
    print(f"  Passed: {passed}  |  Failed: {failed}")
    print("========================================")

    return 1 if failed != 0 else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
