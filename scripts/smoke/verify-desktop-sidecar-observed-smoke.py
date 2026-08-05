#!/usr/bin/env python3
"""verify-desktop-sidecar-observed-smoke — Observed Desktop sidecar fixture smoke source gate.

ps1 迁移（契约见 server docs/design/ps1-to-python-migration.md）：stdlib only、
CLI 参数/退出码兼容（0=通过，1=失败）、机器可读行（`PASS:`/`FAIL:`/`>>>`）与原
ps1 一致。对 `app/desktop/src-tauri/src/edge_manager.rs` 做 Observed 冒烟 fixture
的源码断言，可选运行 `cargo test observed_ --lib`。不启动任何服务、不调用真实 CLI。
"""

import argparse
import os
import re
import subprocess
import sys

FAILED = False


def normalize_stdout_lf() -> None:
    """Disable newline translation so redirected output is byte-identical to pwsh.

    pwsh Write-Host emits `\r\n` line terminators but keeps embedded `` `n `` in
    strings as literal `\n`. Mirror that exactly with explicit writes.
    """
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace", newline="", line_buffering=True)
        sys.stderr.reconfigure(encoding="utf-8", errors="replace", newline="", line_buffering=True)
    except (AttributeError, ValueError):
        pass


def emit(text: str) -> None:
    sys.stdout.write(text + "\r\n")
    sys.stdout.flush()


def step(message: str) -> None:
    emit(f"\n>>> {message}")


def pass_check(message: str) -> None:
    emit(f"PASS: {message}")


def fail_check(message: str) -> None:
    global FAILED
    FAILED = True
    emit(f"FAIL: {message}")
    sys.exit(1)


def assert_contains(text: str, pattern: str, message: str) -> None:
    if re.search(pattern, text) is None:
        fail_check(message)
    pass_check(message)


def assert_not_contains(text: str, pattern: str, message: str) -> None:
    if re.search(pattern, text) is not None:
        fail_check(message)
    pass_check(message)


def main() -> int:
    global FAILED
    normalize_stdout_lf()
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--RepoRoot", default=".", help="repository root (defaults to the current directory)")
    parser.add_argument("--SkipCargoTest", action="store_true", help="skip the focused Rust observed sidecar fixture smoke")
    args = parser.parse_args()

    repo_root = os.path.abspath(args.RepoRoot)
    edge_manager_path = os.path.join(repo_root, "app", "desktop", "src-tauri", "src", "edge_manager.rs")
    with open(edge_manager_path, "r", encoding="utf-8") as handle:
        edge_manager = handle.read()

    step("Observed Desktop sidecar fixture smoke source gate")
    assert_contains(edge_manager, r"EdgeObservedSidecarSmoke", "Observed smoke evidence struct exists")
    assert_contains(edge_manager, r"observe_fixture_sidecar_smoke", "Observed smoke fixture helper exists")
    assert_contains(edge_manager, r"EdgeObservedTargetBinding", "Observed smoke target binding evidence struct exists")
    assert_contains(edge_manager, r"observed_target_binding", "Observed smoke target binding resolver exists")
    assert_contains(edge_manager, r'mode:\s*"fixture"', "Observed smoke is explicitly fixture scoped")
    assert_contains(edge_manager, r"expected_target_id", "Observed smoke records expected Hub target")
    assert_contains(edge_manager, r"observed_target_id", "Observed smoke records observed Hub target")
    assert_contains(edge_manager, r"expected_edge_device_id", "Observed smoke records expected Desktop device")
    assert_contains(edge_manager, r"observed_edge_device_id", "Observed smoke records observed Desktop device")
    assert_contains(edge_manager, r"edge_store_db_path\(app_data_dir\.clone\(\)\)", "Observed smoke reads SQLite app-data path")
    assert_contains(edge_manager, r"edge_log_paths\(app_data_dir\.clone\(\)\)", "Observed smoke reads stdout/stderr log paths")
    assert_contains(edge_manager, r"edge_health_url\(port\)", "Observed smoke reads Local Edge health URL")
    assert_contains(edge_manager, r"edge_preflight\(true,\s*false,\s*true,\s*None\)", "Observed smoke reports fixture preflight readiness")
    assert_contains(edge_manager, r"direct_cli_spawn:\s*false", "Observed smoke preserves no direct CLI spawn")
    assert_contains(edge_manager, r'TcpListener::bind\("127\.0\.0\.1:0"\)', "Observed smoke uses loopback mock health server")
    assert_not_contains(edge_manager, r"(?m)^\s*(?:codex|claude|opencode)\b", "Observed smoke source does not invoke real CLI commands")

    if not args.SkipCargoTest:
        step("Focused Rust observed sidecar fixture smoke")
        src_tauri = os.path.join(repo_root, "app", "desktop", "src-tauri")
        run = subprocess.run(["cargo", "test", "observed_", "--lib"], cwd=src_tauri)
        if run.returncode != 0:
            fail_check("cargo test observed_ --lib failed")
        pass_check("cargo test observed_ --lib passed")

    emit("\nDesktop sidecar observed fixture smoke OK")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 对齐 ps1 $ErrorActionPreference='Stop'
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
