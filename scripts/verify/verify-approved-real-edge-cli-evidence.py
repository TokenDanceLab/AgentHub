#!/usr/bin/env python3
"""AgentHub approved-real Edge CLI evidence verifier — ps1 迁移。

This verifier never executes Codex, Claude Code, OpenCode, model APIs, login,
network calls, or process-launch commands. It only dereferences approved,
redacted evidence files and checks that the manifest matches the event log and
optional hash manifest before reporting real_tested=true.

契约（ps1-to-python-migration）：stdlib only；CLI 签名/退出码与 ps1 一致
（--RepoRoot/--ObservedManifest/--EvidenceRoot/--ApprovalMarker/--ApproveRealEvidence，
0=通过）；机器可读行格式（PASS/FAIL/BLOCK/Status）与 ps1 完全一致。
"""

import argparse
import hashlib
import json
import os
import re
import sys

SECRET_LIKE_PATTERN = re.compile(
    r"(sk-[a-z0-9_-]{8,}|gh[pousr]_[a-z0-9_]{8,}|xox[baprs]-[a-z0-9-]+|AKIA[0-9A-Z]{12,}|"
    r"-----BEGIN [A-Z ]*PRIV(?:ATE) KEY-----|"
    r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|"
    r"(?:token|secret|api[_-]?key|password|authorization)\s*[:=]\s*\S+)",
    re.IGNORECASE,
)
EVIDENCE_REF_PREFIX_PATTERN = re.compile(r"^(?:event-log|edge-event-log|artifact):(.+)$")
SHA256_REF_PATTERN = re.compile(r"^sha256:([a-fA-F0-9]{64})$")

SUPPORTED_ADAPTER_IDS = ("codex", "claude-code", "opencode")

passed = 0
failed = 0
blocks = 0
hash_verified = False


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


def is_non_empty_string(value) -> bool:
    return isinstance(value, str) and bool(value.strip())


def get_json_file(path: str, label: str):
    if not path.strip():
        block_check(f"{label} path missing")
        return None
    if not os.path.isfile(path):
        block_check(f"{label} artifact/log not found: {path}")
        return None

    with open(path, encoding="utf-8") as handle:
        raw = handle.read()
    if SECRET_LIKE_PATTERN.search(raw):
        fail_check(f"{label} contains secret-like content")
        return None

    try:
        parsed = json.loads(raw)
    except ValueError:
        fail_check(f"{label} is not valid JSON")
        return None
    pass_check(f"{label} JSON parsed")
    return parsed


def get_required_property_value(obj, name: str, label: str):
    if obj is None:
        return None
    if isinstance(obj, dict) and name in obj:
        return obj[name]
    block_check(f"{label} {name} is missing")
    return None


def test_required_bool_true(obj, name: str, label: str) -> bool:
    value = get_required_property_value(obj, name, label)
    if value is None:
        return False
    if not isinstance(value, bool):
        block_check(f"{label} {name} must be boolean true")
        return False
    if value is not True:
        block_check(f"{label} {name} is not true")
        return False
    pass_check(f"{label} {name}=true")
    return True


def test_required_bool_value(obj, name: str, label: str, expected: bool) -> bool:
    value = get_required_property_value(obj, name, label)
    if value is None:
        return False
    if not isinstance(value, bool):
        block_check(f"{label} {name} must be boolean {expected}")
        return False
    if value != expected:
        block_check(f"{label} {name} must be {expected}")
        return False
    pass_check(f"{label} {name}={str(expected).lower()}")
    return True


def get_required_string(obj, name: str, label: str):
    value = get_required_property_value(obj, name, label)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        block_check(f"{label} {name} must be a non-empty string")
        return None
    pass_check(f"{label} {name} is present")
    return value


def test_required_exit_code_zero(obj, label: str) -> bool:
    value = get_required_property_value(obj, "exitCode", label)
    if value is None:
        return False
    if not isinstance(value, int) or isinstance(value, bool):
        block_check(f"{label} exitCode must be integer 0")
        return False
    if value != 0:
        block_check(f"{label} exitCode is not 0")
        return False
    pass_check(f"{label} exitCode=0")
    return True


def test_approval_marker(approve_real_evidence: bool, approval_marker: str) -> bool:
    if not approve_real_evidence:
        block_check("approval marker gate is closed: pass -ApproveRealEvidence with -ApprovalMarker")
        return False
    if not approval_marker.strip():
        block_check("approval marker missing")
        return False
    if not os.path.isfile(approval_marker):
        block_check("approval marker file does not exist")
        return False
    pass_check("approval marker exists")
    return True


def resolve_evidence_path(reference: str, root: str, label: str):
    if not reference.strip():
        block_check(f"{label} path missing")
        return None

    candidate = reference if os.path.isabs(reference) else os.path.join(root, reference)
    resolved = os.path.abspath(os.path.normpath(candidate))
    resolved_root = os.path.abspath(os.path.normpath(root))
    root_prefix = resolved_root.rstrip("\\/") + os.sep

    if not (
        resolved.lower() == resolved_root.lower()
        or resolved.lower().startswith(root_prefix.lower())
    ):
        block_check(f"{label} path escapes evidence root")
        return None

    return resolved


def get_event_id(event) -> str:
    if not isinstance(event, dict):
        return None
    for name in ("id", "eventId", "event_id"):
        value = event.get(name)
        if isinstance(value, str) and value.strip():
            return value
    return None


def get_event_string(event, names) -> str:
    if not isinstance(event, dict):
        return None
    for name in names:
        value = event.get(name)
        if isinstance(value, str) and value.strip():
            return value
    return None


def get_event_bool(event, name: str):
    if not isinstance(event, dict):
        return None
    value = event.get(name)
    if not isinstance(value, bool):
        return None
    return value


def get_events_from_log(log):
    if log is None:
        return []
    if isinstance(log, list):
        return list(log)
    if isinstance(log, dict) and "events" in log:
        value = log["events"]
        if isinstance(value, list):
            return list(value)
        return [value] if value is not None else [None]
    return []


def find_event_by_id(events, event_id: str):
    for event in events:
        if get_event_id(event) == event_id:
            return event
    return None


def test_event_common_fields(event, label: str, expected_correlation_id: str, expected_adapter_id: str) -> bool:
    if event is None:
        block_check(f"{label} event missing")
        return False

    ok = True
    correlation_id = get_event_string(event, ("correlationId", "correlation_id"))
    if correlation_id == expected_correlation_id:
        pass_check(f"{label} correlationId matches manifest")
    else:
        block_check(f"{label} correlationId mismatch")
        ok = False

    adapter_id = get_event_string(event, ("adapterId", "adapter", "adapter_id"))
    if adapter_id == expected_adapter_id:
        pass_check(f"{label} adapterId matches manifest")
    else:
        block_check(f"{label} adapterId mismatch")
        ok = False

    if get_event_bool(event, "redacted") is True:
        pass_check(f"{label} redacted=true")
    else:
        block_check(f"{label} redacted must be true")
        ok = False

    if get_event_bool(event, "noSecrets") is True:
        pass_check(f"{label} noSecrets=true")
    else:
        block_check(f"{label} noSecrets must be true")
        ok = False

    return ok


def test_manifest_shape(manifest) -> bool:
    if manifest is None:
        return False

    ok = True
    for field in ("requestMapped", "invocationPlanObserved", "eventReplayObserved", "realCliObserved", "redacted", "noSecrets"):
        if not test_required_bool_true(manifest, field, "observed manifest"):
            ok = False
    if not test_required_bool_value(manifest, "mockAdapterUsed", "observed manifest", False):
        ok = False
    if not test_required_bool_value(manifest, "realCliTested", "observed manifest", True):
        ok = False
    if not test_required_bool_value(manifest, "realModelTested", "observed manifest", False):
        ok = False
    if not test_required_bool_value(manifest, "tokenDanceIdLogin", "observed manifest", False):
        ok = False

    for field in ("realCliTestedReason", "realModelTestedReason", "tokenDanceIdLoginReason", "failureReason", "recordingEvidencePath"):
        if get_required_string(manifest, field, "observed manifest") is None:
            ok = False

    adapter_id = get_required_string(manifest, "adapterId", "observed manifest")
    if adapter_id in SUPPORTED_ADAPTER_IDS:
        pass_check("observed manifest adapterId is supported")
    else:
        block_check("observed manifest adapterId is unsupported")
        ok = False

    for field in ("approvalId", "observedEvidenceRef", "correlationId", "invocationPlanEventId", "terminalEventId", "terminalStatus"):
        if get_required_string(manifest, field, "observed manifest") is None:
            ok = False

    terminal_status_value = get_required_property_value(manifest, "terminalStatus", "observed manifest")
    if ("" if terminal_status_value is None else str(terminal_status_value)) == "finished":
        pass_check("observed manifest terminalStatus=finished")
    else:
        block_check("observed manifest terminalStatus is not finished")
        ok = False

    if not test_required_exit_code_zero(manifest, "observed manifest"):
        ok = False

    plan_id = get_required_property_value(manifest, "invocationPlanEventId", "observed manifest")
    terminal_id = get_required_property_value(manifest, "terminalEventId", "observed manifest")
    if isinstance(plan_id, str) and isinstance(terminal_id, str):
        if plan_id == terminal_id:
            block_check("observed manifest invocationPlanEventId and terminalEventId must be distinct")
            ok = False
        else:
            pass_check("observed manifest event ids are distinct")

    return ok


def get_entry_string(entry, names) -> str:
    if not isinstance(entry, dict):
        return None
    for name in names:
        value = entry.get(name)
        if isinstance(value, str) and value.strip():
            return value
    return None


def resolve_hash_referenced_event_log(manifest, expected_hash: str, root: str):
    event_log_artifact = get_required_string(manifest, "eventLogArtifact", "observed manifest")
    hash_manifest_ref = get_required_string(manifest, "hashManifest", "observed manifest")
    if event_log_artifact is None or hash_manifest_ref is None:
        block_check("sha256 references require eventLogArtifact and hashManifest future artifact schema fields")
        return None

    hash_manifest_path = resolve_evidence_path(hash_manifest_ref, root, "hash manifest")
    hash_manifest = get_json_file(hash_manifest_path, "hash manifest")
    if hash_manifest is None:
        return None

    if isinstance(hash_manifest, list):
        entries = list(hash_manifest)
    elif isinstance(hash_manifest, dict) and isinstance(hash_manifest.get("artifacts"), list):
        entries = list(hash_manifest["artifacts"])
    elif isinstance(hash_manifest, dict) and "sha256" in hash_manifest:
        entries = [hash_manifest]
    else:
        entries = []
    if len(entries) == 0:
        block_check("hash manifest contains no artifacts")
        return None

    matching_entry = None
    for entry in entries:
        entry_name = get_entry_string(entry, ("path", "name"))
        entry_hash = get_entry_string(entry, ("sha256", "hash"))
        if entry_name == event_log_artifact and entry_hash is not None and entry_hash.lower() == expected_hash.lower():
            matching_entry = entry
            break
    if matching_entry is None:
        block_check("hash manifest does not include eventLogArtifact with expected sha256")
        return None
    pass_check("hash manifest includes eventLogArtifact and expected sha256")

    event_log_path = resolve_evidence_path(event_log_artifact, root, "event log artifact")
    if event_log_path is None or not os.path.isfile(event_log_path):
        block_check("event log artifact not found for hash manifest")
        return None

    actual_hash = sha256_of_file(event_log_path)
    if actual_hash != expected_hash.lower():
        block_check("event log artifact sha256 does not match observedEvidenceRef")
        return None
    pass_check("event log artifact sha256 matches observedEvidenceRef")

    if isinstance(matching_entry, dict) and "bytes" in matching_entry:
        actual_bytes = os.path.getsize(event_log_path)
        if int(matching_entry["bytes"]) == actual_bytes:
            pass_check("event log artifact bytes match hash manifest")
        else:
            block_check("event log artifact bytes do not match hash manifest")
            return None

    global hash_verified
    hash_verified = True
    return event_log_path


def sha256_of_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_observed_evidence_event_log(manifest, root: str):
    observed_evidence_ref = get_required_string(manifest, "observedEvidenceRef", "observed manifest")
    if observed_evidence_ref is None:
        return None

    prefix_match = EVIDENCE_REF_PREFIX_PATTERN.match(observed_evidence_ref)
    if prefix_match:
        return resolve_evidence_path(prefix_match.group(1), root, "event log artifact")

    sha256_match = SHA256_REF_PATTERN.match(observed_evidence_ref)
    if sha256_match:
        return resolve_hash_referenced_event_log(manifest, sha256_match.group(1), root)

    block_check("observed manifest observedEvidenceRef must be event-log:, edge-event-log:, artifact:, or sha256:")
    return None


def test_event_log_against_manifest(manifest, event_log) -> bool:
    events = get_events_from_log(event_log)
    if len(events) == 0:
        block_check("event log contains no events")
        return False
    pass_check("event log contains events")

    adapter_id_value = get_required_property_value(manifest, "adapterId", "observed manifest")
    correlation_id_value = get_required_property_value(manifest, "correlationId", "observed manifest")
    plan_event_id_value = get_required_property_value(manifest, "invocationPlanEventId", "observed manifest")
    terminal_event_id_value = get_required_property_value(manifest, "terminalEventId", "observed manifest")
    adapter_id = "" if adapter_id_value is None else str(adapter_id_value)
    correlation_id = "" if correlation_id_value is None else str(correlation_id_value)
    plan_event_id = "" if plan_event_id_value is None else str(plan_event_id_value)
    terminal_event_id = "" if terminal_event_id_value is None else str(terminal_event_id_value)

    plan_event = find_event_by_id(events, plan_event_id)
    terminal_event = find_event_by_id(events, terminal_event_id)

    ok = True
    if not test_event_common_fields(plan_event, "invocation plan event", correlation_id, adapter_id):
        ok = False
    if not test_event_common_fields(terminal_event, "terminal event", correlation_id, adapter_id):
        ok = False

    if plan_event is not None:
        plan_type = get_event_string(plan_event, ("type", "eventType", "event_type"))
        if plan_type is not None and re.search(r"cli_invocation_plan|invocation[_-]?plan", plan_type, re.IGNORECASE):
            pass_check("invocation plan event type matches CLI plan")
        else:
            block_check("invocation plan event type is not a CLI invocation plan")
            ok = False

    if terminal_event is not None:
        terminal_status = get_event_string(terminal_event, ("terminalStatus", "status"))
        if terminal_status == "finished":
            pass_check("terminal event terminalStatus=finished")
        else:
            block_check("terminal event terminalStatus is not finished")
            ok = False

        terminal_exit_code = None
        if isinstance(terminal_event, dict):
            terminal_exit_code = terminal_event.get("exitCode")
            if terminal_exit_code is None:
                terminal_exit_code = terminal_event.get("exit_code")
        if (
            terminal_exit_code is not None
            and isinstance(terminal_exit_code, int)
            and not isinstance(terminal_exit_code, bool)
            and terminal_exit_code == 0
        ):
            pass_check("terminal event exitCode=0")
        else:
            block_check("terminal event exitCode must be integer 0")
            ok = False

    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--RepoRoot", default=".", help="repository root (defaults to the current directory)")
    parser.add_argument("--ObservedManifest", default="", help="observed redacted manifest path")
    parser.add_argument("--EvidenceRoot", default="", help="evidence root directory (defaults to manifest directory)")
    parser.add_argument("--ApprovalMarker", default="", help="operator approval marker file path")
    parser.add_argument("--ApproveRealEvidence", action="store_true", help="open the approval marker gate")
    args = parser.parse_args()

    repo_root = os.path.realpath(args.RepoRoot)
    observed_manifest = args.ObservedManifest
    evidence_root = args.EvidenceRoot
    approval_marker = args.ApprovalMarker
    approve_real_evidence = args.ApproveRealEvidence

    print("AgentHub approved-real Edge CLI evidence verifier")
    print("No real CLI/model/login/network command was executed by this verifier.")
    print("This verifier distinguishes MockAdapterUsed, RealCliTested, RealModelTested, and TokenDanceIDLogin.")

    approved = test_approval_marker(approve_real_evidence, approval_marker)

    if observed_manifest.strip():
        manifest_path = observed_manifest if os.path.isabs(observed_manifest) else os.path.join(repo_root, observed_manifest)
        manifest_path = os.path.abspath(os.path.normpath(manifest_path))
    else:
        manifest_path = ""
    manifest = get_json_file(manifest_path, "observed manifest")
    manifest_ok = test_manifest_shape(manifest)

    if evidence_root.strip():
        evidence_base = evidence_root if os.path.isabs(evidence_root) else os.path.join(repo_root, evidence_root)
    elif manifest_path.strip():
        evidence_base = os.path.dirname(manifest_path)
    else:
        evidence_base = ""
    if evidence_base.strip():
        evidence_base = os.path.abspath(os.path.normpath(evidence_base))

    event_log_path = None
    event_log = None
    if manifest_ok and evidence_base.strip():
        event_log_path = resolve_observed_evidence_event_log(manifest, evidence_base)
        if event_log_path is not None:
            event_log = get_json_file(event_log_path, "event log")

    event_log_ok = test_event_log_against_manifest(manifest, event_log)
    verified = approved and manifest_ok and event_log_ok

    print("\n========================================")
    print(f"  Passed: {passed}  |  Failed: {failed}  |  Blocks: {blocks}")
    print("========================================")

    if verified:
        print("real_tested=true")
        print("MockAdapterUsed=false")
        print("RealCliTested=true")
        print("RealModelTested=false")
        print("TokenDanceIDLogin=false")
        print("approved_real_evidence_verified=true")
        print(f"hash_verified={str(hash_verified).lower()}")
        print("Status: APPROVED_REAL_EVIDENCE_VERIFIED")
        return 0 if failed == 0 else 1

    print("real_tested=false")
    print("MockAdapterUsed=unknown")
    print("RealCliTested=false")
    print("RealModelTested=false")
    print("TokenDanceIDLogin=false")
    print("approved_real_evidence_verified=false")
    print(f"hash_verified={str(hash_verified).lower()}")
    print("Status: APPROVED_REAL_EVIDENCE_BLOCKED")
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
