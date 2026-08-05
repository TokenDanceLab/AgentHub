#!/usr/bin/env python3
"""verify-teamrun-demo-contract — TeamRun demo fixture 证据契约自测（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

对 TeamRun demo 证据链做离线合约自测：scenario manifest 冻结字段与 claims
诚实性；用 `scripts/lib/export-teamrun-demo-fixture-evidence.ps1` 生成 fixture
证据并校验证据形状；用 `scripts/verify/verify-teamrun-demo-readiness.py`
验证 Submission 模式拒绝 fixture-only、FixtureRehearsal 模式接受诚实 fixture
claims、mislabelled claims 被拒；再用 `scripts/lib/package-teamrun-demo-evidence.ps1`
打包并让 `scripts/lib/evidence/verify-redacted-manifest.ps1` 校验红名单（含
授权泄漏负向用例）。全程离线、无 secret。
"""

import argparse
import copy
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

FAILED = 0


def assert_true(condition: bool, message: str, details: str = "") -> None:
    global FAILED
    if condition:
        print(f"PASS: {message}")
        return
    FAILED += 1
    print(f"FAIL: {message}")
    if details.strip():
        print(details)


def is_path_rooted(path_value: str) -> bool:
    return os.path.isabs(path_value) or bool(re.match(r"^[A-Za-z]:[\\/]", path_value))


def sha256_hex(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def find_powershell():
    return shutil.which("pwsh") or shutil.which("powershell")


def invoke_process(file_name: str, arguments: list, working_directory: str) -> tuple:
    """运行子进程并合并捕获 stdout/stderr，镜像 ps1 Invoke-RepoScript。"""
    try:
        run = subprocess.run(
            [file_name, *arguments],
            cwd=working_directory,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        output = (run.stdout + "\n" + run.stderr).replace("\r\n", "\n")
        return run.returncode, output
    except Exception as exc:  # noqa: BLE001 —— 对齐 ps1 try/catch 的异常语义
        return -1, str(exc)


def invoke_repo_script(repo_root: str, script_path: str, arguments: list) -> tuple:
    powershell_exe = find_powershell()
    if not powershell_exe:
        return -1, "PowerShell executable is unavailable"
    return invoke_process(
        powershell_exe, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script_path, *arguments], repo_root
    )


def contains_ci(values: list, needle: str) -> bool:
    return any(str(value).casefold() == needle.casefold() for value in values)


def write_json(path: str, data: dict) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False)


def load_json(path: str) -> dict:
    with open(path, encoding="utf-8-sig") as handle:
        return json.load(handle)


def main() -> int:
    global FAILED
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("-RepoRoot", "--RepoRoot", default=".")
    args = parser.parse_args()

    repo_root = os.path.abspath(args.RepoRoot)
    FAILED = 0

    scenario_path = os.path.join(repo_root, "tests", "fixtures", "teamrun", "teamrun-demo-scenario.json")
    exporter_path = os.path.join(repo_root, "scripts", "lib", "export-teamrun-demo-fixture-evidence.ps1")
    package_path = os.path.join(repo_root, "scripts", "lib", "package-teamrun-demo-evidence.ps1")
    readiness_path = os.path.join(repo_root, "scripts", "verify", "verify-teamrun-demo-readiness.py")
    redacted_manifest_verifier_path = os.path.join(repo_root, "scripts", "lib", "evidence", "verify-redacted-manifest.py")

    assert_true(os.path.isfile(scenario_path), "TeamRun demo scenario manifest exists")
    assert_true(os.path.isfile(exporter_path), "TeamRun fixture evidence exporter exists")
    assert_true(os.path.isfile(package_path), "TeamRun evidence package script exists")
    assert_true(os.path.isfile(readiness_path), "TeamRun readiness checker exists")
    assert_true(os.path.isfile(redacted_manifest_verifier_path), "redacted evidence manifest checker exists")

    if os.path.isfile(scenario_path):
        scenario = load_json(scenario_path)
        assert_true(scenario.get("contract") == "teamrun-demo-evidence-v1", "scenario declares the frozen evidence contract")
        assert_true(scenario.get("fixture_only") is True, "scenario is explicitly fixture-only")
        scenario_claims = scenario.get("claims") or {}
        assert_true(scenario_claims.get("real_runtime_executed") is False, "scenario does not claim real runtime execution")
        assert_true(scenario_claims.get("final_recording_complete") is False, "scenario does not claim the final demo recording")
        assert_true(scenario_claims.get("submission_ready") is False, "scenario does not claim submission readiness")
        assert_true(scenario.get("manifest_schema") is not None, "scenario declares manifest schema metadata")
        assert_true(scenario.get("screenshot_or_video_rehearsal") is not None, "scenario declares screenshot/video rehearsal metadata")
        rehearsal = scenario.get("screenshot_or_video_rehearsal") or {}
        assert_true(rehearsal.get("real_runtime_executed") is False, "rehearsal metadata does not claim real runtime execution")
        assert_true(rehearsal.get("final_recording_complete") is False, "rehearsal metadata does not claim final recording completion")
        assert_true(rehearsal.get("submission_ready") is False, "rehearsal metadata does not claim submission readiness")

        runtime_types = len(
            {
                str(profile.get("runtime_type")).casefold()
                for profile in scenario.get("runtime_profiles") or []
                if profile.get("runtime_type")
            }
        )
        assert_true(runtime_types >= 2, "scenario includes at least two runtime types", f"runtime_types={runtime_types}")

        for field in (
            "state",
            "tasks",
            "assignments",
            "events",
            "runtime_profiles",
            "screenshot_or_video_rehearsal",
            "remote_control_manifest",
            "evidence_matrix",
        ):
            assert_true(
                contains_ci(scenario.get("required_evidence_fields") or [], field),
                f"scenario requires evidence field {field}",
            )
        assert_true(scenario.get("remote_control_manifest") is not None, "scenario declares remote-control manifest")
        if scenario.get("remote_control_manifest") is not None:
            remote_manifest = scenario["remote_control_manifest"]
            for field in ("targetId", "edgeDeviceId", "edgeRunId", "adapterId"):
                value = remote_manifest.get(field)
                assert_true(
                    isinstance(value, str) and value.strip(),
                    f"scenario remote-control manifest contains {field}",
                )
            assert_true(remote_manifest.get("mode") == "FixtureRehearsal", "scenario remote-control manifest labels FixtureRehearsal")
        matrix_ids = [entry.get("requirement_id") for entry in scenario.get("evidence_matrix") or []]
        for requirement_id in (
            "im_or_teamrun_start",
            "target_id",
            "exact_desktop_edge_device",
            "edge_run_id",
            "adapter_id",
            "route_task_event_replay",
            "transcript_render_evidence",
            "artifact_diff_preview",
            "mode_labels",
        ):
            assert_true(contains_ci(matrix_ids, requirement_id), f"scenario evidence matrix includes {requirement_id}")

    if os.path.isfile(scenario_path) and os.path.isfile(exporter_path):
        tmp_root = os.path.join(tempfile.gettempdir(), f"agenthub-teamrun-contract-{os.getpid()}")
        shutil.rmtree(tmp_root, ignore_errors=True)
        os.makedirs(tmp_root, exist_ok=True)

        export = invoke_repo_script(
            repo_root,
            exporter_path,
            ["-ScenarioManifest", scenario_path, "-OutputRoot", tmp_root, "-Stamp", "contract-test"],
        )
        assert_true(export[0] == 0, "fixture exporter exits successfully", export[1])

        export_dir = os.path.join(tmp_root, "teamrun-demo-contract-test")
        evidence_path = os.path.join(export_dir, "teamrun-evidence.json")
        manifest_path = os.path.join(export_dir, "manifest.md")
        assert_true(os.path.isfile(evidence_path), "fixture exporter writes teamrun-evidence.json")
        assert_true(os.path.isfile(manifest_path), "fixture exporter writes package manifest")

        if os.path.isfile(evidence_path):
            evidence = load_json(evidence_path)
            assert_true((evidence.get("source") or {}).get("fixture_only") is True, "exported evidence is marked fixture-only")
            evidence_claims = evidence.get("claims") or {}
            assert_true(evidence_claims.get("real_runtime_executed") is False, "exported evidence does not claim real runtime execution")
            assert_true(evidence_claims.get("final_recording_complete") is False, "exported evidence does not claim final recording completion")
            assert_true(evidence_claims.get("submission_ready") is False, "exported evidence does not claim submission readiness")
            runtime_types_count = int((evidence.get("counts") or {}).get("runtime_types") or 0)
            assert_true(runtime_types_count >= 2, "exported evidence proves at least two runtime types")
            event_types = [event.get("type") for event in evidence.get("events") or []]
            assert_true(contains_ci(event_types, "team.route.decided"), "exported evidence includes route decision event")
            task_roles = [task.get("role") for task in evidence.get("tasks") or []]
            assert_true(contains_ci(task_roles, "worker"), "exported evidence includes worker task")
            assert_true(evidence.get("screenshot_or_video_rehearsal") is not None, "exported evidence includes screenshot/video rehearsal metadata")
            assert_true(evidence.get("remote_control_manifest") is not None, "exported evidence includes remote-control manifest")
            assert_true(evidence.get("evidence_matrix") is not None, "exported evidence includes requirement/evidence matrix")
            assert_true(
                (evidence.get("artifact_diff_preview") or {}).get("status") == "not_available",
                "exported evidence explicitly labels artifact/diff/preview availability",
            )

            submission_readiness = invoke_process(
                sys.executable,
                [readiness_path, "-EvidencePath", evidence_path, "-ManifestPath", manifest_path],
                repo_root,
            )
            assert_true(
                submission_readiness[0] != 0,
                "readiness checker rejects fixture evidence in default submission mode",
                submission_readiness[1],
            )
            assert_true(
                re.search("submission mode rejects fixture-only evidence", submission_readiness[1], re.IGNORECASE),
                "readiness checker names the submission fixture block",
                submission_readiness[1],
            )

            rehearsal_readiness = invoke_process(
                sys.executable,
                [readiness_path, "-EvidencePath", evidence_path, "-ManifestPath", manifest_path, "-Mode", "FixtureRehearsal"],
                repo_root,
            )
            assert_true(
                rehearsal_readiness[0] == 0,
                "readiness checker accepts honest fixture evidence in rehearsal mode",
                rehearsal_readiness[1],
            )
            assert_true(
                re.search("fixture rehearsal mode accepts honest fixture claims", rehearsal_readiness[1], re.IGNORECASE),
                "readiness checker reports rehearsal-only contract",
                rehearsal_readiness[1],
            )

            bad_evidence_path = os.path.join(export_dir, "teamrun-evidence-mislabelled.json")
            bad_evidence = copy.deepcopy(evidence)
            bad_evidence["claims"]["real_runtime_executed"] = True
            bad_evidence["claims"]["final_recording_complete"] = True
            bad_evidence["claims"]["submission_ready"] = True
            write_json(bad_evidence_path, bad_evidence)

            bad_readiness = invoke_process(
                sys.executable,
                [readiness_path, "-EvidencePath", bad_evidence_path, "-Mode", "FixtureRehearsal"],
                repo_root,
            )
            assert_true(bad_readiness[0] != 0, "readiness checker rejects mislabelled fixture claims", bad_readiness[1])
            assert_true(
                re.search("fixture evidence cannot claim real runtime", bad_readiness[1], re.IGNORECASE),
                "readiness checker reports mislabelled fixture claims",
                bad_readiness[1],
            )

            if os.path.isfile(package_path):
                package_root = os.path.join(tmp_root, "package")
                package_run = invoke_repo_script(
                    repo_root,
                    package_path,
                    ["-EvidencePath", evidence_path, "-OutputRoot", package_root, "-Stamp", "contract-test-package"],
                )
                assert_true(package_run[0] == 0, "package script writes fixture rehearsal package", package_run[1])
                package_manifest = os.path.join(package_root, "teamrun-demo-contract-test-package", "manifest.md")
                redacted_manifest = os.path.join(package_root, "teamrun-demo-contract-test-package", "redacted-manifest.json")
                assert_true(os.path.isfile(package_manifest), "package script writes fixture rehearsal manifest")
                assert_true(os.path.isfile(redacted_manifest), "package script writes redacted manifest")
                if os.path.isfile(package_manifest):
                    with open(package_manifest, encoding="utf-8-sig", errors="replace") as handle:
                        package_manifest_text = handle.read()
                    assert_true(
                        re.search("Package mode: FixtureRehearsal", package_manifest_text, re.IGNORECASE),
                        "package manifest labels fixture rehearsal mode",
                    )
                    assert_true(
                        re.search("boundary_label: fixture", package_manifest_text, re.IGNORECASE),
                        "package manifest labels fixture boundary",
                    )
                    assert_true(
                        re.search("sha256=", package_manifest_text, re.IGNORECASE),
                        "package manifest includes artifact hashes",
                    )
                    assert_true(
                        re.search("submission_ready: False", package_manifest_text, re.IGNORECASE),
                        "package manifest keeps submission_ready false",
                    )
                if os.path.isfile(redacted_manifest):
                    redacted = load_json(redacted_manifest)
                    assert_true(redacted.get("schema") == "agenthub-redacted-evidence-manifest-v1", "redacted manifest declares schema")
                    boundary = redacted.get("evidence_boundary") or {}
                    assert_true(boundary.get("label") == "fixture", "redacted manifest labels fixture boundary")
                    assert_true(boundary.get("fixture") is True, "redacted manifest fixture flag is true")
                    assert_true(boundary.get("observed") is False, "redacted manifest observed flag is false")
                    assert_true(boundary.get("real_tested") is False, "redacted manifest RealTested flag is false")
                    assert_true(boundary.get("approved_real") is False, "redacted manifest approved-real flag is false")
                    assert_true(len(redacted.get("files") or []) >= 1, "redacted manifest includes hashes for evidence assets")
                    bad_paths = [
                        file_entry
                        for file_entry in redacted.get("files") or []
                        if re.search(r"(^|/|\\)\.\.($|/|\\)", str(file_entry.get("path", "")))
                        or is_path_rooted(str(file_entry.get("path", "")))
                    ]
                    assert_true(len(bad_paths) == 0, "redacted manifest uses package-relative paths only")
                if os.path.isfile(redacted_manifest_verifier_path):
                    verify_redacted_run = invoke_repo_script(
                        repo_root,
                        redacted_manifest_verifier_path,
                        ["-ManifestPath", redacted_manifest],
                    )
                    assert_true(
                        verify_redacted_run[0] == 0,
                        "redacted manifest checker accepts generated package",
                        verify_redacted_run[1],
                    )

                    bad_package_root = os.path.join(tmp_root, "bad-redacted-package")
                    os.makedirs(bad_package_root, exist_ok=True)
                    shutil.copy2(redacted_manifest, os.path.join(bad_package_root, "redacted-manifest.json"))
                    leak_path = os.path.join(bad_package_root, "leak.txt")
                    with open(leak_path, "w", encoding="ascii") as handle:
                        handle.write("Authorization: Bearer should-not-ship\n")
                    bad_redacted = load_json(os.path.join(bad_package_root, "redacted-manifest.json"))
                    bad_redacted["files"] = [
                        {
                            "path": "leak.txt",
                            "role": "leak",
                            "sha256": sha256_hex(leak_path),
                            "bytes": os.path.getsize(leak_path),
                            "redacted": True,
                        }
                    ]
                    write_json(os.path.join(bad_package_root, "redacted-manifest.json"), bad_redacted)
                    bad_redacted_run = invoke_repo_script(
                        repo_root,
                        redacted_manifest_verifier_path,
                        ["-PackagePath", bad_package_root],
                    )
                    assert_true(
                        bad_redacted_run[0] != 0,
                        "redacted manifest checker rejects authorization leakage",
                        bad_redacted_run[1],
                    )
                    assert_true(
                        re.search("text file has no sensitive values", bad_redacted_run[1], re.IGNORECASE),
                        "redacted checker reports sensitive text without printing the value",
                        bad_redacted_run[1],
                    )
                    assert_true(
                        not re.search("should-not-ship", bad_redacted_run[1], re.IGNORECASE),
                        "redacted checker does not print leaked secret material",
                        bad_redacted_run[1],
                    )

                package_submission_run = invoke_repo_script(
                    repo_root,
                    package_path,
                    [
                        "-EvidencePath",
                        evidence_path,
                        "-OutputRoot",
                        os.path.join(tmp_root, "package-submission"),
                        "-Stamp",
                        "contract-test-submission",
                        "-PackageMode",
                        "Submission",
                    ],
                )
                assert_true(
                    package_submission_run[0] != 0,
                    "package script rejects fixture evidence in Submission mode",
                    package_submission_run[1],
                )
                assert_true(
                    re.search("fixture evidence cannot be packaged in Submission mode", package_submission_run[1], re.IGNORECASE),
                    "package script reports submission fixture block",
                    package_submission_run[1],
                )

    return 1 if FAILED else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'，禁止静默吞错
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
