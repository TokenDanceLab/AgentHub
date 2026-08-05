#!/usr/bin/env python3
"""verify-shared-barrel — shared barrel Edge 导出禁令门禁（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

平台应用（Web/Desktop/Mobile）不得从 @agenthub/shared barrel 引入 Local Edge
客户端导出。两道检查：
1. 子路径禁令 —— 平台 src 不得直连 @agenthub/shared/eventClient 等 Edge 模块；
2. barrel 名字禁令 —— 平台 src 不得从根 barrel（@shared / @agenthub/shared）导入
   Edge 导出名（EventClient 等）。Desktop 拥有 Edge 桥，但必须走自己的
   apiClient/eventClient wrapper，不得从 shared barrel 拉 Edge 客户端。
"""

import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
for _ in range(4):
    if os.path.isfile(os.path.join(ROOT, "AGENTS.md")):
        break
    ROOT = os.path.dirname(ROOT)
else:
    raise RuntimeError("cannot locate AgentHub repository root")

# 平台应用源码目录（三端都扫；Desktop 也必须走自己的 wrapper）
PLATFORM_DIRS = [
    "app/web/src",
    "app/desktop/src",
    "app/mobile-rn/src",
]

# Edge 客户端子路径（子路径禁令）
EDGE_SUB_PATHS = [
    "eventClient",
    "edgeClient",
]

# 根 barrel 导入中禁止出现的 Edge 导出名（eventClient.ts 的导出）
EDGE_EXPORT_NAMES = [
    "EventClient", "EventClientOptions", "EventConnectionListener",
    "EventConnectionStatus", "EventListener",
]


def relative(path: str) -> str:
    return os.path.relpath(path, ROOT).replace(os.sep, "/")


def walk_sorted(root: str):
    """深度优先 + 每层按名称排序的遍历，镜像 Get-ChildItem -Recurse。"""
    for entry in sorted(os.listdir(root)):
        full = os.path.join(root, entry)
        if os.path.isfile(full):
            if entry.endswith(".ts") or entry.endswith(".tsx"):
                yield full
        elif os.path.isdir(full):
            yield from walk_sorted(full)


def collect_files() -> tuple:
    files = []
    scan_failures = []
    for platform_dir in PLATFORM_DIRS:
        full = os.path.join(ROOT, platform_dir)
        if not os.path.isdir(full):
            scan_failures.append(f"platform source directory missing: {platform_dir}")
            continue
        files.extend(walk_sorted(full))
    return files, scan_failures


def main() -> int:
    parser = argparse.ArgumentParser(description="Shared barrel Edge-export ban gate (platform apps)")
    parser.parse_args()

    passed = 0
    failed = 0

    def pass_line(text: str) -> None:
        nonlocal passed
        passed += 1
        print(f"  PASS  {text}")

    def fail_line(text: str) -> None:
        nonlocal failed
        failed += 1
        print(f"  FAIL  {text}")

    files, scan_failures = collect_files()
    for message in scan_failures:
        fail_line(message)

    print()
    print("=== Shared barrel Edge-export ban (platform apps) ===")
    print(f"Scanning {len(files)} .ts/.tsx file(s) across platform src.")

    # ── Check 1: 子路径 Edge 模块导入禁令 ─────────────────────────────────
    sub_path_violations = 0
    sub_path_patterns = [
        re.compile(rf"from\s+['\"]@(agenthub/)?shared/{re.escape(mod)}['\"]", re.IGNORECASE)
        for mod in EDGE_SUB_PATHS
    ]
    for file_path in files:
        rel = relative(file_path)
        with open(file_path, encoding="utf-8", errors="replace") as handle:
            lines = handle.read().splitlines()
        for index, line in enumerate(lines):
            for mod, pattern in zip(EDGE_SUB_PATHS, sub_path_patterns):
                if pattern.search(line):
                    fail_line(f"Edge client sub-path import '@shared/{mod}' in {rel}:{index + 1}")
                    sub_path_violations += 1

    if sub_path_violations == 0:
        pass_line("no Edge client sub-path imports (@agenthub/shared/eventClient, etc.)")

    # ── Check 2: 根 barrel Edge 导出名禁令 ────────────────────────────────
    barrel_violations = 0
    barrel_import_pattern = re.compile(r"from\s+['\"]@(agenthub/)?shared['\"]", re.IGNORECASE)
    export_name_patterns = [
        re.compile(rf"\b{re.escape(name)}\b", re.IGNORECASE)
        for name in EDGE_EXPORT_NAMES
    ]
    for file_path in files:
        rel = relative(file_path)
        with open(file_path, encoding="utf-8", errors="replace") as handle:
            lines = handle.read().splitlines()
        for index, line in enumerate(lines):
            # 只匹配根 barrel 导入（无尾部 /，子路径由 Check 1 管）
            if not barrel_import_pattern.search(line):
                continue
            for name, pattern in zip(EDGE_EXPORT_NAMES, export_name_patterns):
                if pattern.search(line):
                    fail_line(f"Edge barrel export '{name}' imported from root barrel in {rel}:{index + 1}")
                    barrel_violations += 1

    if barrel_violations == 0:
        pass_line("no Edge export names imported from root barrel (@shared / @agenthub/shared)")

    if failed == 0 and len(files) > 0:
        pass_line(f"platform apps free of shared Edge exports ({len(files)} file(s) scanned)")

    print()
    print("========================================")
    print(f"  Passed: {passed}  |  Failed: {failed}")
    print("========================================")

    return 1 if failed else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
