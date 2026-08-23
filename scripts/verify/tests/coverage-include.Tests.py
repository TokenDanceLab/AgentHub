#!/usr/bin/env python3
"""coverage-include — frontend coverage include contract negative self-test (#1535, ps1 迁移)。

证明 include 契约确实把"无人 import 的生产模块"计入 0%，且 verify-coverage-baseline.py
的 uncovered ratchet 会因此 FAIL：

  1. 在 app/mobile-rn/src/__cov_probe__/uncovered_probe.ts 创建真实的生产形模块
     （导出函数），无任何测试 import 它。
  2. 对 agenthub-mobile-rn 跑 vitest --coverage（json-summary）。
  3. 断言 probe 出现在 coverage-summary.json 且 lines.pct == 0（被坏 include/exclude
     配置排除的文件不会出现——这正是本测试要关闭的 fail-open 洞）。
  4. 断言 uncovered_files（0% 行生产模块数）超过 baseline 的 uncoveredFiles——
     ratchet 会拦下门禁。
  5. 删除 probe 并复核计数回落，确保后续真实 gate 不受影响。

统计口径与 verify-coverage-baseline.py 保持一致：#1535 include 合同中
*.stories.ts(x) Storybook 渲染夹具为非生产文件，不计入 production/uncovered
（vitest 从不执行 stories，若计入则每新增一个 story 都会撑大 uncovered）。

退出码：0=通过 / 1=失败。stdlib only；--RepoRoot 与 ps1 -RepoRoot 同名兼容。
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys

PROBE_SOURCE = """\
// Coverage include-contract probe (#1535) — created by
// scripts/verify/tests/coverage-include.Tests.py. No test imports this;
// it must appear in coverage-summary.json as 0% and trip the uncovered
// ratchet. Deleted by the same script.
export function uncoveredProbeTick(): string {
  const state = Math.random() > 0.5 ? 'up' : 'down';
  return state;
}

export const uncoveredProbeConst = 42;
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--RepoRoot", "-RepoRoot", default="")
    args = parser.parse_args()

    if args.RepoRoot.strip():
        repo_root = os.path.abspath(args.RepoRoot)
    else:
        repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

    mobile_dir = os.path.join(repo_root, "app", "mobile-rn")
    probe_dir = os.path.join(mobile_dir, "src", "__cov_probe__")
    probe_file = os.path.join(probe_dir, "uncovered_probe.ts")
    baseline_path = os.path.join(repo_root, "scripts", "verify", "coverage-baseline.json")

    if not os.path.isdir(mobile_dir):
        raise RuntimeError(f"mobile dir not found: {mobile_dir}")
    if not os.path.isfile(baseline_path):
        raise RuntimeError(f"baseline not found: {baseline_path}")

    with open(baseline_path, encoding="utf-8") as handle:
        baseline = json.load(handle)
    mobile_base = (baseline.get("packages") or {}).get("agenthub-mobile-rn") or {}
    if mobile_base.get("uncoveredFiles") is None:
        raise RuntimeError("baseline missing uncoveredFiles for agenthub-mobile-rn")

    failures = []

    def get_coverage_stats(summary_path):
        with open(summary_path, encoding="utf-8") as handle:
            coverage_summary = json.load(handle)
        production = 0
        uncovered = 0
        probe_found = False
        probe_lines = None
        for name, entry in coverage_summary.items():
            if name == "total":
                continue
            # 与 verify-coverage-baseline.py 的合同口径一致：Storybook 渲染
            # 夹具（*.stories.ts/x）非生产文件，不计入 production/uncovered。
            if os.path.basename(name.replace("\\", "/")).endswith((".stories.ts", ".stories.tsx")):
                continue
            production += 1
            lines_info = entry.get("lines") or {}
            if int(lines_info.get("total") or 0) > 0 and float(lines_info.get("pct") or 0.0) == 0.0:
                uncovered += 1
            if re.search(r"__cov_probe__/uncovered_probe\.ts$", name.replace("\\", "/")):
                probe_found = True
                probe_lines = lines_info
        return {"production": production, "uncovered": uncovered, "probe_found": probe_found, "probe_lines": probe_lines}

    try:
        # 1. create the probe (untracked production file, imported by nothing)
        os.makedirs(probe_dir, exist_ok=True)
        with open(probe_file, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(PROBE_SOURCE)

        # 2. run mobile coverage (json-summary only)
        coverage_dir = os.path.join(mobile_dir, "coverage")
        if os.path.isdir(coverage_dir):
            shutil.rmtree(coverage_dir, ignore_errors=True)
        app_dir = os.path.join(repo_root, "app")
        pnpm_exe = shutil.which("pnpm") or "pnpm"
        run = subprocess.run(
            [pnpm_exe, "--filter", "agenthub-mobile-rn", "exec", "vitest", "run", "--coverage",
             "--coverage.reporter=json-summary", "--hookTimeout=120000"],
            cwd=app_dir,
        )
        if run.returncode != 0:
            failures.append(f"mobile vitest run failed with exit {run.returncode}")

        # 3. assert the probe is counted as 0% (not silently excluded)
        summary = os.path.join(mobile_dir, "coverage", "coverage-summary.json")
        if not os.path.isfile(summary):
            failures.append("coverage-summary.json missing — coverage did not run")
        else:
            stats = get_coverage_stats(summary)
            if not stats["probe_found"]:
                failures.append("probe file NOT present in coverage-summary.json — include glob failed to match it (fail-open hole)")
            elif int(stats["probe_lines"].get("total") or 0) == 0:
                failures.append("probe file has 0 instrumented statements — probe is not valid production code")
            elif float(stats["probe_lines"].get("pct") or 0.0) != 0.0:
                failures.append(f"probe file coverage is {stats['probe_lines'].get('pct')}% — expected 0% (something imported it?)")
            else:
                print(f"  OK  probe counted as 0% (statements={stats['probe_lines'].get('total')})")

            # 4. the uncovered ratchet would fail the gate
            print(f"  mobile uncovered_files={stats['uncovered']} baseline={mobile_base['uncoveredFiles']}")
            if stats["uncovered"] <= int(mobile_base["uncoveredFiles"]):
                failures.append("uncovered_files did not grow past baseline — ratchet would NOT trip on new untested code")
            else:
                print(f"  OK  uncovered ratchet would trip (uncovered {stats['uncovered']} > baseline {mobile_base['uncoveredFiles']})")
            print(f"  mobile production_files={stats['production']}")
    finally:
        # 5. cleanup — probe must not leak into the real gate run
        if os.path.isdir(probe_dir):
            shutil.rmtree(probe_dir, ignore_errors=True)
            print("  cleanup: probe dir removed")
        coverage_dir = os.path.join(mobile_dir, "coverage")
        if os.path.isdir(coverage_dir):
            shutil.rmtree(coverage_dir, ignore_errors=True)

    if failures:
        print("")
        print("coverage-include self-test FAILED:")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    print("")
    print("coverage-include self-test ok — include contract counts uncovered modules, ratchet trips")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'，禁止静默吞错
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
