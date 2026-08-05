#!/usr/bin/env python3
"""verify-design-token-ssot — desktop/web surface style CSS 薄 re-export 门禁（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

A7 架构门禁候选 #7，按 docs/architecture/07-design-system-ssot.md：
  - app/{desktop,web}/src/styles/{tokens,themes,presets}.css 必须是
    @shared/styles/{tokens-base,themes,presets-base}.css 的薄 @import re-export
  - 只允许有界的一小组 platform-override 声明（如 desktop 不透明边框）
  - 禁止完整 token 表分叉（在裸 :root 下重声明 --space-* 等）

每个 surface 文件需同时满足：
  1. 存在至少一行解析到 @shared/styles/ 的 @import
  2. --* 自定义属性声明总数 ≤ 10
  3. 每条 --* 声明所在选择器都带 [data-… 属性选择器（平台作用域胶水）
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

SURFACE_FILES = [
    "app/desktop/src/styles/tokens.css",
    "app/desktop/src/styles/themes.css",
    "app/desktop/src/styles/presets.css",
    "app/web/src/styles/tokens.css",
    "app/web/src/styles/themes.css",
    "app/web/src/styles/presets.css",
]

# 单文件 --* 重声明上限（master f17e3b99 基线：desktop/presets 3、web/presets 6、
# 其余 0；10 给合法平台边框胶水留余量，同时任何 :root 全表分叉必然超限）。
MAX_OVERRIDE_LINES = 10

SHARED_IMPORT_RE = re.compile(r"""(?m)^\s*@import\s+['"]@shared/styles/""")
BLOCK_RE = re.compile(r"(?ms)([^{}]*?)\{([^{}]*)\}")
DECL_RE = re.compile(r"(?m)^[ \t]*--[A-Za-z][\w-]*\s*:")


def read_text(path):
    with open(path, encoding="utf-8-sig", errors="replace") as handle:
        return handle.read()


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify that desktop/web surface style CSS files stay thin re-exports of the shared design-token SSOT.")
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

    print("\n=== Design token SSOT thin re-export gate ===")
    print(f"Surface files: {len(SURFACE_FILES)} | override ceiling: {MAX_OVERRIDE_LINES} --* per file")

    for rel in SURFACE_FILES:
        path = os.path.join(REPO_ROOT, rel.replace("/", os.sep))
        print(f"\n--- {rel} ---")

        if not os.path.exists(path):
            fail_check(f"{rel} missing — surface re-export file must exist")
            continue

        content = read_text(path)

        # 剥 /* … */ 注释，注释掉的 token 不计入 override。
        stripped = re.sub(r"/\*.*?\*/", "", content, flags=re.S)

        # ── Gate 1: 必须存在 @shared/styles/ 薄 @import ──
        import_matches = list(SHARED_IMPORT_RE.finditer(stripped))
        if import_matches:
            pass_check(f"{rel}: thin @import @shared/styles/ present ({len(import_matches)} line(s))")
        else:
            fail_check(f"{rel}: missing thin @import of @shared/styles/ — surface file must re-export shared SSOT")

        # ── 解析非嵌套 CSS 块为 (selector, body) 对 ──
        # 这些 surface 文件只有 @import + 扁平 [selector] { --x: v; } 规则
        # （无 @media 嵌套），花括号配对正则足够，无需完整 CSS 解析器。
        override_count = 0
        scope_violations = []

        for block in BLOCK_RE.finditer(stripped):
            selector = block.group(1).strip()
            body = block.group(2)

            decls = DECL_RE.findall(body)
            if not decls:
                continue

            override_count += len(decls)

            # ── Gate 3: override 必须平台作用域 ──
            # 裸 :root / html 选择器重声明 --* 是全表分叉签名（共享 SSOT 在
            # :root 下声明 token）。合法胶水按 rule §3 落在 [data-preset=…] /
            # [data-theme=…] 作用域内。
            if "[data-" not in selector:
                scope_violations.append((selector, len(decls)))

        # ── Gate 2: override 数量有界 ──
        if override_count <= MAX_OVERRIDE_LINES:
            pass_check(f"{rel}: {override_count} --* override(s) ≤ {MAX_OVERRIDE_LINES} ceiling")
        else:
            fail_check(f"{rel}: {override_count} --* override(s) exceed {MAX_OVERRIDE_LINES} ceiling — likely full token-table fork")

        # 报告 Gate 3 违规
        if not scope_violations:
            if override_count > 0:
                pass_check(f"{rel}: all {override_count} override(s) scoped under [data-…] attribute selector")
        else:
            for selector, count in scope_violations:
                preview = selector
                if len(preview) > 60:
                    preview = preview[:60] + "…"
                fail_check(f"{rel}: {count} --* override(s) under unscoped selector '{preview}' — must be [data-…] platform glue, not bare :root fork")

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
