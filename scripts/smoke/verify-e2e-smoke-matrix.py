#!/usr/bin/env python3
"""AgentHub E2E/smoke matrix runner（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

运行 CI-safe smoke 集合：Web stubbed Hub replay、Desktop renderer/Tauri
dry gates、Local Edge/Hub service health、approval/artifact replay。真实
TokenDance ID 登录与 live Hub dispatch 记录为 BLOCKED_WITH_EVIDENCE，
除非单独的 approval gate 满足。

迁移差异（双跑对照记录）：内部子脚本调用改为 python 执行（对应
verify-localhost-real-stack-smoke / verify-login-e2e-readiness / client-smoke
的 py 版本）；release 侧 tauri dry 脚本同样改走 python 执行（verify-tauri-package-dry.py）；
超时进程树终止用 taskkill /T /F 对齐 Kill($true)；
CLI 参数、退出码（0=通过 / 1=失败）与 RUN/PASS/BLOCK/FAIL/SKIP 行
前缀格式与原 ps1 一致。

用法：
  python scripts/smoke/verify-e2e-smoke-matrix.py
  python scripts/smoke/verify-e2e-smoke-matrix.py -SkipWebE2E -SkipDesktopE2E -SkipLocalStack -SkipEdgeClientSmoke -SkipTauriDry
"""

import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone

rows = []


def add_ps_compat(parser, *names, **kwargs):
    """Register a parameter with both ps1-style (-Xxx) and python-style (--Xxx) names."""
    full_names = []
    for name in names:
        full_names.append(name)
        if name.startswith("--"):
            full_names.append("-" + name[2:])
    parser.add_argument(*full_names, **kwargs)


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def test_path_under_root(path, root):
    normalized = os.path.normpath(os.path.abspath(path)).rstrip("\\/")
    normalized_root = os.path.normpath(os.path.abspath(root)).rstrip("\\/")
    if normalized.lower() == normalized_root.lower():
        return True
    prefix = normalized_root + os.sep
    return normalized.lower().startswith(prefix.lower())


def redact_secret_like(value):
    if not value:
        return value
    safe = value
    safe = re.sub(r'(?i)(Authorization:\s*Bearer\s+)[^"\'\s,}]+', r"\1<redacted-token>", safe)
    safe = re.sub(r'(?i)(bearer\s+)[a-z0-9._-]{12,}', r"\1<redacted-token>", safe)
    safe = re.sub(r'(?i)\b(sk|ghp|gho|ghu|ghs|glpat|xox[baprs])-[-_A-Za-z0-9]{8,}', "<redacted-token>", safe)
    safe = re.sub(r'(?i)((?:access[_-]?token|refresh[_-]?token|id[_-]?token|client_secret|password)\s*[=:]\s*)[^"\'\s,}]+', r"\1<redacted-secret>", safe)
    safe = re.sub(r'(?i)("?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client_secret|password)"?\s*:\s*")[^"]+', r"\1<redacted-secret>", safe)
    return safe


def shorten_text(text, max_length=5000):
    safe = redact_secret_like(text)
    if len(safe) <= max_length:
        return safe
    return safe[:max_length] + "\n...<truncated>..."


def get_command_path(command_name):
    path = shutil.which(command_name)
    return path or ""


def get_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def invoke_matrix_command(name, area, command, arguments, working_directory, blocked_exit_codes, blocked_reason, skipped, skip_reason, evidence_level, real_tested, claim, command_timeout_sec):
    if skipped:
        rows.append({
            "name": name,
            "area": area,
            "evidence_level": evidence_level,
            "real_tested": real_tested,
            "status": "skipped",
            "exit_code": None,
            "duration_ms": 0,
            "command": f"{command} {' '.join(arguments)}".strip(),
            "working_directory": working_directory,
            "claim": claim,
            "evidence": skip_reason,
        })
        print(f"SKIP  {name} - {skip_reason}", flush=True)
        return

    started = time.monotonic()
    if not command:
        rows.append({
            "name": name,
            "area": area,
            "evidence_level": evidence_level,
            "real_tested": real_tested,
            "status": "failed",
            "exit_code": "missing-command",
            "duration_ms": 0,
            "command": "",
            "working_directory": working_directory,
            "claim": claim,
            "evidence": "Command path could not be resolved.",
        })
        print(f"FAIL  {name} - command path could not be resolved", flush=True)
        return

    env = dict(os.environ)
    env["AGENTHUB_EDGE_AUTH_TOKEN"] = ""
    print(f"RUN   {name}", flush=True)
    try:
        completed = subprocess.run(
            [command] + arguments,
            cwd=working_directory,
            env=env,
            capture_output=True,
            text=True,
            errors="replace",
            timeout=command_timeout_sec,
        )
    except subprocess.TimeoutExpired as timeout_error:
        try:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(timeout_error.pid)], check=False, capture_output=True)
        except OSError:
            pass
        stdout = timeout_error.stdout or ""
        stderr = timeout_error.stderr or ""
        rows.append({
            "name": name,
            "area": area,
            "evidence_level": evidence_level,
            "real_tested": real_tested,
            "status": "failed",
            "exit_code": "timeout",
            "duration_ms": int((time.monotonic() - started) * 1000),
            "command": f"{command} {' '.join(arguments)}",
            "working_directory": working_directory,
            "claim": claim,
            "evidence": shorten_text(f"Timed out after {command_timeout_sec} seconds.\n{stdout}\n{stderr}"),
        })
        print(f"FAIL  {name} - timeout", flush=True)
        return

    stdout = completed.stdout or ""
    stderr = completed.stderr or ""
    exit_code = completed.returncode
    if exit_code == 0:
        status = "passed"
    elif exit_code in blocked_exit_codes:
        status = "blocked_with_evidence"
    else:
        status = "failed"

    if status == "blocked_with_evidence" and blocked_reason:
        evidence_text = f"{blocked_reason}\n{stdout}\n{stderr}"
    else:
        evidence_text = f"{stdout}\n{stderr}"

    rows.append({
        "name": name,
        "area": area,
        "evidence_level": evidence_level,
        "real_tested": real_tested,
        "status": status,
        "exit_code": exit_code,
        "duration_ms": int((time.monotonic() - started) * 1000),
        "command": f"{command} {' '.join(arguments)}",
        "working_directory": working_directory,
        "claim": claim,
        "evidence": shorten_text(evidence_text),
    })

    if status == "passed":
        print(f"PASS  {name}", flush=True)
    elif status == "blocked_with_evidence":
        print(f"BLOCK {name}", flush=True)
    else:
        print(f"FAIL  {name}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="AgentHub E2E/smoke matrix runner（ps1 迁移）")
    add_ps_compat(parser, "--RepoRoot", default=".", help="repository root")
    add_ps_compat(parser, "--ArtifactRoot", default="", help="artifact root (defaults to .tmp under RepoRoot)")
    add_ps_compat(parser, "--OutputPath", default="", help="matrix manifest JSON output path")
    add_ps_compat(parser, "--CommandTimeoutSec", type=int, default=180, help="per-command timeout in seconds")
    add_ps_compat(parser, "--SkipWebE2E", action="store_true", help="skip web stubbed-hub playwright")
    add_ps_compat(parser, "--SkipDesktopE2E", action="store_true", help="skip desktop renderer playwright")
    add_ps_compat(parser, "--SkipLocalStack", action="store_true", help="skip localhost services smoke")
    add_ps_compat(parser, "--SkipEdgeClientSmoke", action="store_true", help="skip edge client smoke")
    add_ps_compat(parser, "--SkipLoginReadiness", action="store_true", help="skip login real-readiness gate")
    add_ps_compat(parser, "--SkipTauriDry", action="store_true", help="skip desktop tauri dry smoke")
    add_ps_compat(parser, "--RequireHub", action="store_true", help="fail when the hub service probe is missing")
    add_ps_compat(parser, "--RequireRealLogin", action="store_true", help="fail when real login is blocked")
    args = parser.parse_args()

    repo_root = os.path.abspath(args.RepoRoot)
    if not args.ArtifactRoot.strip():
        artifact_root = os.path.abspath(os.path.join(repo_root, ".tmp", "e2e-smoke-matrix", f"run-{os.getpid()}"))
    else:
        artifact_root = os.path.abspath(args.ArtifactRoot)
    if not args.OutputPath.strip():
        output_path = os.path.join(artifact_root, "e2e-smoke-matrix.json")
    else:
        output_path = os.path.abspath(args.OutputPath)

    started_at = now_iso()

    os.makedirs(artifact_root, exist_ok=True)
    if not test_path_under_root(output_path, artifact_root):
        print("FAIL: OutputPath must stay under ArtifactRoot", flush=True)
        return 1

    corepack_path = get_command_path("corepack.cmd")
    if not corepack_path:
        corepack_path = get_command_path("corepack")
    edge_client_smoke_addr = f"127.0.0.1:{get_free_port()}"

    if not corepack_path:
        invoke_matrix_command("web-stubbed-hub-playwright", "web", "corepack", [], repo_root, [], "", True, "corepack is unavailable", "stubbed-hub", False, "Web Hub-shaped replay boundary; not real login or model execution", args.CommandTimeoutSec)
        invoke_matrix_command("desktop-renderer-playwright", "desktop", "corepack", [], repo_root, [], "", True, "corepack is unavailable", "playwright-ui", False, "Desktop Vite renderer smoke; not packaged Tauri", args.CommandTimeoutSec)
    else:
        invoke_matrix_command(
            "web-stubbed-hub-playwright",
            "web",
            corepack_path,
            ["pnpm", "--dir", os.path.join(repo_root, "app", "web"), "run", "test:e2e:stubbed-hub"],
            os.path.join(repo_root, "app", "web"),
            [],
            "",
            args.SkipWebE2E,
            "skipped by -SkipWebE2E",
            "stubbed-hub",
            False,
            "Web Hub-shaped replay boundary; not real login or model execution",
            args.CommandTimeoutSec,
        )

        invoke_matrix_command(
            "desktop-renderer-playwright",
            "desktop",
            corepack_path,
            ["pnpm", "--dir", os.path.join(repo_root, "app", "desktop"), "run", "test:e2e:smoke"],
            os.path.join(repo_root, "app", "desktop"),
            [],
            "",
            args.SkipDesktopE2E,
            "skipped by -SkipDesktopE2E",
            "playwright-ui",
            False,
            "Desktop Vite renderer smoke; not packaged Tauri",
            args.CommandTimeoutSec,
        )

    invoke_matrix_command(
        "localhost-services-smoke",
        "services",
        sys.executable,
        [os.path.join(repo_root, "scripts", "smoke", "verify-localhost-real-stack-smoke.py"), "--RepoRoot", repo_root, "--ArtifactRoot", os.path.join(repo_root, ".tmp", "localhost-real-stack-smoke", f"e2e-matrix-{os.getpid()}"), "--ProbeHub"],
        repo_root,
        [],
        "",
        args.SkipLocalStack,
        "skipped by -SkipLocalStack",
        "observed-local",
        False,
        "Local service health/readiness; not cloud production or real login",
        args.CommandTimeoutSec,
    )

    invoke_matrix_command(
        "edge-client-smoke",
        "edge",
        sys.executable,
        [os.path.join(repo_root, "scripts", "smoke", "client-smoke.py"), "--EdgeAddr", edge_client_smoke_addr, "--EdgeAuthToken", "local-smoke-token", "--SkipGoTests", "--SkipCancel"],
        repo_root,
        [],
        "",
        args.SkipEdgeClientSmoke,
        "skipped by -SkipEdgeClientSmoke",
        "observed-local",
        False,
        "Local Edge API and event path smoke; not real model/API spend",
        args.CommandTimeoutSec,
    )

    invoke_matrix_command(
        "login-real-readiness-gate",
        "auth",
        sys.executable,
        [os.path.join(repo_root, "scripts", "verify", "verify-login-e2e-readiness.py"), "--RepoRoot", repo_root, "--OutputPath", os.path.join(artifact_root, "login-readiness.json")],
        repo_root,
        [2],
        "BLOCKED_WITH_EVIDENCE: real login/remote dispatch needs explicit approved test account, callback, Hub URL, artifact boundary, and operator approval metadata.",
        args.SkipLoginReadiness,
        "skipped by -SkipLoginReadiness",
        "approved-real",
        False,
        "Readiness gate only unless approved-real login metadata is present",
        args.CommandTimeoutSec,
    )

    invoke_matrix_command(
        "desktop-tauri-dry-smoke",
        "tauri",
        sys.executable,
        [os.path.join(repo_root, "scripts", "release", "verify-tauri-package-dry.py"), "-RepoRoot", repo_root, "-ArtifactsRoot", os.path.join(artifact_root, "tauri-dry"), "-SkipInstall", "-SkipExecutableCompile"],
        repo_root,
        [],
        "",
        args.SkipTauriDry,
        "skipped by -SkipTauriDry",
        "packaged-release",
        False,
        "Tauri packaging policy/dry gate; not installer/signing/release upload",
        args.CommandTimeoutSec,
    )

    failed = [row for row in rows if row["status"] == "failed"]
    blocked = [row for row in rows if row["status"] == "blocked_with_evidence"]
    if args.RequireHub:
        local_stack_row = next((row for row in rows if row["name"] == "localhost-services-smoke"), None)
        if local_stack_row and re.search(r'"name"\s*:\s*"hub"[^}]*"status"\s*:\s*"missing"', local_stack_row["evidence"]):
            failed.append({"name": "hub-required", "status": "failed"})
    if args.RequireRealLogin and len(blocked) > 0:
        failed.append({"name": "real-login-required", "status": "failed"})

    if len(failed) > 0:
        overall = "failed"
    elif len(blocked) > 0:
        overall = "passed_with_blockers"
    else:
        overall = "passed"

    planned_evidence_levels = sorted({row["evidence_level"] for row in rows})
    executed_rows = [row for row in rows if row["status"] != "skipped"]
    executed_evidence_levels = sorted({row["evidence_level"] for row in executed_rows})
    skipped_evidence_levels = sorted({row["evidence_level"] for row in rows if row["status"] == "skipped"})
    real_tested = any(row["real_tested"] for row in executed_rows)

    manifest = {
        "schema": "agenthub-e2e-smoke-matrix-v1",
        "status": overall,
        "real_tested": real_tested,
        "evidence_levels": executed_evidence_levels,
        "planned_evidence_levels": planned_evidence_levels,
        "skipped_evidence_levels": skipped_evidence_levels,
        "generated_at": now_iso(),
        "started_at": started_at,
        "repo_root": repo_root,
        "artifact_root": artifact_root,
        "rows": rows,
        "blocked_count": len(blocked),
        "failed_count": len(failed),
        "boundaries": {
            "secrets_handled": False,
            "real_tokendance_id_login_executed": False,
            "real_cli_or_model_execution_required": False,
            "web_direct_local_edge_allowed": False,
            "hub_probe_only_without_db_redis": True,
        },
    }

    with open(output_path, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")))

    print(f"Matrix: {overall}", flush=True)
    print(f"EvidencePath: {output_path}", flush=True)
    print(f"BlockedWithEvidence: {len(blocked)}", flush=True)
    print(f"Failed: {len(failed)}", flush=True)

    if len(failed) > 0:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
