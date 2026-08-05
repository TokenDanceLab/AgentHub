#!/usr/bin/env python3
"""dev-start — 一键启动 Edge、Hub 与 Desktop 开发服务（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

后台启动 edge-server（go run）、hub-server（go run）与 Desktop dev server
（pnpm dev），等待端口就绪后常驻；Ctrl+C 停止全部。
URLs: Edge=http://127.0.0.1:3210, Hub=http://127.0.0.1:8080, Desktop=http://localhost:5173

契约：stdlib only；前置检查（go/node/pnpm 缺失即 exit 1）、端口等待行
（`  [Name] Ready on port N` / `  [Name] TIMEOUT — port N did not become
available in Ns`）与原 ps1 一致。
"""

import os
import shutil
import socket
import subprocess
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))

pids = []


def write_banner(text: str) -> None:
    print(f"\n=== {text} ===")


def write_starting(name: str) -> None:
    print(f"  [{name}] Starting...")


def write_ready(name: str, port: int) -> None:
    print(f"  [{name}] Ready on port {port}")


def write_timeout(name: str, port: int, seconds: int) -> None:
    print(f"  [{name}] TIMEOUT — port {port} did not become available in {seconds}s")


def start_service_process(name: str, working_dir: str, executable: str, args: list) -> None:
    process = subprocess.Popen([executable, *args], cwd=working_dir)
    pids.append(process)
    write_starting(name)


def test_tcp_port(port: int, host_addr: str = "127.0.0.1") -> bool:
    try:
        with socket.create_connection((host_addr, port), timeout=1):
            return True
    except OSError:
        return False


def wait_for_port(name: str, port: int, host_addr: str = "127.0.0.1", timeout_sec: int = 30) -> bool:
    started = time.monotonic()
    while time.monotonic() - started < timeout_sec:
        if test_tcp_port(port, host_addr):
            write_ready(name, port)
            return True
        time.sleep(0.5)
    write_timeout(name, port, timeout_sec)
    return False


def main() -> int:
    repo_root = os.path.realpath(REPO_ROOT)

    # --- Check prerequisites ---
    missing = []
    for tool in ("go", "node", "pnpm"):
        if not shutil.which(tool):
            missing.append(tool)
    if missing:
        print(f"ERROR: Missing required tools: {', '.join(missing)}")
        print("Developers should have Go and Node installed. See https://go.dev/dl/ and https://nodejs.org/")
        return 1

    # --- Install desktop dependencies if needed ---
    if not os.path.isdir(os.path.join(repo_root, "app", "desktop", "node_modules")):
        print("  [Desktop] Installing dependencies (pnpm install)...")
        run = subprocess.run(["pnpm", "install", "--frozen-lockfile"], cwd=os.path.join(repo_root, "app", "desktop"))
        if run.returncode != 0:
            print("ERROR: pnpm install failed")
            return 1

    write_banner("AgentHub Dev Start")
    print(f"Repo: {repo_root}")

    try:
        # Start all services
        start_service_process("edge-server", os.path.join(repo_root, "edge-server"), "go", ["run", "./cmd/agenthub-edge", "--addr", "127.0.0.1:3210"])
        start_service_process("hub-server", os.path.join(repo_root, "hub-server"), "go", ["run", "./cmd/server-hub"])
        start_service_process("desktop", os.path.join(repo_root, "app", "desktop"), "pnpm", ["dev"])

        # Wait for health checks
        print("\nWaiting for services to be ready...\n")
        all_ready = True
        all_ready = wait_for_port("Edge", 3210) and all_ready
        all_ready = wait_for_port("Hub", 8080) and all_ready
        all_ready = wait_for_port("Desktop", 5173, "localhost") and all_ready

        write_banner("All services started")
        print("  Edge:    http://127.0.0.1:3210")
        print("  Hub:     http://127.0.0.1:8080")
        print("  Desktop: http://localhost:5173")
        print("\nPress Ctrl+C to stop all services.\n")

        # Keep running until Ctrl+C
        while True:
            time.sleep(1)
    finally:
        print("\nShutting down...")
        for process in pids:
            if process.poll() is None:
                print(f"  Stopping PID {process.pid}...")
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
        print("All services stopped.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'，禁止静默吞错
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
