#!/usr/bin/env python3
"""setup — AgentHub 本地环境配置。

启用 git hooks（scripts/git-hooks）。

stdlib only；退出码 0=通过。
"""

import argparse
import os
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.parse_args()

    repo_root = os.path.realpath(REPO_ROOT)
    os.chdir(repo_root)

    run = subprocess.run(["git", "config", "core.hooksPath", "scripts/git-hooks"])
    if run.returncode != 0:
        raise RuntimeError(f"git config core.hooksPath failed with exit code {run.returncode}")
    print("Git hooks enabled: scripts/git-hooks")

    print("Setup complete.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— fail closed：未捕获异常返回非零
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
