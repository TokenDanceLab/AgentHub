#!/usr/bin/env python3
"""verify-frontend-package-boundary — 前端包依赖方向门禁（#1759 第二阶段）。

workbench 从 shared 独立为 `@agenthub/workbench` 后，依赖方向固定为
workbench → shared 单向：

1. shared 永远不得 import workbench —— 扫 app/shared/src，禁止
   `@agenthub/workbench*` / `@workbench*` 包名与任何解析进
   app/workbench 的相对导入；
2. workbench 不得反向引用其它端包 —— 扫 app/workbench/src，相对导入
   解析出 workbench 之外时必须落在 shared/src（深导入走 @shared 别名
   或包名均可），且禁止 import desktop/web/mobile-rn 包。

Mobile 侧的 workbench 禁令由 app/mobile-rn/scripts/verify-boundaries.mjs
负责，不在本脚本重复。

Usage:
  python scripts/verify/verify-frontend-package-boundary.py
  python scripts/verify/verify-frontend-package-boundary.py --AppRoot <path>
"""

import argparse
import os
import re
import sys

SOURCE_EXTENSIONS = {".ts", ".tsx", ".js", ".jsx", ".mjs"}

# import/export ... from 'x' | import 'x' | import('x') | require('x') | vi.mock('x')
IMPORT_PATTERN = re.compile(
    r"""(?:
        (?:import|export)\s+(?:type\s+)?[^'"]*?\s+from\s* |
        (?:import|export)\s+ |
        import\s*\(\s* |
        require\s*\(\s* |
        vi\.mock\s*\(\s*
    )['"]([^'"]+)['"]""",
    re.VERBOSE,
)

WORKBENCH_PACKAGE_PREFIXES = ("@agenthub/workbench", "@workbench")
FORBIDDEN_WORKBENCH_CONSUMER_PACKAGES = (
    "agenthub-desktop",
    "agenthub-web",
    "agenthub-mobile-rn",
)


def find_repo_root() -> str:
    root = os.path.dirname(os.path.abspath(__file__))
    for _ in range(4):
        if os.path.isfile(os.path.join(root, "AGENTS.md")):
            return root
        root = os.path.dirname(root)
    raise RuntimeError("cannot locate AgentHub repository root")


def walk_source_files(root: str):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for name in sorted(filenames):
            if os.path.splitext(name)[1] in SOURCE_EXTENSIONS:
                yield os.path.join(dirpath, name)


def extract_specifiers(text: str):
    return [match for match in IMPORT_PATTERN.findall(text) if match]


def check_shared_tree(app_root: str, failures: list) -> int:
    """规则 1：shared 不得出现任何指向 workbench 的导入。"""
    shared_src = os.path.join(app_root, "shared", "src")
    workbench_root = os.path.join(app_root, "workbench")
    scanned = 0

    for file_path in walk_source_files(shared_src):
        with open(file_path, encoding="utf-8", errors="replace") as handle:
            text = handle.read()
        relative_file = os.path.relpath(file_path, app_root)

        for specifier in extract_specifiers(text):
            if specifier.startswith(WORKBENCH_PACKAGE_PREFIXES):
                failures.append(
                    f"{relative_file}: shared must not import workbench ({specifier})"
                )
                continue
            if specifier.startswith("."):
                resolved = os.path.normpath(
                    os.path.join(os.path.dirname(file_path), specifier)
                )
                if resolved == workbench_root or resolved.startswith(workbench_root + os.sep):
                    failures.append(
                        f"{relative_file}: relative import escapes into workbench ({specifier})"
                    )
        scanned += 1

    return scanned


def check_workbench_tree(app_root: str, failures: list) -> int:
    """规则 2：workbench 只允许依赖 shared，不得引用其它端包或越界相对导入。"""
    workbench_src = os.path.join(app_root, "workbench", "src")
    shared_src = os.path.join(app_root, "shared", "src")
    scanned = 0

    for file_path in walk_source_files(workbench_src):
        with open(file_path, encoding="utf-8", errors="replace") as handle:
            text = handle.read()
        relative_file = os.path.relpath(file_path, app_root)

        for specifier in extract_specifiers(text):
            if specifier.startswith(FORBIDDEN_WORKBENCH_CONSUMER_PACKAGES):
                failures.append(
                    f"{relative_file}: workbench must not import app packages ({specifier})"
                )
                continue
            if specifier.startswith("."):
                resolved = os.path.normpath(
                    os.path.join(os.path.dirname(file_path), specifier)
                )
                inside_workbench = resolved == workbench_src or resolved.startswith(
                    workbench_src + os.sep
                )
                inside_shared = resolved == shared_src or resolved.startswith(
                    shared_src + os.sep
                )
                if not inside_workbench and not inside_shared:
                    failures.append(
                        f"{relative_file}: relative import escapes the workbench->shared "
                        f"boundary ({specifier})"
                    )
        scanned += 1

    return scanned


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--AppRoot",
        default=None,
        help="前端 monorepo 根（默认 <repo>/app；测试可注入 fixture 树）",
    )
    args = parser.parse_args()

    app_root = os.path.abspath(args.AppRoot) if args.AppRoot else os.path.join(find_repo_root(), "app")

    failures: list = []
    print("=== Frontend package boundary (workbench -> shared only, #1759) ===")

    shared_scanned = check_shared_tree(app_root, failures)
    workbench_scanned = check_workbench_tree(app_root, failures)
    print(f"Scanned {shared_scanned} shared + {workbench_scanned} workbench source file(s).")

    if failures:
        for failure in failures:
            print(f"  FAIL  {failure}")
        print(f"\n  Passed: 0  |  Failed: {len(failures)}")
        return 1

    print("  PASS  no dependency-direction violations")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐其它 verifier
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
