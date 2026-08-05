#!/usr/bin/env python3
"""verify-remote-control-fixture-e2e — 离线 Remote-Control Fixture E2E 证据门禁（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

本门禁 fixture-only by design：不跑 TokenDanceID 登录、不起 Hub/Desktop/Edge 服务、
不调真实 CLI/model、不部署、不碰 mobile。它证明本地链路形状与要求的证据标识。

契约：stdlib only；CLI 参数/退出码与 ps1 一致（0=通过/1=失败）；机器可读行
（`  PASS  `/`  FAIL  `）格式与原 ps1 一致；子脚本按扩展名分发（.py → python，
.ps1 → pwsh），迁移过渡期二者皆可。
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

passed = 0
failed = 0


def pass_check(text: str) -> None:
    global passed
    passed += 1
    print(f"  PASS  {text}")


def fail_check(text: str, detail: str = "") -> None:
    global failed
    failed += 1
    print(f"  FAIL  {text}")
    if detail.strip():
        print(f"        {detail}")


def step(text: str) -> None:
    print(f"\n=== {text} ===")


def resolve_repo_path(repo_root: str, path_value: str):
    if not path_value or not path_value.strip():
        return None
    if os.path.isabs(path_value) or os.path.splitdrive(path_value)[0]:
        return path_value
    return os.path.join(repo_root, path_value)


def count_items(value) -> int:
    if value is None:
        return 0
    if isinstance(value, list):
        return len(value)
    if isinstance(value, (dict, str)):
        return 1
    return len(list(value)) if hasattr(value, "__iter__") else 1


def find_powershell():
    return shutil.which("pwsh") or shutil.which("powershell")


def invoke_script(script_path: str, arguments: list) -> dict:
    """按扩展名分发：.py 走 python，.ps1 走 pwsh；合并捕获输出，镜像 ps1 Invoke-Script。"""
    is_python = script_path.endswith(".py")
    if is_python:
        python_exe = shutil.which("python") or shutil.which("python3")
        if not python_exe:
            return {"ExitCode": -1, "Output": "Python executable is unavailable."}
        command = [python_exe, script_path, *arguments]
    else:
        powershell_exe = find_powershell()
        if not powershell_exe:
            return {"ExitCode": -1, "Output": "PowerShell executable is unavailable."}
        command = [powershell_exe, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script_path, *arguments]
    try:
        run = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
        return {"ExitCode": run.returncode, "Output": (run.stdout or "") + "\n" + (run.stderr or "")}
    except Exception as exc:  # noqa: BLE001 —— 对齐 ps1 try/catch 返回 ExitCode=-1 的语义
        return {"ExitCode": -1, "Output": str(exc)}


def test_required_string(obj, field: str, label: str) -> bool:
    if obj is not None and str(obj.get(field) or "").strip():
        pass_check(f"{label} contains {field}")
        return True
    fail_check(f"{label} contains {field}")
    return False


def get_event_by_id(events: list, event_id: str):
    for event in events or []:
        if event.get("id") == event_id:
            return event
    return None


def get_event_id_from_ref(event_ref: str):
    if not event_ref or not event_ref.strip():
        return None
    return event_ref.split(":")[-1]


def test_event_ref_resolves(events: list, event_ref: str, label: str) -> bool:
    if not event_ref or not event_ref.strip():
        fail_check(f"{label} is not blank")
        return False
    pass_check(f"{label} is not blank")

    event_id = get_event_id_from_ref(event_ref)
    if not event_id:
        fail_check(f"{label} resolves to an evidence event")
        return False
    if get_event_by_id(events, event_id) is not None:
        pass_check(f"{label} resolves to an evidence event")
        return True
    fail_check(f"{label} resolves to an evidence event", f"eventRef={event_ref}")
    return False


def test_event_field(events: list, event_id: str, field: str, expected) -> bool:
    event = get_event_by_id(events, event_id)
    if event is None:
        fail_check(f"event {event_id} exists")
        return False
    if str(event.get(field)) == str(expected):
        pass_check(f"event {event_id} carries {field}")
        return True
    fail_check(f"event {event_id} carries {field}", f"expected={expected} actual={event.get(field)}")
    return False


def resolve_repo_script(repo_root: str, relative_without_extension: str) -> str:
    """优先 .py、回退 .ps1，迁移过渡期内 ps1 删除后自动指向 python 实现。"""
    for extension in (".py", ".ps1"):
        candidate = os.path.join(repo_root, relative_without_extension + extension)
        if os.path.isfile(candidate):
            return candidate
    return os.path.join(repo_root, relative_without_extension + ".ps1")


def main() -> int:
    global passed, failed
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--ScenarioManifest", "-ScenarioManifest", default="tests/fixtures/teamrun/teamrun-demo-scenario.json")
    parser.add_argument("--EvidencePath", "-EvidencePath", default="")
    parser.add_argument("--OutputRoot", "-OutputRoot", default=".tmp/teamrun-evidence")
    parser.add_argument("--Stamp", "-Stamp", default="")
    args = parser.parse_args()

    repo_root = os.path.realpath(REPO_ROOT)
    if not args.Stamp.strip():
        args.Stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")

    exporter_path = resolve_repo_script(repo_root, os.path.join("scripts", "lib", "export-teamrun-demo-fixture-evidence"))
    readiness_path = os.path.join(repo_root, "scripts", "verify", "verify-teamrun-demo-readiness.py")

    step("Fixture boundary")
    pass_check("FixtureRehearsal only: no TokenDanceID, real CLI/model, deployment, or mobile")

    resolved_evidence = resolve_repo_path(repo_root, args.EvidencePath)
    if not resolved_evidence:
        step("Export fixture evidence")
        export_run = invoke_script(
            exporter_path,
            [
                "-ScenarioManifest", resolve_repo_path(repo_root, args.ScenarioManifest),
                "-OutputRoot", resolve_repo_path(repo_root, args.OutputRoot),
                "-Stamp", args.Stamp,
            ],
        )
        if export_run["ExitCode"] == 0:
            pass_check("fixture exporter exits successfully")
        else:
            fail_check("fixture exporter exits successfully", export_run["Output"])
        resolved_evidence = os.path.join(resolve_repo_path(repo_root, args.OutputRoot), f"teamrun-demo-{args.Stamp}", "teamrun-evidence.json")

    step("Evidence file")
    if resolved_evidence and os.path.isfile(resolved_evidence):
        pass_check("remote-control fixture evidence exists")
    else:
        fail_check("remote-control fixture evidence exists", f"path={resolved_evidence}")

    evidence = None
    if resolved_evidence and os.path.isfile(resolved_evidence):
        try:
            with open(resolved_evidence, encoding="utf-8") as handle:
                evidence = json.load(handle)
            pass_check("remote-control fixture evidence parses")
        except Exception as exc:  # noqa: BLE001 —— 对齐 ps1 catch 语义
            fail_check("remote-control fixture evidence parses", str(exc))

    if evidence is not None:
        step("Readiness mode")
        readiness_run = invoke_script(readiness_path, ["-EvidencePath", resolved_evidence, "-Mode", "FixtureRehearsal"])
        if readiness_run["ExitCode"] == 0:
            pass_check("TeamRun readiness accepts FixtureRehearsal evidence")
        else:
            fail_check("TeamRun readiness accepts FixtureRehearsal evidence", readiness_run["Output"])

        if (evidence.get("source") or {}).get("fixture_only") is True:
            pass_check("evidence is marked fixture_only")
        else:
            fail_check("evidence is marked fixture_only")
        claims = evidence.get("claims") or {}
        if (
            claims.get("real_runtime_executed") is False
            and claims.get("live_hub_runtime_verified") is False
            and claims.get("final_recording_complete") is False
            and claims.get("submission_ready") is False
        ):
            pass_check("FixtureRehearsal keeps RealTested and Submission claims false")
        else:
            fail_check("FixtureRehearsal keeps RealTested and Submission claims false")

        step("Remote-control manifest")
        manifest = evidence.get("remote_control_manifest")
        if manifest is None:
            fail_check("remote-control manifest is present")
        else:
            pass_check("remote-control manifest is present")
            for field in ("hubTaskId", "targetId", "edgeDeviceId", "edgeRunId", "adapterId", "mode", "startedAt"):
                test_required_string(manifest, field, "remote-control manifest")
            if manifest.get("mode") == "FixtureRehearsal":
                pass_check("remote-control manifest mode is FixtureRehearsal")
            else:
                fail_check("remote-control manifest mode is FixtureRehearsal", f"actual={manifest.get('mode')}")
            if count_items(manifest.get("eventRefs")) >= 4:
                pass_check("remote-control manifest contains eventRefs for the chain")
            else:
                fail_check("remote-control manifest contains eventRefs for the chain")
            for event_ref in manifest.get("eventRefs") or []:
                test_event_ref_resolves(evidence.get("events") or [], str(event_ref), "remote-control eventRef")

        if manifest is not None:
            step("Local chain shape")
            required_stages = [
                ("web_start", "Web starts TeamRun with target_id"),
                ("hub_exact_route", "Hub exact-routes to Desktop/Edge target"),
                ("desktop_bridge_start", "Desktop bridge starts Local Edge run fixture"),
                ("edge_events_callback", "Edge emits/callbacks fixture events"),
                ("adapter_callback_result", "Adapter result/callback is emitted"),
                ("hub_replay", "Hub replay records completed fixture chain"),
                ("manifest_validated", "FixtureRehearsal manifest validates"),
            ]
            chain = manifest.get("chain") or []
            last_index = -1
            for stage_name, label in required_stages:
                index = next((i for i, entry in enumerate(chain) if entry.get("stage") == stage_name), -1)
                if index > last_index:
                    pass_check(label)
                    last_index = index
                else:
                    fail_check(label)
            manifest_event_refs = set(str(ref) for ref in manifest.get("eventRefs") or [])
            for stage in chain:
                event_ref = str(stage.get("eventRef") or "")
                test_event_ref_resolves(evidence.get("events") or [], event_ref, f"chain stage {stage.get('stage')} eventRef")
                if event_ref in manifest_event_refs:
                    pass_check(f"chain stage {stage.get('stage')} eventRef is listed in manifest eventRefs")
                else:
                    fail_check(f"chain stage {stage.get('stage')} eventRef is listed in manifest eventRefs")

            state = evidence.get("state") or {}
            if state.get("target_id") == manifest.get("targetId"):
                pass_check("TeamRun state carries the same target_id")
            else:
                fail_check("TeamRun state carries the same target_id")
            if state.get("edge_device_id") == manifest.get("edgeDeviceId"):
                pass_check("TeamRun state carries the exact Desktop/Edge device")
            else:
                fail_check("TeamRun state carries the exact Desktop/Edge device")

            task = next((entry for entry in evidence.get("tasks") or [] if entry.get("id") == manifest.get("hubTaskId")), None)
            if task is not None:
                pass_check("Hub task named by manifest exists")
                for field, expected in (
                    ("target_id", manifest.get("targetId")),
                    ("edge_device_id", manifest.get("edgeDeviceId")),
                    ("edge_run_id", manifest.get("edgeRunId")),
                    ("adapter_id", manifest.get("adapterId")),
                ):
                    if str(task.get(field)) == str(expected):
                        pass_check(f"Hub task carries {field}")
                    else:
                        fail_check(f"Hub task carries {field}", f"expected={expected} actual={task.get(field)}")
            else:
                fail_check("Hub task named by manifest exists")

            test_event_field(evidence.get("events") or [], "evt-remote-001", "target_id", manifest.get("targetId"))
            test_event_field(evidence.get("events") or [], "evt-remote-002", "edge_device_id", manifest.get("edgeDeviceId"))
            test_event_field(evidence.get("events") or [], "evt-remote-004", "edge_run_id", manifest.get("edgeRunId"))
            test_event_field(evidence.get("events") or [], "evt-remote-004", "adapter_id", manifest.get("adapterId"))
            test_event_field(evidence.get("events") or [], "evt-remote-005", "edge_run_id", manifest.get("edgeRunId"))
            test_event_field(evidence.get("events") or [], "evt-remote-005", "adapter_id", manifest.get("adapterId"))
            test_event_field(evidence.get("events") or [], "evt-remote-006", "edge_run_id", manifest.get("edgeRunId"))

        step("Requirement/evidence matrix")
        matrix = evidence.get("evidence_matrix") or []
        required_matrix_items = [
            "im_or_teamrun_start",
            "target_id",
            "exact_desktop_edge_device",
            "edge_run_id",
            "adapter_id",
            "route_task_event_replay",
            "transcript_render_evidence",
            "artifact_diff_preview",
            "mode_labels",
        ]
        for item in required_matrix_items:
            row = next((entry for entry in matrix if entry.get("requirement_id") == item), None)
            if row is None:
                fail_check(f"matrix includes {item}")
                continue
            pass_check(f"matrix includes {item}")
            if str(row.get("fixture_evidence") or "").strip():
                pass_check(f"matrix {item} has fixture evidence")
            else:
                fail_check(f"matrix {item} has fixture evidence")
            if str(row.get("real_tested_requirement") or "").strip():
                pass_check(f"matrix {item} has RealTested requirement")
            else:
                fail_check(f"matrix {item} has RealTested requirement")
            if row.get("mode_label") == "FixtureRehearsal":
                pass_check(f"matrix {item} labels FixtureRehearsal")
            else:
                fail_check(f"matrix {item} labels FixtureRehearsal")

    print(f"\nRemote-control fixture E2E gate: {passed} passed, {failed} failed")
    return 1 if failed > 0 else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'，禁止静默吞错
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
