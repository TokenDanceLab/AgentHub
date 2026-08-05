#!/usr/bin/env python3
"""AgentHub localhost real stack smoke（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

启动或探测 observed product loop 的安全本地服务子集：Web dev server、
Desktop/Tauri renderer bridge、Hub health、Local Edge。唯一恒尝试启动的
服务是 Local Edge（内置 mock runner + 临时 SQLite store）；Web/Desktop 仅在
app workspace 依赖已就绪时启动；Hub 只探测（当前 server 入口依赖外部
database 与 Redis）。

RealTested 保持 false。不执行 TokenDanceID 登录、真实 CLI/model/API 执行、
部署、签名、打包或 Mobile 工作。

迁移差异（双跑对照记录）：失败探测行的底层错误文案随运行时环境变化
（.NET 与 urllib 文案不同），对照时按错误文本归一化；harness 启动进程的
清理用 taskkill /T /F 对齐 Stop-Process 的进程树终止语义；CLI 参数、
退出码（0=通过 / 1=失败 / 2=参数非法）与 PASS/FAIL/WARN 行前缀格式
与原 ps1 一致。

用法：
  python scripts/smoke/verify-localhost-real-stack-smoke.py
  python scripts/smoke/verify-localhost-real-stack-smoke.py -SkipWeb -SkipDesktop -SkipEdge
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

failures = []
warnings = []
services = []
started_processes = []
started_at = ""
cleanup_status = "not_started"
real_cli_or_model_invoked = False


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


def add_failure(text):
    failures.append(text)
    print(f"FAIL: {text}", flush=True)


def add_warning(text):
    warnings.append(text)
    print(f"WARN: {text}", flush=True)


def pass_check(text):
    print(f"PASS: {text}", flush=True)


def redact_secret_like(value):
    if not value:
        return value
    safe = value
    safe = re.sub(r'(?i)(Authorization:\s*Bearer\s+)[^"\'\s,}]+', r"\1<redacted-token>", safe)
    safe = re.sub(r'(?i)(bearer\s+)[a-z0-9._-]{12,}', r"\1<redacted-token>", safe)
    safe = re.sub(r'(?i)(sk|ghp|gho|ghu|ghs|glpat|xox[baprs])-[-_A-Za-z0-9]{8,}', "<redacted-token>", safe)
    safe = re.sub(r'(?i)((?:access[_-]?token|refresh[_-]?token|id[_-]?token|client_secret|password)\s*[=:]\s*)[^"\'\s,}]+', r"\1<redacted-secret>", safe)
    safe = re.sub(r'(?i)("?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client_secret|password)"?\s*:\s*")[^"]+', r"\1<redacted-secret>", safe)
    return safe


def test_path_under_root(path, root):
    normalized = os.path.normpath(os.path.abspath(path)).rstrip("\\/")
    normalized_root = os.path.normpath(os.path.abspath(root)).rstrip("\\/")
    if normalized.lower() == normalized_root.lower():
        return True
    prefix = normalized_root + os.sep
    return normalized.lower().startswith(prefix.lower())


def test_allowed_artifact_root(path, repo_root):
    candidate = os.path.abspath(path)
    temp_base = os.environ.get("TEMP") or tempfile.gettempdir()
    allowed_roots = [
        os.path.join(repo_root, ".tmp", "localhost-real-stack-smoke"),
        os.path.join(repo_root, "tmp", "localhost-real-stack-smoke"),
        os.path.join(temp_base, "AgentHub", "localhost-real-stack-smoke"),
    ]
    for root in allowed_roots:
        if test_path_under_root(candidate, root):
            return True
    return False


def test_loopback_http_url(url):
    try:
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != "http":
            return False
        host = (parsed.hostname or "").lower()
        return host in ("127.0.0.1", "localhost", "::1")
    except ValueError:
        return False


def join_url_path(base_url, path):
    if not path:
        return base_url
    if path.startswith("/"):
        return base_url.rstrip("/") + path
    return base_url.rstrip("/") + "/" + path


def get_url_port(url):
    try:
        parsed = urllib.parse.urlsplit(url)
        if parsed.port is not None:
            return parsed.port
        return 443 if parsed.scheme == "https" else 80
    except ValueError:
        return None


def add_service(service):
    services.append(dict(service))


def invoke_health_probe(name, base_url, health_path, expected_pattern="", timeout=60):
    health_url = join_url_path(base_url, health_path)
    deadline = time.monotonic() + timeout
    last_error = ""
    while True:
        try:
            with urllib.request.urlopen(health_url, timeout=2) as response:
                body = response.read().decode("utf-8", errors="replace")
                matched = re.search(expected_pattern, body, re.IGNORECASE) is not None if expected_pattern else True
                return {
                    "name": name,
                    "url": base_url,
                    "health_url": health_url,
                    "status_code": response.status,
                    "status": "healthy" if matched else "wrong_marker",
                    "expected_pattern": expected_pattern,
                    "marker_matched": matched,
                    "body_excerpt": redact_secret_like(body[:240]),
                }
        except (urllib.error.URLError, OSError, ValueError) as error:
            last_error = str(error)
            if time.monotonic() >= deadline:
                break
            time.sleep(0.35)
    return {
        "name": name,
        "url": base_url,
        "health_url": health_url,
        "status_code": None,
        "status": "missing",
        "error": redact_secret_like(last_error),
    }


def start_managed_process(name, file_name, arguments, working_directory):
    env = dict(os.environ)
    env["BROWSER"] = "none"
    env["AGENTHUB_LOCALHOST_SMOKE"] = "1"
    process = subprocess.Popen(arguments, executable=file_name, cwd=working_directory, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    started_processes.append({
        "name": name,
        "process": process,
        "file_name": file_name,
        "arguments": arguments,
        "working_directory": working_directory,
    })
    return process


def test_app_dependencies(repo_root):
    vite_cmd = os.path.join(repo_root, "app", "node_modules", ".bin", "vite.cmd")
    vite_ps1 = os.path.join(repo_root, "app", "node_modules", ".bin", "vite.ps1")
    return os.path.isfile(vite_cmd) or os.path.isfile(vite_ps1)


def start_vite_service(name, app_dir, base_url, health_path, expected_pattern, timeout_sec):
    pre = invoke_health_probe(name, base_url, health_path, expected_pattern, 2)
    if pre["status"] == "healthy":
        pre["started_by_harness"] = False
        pre["start_mode"] = "preexisting"
        add_service(pre)
        pass_check(f"{name} already healthy")
        return

    if not test_app_dependencies(repo_root):
        add_service({
            "name": name,
            "url": base_url,
            "health_url": join_url_path(base_url, health_path),
            "status": "blocked",
            "started_by_harness": False,
            "blocker": "app workspace dependencies missing; run cd app; corepack.cmd pnpm install --frozen-lockfile",
        })
        add_warning(f"{name} not started because app dependencies are missing")
        return

    corepack = shutil.which("corepack.cmd")
    if not corepack:
        add_service({
            "name": name,
            "url": base_url,
            "health_url": join_url_path(base_url, health_path),
            "status": "blocked",
            "started_by_harness": False,
            "blocker": "corepack.cmd is unavailable",
        })
        add_warning(f"{name} not started because corepack.cmd is unavailable")
        return

    port = get_url_port(base_url)
    start_managed_process(name, corepack, ["pnpm", "--dir", app_dir, "exec", "vite", "--host", "127.0.0.1", "--port", str(port), "--strictPort"], app_dir)
    probe = invoke_health_probe(name, base_url, health_path, expected_pattern, timeout_sec)
    probe["started_by_harness"] = True
    probe["start_mode"] = "vite"
    add_service(probe)
    if probe["status"] == "healthy":
        pass_check(f"{name} started and probed")
    else:
        add_failure(f"{name} failed to become healthy")


def start_edge_service(local_edge_url, edge_health_path, edge_db_path, repo_root, timeout_sec):
    name = "local-edge"
    pre = invoke_health_probe(name, local_edge_url, edge_health_path, r'"version"\s*:\s*"v1"', 2)
    if pre["status"] == "healthy":
        pre["started_by_harness"] = False
        pre["start_mode"] = "preexisting"
        add_service(pre)
        pass_check("Local Edge already healthy")
        return

    go = shutil.which("go")
    if not go:
        add_service({
            "name": name,
            "url": local_edge_url,
            "health_url": join_url_path(local_edge_url, edge_health_path),
            "status": "blocked",
            "started_by_harness": False,
            "blocker": "go executable is unavailable",
        })
        add_failure("Local Edge cannot start because go is unavailable")
        return

    os.makedirs(os.path.dirname(edge_db_path), exist_ok=True)
    port = get_url_port(local_edge_url)
    addr = f"127.0.0.1:{port}"
    start_managed_process(name, go, [
        "run",
        ".\\cmd\\agenthub-edge",
        "--addr", addr,
        "--store-backend", "sqlite",
        "--store-db", edge_db_path,
        "--runner-profile", "agenthub-runner-mock",
    ], os.path.join(repo_root, "edge-server"))

    probe = invoke_health_probe(name, local_edge_url, edge_health_path, r'"version"\s*:\s*"v1"', timeout_sec)
    probe["started_by_harness"] = True
    probe["start_mode"] = "go-run"
    probe["store_backend"] = "sqlite"
    probe["runner_profile"] = "agenthub-runner-mock"
    add_service(probe)
    if probe["status"] == "healthy":
        pass_check("Local Edge mock+SQLite started and probed")
    else:
        add_failure("Local Edge failed to become healthy")


def write_evidence(evidence_path, repo_root, artifact_root, log_root, edge_db_path, args):
    started = []
    for entry in started_processes:
        process = entry["process"]
        started.append({
            "name": entry["name"],
            "pid": process.pid,
            "file_name": os.path.basename(entry["file_name"]),
            "working_directory": entry["working_directory"],
            "started": process.poll() is None,
        })

    has_healthy_edge = any(service.get("name") == "local-edge" and service.get("status") == "healthy" for service in services)
    status = "LOCAL_STACK_SMOKE_PARTIAL_PASSED" if len(failures) == 0 and has_healthy_edge else "LOCAL_STACK_SMOKE_FAILED"

    evidence = {
        "schema": "agenthub-localhost-real-stack-smoke-v1",
        "status": status,
        "generated_at": now_iso(),
        "started_at": started_at,
        "real_tested": False,
        "readiness_only": True,
        "repo_root": repo_root,
        "artifact_root": artifact_root,
        "evidence_path": evidence_path,
        "claims": {
            "real_tokendance_id_login": False,
            "real_cli_or_model_invoked": real_cli_or_model_invoked,
            "real_api_budget_spend": False,
            "public_deploy_used": False,
            "signing_or_release_used": False,
            "mobile_touched": False,
        },
        "topology": {
            "web": {"url": args.WebUrl, "mode": "skipped" if args.SkipWeb else "start_or_probe", "allowed_upstream": "hub"},
            "hub": {"url": args.HubUrl, "mode": "probe_only" if args.ProbeHub else "not_requested", "start_blocker": "server-hub requires external database and Redis services"},
            "desktop_bridge": {"url": args.DesktopBridgeUrl, "mode": "skipped" if args.SkipDesktop else "start_or_probe", "allowed_upstream": "local-edge"},
            "local_edge": {"url": args.LocalEdgeUrl, "mode": "skipped" if args.SkipEdge else "mock_sqlite_start_or_probe"},
        },
        "local_edge": {
            "url": args.LocalEdgeUrl,
            "runner_profile": "agenthub-runner-mock",
            "store_backend": "sqlite",
            "store_db": edge_db_path,
            "real_cli_or_model_invoked": False,
        },
        "services": services,
        "started_processes": started,
        "cleanup": {
            "keep_services": bool(args.KeepServices),
            "status": cleanup_status,
            "strategy": "caller keeps harness-started services and must stop them manually" if args.KeepServices else "harness stops started processes before exit",
        },
        "logs": {"root": log_root},
        "failures": failures,
        "warnings": warnings,
        "blockers": [
            "Hub real startup still requires local database and Redis setup; this script probes Hub only",
            "Web/Desktop Vite startup requires app workspace dependencies to be installed",
            "Real CLI/model/API execution remains blocked by no-spend boundary",
            "Real TokenDanceID login, deploy, signing, release upload, and Mobile remain out of scope",
        ],
    }

    directory = os.path.dirname(evidence_path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    payload = redact_secret_like(json.dumps(evidence, ensure_ascii=False, separators=(",", ":")))
    with open(evidence_path, "w", encoding="utf-8") as handle:
        handle.write(payload)
    return status


def stop_started_processes(keep_services):
    global cleanup_status
    if keep_services:
        cleanup_status = "kept_running"
        return
    for entry in started_processes:
        process = entry["process"]
        if process.poll() is not None:
            continue
        try:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(process.pid)], check=False, capture_output=True)
        except OSError:
            process.kill()
    cleanup_status = "stopped_harness_processes"


def main() -> int:
    parser = argparse.ArgumentParser(description="AgentHub localhost real stack smoke（ps1 迁移）")
    add_ps_compat(parser, "--RepoRoot", default=".", help="repository root")
    add_ps_compat(parser, "--ArtifactRoot", default="", help="artifact root (defaults to .tmp under RepoRoot)")
    add_ps_compat(parser, "--EvidencePath", default="", help="evidence JSON output path")
    add_ps_compat(parser, "--TimeoutSec", type=int, default=60, help="probe deadline in seconds")
    add_ps_compat(parser, "--SkipWeb", action="store_true", help="skip web start/probe")
    add_ps_compat(parser, "--SkipDesktop", action="store_true", help="skip desktop bridge start/probe")
    add_ps_compat(parser, "--SkipEdge", action="store_true", help="skip local edge start/probe")
    add_ps_compat(parser, "--ProbeHub", action="store_true", help="probe hub health only")
    add_ps_compat(parser, "--RequireWeb", action="store_true", help="fail when web is not healthy")
    add_ps_compat(parser, "--RequireDesktop", action="store_true", help="fail when desktop bridge is not healthy")
    add_ps_compat(parser, "--RequireHub", action="store_true", help="fail when hub probe is not healthy")
    add_ps_compat(parser, "--KeepServices", action="store_true", help="keep harness-started services running")
    add_ps_compat(parser, "--WebUrl", default="http://127.0.0.1:5174", help="web base URL")
    add_ps_compat(parser, "--DesktopBridgeUrl", default="http://127.0.0.1:5173", help="desktop bridge base URL")
    add_ps_compat(parser, "--HubUrl", default="http://127.0.0.1:8080", help="hub base URL")
    add_ps_compat(parser, "--LocalEdgeUrl", default="http://127.0.0.1:3210", help="local edge base URL")
    add_ps_compat(parser, "--WebHealthPath", default="/", help="web health path")
    add_ps_compat(parser, "--DesktopHealthPath", default="/", help="desktop health path")
    add_ps_compat(parser, "--HubHealthPath", default="/health/live", help="hub health path")
    add_ps_compat(parser, "--EdgeHealthPath", default="/v1/health", help="local edge health path")
    args = parser.parse_args()

    if args.TimeoutSec <= 0:
        print("FAIL: -TimeoutSec must be greater than zero.", flush=True)
        return 2

    repo_root = os.path.abspath(args.RepoRoot)
    if not args.ArtifactRoot.strip():
        artifact_root = os.path.join(repo_root, ".tmp", "localhost-real-stack-smoke", f"run-{os.getpid()}")
    else:
        artifact_root = os.path.abspath(args.ArtifactRoot) if os.path.isabs(args.ArtifactRoot) else os.path.abspath(os.path.join(repo_root, args.ArtifactRoot))
    if not args.EvidencePath.strip():
        evidence_path = os.path.join(artifact_root, "localhost-real-stack-smoke.json")
    else:
        evidence_path = os.path.abspath(args.EvidencePath) if os.path.isabs(args.EvidencePath) else os.path.abspath(os.path.join(repo_root, args.EvidencePath))

    global started_at
    started_at = now_iso()
    log_root = os.path.join(artifact_root, "logs")
    edge_db_path = os.path.join(artifact_root, "edge", "agenthub-edge.sqlite")

    print("AgentHub localhost real stack smoke", flush=True)
    print("Boundary: RealTested=false, RealCli=false, no API/model spend, no deploy/signing/release, no Mobile.", flush=True)

    if not test_allowed_artifact_root(artifact_root, repo_root):
        add_failure("ArtifactRoot must stay under .tmp\\localhost-real-stack-smoke, tmp\\localhost-real-stack-smoke, or $env:TEMP\\AgentHub\\localhost-real-stack-smoke")
    if not test_path_under_root(evidence_path, artifact_root):
        add_failure("EvidencePath must stay under ArtifactRoot")
    for pair in [
        ("WebUrl", args.WebUrl),
        ("DesktopBridgeUrl", args.DesktopBridgeUrl),
        ("HubUrl", args.HubUrl),
        ("LocalEdgeUrl", args.LocalEdgeUrl),
    ]:
        if not test_loopback_http_url(pair[1]):
            add_failure(f"{pair[0]} must be loopback HTTP")

    os.makedirs(artifact_root, exist_ok=True)
    os.makedirs(log_root, exist_ok=True)

    try:
        if len(failures) == 0:
            if args.SkipWeb:
                add_service({"name": "web", "url": args.WebUrl, "health_url": join_url_path(args.WebUrl, args.WebHealthPath), "status": "skipped", "started_by_harness": False})
            else:
                start_vite_service("web", os.path.join(repo_root, "app", "web"), args.WebUrl, args.WebHealthPath, r'<div id="root"|AgentHub|agenthub', args.TimeoutSec)

            if args.ProbeHub:
                hub = invoke_health_probe("hub", args.HubUrl, args.HubHealthPath, r'"status"\s*:\s*"ok"|healthy|live', args.TimeoutSec)
                hub["started_by_harness"] = False
                hub["start_mode"] = "probe_only"
                add_service(hub)
                if hub["status"] == "healthy":
                    pass_check("Hub probe is healthy")
                elif args.RequireHub:
                    add_failure("Hub probe failed and -RequireHub was set")
                else:
                    add_warning("Hub probe did not pass; recorded as blocker")
            else:
                add_service({"name": "hub", "url": args.HubUrl, "health_url": join_url_path(args.HubUrl, args.HubHealthPath), "status": "not_requested", "started_by_harness": False, "blocker": "probe not requested"})

            if args.SkipDesktop:
                add_service({"name": "desktop", "url": args.DesktopBridgeUrl, "health_url": join_url_path(args.DesktopBridgeUrl, args.DesktopHealthPath), "status": "skipped", "started_by_harness": False})
            else:
                start_vite_service("desktop", os.path.join(repo_root, "app", "desktop"), args.DesktopBridgeUrl, args.DesktopHealthPath, r'<div id="root"|AgentHub|agenthub', args.TimeoutSec)

            if args.SkipEdge:
                add_service({"name": "local-edge", "url": args.LocalEdgeUrl, "health_url": join_url_path(args.LocalEdgeUrl, args.EdgeHealthPath), "status": "skipped", "started_by_harness": False})
            else:
                start_edge_service(args.LocalEdgeUrl, args.EdgeHealthPath, edge_db_path, repo_root, args.TimeoutSec)

            if args.RequireWeb and not any(service.get("name") == "web" and service.get("status") == "healthy" for service in services):
                add_failure("Web was required but is not healthy")
            if args.RequireDesktop and not any(service.get("name") == "desktop" and service.get("status") == "healthy" for service in services):
                add_failure("Desktop was required but is not healthy")
    finally:
        stop_started_processes(args.KeepServices)
        status = write_evidence(evidence_path, repo_root, artifact_root, log_root, edge_db_path, args)

    print(f"EvidencePath: {evidence_path}", flush=True)
    print("RealTested=false", flush=True)
    print("RealCli=false", flush=True)

    if status == "LOCAL_STACK_SMOKE_PARTIAL_PASSED":
        print("Status: LOCAL_STACK_SMOKE_PARTIAL_PASSED", flush=True)
        return 0

    print("Status: LOCAL_STACK_SMOKE_FAILED", flush=True)
    return 1


if __name__ == "__main__":
    sys.exit(main())
