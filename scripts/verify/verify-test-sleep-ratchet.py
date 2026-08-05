#!/usr/bin/env python3
"""verify-test-sleep-ratchet — test-sleep 基线棘轮门禁（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

固定 time.Sleep 在测试里要么太短（负载下 flaky）要么太长（拖慢），无界轮询又会掩盖卡死的组件。
本门禁强制 hub-server/internal/ 与 edge-server/internal/ 下 *_test.go 的按文件 time.Sleep(
计数不超过已提交基线（scripts/verify/test-sleep-baseline.json）。基线只缩不增；新增 sleep
必须显式更新基线（--update-baseline），即被跟踪的审批步骤。

handler/mock 体内的 time.Sleep（模拟慢行为）同样计数——任何新 sleep 都必须以基线更新为理由。

用法：
  python scripts/verify/verify-test-sleep-ratchet.py                    # check
  python scripts/verify/verify-test-sleep-ratchet.py --update-baseline  # approve new baseline
"""

import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BASELINE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test-sleep-baseline.json")

PASSED = 0
FAILED = 0


def pass_check(text: str) -> None:
    global PASSED
    PASSED += 1
    print(f"  PASS  {text}")


def fail_check(text: str) -> None:
    global FAILED
    FAILED += 1
    print(f"  FAIL  {text}")


def collect_current_sleep_counts() -> dict:
    counts = {}
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
                count = 0
                with open(full_path, encoding="utf-8", errors="replace") as handle:
                    for line in handle:
                        if re.search(r"time\.Sleep\(", line):
                            count += 1
                if count > 0:
                    counts[rel] = count
    return counts


def load_baseline() -> dict:
    with open(BASELINE_PATH, encoding="utf-8-sig") as handle:
        text = handle.read()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # 兼容 ps1 写出的收尾括号前带尾逗号的基线文件
        return json.loads(re.sub(r",\s*}", "}", text))


def write_baseline(baseline: dict) -> None:
    lines = ["{"]
    keys = sorted(baseline)
    for index, key in enumerate(keys):
        comma = "," if index < len(keys) - 1 else ""
        lines.append(f' "{key}": {baseline[key]}{comma}')
    lines.append("}")
    with open(BASELINE_PATH, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(lines) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="test-sleep ratchet verifier (#1550)")
    parser.add_argument(
        "--update-baseline",
        action="store_true",
        help="approve a new baseline (tracked, only-shrinks)",
    )
    args = parser.parse_args()

    current = collect_current_sleep_counts()

    if not os.path.isfile(BASELINE_PATH):
        fail_check(f"baseline missing: {BASELINE_PATH}")
        return 1
    baseline = load_baseline()

    if args.update_baseline:
        for rel in sorted(baseline):
            old_n = baseline[rel]
            new_n = current.get(rel, 0)
            if new_n != old_n:
                print(f"  CHG  {rel} : {old_n} -> {new_n}")
        for rel in sorted(key for key in current if key not in baseline):
            print(f"  NEW  {rel} : {current[rel]}")
        merged = dict(baseline)
        merged.update(current)
        for key in list(merged):
            if key not in current:
                del merged[key]
        write_baseline(merged)
        pass_check("baseline updated")
        return 0

    violations = []
    for rel in sorted(current):
        cur = current[rel]
        old = int(baseline.get(rel, 0))
        if cur > old:
            violations.append(f"{rel}: {cur} sleeps, baseline {old}")
    # baseline 里已无 sleep 的文件视为通过（棘轮只向下）
    for rel in sorted(key for key in baseline if key not in current):
        pass_check(f"sleeps removed in {rel}")

    if not violations:
        total = sum(current.values())
        pass_check(
            f"test-sleep ratchet holds ({total} sleeps across {len(current)} files, baseline {len(baseline)} files)"
        )
        return 0
    for violation in violations:
        fail_check(f"sleep ratchet exceeded: {violation}")
    print("  #1550: replace the sleep with an event wait / deadline poll (testkit.Eventually),")
    print("        or approve explicitly via -UpdateBaseline (tracked, only-shrinks).")
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
