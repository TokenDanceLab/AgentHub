#!/usr/bin/env python3
"""AgentHub remote-control fixture E2E gate wrapper — ps1 迁移。

Runs the offline TeamRun fixture E2E gate (scripts/smoke/verify-remote-control-
fixture-e2e.py) against the exported fixture and negative evidence mutations,
proving the gate fails closed on missing/placeholder chain fields.

契约（ps1-to-python-migration）：stdlib only；CLI 签名/退出码与 ps1 一致
（--RepoRoot，0=通过）；机器可读行格式（PASS:/FAIL:）与 ps1 完全一致。
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

failed = 0


def assert_true(condition: bool, message: str, details: str = "") -> None:
    global failed
    if condition:
        print(f"PASS: {message}")
        return
    failed += 1
    print(f"FAIL: {message}")
    if details.strip():
        print(details)


def resolve_repo_script(repo_root: str, relative_without_extension: str) -> str:
    """优先 .py、回退 .ps1，迁移过渡期内兼容两种实现。"""
    for extension in (".py", ".ps1"):
        candidate = os.path.join(repo_root, relative_without_extension + extension)
        if os.path.isfile(candidate):
            return candidate
    return os.path.join(repo_root, relative_without_extension + ".py")


def invoke_repo_python(repo_root: str, arguments: list) -> dict:
    run_result = subprocess.run(
        [sys.executable] + arguments,
        cwd=repo_root,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return {
        "ExitCode": run_result.returncode,
        "Output": (run_result.stdout or "") + "\n" + (run_result.stderr or ""),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--RepoRoot", default=".", help="repository root (defaults to the current directory)")
    args = parser.parse_args()

    repo_root = os.path.realpath(args.RepoRoot)

    gate_path = os.path.join(repo_root, "scripts", "smoke", "verify-remote-control-fixture-e2e.py")
    gate_implementation_path = gate_path
    exporter_path = resolve_repo_script(repo_root, os.path.join("scripts", "lib", "export-teamrun-demo-fixture-evidence"))
    scenario_path = os.path.join(repo_root, "tests", "fixtures", "teamrun", "teamrun-demo-scenario.json")

    assert_true(os.path.isfile(gate_path), "remote-control fixture E2E gate exists")
    assert_true(os.path.isfile(gate_implementation_path), "remote-control fixture E2E gate implementation exists")
    assert_true(os.path.isfile(exporter_path), "TeamRun fixture exporter exists")
    assert_true(os.path.isfile(scenario_path), "TeamRun fixture scenario exists")

    tmp_root = os.path.join(tempfile.gettempdir(), f"agenthub-remote-fixture-e2e-{os.getpid()}")
    shutil.rmtree(tmp_root, ignore_errors=True)
    os.makedirs(tmp_root, exist_ok=True)

    if (
        os.path.isfile(gate_path)
        and os.path.isfile(gate_implementation_path)
        and os.path.isfile(exporter_path)
        and os.path.isfile(scenario_path)
    ):
        with open(gate_implementation_path, encoding="utf-8") as handle:
            script_text = handle.read()
        assert_true(
            re.search("resolve_repo_script", script_text),
            "remote-control fixture E2E gate resolves child scripts by extension",
        )
        assert_true(
            not re.search(r"& powershell\b", script_text, re.IGNORECASE),
            "remote-control fixture E2E gate does not hard-code powershell executable",
        )

        gate_run = invoke_repo_python(
            repo_root,
            [gate_path, "-ScenarioManifest", scenario_path, "-OutputRoot", tmp_root, "-Stamp", "strict-pass"],
        )
        assert_true(gate_run["ExitCode"] == 0, "remote-control fixture E2E gate passes exported fixture", gate_run["Output"])
        assert_true(
            re.search("Web starts TeamRun with target_id", gate_run["Output"], re.IGNORECASE),
            "gate output names Web target_id stage",
            gate_run["Output"],
        )
        assert_true(
            re.search("Hub exact-routes to Desktop/Edge target", gate_run["Output"], re.IGNORECASE),
            "gate output names Hub exact-route stage",
            gate_run["Output"],
        )
        assert_true(
            re.search("Desktop bridge starts Local Edge run fixture", gate_run["Output"], re.IGNORECASE),
            "gate output names Desktop bridge stage",
            gate_run["Output"],
        )
        assert_true(
            re.search("Edge emits/callbacks fixture events", gate_run["Output"], re.IGNORECASE),
            "gate output names Edge callback stage",
            gate_run["Output"],
        )
        assert_true(
            re.search("Adapter result/callback is emitted", gate_run["Output"], re.IGNORECASE),
            "gate output names adapter result/callback stage",
            gate_run["Output"],
        )
        assert_true(
            re.search("Hub replay records completed fixture chain", gate_run["Output"], re.IGNORECASE),
            "gate output names Hub replay stage",
            gate_run["Output"],
        )

        evidence_path = os.path.join(tmp_root, "teamrun-demo-strict-pass", "teamrun-evidence.json")
        assert_true(os.path.isfile(evidence_path), "gate writes exported fixture evidence")

        if os.path.isfile(evidence_path):
            with open(evidence_path, encoding="utf-8") as handle:
                evidence = json.loads(handle.read())
            assert_true(
                evidence.get("remote_control_manifest") is not None,
                "exported fixture includes remote-control manifest",
            )
            assert_true(
                evidence.get("remote_control_manifest", {}).get("mode") == "FixtureRehearsal",
                "remote-control manifest is FixtureRehearsal mode",
            )

            for field in ("hubTaskId", "targetId", "edgeDeviceId", "edgeRunId", "adapterId"):
                bad_path = os.path.join(tmp_root, f"missing-{field}.json")
                with open(evidence_path, encoding="utf-8") as handle:
                    bad_evidence = json.loads(handle.read())
                bad_evidence["remote_control_manifest"][field] = ""
                with open(bad_path, "w", encoding="utf-8") as handle:
                    json.dump(bad_evidence, handle)

                bad_run = invoke_repo_python(repo_root, [gate_path, "-EvidencePath", bad_path])
                assert_true(
                    bad_run["ExitCode"] != 0,
                    f"remote-control fixture E2E gate fails when {field} is missing",
                    bad_run["Output"],
                )
                assert_true(
                    re.search(f"remote-control manifest contains {field}", bad_run["Output"], re.IGNORECASE),
                    f"missing {field} failure is explicit",
                    bad_run["Output"],
                )

            missing_adapter_event_path = os.path.join(tmp_root, "missing-adapter-result-event.json")
            with open(evidence_path, encoding="utf-8") as handle:
                missing_adapter_event = json.loads(handle.read())
            missing_adapter_event["events"] = [
                event for event in missing_adapter_event.get("events", []) if event.get("id") != "evt-remote-005"
            ]
            with open(missing_adapter_event_path, "w", encoding="utf-8") as handle:
                json.dump(missing_adapter_event, handle)
            missing_adapter_event_run = invoke_repo_python(repo_root, [gate_path, "-EvidencePath", missing_adapter_event_path])
            assert_true(
                missing_adapter_event_run["ExitCode"] != 0,
                "remote-control fixture E2E gate fails when adapter result/callback event is missing",
                missing_adapter_event_run["Output"],
            )
            assert_true(
                re.search("event evt-remote-005 exists", missing_adapter_event_run["Output"], re.IGNORECASE),
                "missing adapter event failure is explicit",
                missing_adapter_event_run["Output"],
            )

            placeholder_refs_path = os.path.join(tmp_root, "placeholder-eventrefs.json")
            with open(evidence_path, encoding="utf-8") as handle:
                placeholder_refs = json.loads(handle.read())
            placeholder_refs["remote_control_manifest"]["eventRefs"] = [
                "placeholder-ref-001",
                "placeholder-ref-002",
                "placeholder-ref-003",
                "placeholder-ref-004",
            ]
            with open(placeholder_refs_path, "w", encoding="utf-8") as handle:
                json.dump(placeholder_refs, handle)
            placeholder_refs_run = invoke_repo_python(repo_root, [gate_path, "-EvidencePath", placeholder_refs_path])
            assert_true(
                placeholder_refs_run["ExitCode"] != 0,
                "remote-control fixture E2E gate fails placeholder eventRefs",
                placeholder_refs_run["Output"],
            )
            assert_true(
                re.search("remote-control eventRef resolves to an evidence event", placeholder_refs_run["Output"], re.IGNORECASE),
                "placeholder eventRefs failure is explicit",
                placeholder_refs_run["Output"],
            )

            missing_refs_path = os.path.join(tmp_root, "missing-eventrefs.json")
            with open(evidence_path, encoding="utf-8") as handle:
                missing_refs = json.loads(handle.read())
            missing_refs["remote_control_manifest"]["eventRefs"] = []
            with open(missing_refs_path, "w", encoding="utf-8") as handle:
                json.dump(missing_refs, handle)
            missing_refs_run = invoke_repo_python(repo_root, [gate_path, "-EvidencePath", missing_refs_path])
            assert_true(
                missing_refs_run["ExitCode"] != 0,
                "remote-control fixture E2E gate fails missing eventRefs",
                missing_refs_run["Output"],
            )
            assert_true(
                re.search("remote-control manifest contains eventRefs for the chain", missing_refs_run["Output"], re.IGNORECASE),
                "missing eventRefs failure is explicit",
                missing_refs_run["Output"],
            )

            blank_chain_ref_path = os.path.join(tmp_root, "blank-chain-eventref.json")
            with open(evidence_path, encoding="utf-8") as handle:
                blank_chain_ref = json.loads(handle.read())
            chain = blank_chain_ref["remote_control_manifest"]["chain"]
            blank_chain_stage = str(chain[3].get("stage"))
            chain[3]["eventRef"] = ""
            with open(blank_chain_ref_path, "w", encoding="utf-8") as handle:
                json.dump(blank_chain_ref, handle)
            blank_chain_ref_run = invoke_repo_python(repo_root, [gate_path, "-EvidencePath", blank_chain_ref_path])
            assert_true(
                blank_chain_ref_run["ExitCode"] != 0,
                "remote-control fixture E2E gate fails blank chain eventRef",
                blank_chain_ref_run["Output"],
            )
            blank_chain_pattern = f"chain stage {re.escape(blank_chain_stage)} eventRef is not blank"
            assert_true(
                re.search(blank_chain_pattern, blank_chain_ref_run["Output"], re.IGNORECASE),
                "blank chain eventRef failure is explicit",
                blank_chain_ref_run["Output"],
            )

    return 1 if failed > 0 else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
