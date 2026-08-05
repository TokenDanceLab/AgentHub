#!/usr/bin/env python3
"""dev-up — 一键本地开发环境（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

Docker Compose 启动 PostgreSQL 16 + Redis 7，等待健康后 go run 启动 Hub
Server。默认行为/输出/退出码与 ps1 一致；--full 兼容原 dev-up.sh 语义
（连带构建并启动 hub-server 镜像，等待 Hub health 后打印服务表，不 go run）。

契约：stdlib only；参数名/退出码与 ps1 一致（docker 失败即非零退出）；输出行
（`=== Starting PostgreSQL + Redis ===` / `Waiting for PostgreSQL...` /
`  PostgreSQL is ready.` / `  Redis is ready.` / `=== Starting Hub Server ===`）
与原 ps1 一致。
"""

import argparse
import os
import subprocess
import sys
import time
import urllib.request

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))


def run_captured(command: list) -> tuple:
    run = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return run.returncode, (run.stdout or "") + (run.stderr or "")


def wait_for_pg() -> bool:
    print("\nWaiting for PostgreSQL...")
    for _ in range(60):
        exit_code, out = run_captured(["docker", "compose", "exec", "-T", "postgres", "pg_isready", "-U", "agenthub", "-d", "agenthub"])
        if exit_code == 0 and "accepting connections" in out:
            return True
        time.sleep(1)
    return False


def wait_for_redis() -> bool:
    print("Waiting for Redis...")
    for _ in range(60):
        exit_code, out = run_captured(["docker", "compose", "exec", "-T", "redis", "redis-cli", "ping"])
        if exit_code == 0 and "PONG" in out:
            return True
        time.sleep(1)
    return False


def wait_for_hub() -> bool:
    print("Waiting for Hub Server...")
    for _ in range(30):
        try:
            with urllib.request.urlopen("http://localhost:8080/health", timeout=1):
                return True
        except Exception:  # noqa: BLE001 —— 对齐 .sh curl 探测语义
            time.sleep(2)
    return False


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
        sys.stderr.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except (AttributeError, ValueError):
        pass
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--full", action="store_true", help="build and start all services (postgres + redis + hub-server)")
    args = parser.parse_args()

    repo_root = os.path.realpath(REPO_ROOT)
    os.chdir(repo_root)

    print("=== Starting PostgreSQL + Redis ===")
    if args.full:
        run = subprocess.run(["docker", "compose", "up", "-d", "--build", "postgres", "redis", "hub-server"])
    else:
        run = subprocess.run(["docker", "compose", "up", "-d", "postgres", "redis"])
    if run.returncode != 0:
        raise RuntimeError("docker compose up failed")

    if not wait_for_pg():
        print("  TIMEOUT: PostgreSQL did not become ready in 60s")
        return 1
    print("  PostgreSQL is ready.")

    if not wait_for_redis():
        print("  TIMEOUT: Redis did not become ready in 60s")
        return 1
    print("  Redis is ready.")

    if args.full:
        if not wait_for_hub():
            print("  TIMEOUT: Hub Server did not become ready in 60s")
            return 1
        print("  Hub Server is ready.")

        print("")
        print("  Services:")
        print("    %-20s %s" % ("PostgreSQL", "localhost:5432"))
        print("    %-20s %s" % ("Redis", "localhost:6379"))
        print("    %-20s %s" % ("Hub API", "http://localhost:8080"))
        print("    %-20s %s" % ("Hub Admin", "http://localhost:6060"))
        print("")
        print("  Quick commands:")
        print("    docker compose logs -f              # 查看所有日志")
        print("    %-37s %s" % ("./scripts/dev/dev-down.sh", "# 停止所有服务"))
        return 0

    print("\n=== Starting Hub Server ===")
    print("  API:    http://localhost:8080")
    print("  Admin:  http://localhost:6060/debug/pprof/")
    print("  Press Ctrl+C to stop.\n")

    go_run = subprocess.run(["go", "run", "./hub-server/cmd/server-hub/"])
    return go_run.returncode


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'，禁止静默吞错
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
