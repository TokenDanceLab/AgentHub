#!/usr/bin/env python3
"""AgentHub P1 Edge CLI dispatch evidence verifier — ps1 迁移。

Default mode runs fixture-only Go tests that prove request -> CLI invocation
plan -> fixture event replay/status. Observed/RealTested modes validate a
redacted manifest only when an explicit approval marker is provided.

契约（ps1-to-python-migration）：stdlib only；CLI 签名/退出码与 ps1 一致
（--RepoRoot/--Mode/--ObservedManifest/--ApprovalMarker/--ApproveObservedCLI，
Mode 仅 Fixture/Observed/RealTested，0=通过）；机器可读行格式
（PASS/FAIL/BLOCK/Status）与 ps1 完全一致。
"""

import argparse
import json
import os
import re
import subprocess
import sys

SECRET_LIKE_PATTERN = re.compile(
    r"(sk-[a-z0-9_-]{8,}|gh[pousr]_[a-z0-9_]{8,}|xox[baprs]-[a-z0-9-]+|AKIA[0-9A-Z]{12,}|"
    r"-----BEGIN [A-Z ]*PRIV(?:ATE) KEY-----|"
    r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|"
    r"(?:token|secret|api[_-]?key|password|authorization)\s*[:=]\s*\S+)",
    re.IGNORECASE,
)
SUPPORTED_ADAPTER_IDS = ("codex", "claude-code", "opencode")
EVIDENCE_REF_PATTERN = re.compile(r"^(edge-event-log|event-log|artifact|sha256):.+")

passed = 0
failed = 0
blocks = 0


def pass_check(text: str) -> None:
    global passed
    passed += 1
    print(f"PASS {text}")


def fail_check(text: str) -> None:
    global failed
    failed += 1
    print(f"FAIL {text}")


def block_check(text: str) -> None:
    global blocks
    blocks += 1
    print(f"BLOCK {text}")


def invoke_go_fixture_test(repo_root: str, package: str, run: str) -> None:
    edge_root = os.path.join(repo_root, "edge-server")
    run_result = subprocess.run(
        ["go", "test", package, "-run", run, "-short", "-count=1"],
        cwd=edge_root,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if run_result.returncode == 0:
        pass_check(f"fixture Go test passed: {package} -run {run}")
        return

    fail_check(f"fixture Go test failed: {package} -run {run}")
    output_lines = run_result.stdout.splitlines() + run_result.stderr.splitlines()
    print("\n".join(output_lines))


def test_approval_marker(approve_observed_cli: bool, approval_marker: str) -> bool:
    if not approve_observed_cli:
        block_check("approval marker gate is closed: pass -ApproveObservedCLI with -ApprovalMarker")
        return False
    if not approval_marker.strip():
        block_check("approval marker missing")
        return False
    if not os.path.isfile(approval_marker):
        block_check("approval marker file does not exist")
        return False
    pass_check("approval marker exists")
    return True


def test_observed_manifest(observed_manifest: str):
    if not observed_manifest.strip():
        block_check("observed manifest missing")
        return None
    if not os.path.isfile(observed_manifest):
        block_check("observed manifest file does not exist")
        return None

    with open(observed_manifest, encoding="utf-8") as handle:
        raw = handle.read()
    if SECRET_LIKE_PATTERN.search(raw):
        fail_check("observed manifest contains secret-like content")
        return None

    try:
        manifest = json.loads(raw)
    except ValueError:
        fail_check("observed manifest is not valid JSON")
        return None
    pass_check("observed manifest JSON parsed")
    return manifest


def get_required_manifest_property(manifest, name: str):
    if manifest is None:
        return None
    if isinstance(manifest, dict) and name in manifest:
        return manifest[name]
    block_check(f"observed manifest {name} is missing")
    return None


def test_required_manifest_bool_true(manifest, name: str) -> bool:
    value = get_required_manifest_property(manifest, name)
    if value is None:
        return False
    if not isinstance(value, bool):
        block_check(f"observed manifest {name} must be boolean true")
        return False
    if value is not True:
        block_check(f"observed manifest {name} is not true")
        return False
    pass_check(f"observed manifest {name}=true")
    return True


def test_required_manifest_string(manifest, name: str):
    value = get_required_manifest_property(manifest, name)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        block_check(f"observed manifest {name} must be a non-empty string")
        return None
    pass_check(f"observed manifest {name} is present")
    return value


def test_required_manifest_exit_code_zero(manifest) -> bool:
    value = get_required_manifest_property(manifest, "exitCode")
    if value is None:
        return False
    if not isinstance(value, int) or isinstance(value, bool):
        block_check("observed manifest exitCode must be integer 0")
        return False
    if value != 0:
        block_check("observed manifest exitCode is not 0")
        return False
    pass_check("observed manifest exitCode=0")
    return True


def test_observed_chain(manifest) -> bool:
    if manifest is None:
        return False

    ok = True
    for field in ("requestMapped", "invocationPlanObserved", "eventReplayObserved", "realCliObserved", "redacted", "noSecrets"):
        if not test_required_manifest_bool_true(manifest, field):
            ok = False

    adapter_id = test_required_manifest_string(manifest, "adapterId")
    if adapter_id in SUPPORTED_ADAPTER_IDS:
        pass_check("observed manifest adapterId is supported")
    else:
        block_check("observed manifest adapterId is unsupported")
        ok = False

    if test_required_manifest_string(manifest, "approvalId") is None:
        ok = False

    observed_evidence_ref = test_required_manifest_string(manifest, "observedEvidenceRef")
    if observed_evidence_ref is None:
        ok = False
    elif not EVIDENCE_REF_PATTERN.match(observed_evidence_ref):
        block_check("observed manifest observedEvidenceRef must name an edge-event-log, event-log, artifact, or sha256 reference")
        ok = False
    else:
        pass_check("observed manifest observedEvidenceRef has concrete reference prefix")

    correlation_id = test_required_manifest_string(manifest, "correlationId")
    if correlation_id is None:
        ok = False
    invocation_plan_event_id = test_required_manifest_string(manifest, "invocationPlanEventId")
    if invocation_plan_event_id is None:
        ok = False
    terminal_event_id = test_required_manifest_string(manifest, "terminalEventId")
    if terminal_event_id is None:
        ok = False
    if invocation_plan_event_id is not None and terminal_event_id is not None:
        if invocation_plan_event_id == terminal_event_id:
            block_check("observed manifest invocationPlanEventId and terminalEventId must be distinct")
            ok = False
        else:
            pass_check("observed manifest event ids are distinct")

    terminal_status = test_required_manifest_string(manifest, "terminalStatus")
    if terminal_status == "finished":
        pass_check("observed manifest terminalStatus=finished")
    else:
        block_check("observed manifest terminalStatus is not finished")
        ok = False

    if not test_required_manifest_exit_code_zero(manifest):
        ok = False

    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--RepoRoot", default=".", help="repository root (defaults to the current directory)")
    parser.add_argument("--Mode", default="Fixture", choices=["Fixture", "Observed", "RealTested"], help="execution mode")
    parser.add_argument("--ObservedManifest", default="", help="observed redacted manifest path")
    parser.add_argument("--ApprovalMarker", default="", help="operator approval marker file path")
    parser.add_argument("--ApproveObservedCLI", action="store_true", help="open the approval marker gate")
    args = parser.parse_args()

    repo_root = os.path.realpath(args.RepoRoot)
    mode = args.Mode
    observed_manifest = args.ObservedManifest
    approval_marker = args.ApprovalMarker
    approve_observed_cli = args.ApproveObservedCLI

    if mode not in ("Fixture", "Observed", "RealTested"):
        print(f"ERROR: cannot validate argument 'Mode': mode must be Fixture, Observed, or RealTested", file=sys.stderr)
        return 1

    print("AgentHub P1 Edge CLI dispatch evidence verifier")
    print(f"Mode: {mode}")
    print("No real CLI/model command was executed by this verifier.")

    invoke_go_fixture_test(repo_root, "./internal/adapters", "TestCLIInvocationPlanRedactsPromptEnvAndPaths")
    invoke_go_fixture_test(repo_root, "./internal/lifecycle", "TestProcessExecutorPublishesCLIInvocationPlanAndReplaysFixtureStatus")

    observed_manifest_accepted = False
    if mode != "Fixture":
        approved = test_approval_marker(approve_observed_cli, approval_marker)
        manifest = test_observed_manifest(observed_manifest)
        observed_ok = test_observed_chain(manifest)
        observed_manifest_accepted = approved and observed_ok

    print("\n========================================")
    print(f"  Passed: {passed}  |  Failed: {failed}  |  Blocks: {blocks}")
    print("========================================")

    if observed_manifest_accepted:
        print("real_tested=false")
        print("observed_manifest_accepted=true")
        print("Status: OBSERVED_MANIFEST_ACCEPTED")
        print("RealTested promotion requires a separate verifier: scripts\\verify\\verify-approved-real-edge-cli-evidence.py must dereference the observed evidence artifact/log/hash.")
        return 0 if failed == 0 else 1

    print("real_tested=false")
    if mode == "Fixture":
        print("Status: FIXTURE_DISPATCH_VERIFIED")
        return 0 if failed == 0 else 1

    print("Status: OBSERVED_DISPATCH_BLOCKED")
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
