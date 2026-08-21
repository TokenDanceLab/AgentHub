#!/usr/bin/env python3
"""verify-shared-boundary — shared 前端包 Edge-free 边界门禁（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

shared workbench/chatview/ui 子树被 Web/Desktop/Mobile 三端消费，必须保持
Local Edge 客户端依赖为零（apiClient/EventClient/edgeClient//v1/runs//v1/events）。
Web/Mobile 是 Hub-only，Edge 客户端进入 shared 即把硬 Edge 依赖带进 Hub-only 表面。

已知缺陷 allowlist（文件+豁免模式精确匹配）只记录已接受债务；向 allowlist
文件加入非豁免模式的新 Edge 引用仍 FAIL，任何非 allowlist 文件出现即 FAIL。
"""

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

# 三端共同消费的 shared 子树，必须保持 Edge-free
SCAN_DIRS = [
    "app/shared/src/workbench",
    "app/shared/src/chatview",
    "app/shared/src/ui",
]

# 禁止的 Edge 客户端模式（ps1 用 -match，大小写不敏感）
FORBIDDEN_PATTERNS = [
    ("apiClient", "Edge REST client (apiClient)"),
    ("EventClient", "Edge WS client (EventClient)"),
    ("edgeClient", "Edge client (edgeClient)"),
    ("/v1/runs", "Edge REST run API path (/v1/runs)"),
    ("/v1/events", "Edge WS event API path (/v1/events)"),
]

# 已知缺陷 allowlist：文件 + 豁免模式 + 原因（向 allowlist 文件加入非豁免模式仍 FAIL）
KNOWN_DEFECTS = {
    "app/shared/src/ui/DiffReviewPanelTypes.ts": (
        {"/v1/runs"},
        "comment mentions Edge POST /v1/runs/:id/apply (doc only)",
    ),
}


def relative(path: str) -> str:
    return os.path.relpath(path, ROOT).replace(os.sep, "/")


def known_defect(rel_path: str, pattern: str):
    entry = KNOWN_DEFECTS.get(rel_path)
    if entry is not None and pattern in entry[0]:
        return entry[1]
    return None


def walk_sorted(root: str):
    """深度优先 + 每层按名称排序的遍历，镜像 Get-ChildItem -Recurse
    （NTFS 枚举按字母序：文件在当前位置产出，子目录就地递归）。"""
    for entry in sorted(os.listdir(root)):
        full = os.path.join(root, entry)
        if os.path.isfile(full):
            if entry.endswith(".ts") or entry.endswith(".tsx"):
                yield full
        elif os.path.isdir(full):
            yield from walk_sorted(full)


def collect_files() -> tuple:
    """按 SCAN_DIRS 顺序收集扫描文件；缺失目录先记 FAIL（ps1 顺序：收集阶段在 header 之前）。"""
    files = []
    scan_failures = []
    for scan_dir in SCAN_DIRS:
        full = os.path.join(ROOT, scan_dir)
        if not os.path.isdir(full):
            scan_failures.append(f"scan directory missing: {scan_dir}")
            continue
        files.extend(walk_sorted(full))
    return files, scan_failures


def main() -> int:
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
    print("=== Shared Edge-free boundary (workbench/chatview/ui) ===")
    print(f"Scanning {len(files)} .ts/.tsx file(s) across shared sub-trees.")

    defect_notes = 0
    for file_path in files:
        rel = relative(file_path)
        with open(file_path, encoding="utf-8", errors="replace") as handle:
            lines = handle.read().splitlines()

        for index, line in enumerate(lines):
            for pattern, label in FORBIDDEN_PATTERNS:
                if not re.search(pattern, line, re.IGNORECASE):
                    continue
                reason = known_defect(rel, pattern)
                if reason is not None:
                    defect_notes += 1
                    print(f"  KNOWN DEFECT  {label} in {rel}:{index + 1} — {reason}")
                else:
                    tree = re.sub(r"^app/shared/src/", "", rel, flags=re.IGNORECASE)
                    tree = re.sub(r"/.*$", "", tree, flags=re.IGNORECASE)
                    fail_line(f"{label} found in {rel}:{index + 1} — Edge client must not leak into shared {tree}")

    if failed == 0 and len(files) > 0:
        if defect_notes > 0:
            pass_line(f"no new Edge client violations ({defect_notes} known-defect note(s) in allowlist)")
        else:
            pass_line(f"no Edge client violations across {len(files)} shared file(s)")

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
