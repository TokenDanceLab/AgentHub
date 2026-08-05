#!/usr/bin/env python3
"""dev-down — 停止 Hub Server Docker Compose 开发环境（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

停止并移除 dev-up 启动的 PostgreSQL/Redis 容器。默认保留数据卷；
--clean/-c 删除数据卷（干净重置，兼容原 dev-down.sh 语义）。

契约：stdlib only；无参数行为/退出码与 ps1 一致（退出码跟随 docker compose
down）；输出行（`=== Tearing down Hub Server dev environment ===` /
`Containers stopped and removed.`）与原 ps1 一致。
"""

import argparse
import os
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
        sys.stderr.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except (AttributeError, ValueError):
        pass
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--clean", "-c", action="store_true", help="stop services and remove volumes (clean reset)")
    args = parser.parse_args()

    repo_root = os.path.realpath(REPO_ROOT)
    os.chdir(repo_root)

    if args.clean:
        print("  Stopping all services and removing volumes (clean reset)...")
        run = subprocess.run(["docker", "compose", "down", "-v", "--remove-orphans"])
        print("  Volumes removed: agenthub_pg_data, agenthub_redis_data, agenthub_uploads")
        print("  Done.")
        return run.returncode

    print("=== Tearing down Hub Server dev environment ===")
    run = subprocess.run(["docker", "compose", "down"])
    if run.returncode == 0:
        print("Containers stopped and removed.")
    return run.returncode


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'，禁止静默吞错
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
