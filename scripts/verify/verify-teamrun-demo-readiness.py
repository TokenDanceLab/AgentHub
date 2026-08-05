#!/usr/bin/env python3
"""verify-teamrun-demo-readiness — TeamRun demo 证据包结构就绪门禁（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

本地 TeamRun demo 证据包离线、无 secret 的结构就绪检查：不运行 agent CLI、
不调模型 API、不起本地服务、不上传产物。只有最终 3 分钟录制存在后才能用
-RequireVideo。模式：Submission（默认，拒绝 fixture-only 证据）/
FixtureRehearsal / Mock / RealTested。
"""

import argparse
import json
import os
import re
import sys

VALID_MODES = ["Submission", "FixtureRehearsal", "Mock", "RealTested"]


def find_repo_root() -> str:
    root = os.path.dirname(os.path.abspath(__file__))
    for _ in range(4):
        if os.path.isfile(os.path.join(root, "AGENTS.md")):
            return root
        root = os.path.dirname(root)
    raise RuntimeError("cannot locate AgentHub repository root")


def is_path_rooted(path_value: str) -> bool:
    return os.path.isabs(path_value) or bool(re.match(r"^[A-Za-z]:[\\/]", path_value))


def resolve_repo_path(repo_root: str, path_value: str):
    if not path_value or not path_value.strip():
        return None
    if is_path_rooted(path_value):
        return path_value
    return os.path.join(repo_root, path_value)


def startswith_ci(value: str, prefix: str) -> bool:
    return value.casefold().startswith(prefix.casefold())


def find_latest_evidence(repo_root: str):
    latest = None
    latest_mtime = -1.0
    for root in (".tmp/submission-evidence", ".tmp/teamrun-evidence"):
        resolved_root = os.path.join(repo_root, root)
        if not os.path.isdir(resolved_root):
            continue
        for dirpath, _dirnames, filenames in os.walk(resolved_root):
            for name in filenames:
                if name != "teamrun-evidence.json":
                    continue
                full = os.path.join(dirpath, name)
                mtime = os.path.getmtime(full)
                if mtime > latest_mtime:
                    latest = full
                    latest_mtime = mtime
    return latest


def count_items(value) -> int:
    if value is None:
        return 0
    if isinstance(value, list):
        return len(value)
    return 1


def test_required_string(obj, field: str, label: str) -> bool:
    value = obj.get(field) if isinstance(obj, dict) else None
    if obj is not None and isinstance(value, str) and value.strip():
        pass_check(f"{label} contains {field}")
        return True
    fail_check(f"{label} contains {field}")
    return False


def test_real_proof(evidence: dict, submission_mode: bool) -> bool:
    ok = True
    required_proof_fields = (
        "webActionRef",
        "hubDispatchRef",
        "desktopEdgeRef",
        "localEdgeRunRef",
        "cliAdapterRef",
        "hubStateExportRef",
    )
    claims = evidence.get("claims") or {}

    if evidence.get("real_proof") is None:
        fail_check("real evidence requires real_proof")
        ok = False
    else:
        pass_check("real evidence requires real_proof")
        for field in required_proof_fields:
            if not test_required_string(evidence["real_proof"], field, "real_proof"):
                ok = False

    if claims.get("real_runtime_executed") is True:
        pass_check("real evidence has real_runtime_executed=true")
    else:
        fail_check("real evidence requires real_runtime_executed=true")
        ok = False
    if claims.get("live_hub_runtime_verified") is True:
        pass_check("real evidence has live_hub_runtime_verified=true")
    else:
        fail_check("real evidence requires live_hub_runtime_verified=true")
        ok = False

    if submission_mode:
        if claims.get("final_recording_complete") is True:
            pass_check("submission mode has final recording claim")
        else:
            fail_check("submission mode requires final_recording_complete=true")
            ok = False
        if claims.get("submission_ready") is True:
            pass_check("submission mode has submission-ready claim")
        else:
            fail_check("submission mode requires submission_ready=true")
            ok = False

    return ok


passed = 0
failed = 0


def pass_check(text: str) -> None:
    global passed
    passed += 1
    print(f"  PASS  {text}")


def fail_check(text: str) -> None:
    global failed
    failed += 1
    print(f"  FAIL  {text}")


def step(text: str) -> None:
    print(f"\n=== {text} ===")


def main() -> int:
    global passed, failed
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("-EvidencePath", "--EvidencePath", default=None)
    parser.add_argument("-ManifestPath", "--ManifestPath", default=None)
    parser.add_argument("-VideoPath", "--VideoPath", default=None)
    parser.add_argument("-Mode", "--Mode", choices=VALID_MODES, default="Submission")
    parser.add_argument("-RequireVideo", "--RequireVideo", action="store_true")
    args = parser.parse_args()

    repo_root = find_repo_root()
    passed = 0
    failed = 0

    mode = args.Mode
    require_video = args.RequireVideo

    step("Evidence file")
    resolved_evidence = resolve_repo_path(repo_root, args.EvidencePath)
    if not resolved_evidence:
        resolved_evidence = find_latest_evidence(repo_root)
    if not resolved_evidence or not os.path.isfile(resolved_evidence):
        fail_check("teamrun evidence JSON exists")
    else:
        pass_check("teamrun evidence JSON exists")

    evidence = None
    if resolved_evidence and os.path.isfile(resolved_evidence):
        try:
            with open(resolved_evidence, encoding="utf-8-sig") as handle:
                evidence = json.load(handle)
            pass_check("teamrun evidence JSON parses")
        except Exception as exc:  # noqa: BLE001 —— 对齐 ps1 try/catch 的解析失败路径
            fail_check(f"teamrun evidence JSON parses: {exc}")

    if evidence:
        fixture_only = (evidence.get("source") or {}).get("fixture_only") is True
        mock_only = (evidence.get("source") or {}).get("mock_only") is True
        remote_manifest = evidence.get("remote_control_manifest")
        if isinstance(remote_manifest, dict) and remote_manifest.get("mode") == "Mock":
            mock_only = True

        step("Evidence shape")
        for field in ("state", "tasks", "assignments", "events", "runtime_profiles", "screenshot_or_video_rehearsal"):
            if evidence.get(field) is not None:
                pass_check(f"evidence contains {field}")
            else:
                fail_check(f"evidence contains {field}")

        runtime_profiles_count = count_items(evidence.get("runtime_profiles"))
        if runtime_profiles_count >= 2:
            pass_check("runtime_profiles contains at least two profiles")
        else:
            fail_check(f"runtime_profiles contains at least two profiles (actual: {runtime_profiles_count})")

        runtime_types = 0
        counts = evidence.get("counts")
        if isinstance(counts, dict) and counts.get("runtime_types") is not None:
            runtime_types = int(counts.get("runtime_types"))
        elif evidence.get("runtime_profiles") is not None:
            profile_values = [
                profile.get("runtime_type")
                for profile in evidence["runtime_profiles"]
                if profile.get("runtime_type")
            ]
            runtime_types = len({str(value).casefold() for value in profile_values})
        if runtime_types >= 2:
            pass_check("evidence proves at least two runtime types")
        else:
            fail_check(f"evidence proves at least two runtime types (actual: {runtime_types})")

        step("Remote-control evidence manifest")
        remote_manifest_required = mode != "FixtureRehearsal" or evidence.get("remote_control_manifest") is not None
        if not remote_manifest_required:
            pass_check("remote-control manifest not required for legacy fixture rehearsal")
        elif evidence.get("remote_control_manifest") is None:
            fail_check("remote-control manifest is present")
        else:
            pass_check("remote-control manifest is present")
            manifest = evidence["remote_control_manifest"]
            for field in ("hubTaskId", "targetId", "edgeDeviceId", "edgeRunId", "adapterId", "mode", "startedAt"):
                test_required_string(manifest, field, "remote-control manifest")
            event_ref_count = count_items(manifest.get("eventRefs"))
            if event_ref_count >= 4:
                pass_check("remote-control manifest contains eventRefs for the chain")
            else:
                fail_check(f"remote-control manifest contains eventRefs for the chain (actual: {event_ref_count})")
            redaction = manifest.get("redaction")
            if isinstance(redaction, dict) and isinstance(redaction.get("status"), str) and redaction.get("status").strip():
                pass_check("remote-control manifest contains redaction status")
                if redaction.get("status") in ("redacted", "not_required"):
                    pass_check("remote-control manifest redaction status is acceptable")
                else:
                    fail_check("remote-control manifest redaction status is acceptable")
            else:
                fail_check("remote-control manifest contains redaction status")
            if manifest.get("mode") == mode:
                pass_check("remote-control manifest mode matches readiness mode")
            else:
                fail_check("remote-control manifest mode matches readiness mode")

        step("Evidence taxonomy")
        if evidence.get("contract") == "teamrun-demo-evidence-v1":
            pass_check("teamrun evidence contract")
        else:
            fail_check("teamrun evidence contract")

        if fixture_only:
            pass_check("fixture-only source is declared")
        else:
            pass_check("source is not marked fixture-only")

        claims = evidence.get("claims")
        if claims is None:
            fail_check("evidence claims are present")
        else:
            pass_check("evidence claims are present")

            claims_violation = (
                claims.get("real_runtime_executed") is not False
                or claims.get("final_recording_complete") is not False
                or claims.get("submission_ready") is not False
            )
            if fixture_only and claims_violation:
                fail_check("fixture evidence cannot claim real runtime, final recording, or submission readiness")
            elif fixture_only:
                pass_check("fixture evidence keeps runtime, recording, and submission claims false")

            if mode == "FixtureRehearsal":
                if (
                    fixture_only
                    and claims.get("real_runtime_executed") is False
                    and claims.get("final_recording_complete") is False
                    and claims.get("submission_ready") is False
                ):
                    pass_check("fixture rehearsal mode accepts honest fixture claims")
                else:
                    fail_check("fixture rehearsal mode requires honest fixture claims")
            elif mode == "Mock":
                if (
                    mock_only
                    and claims.get("real_runtime_executed") is False
                    and claims.get("final_recording_complete") is False
                    and claims.get("submission_ready") is False
                ):
                    pass_check("mock mode accepts honest mock claims")
                else:
                    fail_check("mock mode requires mock-only evidence with real, recording, and submission claims false")
            elif mode == "RealTested":
                if fixture_only:
                    fail_check("real-tested mode rejects fixture-only evidence")
                else:
                    pass_check("real-tested mode evidence is not fixture-only")
                if mock_only:
                    fail_check("real-tested mode rejects mock-only evidence")
                else:
                    pass_check("real-tested mode evidence is not mock-only")
                test_real_proof(evidence, False)
            else:
                if fixture_only:
                    fail_check("submission mode rejects fixture-only evidence")
                else:
                    pass_check("submission mode evidence is not fixture-only")
                if mock_only:
                    fail_check("submission mode rejects mock-only evidence")
                else:
                    pass_check("submission mode evidence is not mock-only")
                test_real_proof(evidence, True)

        rehearsal = evidence.get("screenshot_or_video_rehearsal")
        if rehearsal is not None:
            rehearsal_violation = (
                rehearsal.get("real_runtime_executed") is not False
                or rehearsal.get("final_recording_complete") is not False
                or rehearsal.get("submission_ready") is not False
            )
            if fixture_only and rehearsal_violation:
                fail_check("fixture screenshot/video rehearsal metadata keeps readiness claims false")
            else:
                pass_check("screenshot/video rehearsal metadata is honest")

    step("Manifest")
    resolved_manifest = resolve_repo_path(repo_root, args.ManifestPath)
    manifest_required = False
    if not resolved_manifest and resolved_evidence:
        candidate = os.path.join(os.path.dirname(resolved_evidence), "manifest.md")
        if os.path.isfile(candidate):
            resolved_manifest = candidate
    submission_root = os.path.join(repo_root, ".tmp", "submission-evidence")
    if args.ManifestPath or (
        resolved_evidence and startswith_ci(resolved_evidence, submission_root)
    ):
        manifest_required = True
    if resolved_manifest and os.path.isfile(resolved_manifest):
        pass_check("submission manifest exists")
    elif manifest_required:
        fail_check("submission manifest exists")
    else:
        pass_check("submission manifest not required for raw evidence readiness")

    step("Video")
    resolved_video = resolve_repo_path(repo_root, args.VideoPath)
    video_required = require_video or mode == "Submission"
    if video_required:
        if resolved_video and os.path.isfile(resolved_video):
            pass_check("final demo video exists")
        else:
            fail_check("final demo video exists")
    elif resolved_video and os.path.isfile(resolved_video):
        pass_check("optional demo video exists")
    else:
        pass_check("video not required for this offline readiness pass")

    print(f"\nTeamRun demo readiness: {passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'，禁止静默吞错
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
