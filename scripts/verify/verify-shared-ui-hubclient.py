#!/usr/bin/env python3
"""verify-shared-ui-hubclient — 前端表现层 hubClient 依赖门禁（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

shared 表现层（ui/components/chatview）与 workbench 包（#1759 第二阶段起
独立为 app/workbench 的 @agenthub/workbench）不得 value-import Hub 客户端
（hubClient），也不得引用具体 HubClient 类型。

策略（audit-A A-V2 / A7#4 "shared UI no hubClient"，#1546 硬化）：表现模块
只消费窄领域端口（如 WorkbenchProjectsPort），由平台 composition root 注入。
把 hubClient value-import 进表现层是分层违规；type-only import 同样是违规——
它把表现契约耦合到具体客户端的方法面（正是 #1546 移除的耦合）。

经验基线：#1546 之前 workbench/* 有 4 处 `import type { HubClient }`；#1546 之后
shared workbench 只引用领域端口。#1759 拆包后，workbench 源码树整体纳入
本门禁扫描（WORKBENCH_SRC_DIR），shared 侧默认 scope 不再含 workbench。
本门禁的价值是防止未来 runtime 耦合与 type 耦合回归。

用法：
  python scripts/verify/verify-shared-ui-hubclient.py
  python scripts/verify/verify-shared-ui-hubclient.py --shared-src-dir app/shared/src --scope-dirs ui components chatview
"""

import argparse
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

PASSED = 0
FAILED = 0

FORBIDDEN_SPEC_PATTERN = "hubClient"
FORBIDDEN_TYPE_NAME = "HubClient"

# 已知缺陷 allowlist（可引用 hubClient 的相对路径）。master 上为空——
# #1546 之后 shared 表现层已完全解耦。
KNOWN_DEFECTS = set()

# #1759 第二阶段：workbench 独立为 @agenthub/workbench 包后，门禁额外
# 扫描该包整棵源码树（与 shared 表现层同一条分层红线）。
WORKBENCH_SRC_DIR = "app/workbench/src"


def pass_check(text: str) -> None:
    global PASSED
    PASSED += 1
    print(f"  PASS  {text}")


def fail_check(text: str) -> None:
    global FAILED
    FAILED += 1
    print(f"  FAIL  {text}")


def strip_comments(line: str) -> str:
    code = re.sub(r"/\*.*?\*/", " ", line, flags=re.S)
    code = re.sub(r"//.*$", " ", code)
    return code


def collect_scope_files(shared_src_dir: str, scope_dirs) -> list:
    """Collect .ts/.tsx files under shared scopes plus the workbench package.

    scan roots are (src_dir, scope) pairs relative to the repo root; scope ""
    means the src_dir itself is the scan root (workbench package tree).
    """
    scan_roots = [(shared_src_dir, scope) for scope in scope_dirs]
    scan_roots.append((WORKBENCH_SRC_DIR, ""))
    files = []
    for src_dir, scope in scan_roots:
        full = os.path.join(ROOT, src_dir.replace("/", os.sep), scope)
        label = f"{src_dir}/{scope}" if scope else src_dir
        if not os.path.isdir(full):
            fail_check(f"scope directory missing: {label}")
            continue
        for dirpath, dirnames, filenames in os.walk(full):
            dirnames.sort()
            for name in sorted(filenames):
                if not name.endswith((".ts", ".tsx")) or name.endswith(".test.ts"):
                    continue
                files.append(os.path.join(dirpath, name))
    return files


def is_allowlisted(rel: str) -> bool:
    return rel in KNOWN_DEFECTS


def main() -> int:
    parser = argparse.ArgumentParser(description="shared UI hubClient gate verifier (#1468)")
    parser.add_argument("--shared-src-dir", default="app/shared/src", help="shared source directory (default: app/shared/src)")
    parser.add_argument("--scope-dirs", nargs="+", default=["ui", "components", "chatview"], help="scope subdirectories (default: ui components chatview; workbench package is always scanned)")
    args = parser.parse_args()

    files = collect_scope_files(args.shared_src_dir, args.scope_dirs)

    print("\n=== Shared UI hubClient gate (no value/type reference to hubClient) ===")
    print(f"Scanning {len(files)} .ts/.tsx file(s) in shared/{', '.join(args.scope_dirs)} + workbench package ({WORKBENCH_SRC_DIR}).")

    import_from_re = re.compile(r"""from\s*['"]([^'"]*)""" + FORBIDDEN_SPEC_PATTERN + r"""([^'"]*)['"]""")
    side_effect_re = re.compile(r"""^\s*import\s+['"]([^'"]*)""" + FORBIDDEN_SPEC_PATTERN + r"""([^'"]*)['"]""")
    type_ref_re = re.compile(r"\b" + FORBIDDEN_TYPE_NAME + r"\b")

    violations = 0
    for file_path in files:
        rel = os.path.relpath(file_path, ROOT).replace(os.sep, "/")
        with open(file_path, encoding="utf-8", errors="replace") as handle:
            lines = handle.read().splitlines()
        for index, line in enumerate(lines, start=1):
            # 任何来自 hubClient specifier 的 import：import ... from '<spec>'（value 或 type-only）
            for match in import_from_re.finditer(line):
                spec = re.sub(r"^from\s*", "", match.group(0))
                if is_allowlisted(rel):
                    print(f"  KNOWN DEFECT  import of hubClient allowed ({rel}:{index})")
                else:
                    fail_check(f"shared UI imports hubClient (value or type): {rel}:{index} -> {spec}")
                    violations += 1
            # 裸副作用 import：import '<spec>'（无 from）
            for match in side_effect_re.finditer(line):
                if is_allowlisted(rel):
                    print(f"  KNOWN DEFECT  side-effect import of hubClient allowed ({rel}:{index})")
                else:
                    fail_check(f"shared UI side-effect imports hubClient: {rel}:{index}")
                    violations += 1
            # 直接引用具体 HubClient 类型名（注释已剔除）
            code_line = strip_comments(line)
            for match in type_ref_re.finditer(code_line):
                if is_allowlisted(rel):
                    print(f"  KNOWN DEFECT  HubClient type reference allowed ({rel}:{index})")
                else:
                    fail_check(f"shared UI references concrete HubClient type: {rel}:{index}")
                    violations += 1

    if FAILED == 0:
        if violations == 0:
            pass_check(f"no shared UI value/type references to hubClient ({len(files)} file(s) scanned)")
        else:
            pass_check(f"no new shared UI hubClient references ({violations} known-defect note(s) in allowlist)")

    print("\n========================================")
    print(f"  Passed: {PASSED}  |  Failed: {FAILED}")
    print("========================================")

    return 1 if FAILED != 0 else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
