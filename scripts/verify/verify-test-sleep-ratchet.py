#!/usr/bin/env python3
"""verify-test-sleep-ratchet — test-sleep 计数棘轮 + 值预算门禁（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

固定 time.Sleep 在测试里要么太短（负载下 flaky）要么太长（拖慢），无界轮询又会掩盖卡死的组件。
本门禁强制 hub-server/ 与 edge-server/ 下 *_test.go 的按文件 time.Sleep 计数不超过已提交基线
（scripts/verify/test-sleep-baseline.json，#1550），并校验值预算（scripts/verify/test-sleep-budget.json，
#1565 记录、#1948 接入）：

- 预算文件必须存在（fail-closed）；
- 预算内每个路径必须真实存在（腐化路径即红，#1948）；
- 每个条目的 count/total_ms/max_ms 与逐 sleep 值必须与源码完全一致——
  20ms 悄悄变 20s 必红（预算文件 _comment 声称要防的事真正落地）；
- 有 sleep 而无预算条目的文件即红；非常量（运行期变量）sleep 表达式即红。

基线只缩不增；任何计数/值变化必须显式 --update-baseline（被跟踪的审批步骤）。
--update-baseline 同时重写计数基线与值预算：保留 owner/reason，值有变动的条目
review 更新为当天，新增位置的 sleep kind 置为 unclassified（不在许可 kind 集内，
需人工归类并补全审批字段后门禁才放行）。

策略码：[TSB-BUDGET-MISSING] 预算文件缺失；[TSB-SCHEMA] 条目缺必需字段/非法 kind/
非法路径形状；[TSB-PATH] 预算路径不存在；[TSB-UNRESOLVED] sleep 表达式非常量；
[TSB-UNBUDGETED] 有 sleep 无预算条目；[TSB-VALUE] count/total_ms/max_ms/逐值不一致。

用法：
  python scripts/verify/verify-test-sleep-ratchet.py                    # check
  python scripts/verify/verify-test-sleep-ratchet.py --update-baseline  # approve new baseline+budget
"""

import argparse
import datetime
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASELINE_PATH = os.path.join(SCRIPT_DIR, "test-sleep-baseline.json")
BUDGET_PATH = os.path.join(SCRIPT_DIR, "test-sleep-budget.json")

ALLOWED_KINDS = ("grace_window", "negative_window", "poll_deadline", "real_protocol", "simulated_slow")
UNIT_MS = {
    "time.Nanosecond": 0.000001,
    "time.Microsecond": 0.001,
    "time.Millisecond": 1.0,
    "time.Second": 1000.0,
    "time.Minute": 60000.0,
}

PASSED = 0
FAILED = 0

# 非 TTY（CI 日志/管道捕获）统一 UTF-8，避免 Windows GBK 控制台把中文 FAIL
# 详情变乱码；交互终端保留本地编码。
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


def fail_check(text: str) -> None:
    global FAILED
    FAILED += 1
    print(f"  FAIL  {text}")


class Unresolvable(ValueError):
    """sleep 实参无法解析为编译期常量时长（门禁按红处理，防不可预算的动态 sleep）。"""


def strip_line_comment(line: str) -> str:
    """去掉行尾 // 注释（字符串/符文字面量内的 // 视为内容）。"""
    in_str = False
    in_rune = False
    i = 0
    while i < len(line):
        ch = line[i]
        if in_str or in_rune:
            if ch == "\\":
                i += 2
                continue
            if (in_str and ch == '"') or (in_rune and ch == "'"):
                in_str = False
                in_rune = False
        elif ch == '"':
            in_str = True
        elif ch == "'":
            in_rune = True
        elif ch == "/" and i + 1 < len(line) and line[i + 1] == "/":
            return line[:i]
        i += 1
    return line


def extract_sleep_exprs(line: str) -> list:
    """提取一行内所有 time.Sleep(...) 的实参表达式；括号不平衡时返回空列表。"""
    exprs = []
    start = 0
    while True:
        idx = line.find("time.Sleep(", start)
        if idx < 0:
            return exprs
        depth = 0
        open_idx = idx + len("time.Sleep")
        for k in range(open_idx, len(line)):
            if line[k] == "(":
                depth += 1
            elif line[k] == ")":
                depth -= 1
                if depth == 0:
                    exprs.append(line[open_idx + 1 : k])
                    break
        start = idx + 1


def split_top_level(expr: str, op: str) -> list:
    parts = []
    depth = 0
    current = []
    for ch in expr:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == op and depth == 0:
            parts.append("".join(current))
            current = []
        else:
            current.append(ch)
    parts.append("".join(current))
    return [p.strip() for p in parts if p.strip()]


def resolve_unit(term: str):
    return UNIT_MS.get(term.strip())


_CONST_CACHE = {}


def lookup_go_const(name: str, package_dir: str):
    """在同包 .go 源文件里找常量/变量定义的右值；找不到返回 None。"""
    key = (package_dir, name)
    if key in _CONST_CACHE:
        return _CONST_CACHE[key]
    definition = None
    pattern = re.compile(
        r"(?m)^\s*(?:const|var)?\s*" + re.escape(name) + r"\s*(?:time\.Duration)?\s*=\s*([^=\n]+)$"
    )
    if os.path.isdir(package_dir):
        for file_name in sorted(os.listdir(package_dir)):
            if not file_name.endswith(".go"):
                continue
            try:
                with open(os.path.join(package_dir, file_name), encoding="utf-8", errors="replace") as handle:
                    text = handle.read()
            except OSError:
                continue
            match = pattern.search(text)
            if match:
                definition = match.group(1).strip()
                break
    _CONST_CACHE[key] = definition
    return definition


def resolve_factor(term: str, package_dir: str, depth: int) -> float:
    term = term.strip()
    if re.fullmatch(r"\d+(\.\d+)?", term):
        return float(term)
    match = re.fullmatch(r"time\.Duration\((.+)\)", term)
    if match:
        inner = match.group(1).strip()
        if re.fullmatch(r"\d+", inner):
            return int(inner) / 1000000.0  # time.Duration(N) = N 纳秒
        raise Unresolvable(f"time.Duration 实参不是字面量: {term}")
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", term):
        definition = lookup_go_const(term, package_dir)
        if definition is None:
            raise Unresolvable(f"无法解析标识符: {term}")
        return resolve_sleep_expr(definition, package_dir, depth + 1)
    raise Unresolvable(f"不支持的表达式项: {term}")


def resolve_sleep_expr(expr: str, package_dir: str, depth: int = 0) -> float:
    """把 time.Sleep 实参解析为毫秒数；失败抛 Unresolvable。"""
    if depth > 8:
        raise Unresolvable(f"表达式嵌套过深: {expr}")
    expr = expr.strip()
    if not expr:
        raise Unresolvable("空表达式")
    plus_parts = split_top_level(expr, "+")
    if len(plus_parts) > 1:
        return sum(resolve_sleep_expr(part, package_dir, depth + 1) for part in plus_parts)
    star_parts = split_top_level(expr, "*")
    if len(star_parts) > 2:
        raise Unresolvable(f"不支持的连乘表达式: {expr}")
    if len(star_parts) == 2:
        left, right = star_parts
        unit = resolve_unit(right)
        factor_term = left
        if unit is None:
            unit = resolve_unit(left)
            factor_term = right
        if unit is None:
            raise Unresolvable(f"乘积中没有 time 时间单位: {expr}")
        return resolve_factor(factor_term, package_dir, depth) * unit
    unit = resolve_unit(expr)
    if unit is not None:
        return unit
    return resolve_factor(expr, package_dir, depth)


def collect_current_sleeps() -> tuple:
    """返回 ({rel: [(行号, 毫秒|None)]}, [无法解析的表达式说明])。"""
    result = {}
    unresolved = []
    for module in ("hub-server", "edge-server"):
        module_dir = os.path.join(ROOT, module)
        if not os.path.isdir(module_dir):
            continue
        for dirpath, dirnames, filenames in os.walk(module_dir):
            dirnames.sort()
            for name in sorted(filenames):
                if not name.endswith("_test.go"):
                    continue
                full_path = os.path.join(dirpath, name)
                rel = os.path.relpath(full_path, ROOT).replace(os.sep, "/")
                sleeps = []
                with open(full_path, encoding="utf-8", errors="replace") as handle:
                    for line_no, raw in enumerate(handle, start=1):
                        line = strip_line_comment(raw)
                        if "time.Sleep(" not in line:
                            continue
                        exprs = extract_sleep_exprs(line)
                        if not exprs:
                            sleeps.append((line_no, None))
                            unresolved.append(f"{rel}:{line_no}: 括号不平衡或跨行调用")
                            continue
                        for expr in exprs:
                            try:
                                sleeps.append((line_no, resolve_sleep_expr(expr, dirpath)))
                            except Unresolvable as exc:
                                sleeps.append((line_no, None))
                                unresolved.append(f"{rel}:{line_no}: {exc}（表达式: {expr.strip()}）")
                if sleeps:
                    result[rel] = sleeps
    return result, unresolved


def load_baseline() -> dict:
    with open(BASELINE_PATH, encoding="utf-8-sig") as handle:
        text = handle.read()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # 兼容 ps1 写出的收尾括号前带尾逗号的基线文件
        return json.loads(re.sub(r",\s*}", "}", text))


def load_budget(path: str) -> dict:
    with open(path, encoding="utf-8-sig") as handle:
        text = handle.read()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        data = json.loads(re.sub(r",\s*}", "}", text))
    if not isinstance(data, dict):
        raise ValueError("budget 根节点必须是 JSON 对象")
    return {key.strip(): value for key, value in data.items()}


def write_baseline(baseline: dict) -> None:
    lines = ["{"]
    keys = sorted(baseline)
    for index, key in enumerate(keys):
        comma = "," if index < len(keys) - 1 else ""
        lines.append(f' "{key}": {baseline[key]}{comma}')
    lines.append("}")
    with open(BASELINE_PATH, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(lines) + "\n")


def as_number(value: float):
    """整数值的浮点写回为 int（预算文件里 5 而不是 5.0）。"""
    number = float(value)
    return int(number) if number.is_integer() else round(number, 6)


def format_budget(budget: dict) -> str:
    """按预算文件既有版式序列化：每层 1 空格缩进，纯标量对象单行内联。"""

    def scalar(value) -> str:
        return json.dumps(value, ensure_ascii=False)

    def fmt(value, depth: int) -> str:
        pad = " " * depth
        if isinstance(value, dict):
            if all(not isinstance(item, (dict, list)) for item in value.values()):
                inner = ", ".join(f"{scalar(k)}: {scalar(v)}" for k, v in value.items())
                return "{ " + inner + " }"
            lines = ["{"]
            keys = list(value)
            for index, key in enumerate(keys):
                comma = "," if index < len(keys) - 1 else ""
                lines.append(f"{pad} {scalar(key)}: {fmt(value[key], depth + 1)}{comma}")
            lines.append(f"{pad}}}")
            return "\n".join(lines)
        if isinstance(value, list):
            lines = ["["]
            for index, item in enumerate(value):
                comma = "," if index < len(value) - 1 else ""
                lines.append(f"{pad} {fmt(item, depth + 1)}{comma}")
            lines.append(f"{pad}]")
            return "\n".join(lines)
        return scalar(value)

    lines = ["{"]
    keys = list(budget)
    for index, key in enumerate(keys):
        comma = "," if index < len(keys) - 1 else ""
        lines.append(f" {scalar(key)}: {fmt(budget[key], 1)}{comma}")
    lines.append("}")
    return "\n".join(lines) + "\n"


def write_budget(budget: dict) -> None:
    with open(BUDGET_PATH, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(format_budget(budget))


def approx_equal(left, right) -> bool:
    return abs(float(left) - float(right)) <= 1e-6 * max(1.0, abs(float(left)), abs(float(right)))


def entry_schema_errors(entry) -> list:
    """预算条目必需字段校验（_comment 要求 owner/review 逐文件在案）。"""
    if not isinstance(entry, dict):
        return ["条目必须是对象"]
    errors = []
    for field in ("count", "total_ms", "max_ms", "owner", "review", "reason", "sleeps"):
        if field not in entry:
            errors.append(f"缺必需字段 '{field}'")
    if errors:
        return errors
    if not isinstance(entry["count"], int) or isinstance(entry["count"], bool) or entry["count"] < 0:
        errors.append("'count' 必须是非负整数")
    for field in ("total_ms", "max_ms"):
        if not isinstance(entry[field], (int, float)) or isinstance(entry[field], bool):
            errors.append(f"'{field}' 必须是数字")
    for field in ("owner", "review", "reason"):
        if not isinstance(entry[field], str) or not entry[field].strip():
            errors.append(f"'{field}' 必须是非空字符串（被跟踪的审批记录）")
    if not isinstance(entry["sleeps"], list):
        errors.append("'sleeps' 必须是列表")
    else:
        for index, sleep in enumerate(entry["sleeps"]):
            if not isinstance(sleep, dict) or "ms" not in sleep:
                errors.append(f"sleeps[{index}] 必须是含 'ms' 的对象")
                continue
            if not isinstance(sleep["ms"], (int, float)) or isinstance(sleep["ms"], bool):
                errors.append(f"sleeps[{index}].ms 必须是数字")
            if sleep.get("kind") not in ALLOWED_KINDS:
                errors.append(f"sleeps[{index}].kind {sleep.get('kind')!r} 不在许可集 {list(ALLOWED_KINDS)}")
    return errors


def check_budget(budget: dict, current: dict) -> None:
    """值预算门禁：路径真实性 + 条目 schema + count/total_ms/max_ms/逐值一致。"""
    for rel in sorted(key for key in budget if key != "_comment"):
        entry = budget[rel]
        if ".." in rel.split("/") or not re.fullmatch(r"(?:hub-server|edge-server)/.+_test\.go", rel):
            fail_check(f"[TSB-SCHEMA] 预算键不是后端测试文件路径: {rel}")
            continue
        if not os.path.isfile(os.path.join(ROOT, rel.replace("/", os.sep))):
            fail_check(f"[TSB-PATH] 预算路径不存在（腐化条目）: {rel}")
            continue
        schema_errors = entry_schema_errors(entry)
        if schema_errors:
            for error in schema_errors:
                fail_check(f"[TSB-SCHEMA] {rel}: {error}")
            continue
        actual = current.get(rel, [])
        actual_values = sorted(ms for _, ms in actual if ms is not None)
        budget_values = sorted(float(sleep["ms"]) for sleep in entry["sleeps"])
        problems = []
        if entry["count"] != len(actual):
            problems.append(f"count 预算 {entry['count']} != 实际 {len(actual)}")
        if actual_values:
            if not approx_equal(entry["total_ms"], sum(actual_values)):
                problems.append(f"total_ms 预算 {entry['total_ms']} != 实际 {as_number(sum(actual_values))}")
            if not approx_equal(entry["max_ms"], max(actual_values)):
                problems.append(f"max_ms 预算 {entry['max_ms']} != 实际 {as_number(max(actual_values))}")
            if [round(v, 6) for v in budget_values] != [round(v, 6) for v in actual_values]:
                problems.append(
                    "逐值不一致 预算 "
                    + ", ".join(str(as_number(v)) for v in budget_values)
                    + " != 实际 "
                    + ", ".join(str(as_number(v)) for v in actual_values)
                )
        elif entry["count"] or budget_values:
            problems.append("源码已无 sleep，条目需经 --update-baseline 移除")
        if problems:
            fail_check(f"[TSB-VALUE] {rel}: " + "；".join(problems))
    for rel in sorted(current):
        if rel not in budget:
            fail_check(
                f"[TSB-UNBUDGETED] {rel}: 有 {len(current[rel])} 处 sleep 但无预算条目，"
                "请评审后补进 scripts/verify/test-sleep-budget.json"
            )


def rebuild_budget(old_budget: dict, current: dict) -> dict:
    """--update-baseline 的值预算重写：值取源码实测，审批字段尽量保留。"""
    today = datetime.date.today().isoformat()
    new_budget = {}
    if isinstance(old_budget.get("_comment"), str):
        new_budget["_comment"] = old_budget["_comment"]
    for rel in sorted(current):
        values = [ms for _, ms in current[rel]]
        old_entry = old_budget.get(rel)
        old_entry = old_entry if isinstance(old_entry, dict) else None
        old_sleeps = old_entry.get("sleeps", []) if old_entry else []
        old_values = sorted(float(s["ms"]) for s in old_sleeps if isinstance(s, dict) and isinstance(s.get("ms"), (int, float)))
        changed = old_entry is None or entry_count_changed(old_entry, values) or [round(v, 6) for v in old_values] != [round(v, 6) for v in sorted(values)]
        sleeps = []
        for index, ms in enumerate(values):
            kind = "unclassified"
            if index < len(old_sleeps) and isinstance(old_sleeps[index], dict):
                kind = old_sleeps[index].get("kind", "unclassified")
            sleeps.append({"ms": as_number(ms), "kind": kind})
        entry = {
            "count": len(values),
            "total_ms": as_number(sum(values)),
            "max_ms": as_number(max(values)),
            "owner": old_entry.get("owner", "") if old_entry else "",
            "review": old_entry.get("review", "") if old_entry and not changed else today,
            "reason": old_entry.get("reason", "") if old_entry else "",
            "sleeps": sleeps,
        }
        new_budget[rel] = entry
    return new_budget


def entry_count_changed(old_entry: dict, values: list) -> bool:
    return old_entry.get("count") != len(values)


def main() -> int:
    parser = argparse.ArgumentParser(description="test-sleep ratchet + value budget verifier (#1550/#1565/#1948)")
    parser.add_argument(
        "--update-baseline",
        action="store_true",
        help="approve a new baseline + budget (tracked approval)",
    )
    args = parser.parse_args()

    current, unresolved = collect_current_sleeps()
    counts = {rel: len(sleeps) for rel, sleeps in current.items()}

    if not os.path.isfile(BASELINE_PATH):
        fail_check(f"baseline missing: {BASELINE_PATH}")
        return 1
    baseline = load_baseline()

    if args.update_baseline:
        for rel in sorted(baseline):
            old_n = baseline[rel]
            new_n = counts.get(rel, 0)
            if new_n != old_n:
                print(f"  CHG  {rel} : {old_n} -> {new_n}")
        for rel in sorted(key for key in counts if key not in baseline):
            print(f"  NEW  {rel} : {counts[rel]}")
        for note in unresolved:
            fail_check(f"[TSB-UNRESOLVED] {note}（无法预算的 sleep 不能进入审批基线）")
        if FAILED:
            return 1
        if not os.path.isfile(BUDGET_PATH):
            fail_check(f"[TSB-BUDGET-MISSING] 预算文件不存在: {BUDGET_PATH}")
            return 1
        old_budget = load_budget(BUDGET_PATH)
        for rel in sorted(key for key in old_budget if key != "_comment" and key not in current):
            print(f"  DEL  {rel}（源码已无 sleep，条目移除）")
        merged = dict(baseline)
        merged.update(counts)
        for key in list(merged):
            if key not in counts:
                del merged[key]
        write_baseline(merged)
        write_budget(rebuild_budget(old_budget, current))
        pass_check("baseline + budget updated（新增条目/空审批字段需人工补全后才放行）")
        return 0

    violations = []
    for rel in sorted(counts):
        cur = counts[rel]
        old = int(baseline.get(rel, 0))
        if cur > old:
            violations.append(f"{rel}: {cur} sleeps, baseline {old}")
    # baseline 里已无 sleep 的文件视为通过（棘轮只向下）
    for rel in sorted(key for key in baseline if key not in counts):
        pass_check(f"sleeps removed in {rel}")

    if not os.path.isfile(BUDGET_PATH):
        fail_check(f"[TSB-BUDGET-MISSING] 预算文件不存在（值预算门禁）: {BUDGET_PATH}")
    else:
        budget = load_budget(BUDGET_PATH)
        check_budget(budget, current)

    for note in unresolved:
        fail_check(f"[TSB-UNRESOLVED] {note}")

    for violation in violations:
        fail_check(f"sleep ratchet exceeded: {violation}")

    if FAILED == 0:
        total = sum(counts.values())
        pass_check(
            f"test-sleep ratchet + value budget hold ({total} sleeps across {len(counts)} files, "
            f"count baseline {len(baseline)} files)"
        )
        return 0
    print("  #1550/#1565/#1948: 用事件等待 / 截止轮询（testkit.Eventually）替换 sleep，")
    print("        或评审后 --update-baseline（被跟踪的审批步骤）并补全 owner/review/reason。")
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
