#!/usr/bin/env python3
"""verify-shared-edge-surface-isolation — shared edge 表面隔离门禁（HARD GATE，ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

Hub-only 表面（Web + Mobile RN）不得从 shared 包 import Local Edge 客户端面。

shared 包携带 Edge 表面（eventClient.ts、transcript/edge*.ts、edgeQueryKeys），
它们只面向 Desktop。Web 与 Mobile RN 是 Hub-only，不得 import 这些 Edge 专用 shared 模块。

自 2026-08-03（#1525）起为 HARD GATE：违规 exit 1；扫描目录缺失即失败；内部错误即失败。
自测位于 scripts/verify/tests/verify-shared-edge-surface-isolation.Tests.ps1。

A-V3 裁决（2026-08-03）：shared 不做全量三分，edge 表面补硬门禁——web/mobile-rn
不得 import @shared/eventClient、@shared/transcript/edge*、edgeQueryKeys。
本条门禁与 #1463 shared-boundary 互补：#1463 守 shared 内部 workbench/chatview/ui
不出现 Edge 客户端实现；本条守 shared 内已存在的 edge 表面不被 hub-only 消费者引入。

用法：
  python scripts/verify/verify-shared-edge-surface-isolation.py
  python scripts/verify/verify-shared-edge-surface-isolation.py --repo-root-override <fixture-root>
"""

import argparse
import os
import re
import sys

PASSED = 0
FAILED = 0

# Hub-only 表面：Web 浏览器客户端、Mobile React Native 客户端
SCAN_DIRS = (
    "app/web/src",
    "app/mobile-rn/src",
)

# 禁止的 Edge 表面 import 模式：匹配 .ts/.tsx/.js/.jsx 中的 import 路径与符号使用。
# 每个模式同时覆盖 workspace 包名（@agenthub/shared/...）与 web/desktop 经
# tsconfig/vite 使用的路径别名（@shared/...）。
FORBIDDEN_PATTERNS = (
    ("@shared/eventClient|@agenthub/shared/eventClient", "Edge WS client import (@shared/eventClient)"),
    ("@shared/transcript/edge|@agenthub/shared/transcript/edge", "Edge transcript module import (@shared/transcript/edge*)"),
    ("edgeQueryKeys", "Edge query keys symbol (edgeQueryKeys)"),
)


def pass_check(text: str) -> None:
    global PASSED
    PASSED += 1
    print(f"  PASS  {text}")


def fail_check(text: str) -> None:
    global FAILED
    FAILED += 1
    print(f"  FAIL  {text}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Shared Edge surface isolation verifier (HARD GATE, #1525)")
    parser.add_argument("--repo-root-override", default="", help="override repository root (test injection point)")
    args = parser.parse_args()

    if args.repo_root_override:
        root = os.path.abspath(args.repo_root_override)
    else:
        root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    print("\n=== Shared Edge surface isolation (HARD GATE, A-V3 裁决 2026-08-03) ===")
    print("Policy: app/web/src and app/mobile-rn/src (Hub-only clients) must not")
    print("import @shared/eventClient, @shared/transcript/edge*, or edgeQueryKeys.")
    print("")

    # ── 收集目标文件 ──
    files = []
    for scan_dir in SCAN_DIRS:
        full = os.path.join(root, scan_dir.replace("/", os.sep))
        if not os.path.isdir(full):
            fail_check(f"scan directory missing: {scan_dir} — Hub-only surface gate cannot prove anything; treat as violation")
            continue
        try:
            for dirpath, dirnames, filenames in os.walk(full):
                dirnames.sort()
                for name in sorted(filenames):
                    if name.endswith((".ts", ".tsx", ".js", ".jsx")):
                        files.append(os.path.join(dirpath, name))
        except OSError as exc:
            fail_check(f"scan error in {scan_dir} : {exc}")

    print(f"Scanning {len(files)} .ts/.tsx/.js/.jsx file(s) across {len(SCAN_DIRS)} Hub-only surface(s).")
    print("")

    # ── 扫描 ──
    for pattern, label in FORBIDDEN_PATTERNS:
        try:
            regex = re.compile(pattern)
        except re.error as exc:
            fail_check(f"{label}: scan error — {exc}")
            continue
        matches = []
        for file_path in files:
            with open(file_path, encoding="utf-8", errors="replace") as handle:
                for line_no, line in enumerate(handle, start=1):
                    if regex.search(line):
                        matches.append((file_path, line_no))
        if matches:
            for file_path, line_no in matches:
                rel = os.path.relpath(file_path, root).replace(os.sep, "/")
                fail_check(f"{label} found in {rel}:{line_no}")
        else:
            pass_check(f"{label} absent from Hub-only surfaces")

    # ── 汇总 ──
    print("\n========================================")
    print(f"  Passed: {PASSED}  |  Failed: {FAILED}")
    print("========================================")

    if FAILED == 0:
        print("\nNo Edge surface isolation violations detected. Hub-only surfaces are clean.")
        return 0
    print(f"\n{FAILED} violation(s) found — HARD GATE (A-V3 裁决 2026-08-03, #1525).")
    print("Web/Mobile must not import Edge-only shared surfaces; fix imports or escalate.")
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
