#!/usr/bin/env python3
"""verify-p0-desktop-edge-cli-smoke — P0 Desktop/Edge/CLI no-spend 冒烟（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

验证最小的 no-secret/no-spend 路径：Desktop app 表面 -> 内置 Local Edge sidecar
二进制 -> Edge health -> 选定 CLI 二进制/版本探测。绝不提交 model run、绝不读 CLI
auth 文件、绝不执行 TokenDanceID 登录。

契约：stdlib only；参数名/退出码与 ps1 一致（0=通过/1=失败）；机器可读行
（`PASS `/`FAIL `/`WARN `、`Status:`、`EvidencePath:` 等）与原 ps1 一致；证据 JSON
用 ConvertTo-Json 等价格式（2-space indent）；prepare 子脚本按扩展名分发
（.py → python，.ps1 → pwsh）。
"""

import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))

SECRET_LIKE_PATTERN = re.compile(
    r"(?i)(sk-[a-z0-9_-]{8,}|gh[pousr]_[a-z0-9_]{8,}|xox[baprs]-[a-z0-9-]+|"
    r"AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]*PRIV(?:ATE) KEY-----|"
    r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|"
    r"(?:token|secret|api[_-]?key|password|authorization)\s*[:=]\s*\S+)"
)

started = []
failures = []
warnings = []
desktop_status = "not_started"
tauri_dev_status = "not_requested"
edge_started = False


def step(text: str) -> None:
    print(f"\n=== {text} ===")


def pass_check(text: str) -> None:
    print(f"PASS {text}")


def warn_smoke(text: str) -> None:
    warnings.append(text)
    print(f"WARN {text}")


def fail_smoke(text: str) -> None:
    failures.append(text)
    print(f"FAIL {text}")


def assert_true(condition: bool, text: str) -> None:
    if condition:
        pass_check(text)
    else:
        fail_smoke(text)


def redact(text: str, repo_root: str) -> str:
    if not text or not text.strip():
        return text
    safe = text.replace(repo_root, "<repo>")
    safe = SECRET_LIKE_PATTERN.sub("<redacted>", safe)
    return safe


def join_repo(repo_root: str, path: str) -> str:
    if os.path.isabs(path):
        return path
    return os.path.join(repo_root, path)


def test_loopback_url(url: str) -> bool:
    match = re.match(r"^http://(127\.0\.0\.1|localhost):\d+(/.*)?$", url)
    return match is not None


def resolve_executable(value: str) -> str:
    if not value or not value.strip():
        return ""
    if os.path.isabs(value) and os.path.isfile(value):
        return os.path.realpath(value)
    resolved = shutil.which(value)
    return resolved or ""


def resolve_cli(runtime: str, cli_path: str) -> str:
    if runtime == "mock":
        return ""
    if cli_path.strip():
        return resolve_executable(cli_path)
    if runtime == "codex-acp":
        if os.environ.get("AGENTHUB_CODEX_ACP_PATH"):
            return resolve_executable(os.environ["AGENTHUB_CODEX_ACP_PATH"])
        return resolve_executable("npx")
    if runtime == "claude-code":
        if os.environ.get("AGENTHUB_CLAUDE_CODE_PATH"):
            return resolve_executable(os.environ["AGENTHUB_CLAUDE_CODE_PATH"])
        return resolve_executable("claude")
    if runtime == "opencode-acp":
        if os.environ.get("AGENTHUB_OPENCODE_ACP_PATH"):
            return resolve_executable(os.environ["AGENTHUB_OPENCODE_ACP_PATH"])
        return resolve_executable("opencode")
    return ""


def get_cli_path_flag(runtime: str) -> str:
    return {
        "codex-acp": "--codex-acp-path",
        "claude-code": "--claude-code-path",
        "opencode-acp": "--opencode-acp-path",
    }.get(runtime, "")


def invoke_cli_version_probe(path: str, repo_root: str) -> dict:
    if not path or not path.strip():
        return {"status": "skipped", "command_name": None, "output": None, "reason": "Runtime is mock or CLI is not installed"}
    try:
        run = subprocess.run(
            [path, "--version"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
        )
        exit_code = run.returncode
        output = (run.stdout or "") + (run.stderr or "")
    except Exception as exc:  # noqa: BLE001 —— 对齐 ps1 捕获语义
        return {"status": "blocked", "command_name": os.path.basename(path), "output": "", "reason": f"--version probe failed: {exc}"}
    trimmed = redact(output, repo_root).strip()
    if exit_code == 0 and trimmed:
        return {"status": "passed", "command_name": os.path.basename(path), "output": trimmed, "reason": "no-spend version probe only"}
    return {"status": "blocked", "command_name": os.path.basename(path), "output": trimmed, "reason": f"--version probe failed with exit code {exit_code}"}


def start_managed_process(name: str, file_name: str, arguments: list, working_directory: str, stdout_path: str, stderr_path: str):
    stdout_handle = open(stdout_path, "w", encoding="utf-8", errors="replace")
    stderr_handle = open(stderr_path, "w", encoding="utf-8", errors="replace")
    process = subprocess.Popen(
        [file_name, *arguments],
        cwd=working_directory,
        stdout=stdout_handle,
        stderr=stderr_handle,
    )
    started.append({"name": name, "process": process, "stdout_handle": stdout_handle, "stderr_handle": stderr_handle, "file": file_name})
    return process


def test_desktop_dependencies(repo_root: str) -> bool:
    desktop_node_modules = os.path.join(repo_root, "app", "desktop", "node_modules")
    app_node_modules = os.path.join(repo_root, "app", "node_modules")
    return os.path.isdir(desktop_node_modules) or os.path.isdir(app_node_modules)


def save_started_logs() -> None:
    for entry in started:
        try:
            entry["stdout_handle"].flush()
            entry["stderr_handle"].flush()
        except Exception:  # noqa: BLE001 —— 对齐 ps1 catch {}
            pass


def stop_started(keep_services: bool) -> None:
    if keep_services:
        return
    for entry in started:
        process = entry["process"]
        if process and process.poll() is None:
            try:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
            except Exception:  # noqa: BLE001 —— 对齐 ps1 Stop-Process -EA SilentlyContinue
                pass
        for handle in (entry["stdout_handle"], entry["stderr_handle"]):
            try:
                handle.close()
            except Exception:  # noqa: BLE001
                pass


def test_http_health(url: str, seconds: int):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                return response.read()
        except Exception:  # noqa: BLE001 —— 对齐 ps1 Invoke-RestMethod catch
            time.sleep(0.3)
    return None


def resolve_repo_script(repo_root: str, relative_without_extension: str) -> str:
    """优先 .py、回退 .ps1，迁移过渡期内兼容两种实现。"""
    for extension in (".py", ".ps1"):
        candidate = os.path.join(repo_root, relative_without_extension + extension)
        if os.path.isfile(candidate):
            return candidate
    return os.path.join(repo_root, relative_without_extension + ".ps1")


def invoke_script(script_path: str, arguments: list, stream_output: bool = False) -> dict:
    if script_path.endswith(".py"):
        python_exe = shutil.which("python") or shutil.which("python3")
        if not python_exe:
            return {"ExitCode": -1, "Output": "Python executable is unavailable."}
        command = [python_exe, script_path, *arguments]
    else:
        powershell_exe = shutil.which("pwsh") or shutil.which("powershell")
        if not powershell_exe:
            return {"ExitCode": -1, "Output": "PowerShell executable is unavailable."}
        command = [powershell_exe, "-NoProfile", "-File", script_path, *arguments]
    if stream_output:
        run = subprocess.run(command)
        return {"ExitCode": run.returncode, "Output": ""}
    run = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return {"ExitCode": run.returncode, "Output": (run.stdout or "") + "\n" + (run.stderr or "")}


def main() -> int:
    global failures, warnings, started, desktop_status, tauri_dev_status, edge_started
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
        sys.stderr.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except (AttributeError, ValueError):
        pass
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--RepoRoot", "-RepoRoot", default=".")
    parser.add_argument("--Runtime", "-Runtime", default="mock", choices=["codex-acp", "claude-code", "opencode-acp", "mock"])
    parser.add_argument("--CliPath", "-CliPath", default="")
    parser.add_argument("--Port", "-Port", type=int, default=3298)
    parser.add_argument("--TimeoutSec", "-TimeoutSec", type=int, default=30)
    parser.add_argument("--ArtifactRoot", "-ArtifactRoot", default=".tmp\\p0-desktop-edge-cli-smoke")
    parser.add_argument("--SkipSidecarBuild", "-SkipSidecarBuild", action="store_true")
    parser.add_argument("--SkipDesktopDev", "-SkipDesktopDev", action="store_true")
    parser.add_argument("--RequireDesktopDev", "-RequireDesktopDev", action="store_true")
    parser.add_argument("--StartTauriDev", "-StartTauriDev", action="store_true")
    parser.add_argument("--KeepServices", "-KeepServices", action="store_true")
    args = parser.parse_args()

    repo_root = os.path.realpath(args.RepoRoot)
    failures = []
    warnings = []
    started = []
    desktop_status = "not_started"
    tauri_dev_status = "not_requested"
    edge_started = False

    print("AgentHub P0 Desktop/Edge/CLI no-spend smoke")
    print("Boundary: no secrets, no real model run, no TokenDanceID login, no deploy/signing/release.")

    if args.Port <= 0 or args.Port > 65535:
        fail_smoke("-Port must be between 1 and 65535")
    if not test_loopback_url(f"http://127.0.0.1:{args.Port}"):
        fail_smoke("Edge URL must be loopback")
    for input_value in (args.CliPath, args.ArtifactRoot):
        if SECRET_LIKE_PATTERN.search(input_value):
            fail_smoke("input contains secret-like content")

    artifact_root = os.path.abspath(join_repo(repo_root, args.ArtifactRoot))
    allowed_artifact_root = os.path.abspath(os.path.join(repo_root, ".tmp", "p0-desktop-edge-cli-smoke"))
    if not (artifact_root == allowed_artifact_root or artifact_root.lower().startswith(allowed_artifact_root.lower() + os.sep)):
        fail_smoke("ArtifactRoot must stay under .tmp\\p0-desktop-edge-cli-smoke")
    os.makedirs(artifact_root, exist_ok=True)
    evidence_path = os.path.join(artifact_root, "smoke-result.json")
    log_root = os.path.join(artifact_root, "logs")
    os.makedirs(log_root, exist_ok=True)

    cli_resolved = resolve_cli(args.Runtime, args.CliPath)
    cli_probe = invoke_cli_version_probe(cli_resolved, repo_root)

    try:
        if not failures:
            step("Tauri sidecar binary")
            prepare_script = resolve_repo_script(repo_root, os.path.join("scripts", "release", "prepare-tauri-sidecar-local"))
            prepare_args = ["-RepoRoot", repo_root]
            if args.SkipSidecarBuild:
                prepare_args.append("-NoBuild")
            prepare_run = invoke_script(prepare_script, prepare_args, stream_output=True)
            if prepare_run["ExitCode"] != 0:
                fail_smoke(f"{os.path.basename(prepare_script)} failed")
            sidecar_smoke_python = os.path.join(repo_root, "scripts", "release", "verify-tauri-sidecar-binary-smoke.py")
            sidecar_smoke_run = invoke_script(sidecar_smoke_python, ["-RepoRoot", repo_root], stream_output=True)
            if sidecar_smoke_run["ExitCode"] != 0:
                fail_smoke("verify-tauri-sidecar-binary-smoke.py failed")
            sidecar = os.path.join(repo_root, "app", "desktop", "src-tauri", "binaries", "agenthub-edge-x86_64-pc-windows-msvc.exe")
            assert_true(os.path.isfile(sidecar), "Tauri sidecar binary exists")

            step("Desktop app surface")
            if args.SkipDesktopDev:
                warn_smoke("Desktop Vite startup skipped by caller")
            elif not test_desktop_dependencies(repo_root):
                desktop_status = "blocked"
                message = "Desktop app dependencies are missing; run package install before requiring Desktop app startup"
                if args.RequireDesktopDev:
                    fail_smoke(message)
                else:
                    warn_smoke(message)
            else:
                corepack = shutil.which("corepack") or shutil.which("corepack.cmd")
                if corepack:
                    start_managed_process(
                        "desktop-vite",
                        corepack,
                        ["pnpm", "--dir", os.path.join(repo_root, "app", "desktop"), "exec", "vite", "--host", "127.0.0.1", "--port", "5173", "--strictPort"],
                        os.path.join(repo_root, "app", "desktop"),
                        os.path.join(log_root, "desktop-vite.stdout.log"),
                        os.path.join(log_root, "desktop-vite.stderr.log"),
                    )
                    desktop_probe = test_http_health("http://127.0.0.1:5173", min(10, args.TimeoutSec))
                    if desktop_probe is not None:
                        desktop_status = "started"
                        pass_check("Desktop Vite app surface started on 127.0.0.1:5173")
                    else:
                        desktop_status = "blocked"
                        message = "Desktop Vite app surface did not start"
                        if args.RequireDesktopDev:
                            fail_smoke(message)
                        else:
                            warn_smoke(message)
                else:
                    desktop_status = "blocked"
                    message = "corepack.cmd unavailable for Desktop Vite startup"
                    if args.RequireDesktopDev:
                        fail_smoke(message)
                    else:
                        warn_smoke(message)
            if args.StartTauriDev:
                corepack = shutil.which("corepack") or shutil.which("corepack.cmd")
                if corepack:
                    start_managed_process(
                        "tauri-dev",
                        corepack,
                        ["pnpm", "--dir", os.path.join(repo_root, "app", "desktop"), "tauri", "dev"],
                        os.path.join(repo_root, "app", "desktop"),
                        os.path.join(log_root, "tauri-dev.stdout.log"),
                        os.path.join(log_root, "tauri-dev.stderr.log"),
                    )
                    time.sleep(min(8, args.TimeoutSec))
                    tauri_dev_status = "started_probe_only"
                    pass_check("Tauri dev process launched for startup probe")
                else:
                    tauri_dev_status = "blocked"
                    fail_smoke("corepack.cmd unavailable for Tauri dev startup")

            step("CLI binary no-spend probe")
            if args.Runtime == "mock":
                pass_check("Runtime=mock uses built-in mock runner; CLI probe intentionally skipped")
            elif cli_probe.get("status") == "passed":
                pass_check(f"{args.Runtime} CLI binary is visible via --version")
            else:
                fail_smoke(f"{args.Runtime} CLI binary/probe is not available: {cli_probe.get('reason')}")

            step("Local Edge startup")
            edge_url = f"http://127.0.0.1:{args.Port}"
            edge_health = f"{edge_url}/v1/health"
            edge_db = os.path.join(artifact_root, "agenthub-edge.sqlite")
            edge_event_log = os.path.join(artifact_root, "edge-event-log.ndjson")
            edge_args = ["--addr", f"127.0.0.1:{args.Port}", "--dev", "--store-backend", "sqlite", "--store-db", edge_db, "--event-log-path", edge_event_log]
            if args.Runtime == "mock":
                edge_args += ["--runner-profile", "agenthub-runner-mock"]
            else:
                edge_args += ["--runner-profile", args.Runtime, get_cli_path_flag(args.Runtime), cli_resolved]
            start_managed_process(
                "local-edge-sidecar",
                sidecar,
                edge_args,
                repo_root,
                os.path.join(log_root, "edge.stdout.log"),
                os.path.join(log_root, "edge.stderr.log"),
            )
            health = test_http_health(edge_health, args.TimeoutSec)
            if health is None:
                fail_smoke("Local Edge did not become healthy")
            else:
                edge_started = True
                pass_check("Local Edge sidecar started and /v1/health responded")
    finally:
        stop_started(args.KeepServices)
        save_started_logs()

    passed = not failures
    evidence = {
        "schema": "agenthub-p0-desktop-edge-cli-smoke-v1",
        "status": "P0_DESKTOP_EDGE_CLI_SMOKE_PASSED" if passed else "P0_DESKTOP_EDGE_CLI_SMOKE_FAILED",
        "generated_at": datetime.datetime.now().astimezone().isoformat(),
        "repo_root": "<repo>",
        "artifact_root": ".tmp/p0-desktop-edge-cli-smoke",
        "runtime": args.Runtime,
        "claims": {
            "tauri_app_startup": tauri_dev_status if args.StartTauriDev else "not_requested",
            "desktop_app_surface": desktop_status,
            "sidecar_edge_started": edge_started,
            "cli_binary_probe_visible": cli_probe.get("status") == "passed",
            "mock_adapter_used": args.Runtime == "mock",
            "real_cli_tested": False,
            "real_model_tested": False,
            "tokendance_id_login": False,
            "real_api_budget_spend": False,
        },
        "cli_probe": cli_probe,
        "edge": {
            "url": f"http://127.0.0.1:{args.Port}",
            "health_path": "/v1/health",
            "runner_profile": "agenthub-runner-mock" if args.Runtime == "mock" else args.Runtime,
            "model_run_submitted": False,
        },
        "logs": {"root": "logs"},
        "failures": list(failures),
        "warnings": list(warnings),
        "blockers": [
            "Real model execution is intentionally not performed by this smoke.",
            "TokenDanceID login is intentionally not performed by this smoke.",
            "CLI auth files and secret env values are not read or recorded.",
        ],
    }
    with open(evidence_path, "w", encoding="utf-8") as handle:
        json.dump(evidence, handle, ensure_ascii=False, indent=2)

    print(f"EvidencePath: {evidence_path}")
    print(f"TauriAppStartup={evidence['claims']['tauri_app_startup']}")
    print(f"SidecarEdgeStarted={str(edge_started).lower()}")
    print(f"CliBinaryProbeVisible={str(evidence['claims']['cli_binary_probe_visible']).lower()}")
    print("RealCliTested=false")
    print("RealModelTested=false")
    print("TokenDanceIDLogin=false")

    if passed:
        print("Status: P0_DESKTOP_EDGE_CLI_SMOKE_PASSED")
        return 0
    print("Status: P0_DESKTOP_EDGE_CLI_SMOKE_FAILED")
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'，禁止静默吞错
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
