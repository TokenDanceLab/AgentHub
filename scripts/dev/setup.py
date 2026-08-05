#!/usr/bin/env python3
"""setup — AgentHub 本地环境配置（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

启用 git hooks（scripts/git-hooks），可选同步 public reference 仓库
（-Reference core|all；兼容原 setup.sh 的 --reference-core / --reference-all）。

契约：stdlib only；参数/输出行（`Git hooks enabled: scripts/git-hooks` /
`Setup complete.`）与 ps1 一致；退出码 0=通过。
"""

import argparse
import os
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--Reference", "-Reference", default="none", choices=["none", "core", "all"])
    parser.add_argument("--reference-core", action="store_true", help="sync core reference repos (setup.sh compatibility)")
    parser.add_argument("--reference-all", action="store_true", help="sync all reference repos (setup.sh compatibility)")
    args = parser.parse_args()

    reference = args.Reference
    if args.reference_core:
        reference = "core"
    if args.reference_all:
        reference = "all"

    repo_root = os.path.realpath(REPO_ROOT)
    os.chdir(repo_root)

    run = subprocess.run(["git", "config", "core.hooksPath", "scripts/git-hooks"])
    if run.returncode != 0:
        raise RuntimeError(f"git config core.hooksPath failed with exit code {run.returncode}")
    print("Git hooks enabled: scripts/git-hooks")

    if reference != "none":
        sync_run = subprocess.run([sys.executable, os.path.join(SCRIPT_DIR, "sync-reference.py"), "--Tier", reference])
        if sync_run.returncode != 0:
            return sync_run.returncode

    print("Setup complete.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'，禁止静默吞错
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
