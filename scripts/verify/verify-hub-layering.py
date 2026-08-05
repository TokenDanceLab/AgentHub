#!/usr/bin/env python3
"""verify-hub-layering — Hub handler 分层门禁（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

单向流（audit-A Scope 2）：handler -> service -> repository。handler 包不得
直接 import repository 层。已知缺陷 allowlist：health.go（非业务健康探针，
应走 HealthService，audit-A 2.1）；新 handler 文件 import repository 即 FAIL。
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

HANDLER_DIR = "hub-server/internal/handler"

# 禁止的 import（ps1 用 -match，大小写不敏感）
FORBIDDEN_PATTERN = re.compile(r"^github\.com/agenthub/hub-server/internal/repository(/|$)", re.IGNORECASE)
FORBIDDEN_LABEL = "repository layer (handler must go through service)"

# 已知缺陷 allowlist：文件 + 原因
KNOWN_DEFECTS = {
    "hub-server/internal/handler/health.go": (
        "imports repository.VerifyMigrations for health-check migration status — non-business, route via HealthService (audit-A 2.1)"
    ),
}

# 镜像 ps1 的 [regex]::Matches（大小写敏感）
BLOCK_IMPORT = re.compile(r"import\s*\((?P<body>.*?)\)", re.DOTALL)
QUOTED_PATH = re.compile(r'"(?P<path>[^"]+)"')
SINGLE_IMPORT = re.compile(r'^[ \t]*import[ \t]+(?:\S+[ \t]+)?"(?P<path>[^"]+)"', re.MULTILINE)


def relative(path: str) -> str:
    return os.path.relpath(path, ROOT).replace(os.sep, "/")


def known_defect(rel_path: str):
    return KNOWN_DEFECTS.get(rel_path)


def get_go_imports(content: str) -> list:
    """提取 Go import 路径：块 import + 单行 import，去重保序（镜像 ps1）。"""
    paths = []

    for match in BLOCK_IMPORT.finditer(content):
        for line in match.group("body").split("\n"):
            line = re.sub(r"//.*$", "", line)
            trimmed = line.strip()
            if trimmed == "":
                continue
            paths.extend(q.group("path") for q in QUOTED_PATH.finditer(line))

    paths.extend(m.group("path") for m in SINGLE_IMPORT.finditer(content))

    seen = set()
    unique = []
    for path in paths:
        if path not in seen:
            seen.add(path)
            unique.append(path)
    return unique


def main() -> int:
    parser = argparse.ArgumentParser(description="Hub handler layering gate (no repository import)")
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

    handler_dir = os.path.join(ROOT, HANDLER_DIR)
    if not os.path.isdir(handler_dir):
        fail_line(f"handler directory missing: {HANDLER_DIR}")
        return 1

    files = []
    for name in sorted(os.listdir(handler_dir)):
        full = os.path.join(handler_dir, name)
        if os.path.isfile(full) and name.endswith(".go"):
            files.append(full)

    print()
    print("=== Hub handler layering (no repository import) ===")
    print(f"Scanning {len(files)} .go file(s) in hub-server/internal/handler.")

    defect_notes = 0
    for file_path in files:
        rel = relative(file_path)
        with open(file_path, encoding="utf-8", errors="replace") as handle:
            content = handle.read()
        imports = get_go_imports(content)

        for path in imports:
            if not FORBIDDEN_PATTERN.search(path):
                continue
            reason = known_defect(rel)
            if reason is not None:
                defect_notes += 1
                print(f"  KNOWN DEFECT  {FORBIDDEN_LABEL} imported in {rel}: {path} — {reason}")
            else:
                fail_line(f"{FORBIDDEN_LABEL} imported in {rel}: {path} — handler must go through service")

    if failed == 0 and len(files) > 0:
        if defect_notes > 0:
            pass_line(f"no new handler->repository violations ({defect_notes} known-defect note(s) in allowlist)")
        else:
            pass_line(f"no handler->repository imports across {len(files)} .go file(s)")

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
