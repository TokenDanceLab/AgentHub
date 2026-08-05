#!/usr/bin/env python3
"""export-teamrun-demo-fixture-evidence — 导出 fixture-only TeamRun demo 证据包（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

按 scenario manifest 离线导出 fixture 证据包。本脚本 offline by design：
不跑 agent CLI、不调 model API、不起 Hub/Edge 服务、不上传 artifact、
不声称 final recording。

契约：stdlib only；参数名/退出码与 ps1 一致（0=通过/1=失败）；stdout 行
（`Created fixture-only TeamRun evidence:` / `  <path>` / `Manifest:`）与原 ps1
一致；证据 JSON 用 ConvertTo-Json 等价格式（2-space indent）；校验失败抛
ERROR → 非零退出（对齐 $ErrorActionPreference='Stop'）。
"""

import argparse
import datetime
import json
import os
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))


def count_items(value) -> int:
    if value is None:
        return 0
    if isinstance(value, list):
        return len(value)
    if isinstance(value, (dict, str)):
        return 1
    return len(list(value)) if hasattr(value, "__iter__") else 1


def resolve_repo_path(repo_root: str, path_value: str):
    if not path_value or not path_value.strip():
        return None
    if os.path.isabs(path_value) or os.path.splitdrive(path_value)[0]:
        return path_value
    return os.path.join(repo_root, path_value)


def get_runtime_profiles(scenario: dict) -> list:
    if scenario.get("runtime_profiles") is not None:
        return list(scenario["runtime_profiles"])
    return list(scenario.get("agent_profiles") or [])


def test_required_string(obj, field: str, label: str) -> None:
    if obj is None or not str(obj.get(field) or "").strip():
        raise RuntimeError(f"{label} must include {field}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--ScenarioManifest", "-ScenarioManifest", default="tests/fixtures/teamrun/teamrun-demo-scenario.json")
    parser.add_argument("--OutputRoot", "-OutputRoot", default=".tmp/teamrun-evidence")
    parser.add_argument("--Stamp", "-Stamp", default="")
    args = parser.parse_args()

    repo_root = os.path.realpath(REPO_ROOT)
    if not args.Stamp.strip():
        args.Stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")

    resolved_scenario = resolve_repo_path(repo_root, args.ScenarioManifest)
    if not resolved_scenario or not os.path.isfile(resolved_scenario):
        raise RuntimeError(f"scenario manifest not found: {args.ScenarioManifest}")

    with open(resolved_scenario, encoding="utf-8-sig") as handle:
        scenario = json.load(handle)
    if scenario.get("contract") != "teamrun-demo-evidence-v1":
        raise RuntimeError(f"unsupported scenario contract: {scenario.get('contract')}")
    if scenario.get("fixture_only") is not True:
        raise RuntimeError("scenario must be fixture_only=true")
    claims = scenario.get("claims") or {}
    if claims.get("real_runtime_executed") is not False or claims.get("final_recording_complete") is not False:
        raise RuntimeError("fixture scenario must not claim real runtime execution or final recording completion")
    if claims.get("submission_ready") is not False:
        raise RuntimeError("fixture scenario must not claim submission readiness")
    rehearsal = scenario.get("screenshot_or_video_rehearsal")
    if rehearsal is None:
        raise RuntimeError("scenario must include screenshot_or_video_rehearsal metadata")
    if (
        rehearsal.get("real_runtime_executed") is not False
        or rehearsal.get("final_recording_complete") is not False
        or rehearsal.get("submission_ready") is not False
    ):
        raise RuntimeError("fixture rehearsal metadata must keep real_runtime_executed, final_recording_complete, and submission_ready false")

    runtime_profiles = get_runtime_profiles(scenario)
    runtime_types = sorted({profile.get("runtime_type") for profile in runtime_profiles if profile.get("runtime_type")})
    if len(runtime_types) < 2:
        raise RuntimeError("scenario must include at least two runtime types")

    remote_manifest = scenario.get("remote_control_manifest")
    if remote_manifest is not None:
        for field in ("hubTaskId", "targetId", "edgeDeviceId", "edgeRunId", "adapterId", "mode", "startedAt"):
            test_required_string(remote_manifest, field, "remote_control_manifest")
        if remote_manifest.get("mode") != "FixtureRehearsal":
            raise RuntimeError("fixture remote_control_manifest mode must be FixtureRehearsal")
        if count_items(remote_manifest.get("eventRefs")) < 4:
            raise RuntimeError("remote_control_manifest must include at least four eventRefs")
    if scenario.get("evidence_matrix") is None or count_items(scenario.get("evidence_matrix")) < 1:
        raise RuntimeError("scenario must include evidence_matrix")

    output_root_path = resolve_repo_path(repo_root, args.OutputRoot)
    output_dir = os.path.join(output_root_path, f"teamrun-demo-{args.Stamp}")
    os.makedirs(output_dir, exist_ok=True)

    commit = "unknown"
    try:
        run = subprocess.run(
            ["git", "-C", repo_root, "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if run.returncode == 0:
            commit = run.stdout.strip()
    except Exception:  # noqa: BLE001 —— 对齐 ps1 try/catch 回退 unknown
        commit = "unknown"

    generated_at = datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    evidence = {
        "contract": scenario.get("contract"),
        "manifest_schema": scenario.get("manifest_schema"),
        "generated_at": generated_at,
        "source": {
            "fixture_only": True,
            "scenario_manifest": "tests/fixtures/teamrun/teamrun-demo-scenario.json",
            "commit": commit,
            "real_runtime_executed": False,
            "final_recording_complete": False,
            "submission_ready": False,
        },
        "claims": claims,
        "scenario": {
            "scenario_id": scenario.get("scenario_id"),
            "title": scenario.get("title"),
            "boundaries": scenario.get("boundaries"),
        },
        "remote_control_manifest": remote_manifest,
        "state": scenario.get("state"),
        "tasks": list(scenario.get("tasks") or []),
        "assignments": list(scenario.get("assignments") or []),
        "events": list(scenario.get("events") or []),
        "runtime_profiles": list(runtime_profiles),
        "screenshot_or_video_rehearsal": rehearsal,
        "artifact_diff_preview": scenario.get("artifact_diff_preview"),
        "evidence_matrix": list(scenario.get("evidence_matrix") or []),
        "api_exports_required_for_real_demo": list(scenario.get("api_exports_required_for_real_demo") or []),
        "counts": {
            "runtime_profiles": count_items(runtime_profiles),
            "runtime_types": len(runtime_types),
            "tasks": count_items(scenario.get("tasks")),
            "assignments": count_items(scenario.get("assignments")),
            "events": count_items(scenario.get("events")),
            "screenshot_or_video_assets": count_items(rehearsal.get("current_assets")),
        },
    }

    evidence_path = os.path.join(output_dir, "teamrun-evidence.json")
    with open(evidence_path, "w", encoding="utf-8") as handle:
        json.dump(evidence, handle, ensure_ascii=False, indent=2)

    manifest_path = os.path.join(output_dir, "manifest.md")
    manifest_md = (
        "# TeamRun Fixture Evidence Package\n"
        "\n"
        f"Generated: {generated_at}\n"
        f"Commit: {commit}\n"
        f"Scenario: {scenario.get('scenario_id')}\n"
        f"Contract: {scenario.get('contract')}\n"
        "\n"
        "## Files\n"
        "\n"
        "- teamrun-evidence.json\n"
        "\n"
        "## Fixture Boundary\n"
        "\n"
        "- fixture_only: true\n"
        "- real_runtime_executed: false\n"
        "- final_recording_complete: false\n"
        "- submission_ready: false\n"
        f"- screenshot_or_video_rehearsal: {rehearsal.get('mode')}\n"
        "\n"
        "This package freezes the minimum evidence shape for the TeamRun demo.\n"
        "It is not the final 3-minute recording and is not proof of a real runtime run.\n"
        "\n"
        "## Evidence Summary\n"
        "\n"
        f"- runtime_profiles: {count_items(scenario.get('agent_profiles'))}\n"
        f"- runtime_types: {len(runtime_types)}\n"
        f"- tasks: {count_items(scenario.get('tasks'))}\n"
        f"- assignments: {count_items(scenario.get('assignments'))}\n"
        f"- events: {count_items(scenario.get('events'))}\n"
        f"- screenshot_or_video_assets: {count_items(rehearsal.get('current_assets'))}\n"
    )
    with open(manifest_path, "w", encoding="utf-8") as handle:
        handle.write(manifest_md)

    print("Created fixture-only TeamRun evidence:")
    print(f"  {os.path.normpath(evidence_path)}")
    print("Manifest:")
    print(f"  {os.path.normpath(manifest_path)}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'，禁止静默吞错
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
