#!/usr/bin/env python3
"""verify-shared-trio-ratchet — shared 组件三件套棘轮门禁（#1951）。

`docs/component-acceptance.md` 把「新 shared 组件必须带三件套」定为硬规则：
组件本体 + `<组件>.test.tsx` + `<组件>.stories.tsx`（验收表对照记录在
PR/issue 侧）。此前该规则纯靠自觉，本门禁把文件配对部分机器化：

- 扫描 `app/shared/src/ui/**` 下按 React 约定以 PascalCase 命名的组件
  `.tsx`（排除 `.test.tsx` / `.stories.tsx` 与小写 hook/utility 文件）；
- 每个组件必须配对同目录 `<组件>.test.tsx` 与 `<组件>.stories.tsx`；
  复杂组件的测试允许放在同目录 `__tests__/<组件>.test.tsx`，但其他测试
  文件不得代替该组件的测试（防止一个无关测试让整目录假绿）；
- 存量缺件显式登记在 `scripts/verify/shared-trio-baseline.json`，棘轮
  只缩不增：未登记的新缺件即红；登记过的缺件补齐后必须同步收缩/移除
  基线条目（防止基线腐化为永久豁免）。

策略码：[STR-BASELINE-MISSING] 基线文件缺失（fail-closed）；
[STR-SCHEMA] 基线条目缺必需字段/非法路径/非法 missing 值/重复登记；
[STR-SCAN-ROOT] 扫描根缺失；[STR-SCAN-EMPTY] 扫描结果异常为空；
[STR-NEW-DEBT] 新增缺件未在基线登记；[STR-BASELINE-STALE] 基线条目指向
已删除/非组件文件，或组件缺件已修复但基线未同步收缩。

用法：
  python scripts/verify/verify-shared-trio-ratchet.py
  python scripts/verify/verify-shared-trio-ratchet.py --RepoRootPath <root> --BaselinePath <baseline.json>
"""

import argparse
import json
import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCAN_ROOT = "app/shared/src/ui"
ALLOWED_MISSING = ("test", "stories")
COMPONENT_FILENAME_RE = re.compile(r"^[A-Z][A-Za-z0-9]*\.tsx$")

PASSED = 0
FAILED = 0

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure") and not _stream.isatty():
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (OSError, ValueError):
            pass


def pass_check(text: str) -> None:
    global PASSED
    PASSED += 1
    print(f"  PASS  {text}")


def fail_check(code: str, text: str) -> None:
    global FAILED
    FAILED += 1
    print(f"  FAIL  [{code}] {text}")


def scan_root_path(repo_root: str) -> str:
    return os.path.join(repo_root, *SCAN_ROOT.split("/"))


def collect_components(repo_root: str) -> list:
    """返回 ui/ 下 PascalCase 组件 .tsx 的仓库相对路径。"""
    components = []
    for dirpath, dirnames, filenames in os.walk(scan_root_path(repo_root)):
        dirnames.sort()
        for name in sorted(filenames):
            if not COMPONENT_FILENAME_RE.fullmatch(name):
                continue
            rel = os.path.relpath(os.path.join(dirpath, name), repo_root)
            components.append(rel.replace(os.sep, "/"))
    return components


def missing_pieces(repo_root: str, component_rel: str) -> list:
    """返回组件缺失的件列表（'test' / 'stories'），齐备返回空列表。"""
    comp_path = os.path.join(repo_root, *component_rel.split("/"))
    directory = os.path.dirname(comp_path)
    stem = os.path.basename(comp_path)[: -len(".tsx")]
    direct_test = os.path.join(directory, stem + ".test.tsx")
    split_test = os.path.join(directory, "__tests__", stem + ".test.tsx")
    missing = []
    if not (os.path.isfile(direct_test) or os.path.isfile(split_test)):
        missing.append("test")
    if not os.path.isfile(os.path.join(directory, stem + ".stories.tsx")):
        missing.append("stories")
    return missing


def is_valid_component_key(component: object) -> bool:
    if not isinstance(component, str) or "\\" in component:
        return False
    parts = component.split("/")
    prefix = SCAN_ROOT.split("/")
    if parts[: len(prefix)] != prefix or len(parts) <= len(prefix):
        return False
    if any(part in ("", ".", "..") for part in parts):
        return False
    return COMPONENT_FILENAME_RE.fullmatch(parts[-1]) is not None


def load_baseline(baseline_path: str) -> dict:
    """返回 {组件相对路径: 条目}；基线缺失/不可解析/不合规直接红。"""
    if not os.path.isfile(baseline_path):
        fail_check("STR-BASELINE-MISSING", f"基线文件不存在（fail-closed）: {baseline_path}")
        return {}
    try:
        with open(baseline_path, encoding="utf-8-sig") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError) as exc:
        fail_check("STR-SCHEMA", f"基线文件不可解析: {exc}")
        return {}
    exemptions = data.get("exemptions") if isinstance(data, dict) else None
    if not isinstance(exemptions, list):
        fail_check("STR-SCHEMA", "基线根节点必须是对象且含 'exemptions' 列表")
        return {}
    entries = {}
    for index, entry in enumerate(exemptions):
        label = f"exemptions[{index}]"
        if not isinstance(entry, dict):
            fail_check("STR-SCHEMA", f"{label}: 条目必须是对象")
            continue
        component = entry.get("component")
        missing = entry.get("missing")
        if not is_valid_component_key(component):
            fail_check(
                "STR-SCHEMA",
                f"{label}: component 必须是 {SCAN_ROOT}/ 下 PascalCase 组件的 .tsx 相对路径",
            )
            continue
        if component in entries:
            fail_check("STR-SCHEMA", f"{label}: 组件重复登记: {component}")
            continue
        if (
            not isinstance(missing, list)
            or not missing
            or any(piece not in ALLOWED_MISSING for piece in missing)
            or len(set(missing)) != len(missing)
        ):
            fail_check("STR-SCHEMA", f"{label}: missing 必须是 {list(ALLOWED_MISSING)} 的非空去重子集")
            continue
        if not isinstance(entry.get("issue"), int) or isinstance(entry.get("issue"), bool) or entry["issue"] <= 0:
            fail_check("STR-SCHEMA", f"{label}: issue 必须是正整数（被跟踪的审批记录）")
            continue
        if not isinstance(entry.get("reason"), str) or not entry["reason"].strip():
            fail_check("STR-SCHEMA", f"{label}: reason 必须是非空字符串")
            continue
        entries[component] = entry
    return entries


def main() -> int:
    parser = argparse.ArgumentParser(description="shared component trio ratchet (#1951)")
    parser.add_argument("--RepoRootPath", default="", help="repository root (defaults to two levels above this script)")
    parser.add_argument("--BaselinePath", default="", help="shared-trio baseline JSON path (relative paths resolve from repo root)")
    args = parser.parse_args()

    repo_root = os.path.realpath(args.RepoRootPath) if args.RepoRootPath else os.path.realpath(os.path.join(SCRIPT_DIR, "..", ".."))
    if args.BaselinePath:
        baseline_path = args.BaselinePath
        if not os.path.isabs(baseline_path):
            baseline_path = os.path.join(repo_root, baseline_path)
        baseline_path = os.path.realpath(baseline_path)
    else:
        baseline_path = os.path.join(repo_root, "scripts", "verify", "shared-trio-baseline.json")

    baseline = load_baseline(baseline_path)
    if FAILED:
        return 1

    scan_root = scan_root_path(repo_root)
    if not os.path.isdir(scan_root):
        fail_check("STR-SCAN-ROOT", f"扫描根不存在（fail-closed）: {SCAN_ROOT}")
        return 1

    components = collect_components(repo_root)
    if not components:
        fail_check("STR-SCAN-EMPTY", f"{SCAN_ROOT} 未发现 PascalCase .tsx 组件（拒绝空扫描假绿）")
        return 1

    exempted = 0
    for component in components:
        actual = missing_pieces(repo_root, component)
        entry = baseline.get(component)
        registered = sorted(entry["missing"]) if entry else []
        if not actual:
            if entry:
                fail_check(
                    "STR-BASELINE-STALE",
                    f"{component}: 三件套已齐备，基线豁免条目需同步移除（棘轮只缩不增）",
                )
            continue
        if entry and sorted(actual) == registered:
            exempted += 1
            pass_check(f"{component}: 存量缺件按基线豁免（{', '.join(registered)}，issue #{entry['issue']}）")
            continue
        new_debt = sorted(set(actual) - set(registered))
        if new_debt:
            expected = "、".join(f"<组件>.{piece}.tsx" for piece in new_debt)
            fail_check(
                "STR-NEW-DEBT",
                f"{component}: 缺 {', '.join(new_debt)}（期望 {expected}）；"
                "新组件三件套为硬规则，见 docs/component-acceptance.md",
            )
        if entry:
            repaired = sorted(set(registered) - set(actual))
            if repaired:
                fail_check(
                    "STR-BASELINE-STALE",
                    f"{component}: 缺件 {', '.join(repaired)} 已修复，基线条目需同步收缩",
                )

    for component in sorted(set(baseline) - set(components)):
        fail_check("STR-BASELINE-STALE", f"{component}: 基线登记的组件文件已不存在或不再属于扫描范围，条目需移除")

    if FAILED == 0:
        pass_check(
            f"shared component trio ratchet holds ({len(components)} components under "
            f"{SCAN_ROOT}, {len(components) - exempted} complete, {exempted} exempted by baseline)"
        )
        return 0
    print("  #1951: 补齐组件的 .test.tsx / .stories.tsx（验收标准见 docs/component-acceptance.md）；")
    print("        存量缺件修复后同步收缩 scripts/verify/shared-trio-baseline.json。")
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐其他 verify 脚本
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
