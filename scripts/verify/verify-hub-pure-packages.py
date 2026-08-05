#!/usr/bin/env python3
"""verify-hub-pure-packages — Hub 纯 Go helper 包导入门禁（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

纯包目标（A7 架构门禁候选 #5）不得导入：
  - gorm.io/*                                  (GORM ORM)
  - database/sql                               (raw SQL driver)
  - github.com/agenthub/hub-server/internal/cache (cache 层)
  - github.com/agenthub/hub-server/internal/ws    (websocket 层)
  - github.com/agenthub/hub-server/internal/service 及其编排兄弟子包

只扫描 import 行；匹配前先剥掉 // 行注释，避免 doc 注释误报。
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

PURE_DIRS = [
    "hub-server/internal/service/dispatch",
    "hub-server/internal/service/deliveryoutbox",
    "hub-server/internal/service/im",
    "hub-server/internal/service/agentevent",
]
PURE_FILES = [
    "hub-server/internal/service/agentteam/route_helpers.go",
]

# 与 ps1 一一对应：(锚定 import path 的正则, 输出标签)。-match 默认忽略大小写，此处同。
FORBIDDEN_PATTERNS = [
    (r"^gorm\.io/", "GORM ORM (gorm.io)"),
    (r"^database/sql(/|$)", "database/sql (raw SQL)"),
    (r"^github\.com/agenthub/hub-server/internal/cache(/|$)", "internal/cache layer"),
    (r"^github\.com/agenthub/hub-server/internal/ws(/|$)", "internal/ws layer"),
    (r"^github\.com/agenthub/hub-server/internal/service(/|$)", "concrete *Service orchestration (internal/service tree)"),
]

# 放行前缀：命中禁止规则但等于或位于纯包子路径内的 import 降级为 PASS。
ALLOW_PREFIXES = [
    "github.com/agenthub/hub-server/internal/service/dispatch",
    "github.com/agenthub/hub-server/internal/service/deliveryoutbox",
    "github.com/agenthub/hub-server/internal/service/im",
    "github.com/agenthub/hub-server/internal/service/agentevent",
]

IMPORT_BLOCK_RE = re.compile(r"(?ms)import\s*\((.*?)\)")
IMPORT_SINGLE_RE = re.compile(r'(?m)^[ \t]*import[ \t]+(?:\S+[ \t]+)?"([^"]+)"')
QUOTED_PATH_RE = re.compile(r'"([^"]+)"')


def is_allowed(import_path):
    for prefix in ALLOW_PREFIXES:
        if import_path == prefix or import_path.startswith(prefix + "/"):
            return True
    return False


def get_go_imports(content):
    paths = []

    # 块导入：import ( ... )，逐行剥 // 注释后取所有引号路径。
    for match in IMPORT_BLOCK_RE.finditer(content):
        for line in match.group(1).split("\n"):
            line = re.sub(r"//.*$", "", line)
            if line.strip() == "":
                continue
            for quoted in QUOTED_PATH_RE.finditer(line):
                paths.append(quoted.group(1))

    # 单行导入：import "..." / import alias "..." / import . "..."
    for match in IMPORT_SINGLE_RE.finditer(content):
        paths.append(match.group(1))

    seen = set()
    unique_paths = []
    for path in paths:
        if path not in seen:
            seen.add(path)
            unique_paths.append(path)
    return unique_paths


def collect_target_files(fail_check):
    files = []
    for rel_dir in PURE_DIRS:
        full = os.path.join(REPO_ROOT, rel_dir)
        if os.path.isdir(full):
            for name in sorted(os.listdir(full)):
                if name.endswith(".go") and os.path.isfile(os.path.join(full, name)):
                    files.append(os.path.join(full, name))
        else:
            fail_check(f"pure package directory missing: {rel_dir}")
    for rel_file in PURE_FILES:
        full = os.path.join(REPO_ROOT, rel_file)
        if os.path.exists(full):
            files.append(full)
        else:
            fail_check(f"pure package file missing: {rel_file}")
    return files


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify that Hub pure Go helper packages stay import-clean.")
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

    files = collect_target_files(fail_check)

    print("\n=== Hub pure package import gate ===")
    print(f"Scanning {len(files)} .go file(s) across pure helper packages.")

    for path in files:
        rel = os.path.relpath(path, REPO_ROOT).replace("\\", "/")
        with open(path, encoding="utf-8-sig", errors="replace") as handle:
            content = handle.read()
        for import_path in get_go_imports(content):
            for pattern, label in FORBIDDEN_PATTERNS:
                if re.search(pattern, import_path, re.IGNORECASE):
                    if is_allowed(import_path):
                        continue
                    fail_check(f"{label} imported in {rel}: {import_path}")

    if failed == 0 and len(files) > 0:
        pass_check(f"no forbidden imports across {len(files)} .go file(s) in pure packages")

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
