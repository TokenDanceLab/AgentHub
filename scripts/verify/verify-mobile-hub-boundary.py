#!/usr/bin/env python3
"""verify-mobile-hub-boundary — Mobile RN Hub-only 边界门禁（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

Mobile 客户端只允许使用 Hub REST/WS 与 Hub 签发的会话；不得打开 Local Edge
事件流或直接调用 Edge run-control API（Desktop 独占 Local Edge bridge）。
mobilePlatform.ts 声明 localEdge: false，本门禁守护该声明并阻止 Local Edge
URL 或旧 Edge helper 符号回流到 app/mobile-rn/src。

扫描范围：app/mobile-rn/src 内 runtime 源文件（ts/tsx/js/jsx）；scripts/、
README、mock-hub 与 docs 副本在 src/ 之外，不扫描（与 verify-boundaries.mjs
既有 allow/exclude 模式一致）。
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
MOBILE_SRC = os.path.join(REPO_ROOT, "app", "mobile-rn", "src")

SOURCE_EXTENSIONS = (".ts", ".tsx", ".js", ".jsx")

FORBIDDEN_PATTERNS = [
    (r"127\.0\.0\.1:3210|localhost:3210", "Local Edge loopback URL"),
    (r"/v1/events|/v1/runs", "Local Edge event/run API"),
    (r"edgeAuth|createEventStream|edgeBaseUrl", "legacy Edge bridge helper or symbol"),
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
    parser = argparse.ArgumentParser(description="Verify that the Mobile RN app stays Hub-only.")
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

    print("\n=== Mobile RN Hub-only boundary ===")

    if not os.path.isdir(MOBILE_SRC):
        fail_check("app/mobile-rn/src missing — cannot verify Mobile Hub-only boundary")
        print("\n========================================")
        print(f"  Passed: {passed}  |  Failed: {failed}")
        print("========================================")
        return 1

    boundary_files = collect_files(MOBILE_SRC, SOURCE_EXTENSIONS)

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
            pass_check(f"{label} absent from app/mobile-rn/src")

    mobile_platform_path = os.path.join(REPO_ROOT, "app", "mobile-rn", "src", "platform", "mobilePlatform.ts")
    if not os.path.exists(mobile_platform_path):
        fail_check("app/mobile-rn/src/platform/mobilePlatform.ts missing")
    else:
        with open(mobile_platform_path, encoding="utf-8-sig", errors="replace") as handle:
            mobile_platform = handle.read()
        if "localEdge: false" in mobile_platform:
            pass_check("app/mobile-rn/src/platform/mobilePlatform.ts declares localEdge: false")
        else:
            fail_check("app/mobile-rn/src/platform/mobilePlatform.ts must declare localEdge: false")

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
