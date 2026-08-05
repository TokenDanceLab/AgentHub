#!/usr/bin/env python3
"""verify-localhost-observed-loop — AgentHub localhost observed loop gate.

ps1 迁移（契约见 server docs/design/ps1-to-python-migration.md）：stdlib only、
CLI 参数/退出码兼容（0=通过/1=失败/2=非法参数）、机器可读行（`FAIL:`/`WARN:`/
`PASS:`/`Status:`/`ManifestPath:` 等）与原 ps1 一致；生成的 JSON manifest 用
ConvertTo-Json 等价格式（2-space indent）。

本脚本是 localhost 产品环路的 no-spend 胶水：Web 5174 -> Hub 8080 -> Desktop/
Tauri evidence bridge 5173 -> Local Edge 3210 -> fixture adapter -> Hub replay
-> Web transcript/approval/artifact render。默认只写 readiness manifest，不执行
真实登录、真实 CLI/model/API 调用、部署、签名、发布上传或 Mobile 工作。
"""

import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.parse

SECRET_LIKE_PATTERN = re.compile(
    r"(?i)(Authorization:\s*Bearer\s+[^\"'\s,}]+|"
    r"bearer\s+[a-z0-9._-]{12,}|"
    r"(?:sk|ghp|gho|ghu|ghs|glpat|xox[baprs])-[-_A-Za-z0-9]{8,}|"
    r"access[_-]?token\s*[=:]|"
    r"refresh[_-]?token\s*[=:]|"
    r"id[_-]?token\s*[=:]|"
    r"client_secret\s*[=:]|"
    r"password\s*[=:])"
)

failures = []
warnings = []
generated_at = None


def normalize_stdout_lf() -> None:
    """Disable newline translation so redirected output is byte-identical to pwsh."""
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace", newline="", line_buffering=True)
        sys.stderr.reconfigure(encoding="utf-8", errors="replace", newline="", line_buffering=True)
    except (AttributeError, ValueError):
        pass


def emit(text: str) -> None:
    sys.stdout.write(text + "\r\n")
    sys.stdout.flush()


def add_failure(text: str) -> None:
    failures.append(text)
    emit(f"FAIL: {text}")


def add_warning(text: str) -> None:
    warnings.append(text)
    emit(f"WARN: {text}")


def pass_check(text: str) -> None:
    emit(f"PASS: {text}")


def redact_secret_like(value: str) -> str:
    if not value:
        return value
    safe = value
    safe = re.sub(r"(?i)(Authorization:\s*Bearer\s+)[^\"'\s,}]+", r"\1<redacted-token>", safe)
    safe = re.sub(r"(?i)(bearer\s+)[a-z0-9._-]{12,}", r"\1<redacted-token>", safe)
    safe = re.sub(r"(?i)(sk|ghp|gho|ghu|ghs|glpat|xox[baprs])-[-_A-Za-z0-9]{8,}", "<redacted-token>", safe)
    safe = re.sub(r"(?i)((?:access[_-]?token|refresh[_-]?token|id[_-]?token|client_secret|password)\s*[=:]\s*)[^\"'\s,}]+", r"\1<redacted-secret>", safe)
    safe = re.sub(r'(?i)("?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client_secret|password)"?\s*:\s*")[^"]+', r"\1<redacted-secret>", safe)
    return safe


def test_secret_like(value: str) -> bool:
    if not value or not value.strip():
        return False
    return bool(SECRET_LIKE_PATTERN.search(value))


def get_full_path(path: str, repo_root: str) -> str:
    if os.path.isabs(path):
        return os.path.abspath(path)
    return os.path.abspath(os.path.join(repo_root, path))


def test_path_under_root(path: str, root: str) -> bool:
    normalized = os.path.abspath(path).rstrip("\\/")
    normalized_root = os.path.abspath(root).rstrip("\\/")
    if normalized.lower() == normalized_root.lower():
        return True
    return normalized.lower().startswith(normalized_root.lower() + os.sep)


def test_allowed_artifact_root(path: str, repo_root: str, env_temp: str) -> bool:
    if not path or not path.strip():
        return False
    candidate = get_full_path(path, repo_root)
    temp_base = env_temp or os.environ.get("TMP") or ""
    allowed_roots = [
        os.path.join(repo_root, ".tmp", "localhost-observed-loop"),
        os.path.join(repo_root, "tmp", "localhost-observed-loop"),
        os.path.join(temp_base, "AgentHub", "localhost-observed-loop") if temp_base else "",
    ]
    for root in allowed_roots:
        if root and test_path_under_root(candidate, root):
            return True
    return False


def test_allowed_manifest_path(path: str, repo_root: str, env_temp: str, artifact_root: str) -> bool:
    if not path or not path.strip():
        return False
    candidate = get_full_path(path, repo_root)
    if test_allowed_artifact_root(candidate, repo_root, env_temp):
        return True
    if test_allowed_artifact_root(artifact_root, repo_root, env_temp) and test_path_under_root(candidate, artifact_root):
        return True
    return False


def test_loopback_http_url(url: str) -> bool:
    try:
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != "http":
            return False
        return parsed.hostname.lower() in ("127.0.0.1", "localhost", "::1", "[::1]")
    except Exception:  # noqa: BLE001
        return False


def get_origin(url: str) -> str:
    try:
        parsed = urllib.parse.urlsplit(url)
        port = parsed.port if parsed.port else (443 if parsed.scheme == "https" else 80)
        return f"{parsed.scheme.lower()}://{parsed.hostname.lower()}:{port}"
    except Exception:  # noqa: BLE001
        return ""


def get_url_port(url: str) -> int | None:
    try:
        return urllib.parse.urlsplit(url).port
    except Exception:  # noqa: BLE001
        return None


def find_powershell() -> str | None:
    return shutil.which("pwsh") or shutil.which("powershell")


def invoke_captured_process(file_name: str, arguments: list, working_directory: str) -> dict:
    try:
        run = subprocess.run([file_name, *arguments], cwd=working_directory, capture_output=True)
        output = (run.stdout + b"\n" + run.stderr).decode("utf-8", errors="replace")
        return {"ExitCode": run.returncode, "Output": redact_secret_like(output)}
    except Exception as exc:  # noqa: BLE001 —— 对齐 ps1 try/catch 返回 ExitCode=-1
        return {"ExitCode": -1, "Output": redact_secret_like(str(exc))}


def invoke_repo_script(repo_root: str, relative_path: str, arguments: list) -> dict:
    script_path = os.path.join(repo_root, relative_path)
    if not os.path.isfile(script_path):
        return {"ExitCode": -1, "Output": f"missing {relative_path}"}
    if script_path.endswith(".py"):
        python_exe = shutil.which("python") or shutil.which("python3")
        if not python_exe:
            return {"ExitCode": -1, "Output": "Python executable is unavailable"}
        return invoke_captured_process(python_exe, [script_path, *arguments], repo_root)
    powershell_exe = find_powershell()
    if not powershell_exe:
        return {"ExitCode": -1, "Output": "PowerShell executable is unavailable"}
    return invoke_captured_process(
        powershell_exe, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script_path, *arguments], repo_root
    )


def assert_static_boundary(artifact_root: str, manifest_path: str, observed_dispatch_report_path: str, repo_root: str, env_temp: str) -> None:
    if not test_allowed_artifact_root(artifact_root, repo_root, env_temp):
        add_failure("artifact root must stay under .tmp\\localhost-observed-loop, tmp\\localhost-observed-loop, or $env:TEMP\\AgentHub\\localhost-observed-loop")
    if not test_allowed_manifest_path(manifest_path, repo_root, env_temp, artifact_root):
        add_failure("ManifestPath must stay under the artifact root or allowed localhost-observed-loop temp roots")
    if not test_allowed_manifest_path(observed_dispatch_report_path, repo_root, env_temp, artifact_root):
        add_failure("ObservedDispatchReportPath must stay under the artifact root or allowed localhost-observed-loop temp roots")


def get_supplied_environment_name_list(supplied_environment_names: list, required_environment_names: list, use_environment: bool) -> list:
    available = []
    for raw_name in supplied_environment_names:
        for name in raw_name.split(","):
            trimmed = name.strip()
            if trimmed:
                available.append(trimmed)
    if use_environment:
        for name in required_environment_names:
            if os.environ.get(name):
                available.append(name)
    return list(dict.fromkeys(available))


def initialize_artifact_root(artifact_root: str, clean_artifact_root: bool, startup_log: str, cleanup_log: str, allowed: bool) -> None:
    if not allowed:
        return
    if clean_artifact_root and os.path.exists(artifact_root):
        shutil.rmtree(artifact_root, ignore_errors=True)
    os.makedirs(os.path.dirname(startup_log), exist_ok=True)
    with open(startup_log, "w", encoding="utf-8") as handle:
        handle.write(f"started={datetime.datetime.now().astimezone().isoformat()}")
    with open(cleanup_log, "w", encoding="utf-8") as handle:
        handle.write(f"clean_artifact_root={str(bool(clean_artifact_root)).lower()}")


def write_json_file(value, path: str) -> None:
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    json_text = json.dumps(value, ensure_ascii=False, indent=2)
    json_text = redact_secret_like(json_text)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(json_text)


def write_service_artifacts(
    status: str,
    services: list,
    started_by_harness: bool,
    source_evidence_path: str,
    repo_root: str,
    artifact_root: str,
    probe_services: bool,
    start_services: bool,
    start_service_plan_path: str,
    web_health_path: str,
    hub_health_path: str,
    desktop_health_path: str,
    edge_health_path: str,
    expected_web_marker: str,
    expected_hub_marker: str,
    expected_desktop_marker: str,
    expected_edge_marker: str,
    service_probe_manifest_path: str,
    health_manifest_path: str,
    pid_manifest_path: str,
    cleanup_log: str,
) -> None:
    service_manifest = {
        "schema": "agenthub-localhost-observed-loop-service-probe-v1",
        "status": status,
        "real_tested": False,
        "generated_at": generated_at.isoformat(),
        "repo_root": repo_root,
        "artifact_root": artifact_root,
        "source_evidence": source_evidence_path,
        "probe_services": bool(probe_services),
        "start_services": bool(start_services),
        "start_plan_path": start_service_plan_path,
        "started_by_harness": started_by_harness,
        "no_real_tokendance_id_login": True,
        "no_real_cli_or_model_spend": None if start_services else True,
        "cli_or_model_spend_claim": "operator_attested_start_plan_not_verified_by_harness" if start_services else "not_started_by_harness",
        "no_real_api_budget_spend_by_this_runner": True,
        "health_paths": {"web": web_health_path, "hub": hub_health_path, "desktop_bridge": desktop_health_path, "local_edge": edge_health_path},
        "expected_markers": {
            "web": expected_web_marker,
            "hub": expected_hub_marker,
            "desktop_bridge": expected_desktop_marker,
            "local_edge": expected_edge_marker,
        },
        "services": list(services),
    }

    health_manifest = {
        "schema": "agenthub-localhost-observed-loop-health-v1",
        "status": status,
        "real_tested": False,
        "generated_at": generated_at.isoformat(),
        "services": list(services),
    }

    pid_manifest = {
        "schema": "agenthub-localhost-observed-loop-pids-v1",
        "status": status,
        "real_tested": False,
        "generated_at": generated_at.isoformat(),
        "started_by_harness": started_by_harness,
        "start_services": bool(start_services),
        "start_plan_path": start_service_plan_path,
        "started_processes": [],
        "cleanup": {
            "strategy": "If StartServices is used, delegated verifier stops harness-started processes; otherwise remove the safe artifact root with Remove-Item after review.",
            "cleanup_log": cleanup_log,
        },
    }

    write_json_file(service_manifest, service_probe_manifest_path)
    write_json_file(health_manifest, health_manifest_path)
    write_json_file(pid_manifest, pid_manifest_path)


def invoke_service_readiness(ctx: dict) -> None:
    if not (ctx["probe_services"] or ctx["start_services"]):
        write_service_artifacts(
            "NOT_REQUESTED", [], False, "", ctx["repo_root"], ctx["artifact_root"], ctx["probe_services"], ctx["start_services"],
            ctx["start_service_plan_path"], ctx["web_health_path"], ctx["hub_health_path"], ctx["desktop_health_path"], ctx["edge_health_path"],
            ctx["expected_web_marker"], ctx["expected_hub_marker"], ctx["expected_desktop_marker"], ctx["expected_edge_marker"],
            ctx["service_probe_manifest_path"], ctx["health_manifest_path"], ctx["pid_manifest_path"], ctx["cleanup_log"],
        )
        return

    service_args = [
        "-RepoRoot", ctx["repo_root"],
        "-EvidencePath", ctx["service_probe_manifest_path"],
        "-RealServices",
        "-WebUrl", ctx["web_url"],
        "-HubUrl", ctx["hub_url"],
        "-DesktopBridgeUrl", ctx["desktop_bridge_url"],
        "-LocalEdgeUrl", ctx["local_edge_url"],
        "-WebHealthPath", ctx["web_health_path"],
        "-HubHealthPath", ctx["hub_health_path"],
        "-DesktopHealthPath", ctx["desktop_health_path"],
        "-EdgeHealthPath", ctx["edge_health_path"],
        "-ExpectedWebMarker", ctx["expected_web_marker"],
        "-ExpectedHubMarker", ctx["expected_hub_marker"],
        "-ExpectedDesktopMarker", ctx["expected_desktop_marker"],
        "-ExpectedEdgeMarker", ctx["expected_edge_marker"],
        "-RegisteredTargetUrl", ctx["registered_target_url"],
        "-HubDispatchTargetUrl", ctx["hub_dispatch_target_url"],
        "-TimeoutSec", str(ctx["timeout_sec"]),
    ]
    if ctx["start_services"]:
        service_args += ["-StartServices", "-StartServicePlanPath", ctx["start_service_plan_path"]]

    services_run = invoke_repo_script(ctx["repo_root"], "scripts\\smoke\\verify-localhost-real-services.py", service_args)
    ctx["service_probe_exit_code"] = services_run["ExitCode"]
    ctx["service_probe_output"] = services_run["Output"]
    emit(services_run["Output"])

    services = []
    started_by_harness = False
    if os.path.isfile(ctx["service_probe_manifest_path"]):
        try:
            with open(ctx["service_probe_manifest_path"], "r", encoding="utf-8") as handle:
                service_evidence = json.load(handle)
            services = list(service_evidence.get("services") or [])
            started_by_harness = service_evidence.get("started_by_harness") is True
            ctx["service_probe_status"] = str(service_evidence.get("status"))
        except Exception:  # noqa: BLE001 —— 对齐 ps1 catch 语义
            ctx["service_probe_status"] = "UNREADABLE_SERVICE_MANIFEST"
    else:
        ctx["service_probe_status"] = "MISSING_SERVICE_MANIFEST"

    write_service_artifacts(
        ctx["service_probe_status"], services, started_by_harness, ctx["service_probe_manifest_path"], ctx["repo_root"],
        ctx["artifact_root"], ctx["probe_services"], ctx["start_services"], ctx["start_service_plan_path"], ctx["web_health_path"],
        ctx["hub_health_path"], ctx["desktop_health_path"], ctx["edge_health_path"], ctx["expected_web_marker"],
        ctx["expected_hub_marker"], ctx["expected_desktop_marker"], ctx["expected_edge_marker"], ctx["service_probe_manifest_path"],
        ctx["health_manifest_path"], ctx["pid_manifest_path"], ctx["cleanup_log"],
    )
    if services_run["ExitCode"] != 0:
        add_failure("localhost real-services readiness gate failed")


def new_readiness_manifest(ctx: dict, status: str) -> dict:
    safe_note = redact_secret_like(ctx["run_note"])
    return {
        "schema": "agenthub-localhost-observed-loop-readiness-v1",
        "status": status,
        "mode": ctx["mode"],
        "evidence_origin": "readiness_only",
        "real_tested": False,
        "generated_at": generated_at.isoformat(),
        "repo_root": ctx["repo_root"],
        "artifact_root": ctx["artifact_root"],
        "topology": {
            "web_url": ctx["web_url"],
            "hub_url": ctx["hub_url"],
            "desktop_bridge_url": ctx["desktop_bridge_url"],
            "local_edge_url": ctx["local_edge_url"],
            "registered_target_url": ctx["registered_target_url"],
            "hub_dispatch_target_url": ctx["hub_dispatch_target_url"],
            "web_port": 5174,
            "hub_port": 8080,
            "desktop_tauri_evidence_port": 5173,
            "local_edge_port": 3210,
            "web_upstream": "hub",
            "hub_dispatch_target": "registered-desktop-bridge",
            "desktop_handoff": "local-edge",
            "direct_hub_to_local_edge": (
                bool(ctx["hub_dispatch_target_url"]) and get_origin(ctx["hub_dispatch_target_url"]) == get_origin(ctx["local_edge_url"])
            ),
        },
        "chain": {
            "web": "5174",
            "hub": "8080",
            "desktop_tauri_evidence": "5173",
            "local_edge": "3210",
            "fixture_adapter": "fixture-sdk-adapter",
            "hub_replay": "required",
            "web_render": "transcript_approval_artifact",
        },
        "paths": {
            "manifest": ctx["manifest_path"],
            "artifact_root": ctx["artifact_root"],
            "log_root": ctx["log_root"],
            "startup_log": ctx["startup_log"],
            "cleanup_log": ctx["cleanup_log"],
            "readiness_gate": ctx["readiness_gate_path"],
            "observed_dispatch_report": ctx["observed_dispatch_report_path"],
            "service_probe_manifest": ctx["service_probe_manifest_path"],
            "pid_manifest": ctx["pid_manifest_path"],
            "health_manifest": ctx["health_manifest_path"],
        },
        "service_probes": {
            "status": ctx["service_probe_status"],
            "exit_code": ctx["service_probe_exit_code"],
            "probe_services": bool(ctx["probe_services"]),
            "start_services": bool(ctx["start_services"]),
            "start_plan_path": ctx["start_service_plan_path"],
            "service_probe_manifest": ctx["service_probe_manifest_path"],
            "pid_manifest": ctx["pid_manifest_path"],
            "health_manifest": ctx["health_manifest_path"],
            "health_paths": {"web": ctx["web_health_path"], "hub": ctx["hub_health_path"], "desktop_bridge": ctx["desktop_health_path"], "local_edge": ctx["edge_health_path"]},
            "expected_markers": {
                "web": ctx["expected_web_marker"],
                "hub": ctx["expected_hub_marker"],
                "desktop_bridge": ctx["expected_desktop_marker"],
                "local_edge": ctx["expected_edge_marker"],
            },
            "cleanup": {
                "strategy": "Keep artifacts under the safe artifact root for review; remove that root with Remove-Item after capture. Harness-started child processes are delegated to verify-localhost-real-services.ps1 cleanup.",
                "clean_artifact_root": bool(ctx["clean_artifact_root"]),
            },
        },
        "required_environment_names": list(ctx["required_environment_names"]),
        "supplied_environment_names": list(ctx["supplied_environment_names"]),
        "observed_manifest_contract": {
            "required_schema": "agenthub-observed-localhost-dispatch-v1",
            "accepted_origins": ["observed_hub_manifest", "observed_desktop_path"],
        },
        "gates": [
            {
                "name": "verify-local-stack-e2e-readiness.ps1",
                "mode": "ApprovedReal" if ctx["mode"] == "ApprovedReal" else "ReadinessOnly",
                "status": "SEE_READINESS_GATE" if ctx["mode"] == "ApprovedReal" else "NOT_RUN_BY_DEFAULT",
                "evidence": ctx["readiness_gate_path"],
                "probe_services": bool(ctx["probe_services"]),
                "start_services": bool(ctx["start_services"]),
            },
            {
                "name": "verify-observed-localhost-dispatch.ps1",
                "mode": "FixtureManifestOrApprovedReal",
                "status": "NOT_RUN_READINESS_ONLY" if ctx["mode"] == "ReadinessOnly" else "SEE_OBSERVED_REPORT",
                "evidence": ctx["observed_dispatch_report_path"],
            },
        ],
        "claims": {
            "real_tokendance_id_login": False,
            "real_cli_or_model_invoked_by_this_runner": False,
            "real_api_budget_spend_by_this_runner": False,
            "public_deploy_signing_release": False,
            "mobile": False,
        },
        "boundaries": {
            "no_real_login": True,
            "no_real_cli_model_api_spend": True,
            "no_deploy_signing_release": True,
            "direct_hub_to_local_edge_rejected": True,
            "readiness_only_until_observed_manifest": True,
        },
        "run_note": safe_note,
        "failures": list(failures),
        "warnings": list(warnings),
        "blockers": [
            "real TokenDanceID login is intentionally not performed",
            "real CLI/model/API invocation is intentionally not performed",
            "ApprovedReal requires an observed dispatch manifest and explicit approval",
            "direct Hub-to-LocalEdge dispatch is rejected",
        ],
    }


def new_observed_fixture_manifest(ctx: dict) -> dict:
    events = [
        {"id": "evt-localhost-001", "type": "target.registered", "actor": "hub", "source": "hub.target_registry", "observed": True},
        {"id": "evt-localhost-002", "type": "web.teamrun.start", "actor": "web", "source": "web.5174", "observed": True},
        {"id": "evt-localhost-003", "type": "hub.agent.dispatch", "actor": "hub", "source": "hub.dispatch_log", "observed": True},
        {"id": "evt-localhost-004", "type": "desktop.dispatch.accepted", "actor": "desktop", "source": "desktop.tauri_evidence", "observed": True},
        {"id": "evt-localhost-005", "type": "edge.run.started", "actor": "desktop-local-edge", "source": "edge.run_log", "observed": True},
        {"id": "evt-localhost-006", "type": "hub.replay.recorded", "actor": "hub", "source": "hub.replay_store", "observed": True},
        {"id": "evt-localhost-007", "type": "web.replay.rendered", "actor": "web", "source": "web.transcript_approval_artifact_render", "observed": True},
    ]
    return {
        "schema": "agenthub-observed-localhost-dispatch-v1",
        "evidence_origin": "observed_desktop_path",
        "real_tested": False,
        "approval_gate": "",
        "topology": {
            "web": {"url": ctx["web_url"], "port": 5174, "upstream": "hub"},
            "hub": {"url": ctx["hub_url"], "port": 8080},
            "desktop_bridge": {"url": ctx["desktop_bridge_url"], "port": 5173, "evidence": "tauri-sidecar-fixture"},
            "local_edge": {"url": ctx["local_edge_url"], "port": 3210},
        },
        "target_registration": {
            "target_id": "target-localhost-observed-loop-001",
            "edge_device_id": "desktop-device-localhost-001",
            "target_kind": "desktop_bridge",
            "desktop_bridge_url": ctx["desktop_bridge_url"],
            "source": "hub.target_registry",
            "event_ref": "evt-localhost-001",
        },
        "dispatch": {
            "hub_task_id": "run-localhost-observed-loop-001",
            "target_id": "target-localhost-observed-loop-001",
            "edge_device_id": "desktop-device-localhost-001",
            "dispatch_target_url": ctx["desktop_bridge_url"],
            "source": "hub.dispatch_log",
            "event_ref": "evt-localhost-003",
        },
        "desktop_accept": {
            "hub_task_id": "run-localhost-observed-loop-001",
            "target_id": "target-localhost-observed-loop-001",
            "edge_device_id": "desktop-device-localhost-001",
            "desktop_bridge_url": ctx["desktop_bridge_url"],
            "local_edge_url": ctx["local_edge_url"],
            "source": "desktop.tauri_evidence",
            "event_ref": "evt-localhost-004",
        },
        "edge_run": {
            "hub_task_id": "run-localhost-observed-loop-001",
            "target_id": "target-localhost-observed-loop-001",
            "edge_device_id": "desktop-device-localhost-001",
            "edge_run_id": "edge-run-localhost-observed-loop-001",
            "adapter_id": "fixture-sdk-adapter",
            "source": "edge.run_log",
            "event_ref": "evt-localhost-005",
        },
        "hub_replay": {
            "team_run_id": "teamrun-localhost-observed-loop-001",
            "hub_task_id": "run-localhost-observed-loop-001",
            "target_id": "target-localhost-observed-loop-001",
            "edge_device_id": "desktop-device-localhost-001",
            "edge_run_id": "edge-run-localhost-observed-loop-001",
            "adapter_id": "fixture-sdk-adapter",
            "replay_ref": "evt-localhost-006",
            "source": "hub.replay_store",
            "event_ref": "evt-localhost-006",
        },
        "web_render": {
            "team_run_id": "teamrun-localhost-observed-loop-001",
            "hub_task_id": "run-localhost-observed-loop-001",
            "target_id": "target-localhost-observed-loop-001",
            "edge_device_id": "desktop-device-localhost-001",
            "edge_run_id": "edge-run-localhost-observed-loop-001",
            "adapter_id": "fixture-sdk-adapter",
            "replay_ref": "evt-localhost-006",
            "render_source": "hub-replay",
            "rendered_blocks": ["transcript", "approval", "artifact"],
            "observed": True,
            "source": "web.transcript_approval_artifact_render",
            "event_ref": "evt-localhost-007",
        },
        "events": events,
        "claims": {
            "real_tokendance_id_login": False,
            "real_cli_or_model_invoked": False,
            "public_deploy_signing_release": False,
        },
    }


def main() -> int:
    global generated_at
    normalize_stdout_lf()
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--RepoRoot", default=".")
    parser.add_argument("--Mode", default="ReadinessOnly", choices=["ReadinessOnly", "FixtureManifest", "ApprovedReal"])
    parser.add_argument("--ArtifactRoot", default="")
    parser.add_argument("--ManifestPath", default="")
    parser.add_argument("--ObservedEvidencePath", default="")
    parser.add_argument("--ObservedDispatchReportPath", default="")
    parser.add_argument("--ApproveRealEvidence", action="store_true")
    parser.add_argument("--CleanArtifactRoot", action="store_true")
    parser.add_argument("--RequiredEnvironmentNames", nargs="*", default=[])
    parser.add_argument("--SuppliedEnvironmentNames", nargs="*", default=[])
    parser.add_argument("--UseEnvironment", action="store_true")
    parser.add_argument("--WebUrl", default="http://127.0.0.1:5174")
    parser.add_argument("--HubUrl", default="http://127.0.0.1:8080")
    parser.add_argument("--DesktopBridgeUrl", default="http://127.0.0.1:5173")
    parser.add_argument("--LocalEdgeUrl", default="http://127.0.0.1:3210")
    parser.add_argument("--WebHealthPath", default="/")
    parser.add_argument("--HubHealthPath", default="/health/live")
    parser.add_argument("--DesktopHealthPath", default="/")
    parser.add_argument("--EdgeHealthPath", default="/v1/health")
    parser.add_argument("--ExpectedWebMarker", default="agenthub-web-real-service-marker")
    parser.add_argument("--ExpectedHubMarker", default="agenthub-hub-real-service-marker")
    parser.add_argument("--ExpectedDesktopMarker", default="agenthub-desktop-bridge-real-service-marker")
    parser.add_argument("--ExpectedEdgeMarker", default="agenthub-local-edge-real-service-marker")
    parser.add_argument("--RegisteredTargetUrl", default="")
    parser.add_argument("--HubDispatchTargetUrl", default="")
    parser.add_argument("--RunNote", default="")
    parser.add_argument("--TimeoutSec", type=int, default=12)
    parser.add_argument("--ProbeServices", action="store_true")
    parser.add_argument("--StartServices", action="store_true")
    parser.add_argument("--StartServicePlanPath", default="")
    args = parser.parse_args()

    if args.TimeoutSec <= 0:
        emit("FAIL: -TimeoutSec must be greater than zero.")
        return 2

    repo_root = os.path.abspath(args.RepoRoot)
    env_temp = os.environ.get("TEMP") or os.environ.get("TMP") or ""

    artifact_root = args.ArtifactRoot or os.path.join(repo_root, ".tmp", "localhost-observed-loop", f"run-{os.getpid()}")
    artifact_root = get_full_path(artifact_root, repo_root)

    manifest_path = args.ManifestPath
    if not manifest_path.strip():
        if args.Mode == "FixtureManifest":
            manifest_path = os.path.join(artifact_root, "observed-dispatch-manifest.json")
        else:
            manifest_path = os.path.join(artifact_root, "localhost-observed-loop-readiness.json")
    manifest_path = get_full_path(manifest_path, repo_root)

    observed_dispatch_report_path = args.ObservedDispatchReportPath or os.path.join(artifact_root, "observed-dispatch-report.json")
    observed_dispatch_report_path = get_full_path(observed_dispatch_report_path, repo_root)

    required_environment_names = list(args.RequiredEnvironmentNames) or [
        "AGENTHUB_WEB_URL",
        "AGENTHUB_HUB_URL",
        "AGENTHUB_DESKTOP_BRIDGE_URL",
        "AGENTHUB_LOCAL_EDGE_URL",
        "AGENTHUB_LOCAL_STACK_ARTIFACT_ROOT",
    ]
    supplied_environment_names = get_supplied_environment_name_list(
        args.SuppliedEnvironmentNames, required_environment_names, args.UseEnvironment
    )

    global failures, warnings
    failures = []
    warnings = []
    generated_at = datetime.datetime.now().astimezone()

    log_root = os.path.join(artifact_root, "logs")
    startup_log = os.path.join(log_root, "startup.log")
    cleanup_log = os.path.join(log_root, "cleanup.log")
    readiness_gate_path = os.path.join(artifact_root, "local-stack-readiness.json")
    service_probe_manifest_path = os.path.join(artifact_root, "service-probe-manifest.json")
    pid_manifest_path = os.path.join(artifact_root, "service-pids.json")
    health_manifest_path = os.path.join(artifact_root, "service-health.json")

    ctx = {
        "repo_root": repo_root,
        "mode": args.Mode,
        "artifact_root": artifact_root,
        "manifest_path": manifest_path,
        "observed_dispatch_report_path": observed_dispatch_report_path,
        "observed_evidence_path": args.ObservedEvidencePath,
        "approve_real_evidence": args.ApproveRealEvidence,
        "clean_artifact_root": args.CleanArtifactRoot,
        "required_environment_names": required_environment_names,
        "supplied_environment_names": supplied_environment_names,
        "use_environment": args.UseEnvironment,
        "web_url": args.WebUrl,
        "hub_url": args.HubUrl,
        "desktop_bridge_url": args.DesktopBridgeUrl,
        "local_edge_url": args.LocalEdgeUrl,
        "web_health_path": args.WebHealthPath,
        "hub_health_path": args.HubHealthPath,
        "desktop_health_path": args.DesktopHealthPath,
        "edge_health_path": args.EdgeHealthPath,
        "expected_web_marker": args.ExpectedWebMarker,
        "expected_hub_marker": args.ExpectedHubMarker,
        "expected_desktop_marker": args.ExpectedDesktopMarker,
        "expected_edge_marker": args.ExpectedEdgeMarker,
        "registered_target_url": args.RegisteredTargetUrl,
        "hub_dispatch_target_url": args.HubDispatchTargetUrl,
        "run_note": args.RunNote,
        "timeout_sec": args.TimeoutSec,
        "probe_services": args.ProbeServices,
        "start_services": args.StartServices,
        "start_service_plan_path": args.StartServicePlanPath,
        "log_root": log_root,
        "startup_log": startup_log,
        "cleanup_log": cleanup_log,
        "readiness_gate_path": readiness_gate_path,
        "service_probe_manifest_path": service_probe_manifest_path,
        "pid_manifest_path": pid_manifest_path,
        "health_manifest_path": health_manifest_path,
        "service_probe_status": "NOT_REQUESTED",
        "service_probe_exit_code": None,
        "service_probe_output": "",
    }

    emit("AgentHub localhost observed loop gate")
    emit(f"Mode: {args.Mode}")
    emit("No real TokenDanceID login, real CLI/model/API spend, deploy, signing, or release upload will be performed.")

    assert_static_boundary(artifact_root, manifest_path, observed_dispatch_report_path, repo_root, env_temp)
    if not failures:
        initialize_artifact_root(
            artifact_root, args.CleanArtifactRoot, startup_log, cleanup_log,
            test_allowed_artifact_root(artifact_root, repo_root, env_temp),
        )
        invoke_service_readiness(ctx)

    if args.Mode == "ReadinessOnly":
        status = "READINESS_ONLY_MANIFEST_WRITTEN" if not failures else "LOCALHOST_OBSERVED_LOOP_FAILED"
        if test_allowed_manifest_path(manifest_path, repo_root, env_temp, artifact_root):
            write_json_file(new_readiness_manifest(ctx, status), manifest_path)
        emit(f"ManifestPath: {manifest_path}")
        emit(f"StartupLog: {startup_log}")
        emit(f"CleanupLog: {cleanup_log}")
        emit(f"Status: {status}")
        emit("RealTested=false")
        return 0 if not failures else 1

    if args.Mode == "FixtureManifest":
        if not failures:
            write_json_file(new_observed_fixture_manifest(ctx), manifest_path)
            pass_check("fixture observed-dispatch manifest written")
            observed_run = invoke_repo_script(
                ctx["repo_root"],
                "scripts\\smoke\\verify-observed-localhost-dispatch.ps1",
                ["-RepoRoot", ctx["repo_root"], "-ObservedEvidencePath", manifest_path, "-EvidencePath", observed_dispatch_report_path, "-TimeoutSec", str(args.TimeoutSec)],
            )
            emit(observed_run["Output"])
            if observed_run["ExitCode"] != 0:
                add_failure("observed localhost dispatch verifier rejected fixture manifest")
        if failures and test_allowed_manifest_path(manifest_path, repo_root, env_temp, artifact_root) and not os.path.isfile(manifest_path):
            write_json_file(new_readiness_manifest(ctx, "LOCALHOST_OBSERVED_LOOP_FAILED"), manifest_path)
        status = "FIXTURE_OBSERVED_MANIFEST_PASSED" if not failures else "LOCALHOST_OBSERVED_LOOP_FAILED"
        emit(f"Status: {status}")
        emit("RealTested=false")
        return 0 if not failures else 1

    # ApprovedReal
    if not args.ApproveRealEvidence:
        add_failure("ApprovedReal requires -ApproveRealEvidence")
    if not args.ObservedEvidencePath.strip():
        add_failure("ApprovedReal requires -ObservedEvidencePath")
    if not failures:
        readiness_args = [
            "-RepoRoot", ctx["repo_root"],
            "-Mode", "ApprovedReal",
            "-EvidencePath", readiness_gate_path,
            "-ArtifactRoot", artifact_root,
            "-SuppliedEnvironmentNames", ",".join(required_environment_names),
            "-ObservedEvidencePath", args.ObservedEvidencePath,
            "-ApproveRealEvidence",
        ]
        if args.ProbeServices:
            readiness_args += ["-ProbeServices"]
        if args.StartServices:
            readiness_args += ["-StartServices", "-StartServicePlanPath", args.StartServicePlanPath]
        readiness_run = invoke_repo_script(
            ctx["repo_root"], "scripts\\smoke\\verify-local-stack-e2e-readiness.ps1", readiness_args
        )
        emit(readiness_run["Output"])
        if readiness_run["ExitCode"] != 0:
            add_failure("local-stack ApprovedReal readiness gate failed")

        observed_run = invoke_repo_script(
            ctx["repo_root"],
            "scripts\\smoke\\verify-observed-localhost-dispatch.ps1",
            ["-RepoRoot", ctx["repo_root"], "-ObservedEvidencePath", args.ObservedEvidencePath, "-EvidencePath", observed_dispatch_report_path, "-AllowRealTestedApproval", "-TimeoutSec", str(args.TimeoutSec)],
        )
        emit(observed_run["Output"])
        if observed_run["ExitCode"] != 0:
            add_failure("observed localhost dispatch gate failed")

    real_tested = False
    if not failures and os.path.isfile(observed_dispatch_report_path):
        try:
            with open(observed_dispatch_report_path, "r", encoding="utf-8") as handle:
                observed_report = json.load(handle)
            real_tested = observed_report.get("real_tested") is True
        except Exception:  # noqa: BLE001
            real_tested = False

    status = (
        "APPROVED_REAL_PASSED" if real_tested else "APPROVED_REAL_READINESS_ONLY_PASSED"
    ) if not failures else "LOCALHOST_OBSERVED_LOOP_FAILED"
    write_json_file(new_readiness_manifest(ctx, status), manifest_path)
    emit(f"Status: {status}")
    emit(f"RealTested={str(real_tested).lower()}")
    return 0 if not failures else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
