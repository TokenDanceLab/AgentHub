#!/usr/bin/env python3
"""verify-orchestrator-deps — A-V1 orchestrator 依赖方向门禁（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

目标方向（机器门禁）：

    internal/orchestration            # neutral contracts (SSOT)
        ↑
    internal/adapters/orchestrator    # leaf implementation, contracts + narrow ports only
        ↑
    composition root / registry       # injects concrete deps

断言：
  1. 叶子包 internal/adapters/orchestrator 不得 import 根实现包
     github.com/agenthub/edge-server/internal/adapters。
  2. internal/orchestration 不得 import 任何 internal/adapters 包。
  3. 根 internal/adapters 不得 import 叶子包（单向 seam）。

用法：
  python scripts/verify/verify-orchestrator-deps.py            # check real repo
  python scripts/verify/verify-orchestrator-deps.py --EdgeServerRoot <dir>  # fixture

stdlib only；参数名/退出码与 ps1 一致（0=通过/1=失败）；机器可读行
（`  PASS  ` / `  FAIL  `）格式与原 ps1 一致。
"""

import argparse
import os
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))

passed = 0
failed = 0


def pass_check(text: str) -> None:
    global passed
    passed += 1
    print(f"  PASS  {text}")


def fail_check(text: str) -> None:
    global failed
    failed += 1
    print(f"  FAIL  {text}")


def go_list_deps(edge_server_root: str, pattern: str) -> list:
    """GOWORK=off 且 -C 目标根内运行，使目标自身的 go.mod 生效，repo 根 go.work 与调用方 cwd 不泄漏进检查。"""
    env = dict(os.environ)
    env["GOWORK"] = "off"
    run = subprocess.run(
        ["go", "-C", edge_server_root, "list", "-deps", pattern],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
    )
    if run.returncode != 0:
        raise RuntimeError(f"go list -deps {pattern} failed:\n{(run.stdout or '') + (run.stderr or '')}")
    return [line for line in run.stdout.splitlines() if line.strip()]


def main() -> int:
    global passed, failed
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--EdgeServerRoot", "-EdgeServerRoot", default=os.path.join(REPO_ROOT, "edge-server"))
    args = parser.parse_args()

    edge_server_root = os.path.realpath(args.EdgeServerRoot)
    if not os.path.isfile(os.path.join(edge_server_root, "go.mod")):
        fail_check(f"edge-server root missing go.mod: {edge_server_root}")
        return 1

    print("\n=== Orchestrator dependency direction (A-V1 Step 2, #1566) ===")
    print(f"Edge server root: {edge_server_root}")

    leaf_pattern = "./internal/adapters/orchestrator/..."
    root_pkg = "github.com/agenthub/edge-server/internal/adapters"
    orchestration_pattern = "./internal/orchestration/"

    # ── Assertion 1: leaf must not import root implementation package ───────
    leaf_deps = go_list_deps(edge_server_root, leaf_pattern)
    leaf_violations = [dep for dep in leaf_deps if dep == root_pkg]
    if leaf_violations:
        fail_check(f"leaf internal/adapters/orchestrator imports root implementation package: {', '.join(leaf_violations)}")
    else:
        pass_check("leaf package does not import root internal/adapters (go list -deps clean)")

    # ── Assertion 2: orchestration must not import adapters at all ──────────
    orch_deps = go_list_deps(edge_server_root, orchestration_pattern)
    orch_violations = [dep for dep in orch_deps if "internal/adapters" in dep]
    if orch_violations:
        fail_check(f"neutral contract package internal/orchestration imports adapters: {', '.join(orch_violations)}")
    else:
        pass_check("internal/orchestration has no adapters dependency")

    # ── Assertion 3: root adapters must not import the leaf (one-way seam) ──
    root_deps = go_list_deps(edge_server_root, "./internal/adapters")
    root_violations = [dep for dep in root_deps if "internal/adapters/orchestrator" in dep]
    if root_violations:
        fail_check(f"root internal/adapters imports the orchestrator leaf: {', '.join(root_violations)}")
    else:
        pass_check("root adapters does not import the orchestrator leaf")

    print("\n========================================")
    print(f"  Passed: {passed}  |  Failed: {failed}")
    print("========================================")

    return 1 if failed else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'，禁止静默吞错
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
