#!/usr/bin/env python3
"""verify-p0-local-product-loop-evidence — P0 本地产品环路脱敏证据 runner（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

一键 runner 把 localhost fixture 链变成紧凑的机器可读报告：

Web -> Hub -> Desktop Local Edge sidecar -> fixture/CLI adapter -> Hub replay -> Web render

ApprovedRealReview 模式可复核外部抓取的 observed-dispatch manifest，但不执行真实
TokenDanceID 登录、真实 CLI/model 执行、公开部署、签名、push、merge 或 tag 工作。

契约：stdlib only；参数名/退出码与 ps1 一致（0=通过/1=失败/2=非法参数）；机器
可读行（`  PASS  `/`  FAIL  `/`  WARN  `、`Status:`、`RealTested=`）与原 ps1 一致；
证据 JSON 用 ConvertTo-Json 等价格式（2-space indent）；子脚本按扩展名分发
（.py → python，.ps1 → pwsh）。
"""

import argparse
import datetime
import json
import os
import shutil
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))

failures = []
warnings = []
segments = []
gate_results = []
blockers = [
    "real TokenDanceID login requires explicit operator approval and a running TokenDanceID plus Hub callback configuration",
    "real CLI/model adapter invocation requires explicit operator approval and a no-secret observed-dispatch manifest",
    "public deploy, signing, push, merge, and tag remain out of scope for this runner",
]
observed_report_path = ""
fixture_evidence_path = ""
real_tested = False


def step(text: str) -> None:
    print(f"\n=== {text} ===")


def add_failure(text: str) -> None:
    failures.append(text)
    print(f"  FAIL  {text}")


def add_warning(text: str) -> None:
    warnings.append(text)
    print(f"  WARN  {text}")


def pass_check(text: str) -> None:
    print(f"  PASS  {text}")


def test_path_under_root(path: str, root: str) -> bool:
    normalized = os.path.abspath(path).rstrip("\\/")
    normalized_root = os.path.abspath(root).rstrip("\\/")
    if normalized.lower() == normalized_root.lower():
        return True
    return normalized.lower().startswith(normalized_root.lower() + os.sep)


def assert_safe_artifact_root(repo_root: str, artifact_root: str) -> None:
    temp_allowed = os.path.join(os.environ.get("TEMP") or os.environ.get("TMP") or "", "AgentHub", "p0-local-product-loop-evidence")
    allowed_roots = [
        os.path.join(repo_root, ".tmp", "p0-local-product-loop-evidence"),
        os.path.join(repo_root, "tmp", "p0-local-product-loop-evidence"),
        temp_allowed,
    ]
    for root in allowed_roots:
        if test_path_under_root(artifact_root, root):
            pass_check("artifact root is inside allowed sanitized evidence area")
            return
    add_failure("artifact root must stay under .tmp\\p0-local-product-loop-evidence, tmp\\p0-local-product-loop-evidence, or $env:TEMP\\AgentHub\\p0-local-product-loop-evidence")


def assert_evidence_path(evidence_path: str, artifact_root: str) -> None:
    if test_path_under_root(evidence_path, artifact_root):
        pass_check("EvidencePath is inside ArtifactRoot")
        return
    add_failure("EvidencePath must stay inside ArtifactRoot")


def find_powershell():
    return shutil.which("pwsh") or shutil.which("powershell")


def invoke_captured_process(file_name: str, arguments: list, working_directory: str) -> dict:
    try:
        run = subprocess.run(
            [file_name, *arguments],
            cwd=working_directory,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        return {"ExitCode": run.returncode, "Output": (run.stdout + "\n" + run.stderr).replace("\r\n", "\n")}
    except Exception as exc:  # noqa: BLE001 —— 对齐 ps1 try/catch 返回 ExitCode=-1
        return {"ExitCode": -1, "Output": str(exc)}


def resolve_repo_script(repo_root: str, relative_without_extension: str) -> str:
    """优先 .py、回退 .ps1，迁移过渡期内兼容两种实现。"""
    for extension in (".py", ".ps1"):
        candidate = os.path.join(repo_root, relative_without_extension + extension)
        if os.path.isfile(candidate):
            return candidate
    return os.path.join(repo_root, relative_without_extension + ".ps1")


def invoke_repo_script(repo_root: str, relative_path: str, arguments: list) -> dict:
    script_path = os.path.join(repo_root, relative_path)
    if not os.path.isfile(script_path):
        return {"ExitCode": -1, "Output": f"missing {relative_path}", "ScriptPath": script_path}
    if script_path.endswith(".py"):
        python_exe = shutil.which("python") or shutil.which("python3")
        if not python_exe:
            return {"ExitCode": -1, "Output": "Python executable is unavailable", "ScriptPath": script_path}
        run = invoke_captured_process(python_exe, [script_path, *arguments], repo_root)
    else:
        powershell_exe = find_powershell()
        if not powershell_exe:
            return {"ExitCode": -1, "Output": "PowerShell executable is unavailable", "ScriptPath": script_path}
        run = invoke_captured_process(powershell_exe, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script_path, *arguments], repo_root)
    run["ScriptPath"] = script_path
    return run


def get_event(evidence: dict, event_type: str):
    for event in evidence.get("events") or []:
        if str(event.get("type")) == event_type:
            return event
    return None


def get_event_index(evidence: dict, event_type: str) -> int:
    events = evidence.get("events") or []
    for index, event in enumerate(events):
        if str(event.get("type")) == event_type:
            return index
    return -1


def add_segment(name: str, label: str, passed: bool, event_types: list, details: dict) -> None:
    status = "PASS" if passed else "FAIL"
    if passed:
        pass_check(f"segment passed: {name}")
    else:
        add_failure(f"segment failed: {name}")
    segments.append(
        {
            "name": name,
            "label": label,
            "status": status,
            "event_types": list(event_types),
            "details": details,
        }
    )


def test_same_origin(left: str, right: str) -> bool:
    from urllib.parse import urlsplit

    try:
        left_uri = urlsplit(left)
        right_uri = urlsplit(right)
        return left_uri.scheme == right_uri.scheme and left_uri.hostname == right_uri.hostname and left_uri.port == right_uri.port
    except Exception:  # noqa: BLE001 —— 对齐 ps1 try/catch 返回 $false
        return False


def validate_fixture_evidence(evidence: dict) -> None:
    if evidence.get("schema") != "agenthub-localhost-product-loop-v1":
        add_failure("fixture evidence schema mismatch")
    if evidence.get("real_tested") is not False:
        add_failure("fixture evidence must keep real_tested=false")
    claims = evidence.get("claims") or {}
    if claims.get("real_tokendance_id_login") is not False:
        add_failure("fixture evidence must not claim real TokenDanceID login")
    if claims.get("real_cli_or_model_invoked") is not False:
        add_failure("fixture evidence must not claim real CLI/model invocation")
    if claims.get("public_deploy_used") is not False:
        add_failure("fixture evidence must not claim public deploy")

    services = evidence.get("services") or []
    web = next((entry for entry in services if entry.get("service") == "web"), None)
    hub = next((entry for entry in services if entry.get("service") == "hub"), None)
    desktop = next((entry for entry in services if entry.get("service") == "desktop"), None)
    edge = next((entry for entry in services if entry.get("service") == "local-edge"), None)

    for name, value in (("web", web), ("hub", hub), ("desktop", desktop), ("local-edge", edge)):
        if value is None:
            add_failure(f"fixture service missing: {name}")

    required_order = [
        "target.registered",
        "web.teamrun.start",
        "hub.agent.dispatch",
        "desktop.dispatch.accepted",
        "edge.run.started",
        "adapter.run.completed",
        "hub.replay.recorded",
        "web.replay.rendered",
    ]
    last_index = -1
    for event_type in required_order:
        index = get_event_index(evidence, event_type)
        if index <= last_index:
            add_failure(f"fixture event order invalid at {event_type}")
        last_index = index

    dispatch = get_event(evidence, "hub.agent.dispatch")
    desktop_accept = get_event(evidence, "desktop.dispatch.accepted")
    edge_start = get_event(evidence, "edge.run.started")
    adapter_done = get_event(evidence, "adapter.run.completed")
    replay = get_event(evidence, "hub.replay.recorded")
    render = get_event(evidence, "web.replay.rendered")

    topology = evidence.get("topology") or {}
    allowed_upstreams = topology.get("web", {}).get("allowed_upstreams") or []
    web_only = len(allowed_upstreams) == 1 and "hub" in allowed_upstreams
    add_segment(
        "web_to_hub",
        "Web starts TeamRun through Hub-only boundary",
        web_only and get_event(evidence, "web.teamrun.start") is not None and dispatch is not None,
        ["web.teamrun.start", "hub.agent.dispatch"],
        {"allowed_upstreams": allowed_upstreams, "web_health_identity": str((web or {}).get("health", {}).get("identity") or "")},
    )

    hub_routes_desktop = (
        desktop is not None
        and edge is not None
        and dispatch is not None
        and str(dispatch.get("desktop_url") or "") == str(desktop.get("url") or "")
        and not test_same_origin(str(dispatch.get("desktop_url") or ""), str(edge.get("url") or ""))
    )
    add_segment(
        "hub_to_registered_desktop_bridge",
        "Hub dispatch targets the registered Desktop bridge, not Local Edge directly",
        hub_routes_desktop,
        ["target.registered", "hub.agent.dispatch"],
        {
            "dispatch_desktop_url": str(dispatch.get("desktop_url") or "") if dispatch else "",
            "registered_desktop_url": str(desktop.get("url") or "") if desktop else "",
            "local_edge_url": str(edge.get("url") or "") if edge else "",
        },
    )

    desktop_allowed = topology.get("desktop", {}).get("allowed_upstreams") or []
    desktop_sidecar = (
        len(desktop_allowed) == 1
        and "local-edge" in desktop_allowed
        and str(topology.get("desktop", {}).get("bridge") or "") == "tauri-sidecar-fixture"
        and str((desktop or {}).get("health", {}).get("bridge") or "") == "tauri-sidecar-fixture"
        and desktop_accept is not None
        and edge_start is not None
    )
    add_segment(
        "desktop_local_edge_sidecar",
        "Desktop bridge dispatches only to Local Edge sidecar",
        desktop_sidecar,
        ["desktop.dispatch.accepted", "edge.run.started"],
        {"desktop_bridge": str(topology.get("desktop", {}).get("bridge") or ""), "allowed_upstreams": desktop_allowed},
    )

    local_edge_topology = topology.get("local_edge") or {}
    fixture_adapter = (
        str(local_edge_topology.get("adapter") or "") == "fixture-sdk"
        and local_edge_topology.get("real_cli_or_model_invoked") is False
        and adapter_done is not None
        and adapter_done.get("real_cli_or_model_invoked") is False
    )
    add_segment(
        "local_edge_fixture_adapter",
        "Local Edge runs fixture adapter without real CLI/model spend",
        fixture_adapter,
        ["edge.run.started", "adapter.run.completed"],
        {"adapter": str(local_edge_topology.get("adapter") or ""), "real_cli_or_model_invoked": False},
    )

    remote_manifest = evidence.get("remote_control_manifest") or {}
    task = next((entry for entry in evidence.get("tasks") or [] if entry.get("id") == remote_manifest.get("hubTaskId")), None)
    hub_replay = replay is not None and task is not None and str(task.get("status") or "") == "completed"
    add_segment(
        "hub_replay",
        "Hub replay records completed localhost fixture chain",
        hub_replay,
        ["adapter.run.completed", "hub.replay.recorded"],
        {
            "hub_task_id": str(remote_manifest.get("hubTaskId") or ""),
            "task_status": str(task.get("status") or "") if task else "",
        },
    )

    web_render = (
        render is not None
        and str(render.get("source") or "") == "hub-replay"
        and "hub.replay.recorded" in (render.get("rendered_event_types") or [])
        and get_event_index(evidence, "web.replay.rendered") > get_event_index(evidence, "hub.replay.recorded")
    )
    add_segment(
        "web_render",
        "Web renders Hub replay into localhost fixture view",
        web_render,
        ["hub.replay.recorded", "web.replay.rendered"],
        {"source": str(render.get("source") or "") if render else "", "rendered_event_types": render.get("rendered_event_types") or [] if render else []},
    )


def write_report(status: str, mode: str, evidence_path: str, artifact_root: str, repo_root: str, node_path: str) -> None:
    report = {
        "schema": "agenthub-p0-local-product-loop-evidence-v1",
        "mode": mode,
        "status": status,
        "real_tested": real_tested,
        "generated_at": datetime.datetime.now().astimezone().isoformat(),
        "repo_root": repo_root,
        "artifact_root": artifact_root,
        "sanitized": True,
        "sequence": "Web -> Hub -> Desktop Local Edge sidecar -> fixture/CLI adapter -> Hub replay -> Web render",
        "sources": {
            "fixture_product_loop": {
                "script": "scripts/smoke/verify-localhost-product-loop.py",
                "evidence_path": fixture_evidence_path,
            },
            "observed_dispatch_report": observed_report_path,
        },
        "gate_results": list(gate_results),
        "segments": list(segments),
        "boundaries": {
            "web": {"upstream": "hub-only", "direct_local_edge": "rejected"},
            "desktop": {"bridge": "tauri-sidecar-fixture", "upstream": "local-edge-sidecar"},
            "local_edge": {"adapter": "fixture-sdk", "real_cli_or_model_invoked": False},
            "hub": {"dispatch_target": "registered-desktop-bridge", "replay_owner": True},
        },
        "claims": {
            "real_tokendance_id_login": False,
            "real_cli_or_model_invoked_by_this_runner": False,
            "public_deploy_signing_push_merge_or_tag": False,
            "production_code_touched": False,
        },
        "approved_real_requirements": {
            "environment_names": [
                "AGENTHUB_WEB_URL",
                "AGENTHUB_HUB_URL",
                "AGENTHUB_DESKTOP_BRIDGE_URL",
                "AGENTHUB_LOCAL_EDGE_URL",
                "AGENTHUB_LOCAL_STACK_ARTIFACT_ROOT",
            ],
            "observed_manifest_schema": "agenthub-observed-localhost-dispatch-v1",
            "command": "python .\\scripts\\smoke\\verify-p0-local-product-loop-evidence.py --RepoRoot . --Mode ApprovedRealReview --ArtifactRoot .tmp\\p0-local-product-loop-evidence\\approved --ObservedEvidencePath <observed-dispatch.json> --ApproveRealEvidence",
            "local_stack_probe_command": "python .\\scripts\\smoke\\verify-local-stack-e2e-readiness.py --RepoRoot . --Mode ApprovedReal --ArtifactRoot .tmp\\local-stack-e2e-readiness\\approved --SuppliedEnvironmentNames AGENTHUB_WEB_URL,AGENTHUB_HUB_URL,AGENTHUB_DESKTOP_BRIDGE_URL,AGENTHUB_LOCAL_EDGE_URL,AGENTHUB_LOCAL_STACK_ARTIFACT_ROOT --ProbeServices --ApproveRealEvidence --ObservedEvidencePath <observed-dispatch.json>",
        },
        "blockers": list(blockers),
        "failures": list(failures),
        "warnings": list(warnings),
    }

    report_dir = os.path.dirname(evidence_path)
    if report_dir.strip():
        os.makedirs(report_dir, exist_ok=True)
    with open(evidence_path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)


def main() -> int:
    global failures, warnings, segments, gate_results, observed_report_path, fixture_evidence_path, real_tested
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--RepoRoot", "-RepoRoot", default=".")
    parser.add_argument("--Mode", "-Mode", default="FixtureOnly", choices=["FixtureOnly", "ApprovedRealReview"])
    parser.add_argument("--EvidencePath", "-EvidencePath", default="")
    parser.add_argument("--ArtifactRoot", "-ArtifactRoot", default="")
    parser.add_argument("--ObservedEvidencePath", "-ObservedEvidencePath", default="")
    parser.add_argument("--ApproveRealEvidence", "-ApproveRealEvidence", action="store_true")
    parser.add_argument("--NodePath", "-NodePath", default="node")
    parser.add_argument("--TimeoutSec", "-TimeoutSec", type=int, default=8)
    args = parser.parse_args()

    if args.TimeoutSec <= 0:
        print("FAIL: -TimeoutSec must be greater than zero.")
        return 2

    repo_root = os.path.realpath(args.RepoRoot)
    if not args.ArtifactRoot.strip():
        artifact_root = os.path.join(repo_root, ".tmp", "p0-local-product-loop-evidence", f"run-{os.getpid()}")
    elif not os.path.isabs(args.ArtifactRoot):
        artifact_root = os.path.join(repo_root, args.ArtifactRoot)
    else:
        artifact_root = args.ArtifactRoot
    artifact_root = os.path.abspath(artifact_root)

    if not args.EvidencePath.strip():
        evidence_path = os.path.join(artifact_root, "sanitized-evidence.json")
    elif not os.path.isabs(args.EvidencePath):
        evidence_path = os.path.join(repo_root, args.EvidencePath)
    else:
        evidence_path = args.EvidencePath
    evidence_path = os.path.abspath(evidence_path)

    failures = []
    warnings = []
    segments = []
    gate_results = []
    observed_report_path = ""
    fixture_evidence_path = os.path.join(artifact_root, "fixture-product-loop.json")
    real_tested = False

    print("AgentHub P0 local product-loop sanitized evidence runner")
    print(f"Mode: {args.Mode}")
    print("No real TokenDanceID login, real CLI/model spend, deploy, signing, push, merge, or tag will be performed.")

    step("Output safety")
    assert_safe_artifact_root(repo_root, artifact_root)
    assert_evidence_path(evidence_path, artifact_root)
    if failures:
        print("Status: P0_LOCAL_PRODUCT_LOOP_EVIDENCE_FAILED")
        print("RealTested=false")
        return 1
    os.makedirs(artifact_root, exist_ok=True)

    step("Fixture product loop")
    fixture_run = invoke_repo_script(
        repo_root,
        resolve_repo_script(repo_root, os.path.join("scripts", "smoke", "verify-localhost-product-loop")),
        ["-RepoRoot", repo_root, "-EvidencePath", fixture_evidence_path, "-NodePath", args.NodePath],
    )
    print(fixture_run["Output"])
    gate_results.append(
        {
            "name": os.path.basename(fixture_run["ScriptPath"]),
            "mode": "FixtureOnly",
            "exit_code": fixture_run["ExitCode"],
            "status": "PASS" if fixture_run["ExitCode"] == 0 else "FAIL",
            "evidence": fixture_evidence_path,
        }
    )
    if fixture_run["ExitCode"] != 0:
        add_failure("fixture product-loop harness failed")
    elif not os.path.isfile(fixture_evidence_path):
        add_failure("fixture product-loop evidence was not written")
    else:
        with open(fixture_evidence_path, encoding="utf-8") as handle:
            fixture_evidence = json.load(handle)
        validate_fixture_evidence(fixture_evidence)

    if args.Mode == "ApprovedRealReview":
        step("Approved real observed-dispatch review")
        if not args.ApproveRealEvidence:
            add_failure("ApprovedRealReview requires -ApproveRealEvidence")
        if not args.ObservedEvidencePath.strip():
            add_failure("ApprovedRealReview requires -ObservedEvidencePath")
        else:
            observed_report_path = os.path.join(artifact_root, "observed-dispatch-report.json")
            observed_args = [
                "-RepoRoot", repo_root,
                "-ObservedEvidencePath", args.ObservedEvidencePath,
                "-EvidencePath", observed_report_path,
            ]
            if args.ApproveRealEvidence:
                observed_args.append("-AllowRealTestedApproval")
            observed_run = invoke_repo_script(
                repo_root,
                resolve_repo_script(repo_root, os.path.join("scripts", "smoke", "verify-observed-localhost-dispatch")),
                observed_args,
            )
            print(observed_run["Output"])
            gate_results.append(
                {
                    "name": os.path.basename(observed_run["ScriptPath"]),
                    "mode": "ApprovedRealReview",
                    "exit_code": observed_run["ExitCode"],
                    "status": "PASS" if observed_run["ExitCode"] == 0 else "FAIL",
                    "evidence": observed_report_path,
                }
            )
            if observed_run["ExitCode"] != 0:
                add_failure("observed localhost dispatch review failed")
            elif os.path.isfile(observed_report_path):
                with open(observed_report_path, encoding="utf-8") as handle:
                    observed_json = json.load(handle)
                if observed_json.get("real_tested") is True and args.ApproveRealEvidence:
                    real_tested = True
                    pass_check("ApprovedRealReview accepted approval-gated real_tested evidence")
                else:
                    add_warning("ApprovedRealReview passed without promoting real_tested=true")

    if not failures:
        if args.Mode == "ApprovedRealReview" and real_tested:
            status = "P0_LOCAL_PRODUCT_LOOP_APPROVED_REAL_PASSED"
        elif args.Mode == "ApprovedRealReview":
            status = "P0_LOCAL_PRODUCT_LOOP_APPROVED_REVIEW_PASSED"
        else:
            status = "P0_LOCAL_PRODUCT_LOOP_FIXTURE_PASSED"
    else:
        status = "P0_LOCAL_PRODUCT_LOOP_EVIDENCE_FAILED"

    write_report(status, args.Mode, evidence_path, artifact_root, repo_root, args.NodePath)

    step("Boundary summary")
    print("  Fixture chain includes Web -> Hub -> Desktop sidecar -> Local Edge -> fixture adapter -> Hub replay -> Web render.")
    print("  Web boundary is Hub-only; direct Local Edge proof remains rejected.")
    print("  Desktop boundary uses Local Edge sidecar fixture; no UI/direct CLI spawn is certified here.")
    print(f"  EvidencePath: {evidence_path}")
    print(f"  RealTested={str(real_tested).lower()}")
    print(f"Status: {status}")

    return 0 if not failures else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'，禁止静默吞错
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
