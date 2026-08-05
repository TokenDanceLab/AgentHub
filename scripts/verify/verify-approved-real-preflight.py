#!/usr/bin/env python3
"""AgentHub approved-real preflight manifest gate — ps1 迁移。

This script validates the operator-approved manifest needed before any real
login, CLI/model/API, deploy, signing, notarization, updater, release, or
production action can be attempted. It never executes those actions.

契约（ps1-to-python-migration）：stdlib only；CLI 签名/退出码与 ps1 一致
（--RepoRoot/--ManifestPath，0=通过）；机器可读行格式（PASS/FAIL/BLOCK/Status）
与 ps1 完全一致；异常 → 非零退出 + stderr。
"""

import argparse
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
SENSITIVE_NAME_PATTERN = re.compile(
    r"(access[_-]?token|refresh[_-]?token|secret|password|authorization|api[_-]?key|private[_-]?key)",
    re.IGNORECASE,
)
PRODUCTION_ACTION_NAME_PATTERN = re.compile(
    r"(production|deploy|sign|notar|release|updater)", re.IGNORECASE
)
SAFE_SENSITIVE_VALUE_PATTERN = re.compile(
    r"^(redacted|<redacted>|placeholder|not provided|none|n/a|identifier-only|"
    r"owned by .+|operator-owned .+|.+ owner only|.+ names only)$",
    re.IGNORECASE,
)
APPROVED_VALUE_PATTERN = re.compile(
    r"^(false|blocked|disallowed|not_approved|none|n/a)$", re.IGNORECASE
)
URI_LIKE_PATTERN = re.compile(
    r"^(https?://|file://|app://|tauri://|ws://|wss://|localhost:|127\.0\.0\.1:)"
)

SUPPORTED_RUNTIME_IDS = ("codex", "claude-code", "opencode")

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


def get_value_at_path(obj, path: str):
    current = obj
    for part in path.split("."):
        if current is None:
            return None
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def test_non_empty_string(value) -> bool:
    return isinstance(value, str) and bool(value.strip())


def require_string_path(obj, path: str, label: str):
    value = get_value_at_path(obj, path)
    if test_non_empty_string(value):
        pass_check(f"{label} is declared")
        return value
    fail_check(f"{label} missing or not a non-empty string ({path})")
    return None


def require_object_path(obj, path: str, label: str):
    value = get_value_at_path(obj, path)
    if value is not None and not isinstance(value, (str, list)):
        pass_check(f"{label} is declared")
        return value
    fail_check(f"{label} missing or not an object ({path})")
    return None


def require_number_path(obj, path: str, label: str):
    value = get_value_at_path(obj, path)
    if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0:
        pass_check(f"{label} is declared")
        return float(value)
    fail_check(f"{label} missing or not a positive number ({path})")
    return None


def require_array_path(obj, path: str, label: str):
    value = get_value_at_path(obj, path)
    if isinstance(value, list) and len(value) > 0:
        pass_check(f"{label} is declared")
        return list(value)
    fail_check(f"{label} missing or not a non-empty array ({path})")
    return []


def require_bool_path(obj, path: str, label: str, expected=None):
    value = get_value_at_path(obj, path)
    if not isinstance(value, bool):
        fail_check(f"{label} missing or not a boolean ({path})")
        return None
    if expected is not None and value != expected:
        fail_check(f"{label} must be {expected}, got {value}")
        return value
    pass_check(f"{label} is declared as {value}")
    return value


def test_approved_action_object(value) -> bool:
    if isinstance(value, bool):
        return not value
    if isinstance(value, str):
        return bool(APPROVED_VALUE_PATTERN.fullmatch(value))
    if value is not None:
        if isinstance(value, dict):
            approved = value.get("approved")
            approval_id = value.get("approval_id")
            return (
                approved is True
                and approval_id is not None
                and test_non_empty_string(approval_id)
            )
        return False
    return True


def inspect_json_tree(node, path: str = "$") -> None:
    if node is None:
        return

    if isinstance(node, list):
        for index, item in enumerate(node):
            inspect_json_tree(item, f"{path}[{index}]")
        return

    if isinstance(node, str):
        if SECRET_LIKE_PATTERN.search(node):
            fail_check(
                f"{path} contains secret-like content; use identifiers, owners, hashes, or redacted placeholders only"
            )
        return

    if isinstance(node, bool) or isinstance(node, (int, float)):
        return

    for name, value in node.items():
        child_path = f"{path}.{name}"
        if (
            name != "no_secret_runner"
            and SENSITIVE_NAME_PATTERN.search(name)
            and isinstance(value, str)
        ):
            if value.strip() and not SAFE_SENSITIVE_VALUE_PATTERN.fullmatch(value):
                fail_check(
                    f"{child_path} declares a sensitive value; use owner-only or redacted text, never a secret"
                )

        if PRODUCTION_ACTION_NAME_PATTERN.search(name):
            if not test_approved_action_object(value):
                block_check(
                    f"{child_path} is production/deploy/sign/release/updater scoped but lacks explicit approval_id"
                )

        inspect_json_tree(value, child_path)


def assert_uri_like(value: str, label: str) -> None:
    if not value.strip():
        return
    if URI_LIKE_PATTERN.match(value):
        pass_check(f"{label} has an explicit URL/origin shape")
    else:
        fail_check(f"{label} must be an explicit URL/origin, not a vague environment name")


def test_runtime_readiness_entry(runtime) -> None:
    runtime_id = require_string_path(runtime, "runtime_id", "runtime_readiness.runtime_id")
    if runtime_id in SUPPORTED_RUNTIME_IDS:
        pass_check(f"runtime_readiness {runtime_id} is supported")
    elif test_non_empty_string(runtime_id):
        fail_check(
            f"runtime_readiness runtime_id must be codex, claude-code, or opencode, got '{runtime_id}'"
        )

    require_string_path(runtime, "command_discovery.command_name", f"runtime_readiness.{runtime_id} command_discovery.command_name")
    installed = get_value_at_path(runtime, "command_discovery.installed")
    if isinstance(installed, bool):
        pass_check(f"runtime_readiness.{runtime_id} command_discovery.installed is boolean")
    else:
        fail_check(f"runtime_readiness.{runtime_id} command_discovery.installed missing or not boolean")
    require_string_path(runtime, "json_mode.expected_flag_or_mode", f"runtime_readiness.{runtime_id} json_mode.expected_flag_or_mode")
    require_string_path(runtime, "permission_boundary.expected_mode", f"runtime_readiness.{runtime_id} permission_boundary.expected_mode")
    require_string_path(runtime, "budget.stop_policy", f"runtime_readiness.{runtime_id} budget.stop_policy")
    require_string_path(runtime, "timeouts.kill_policy", f"runtime_readiness.{runtime_id} timeouts.kill_policy")
    require_string_path(runtime, "artifacts.root_policy", f"runtime_readiness.{runtime_id} artifacts.root_policy")
    require_string_path(runtime, "redaction_manifest.policy", f"runtime_readiness.{runtime_id} redaction_manifest.policy")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--RepoRoot", default=".", help="repository root (defaults to the current directory)")
    parser.add_argument("--ManifestPath", default="", help="operator-approved preflight manifest path")
    args = parser.parse_args()

    repo_root = os.path.realpath(args.RepoRoot)
    manifest_path = args.ManifestPath

    print("AgentHub approved-real preflight manifest gate")
    print("Input kind: manifest/preflight only")
    print("No login, CLI/model/API, deploy, sign, notarization, updater, release upload, network, or production command was executed.")
    print("MockAdapterUsed=false")
    print("RealCliTested=false")
    print("RealModelTested=false")
    print("TokenDanceIDLogin=false")

    if not manifest_path.strip():
        fail_check("explicit -ManifestPath is required")
        print("Status: APPROVED_REAL_PREFLIGHT_BLOCKED")
        return 1

    resolved_manifest = manifest_path if os.path.isabs(manifest_path) else os.path.join(repo_root, manifest_path)
    resolved_manifest = os.path.abspath(os.path.normpath(resolved_manifest))
    if not os.path.isfile(resolved_manifest):
        fail_check(f"manifest file not found: {resolved_manifest}")
        print("Status: APPROVED_REAL_PREFLIGHT_BLOCKED")
        return 1

    with open(resolved_manifest, encoding="utf-8") as handle:
        raw = handle.read()
    if SECRET_LIKE_PATTERN.search(raw):
        fail_check("manifest contains secret-like content; provide identifiers, owners, hashes, or redacted placeholders only")

    try:
        manifest = json.loads(raw)
    except ValueError:
        fail_check("manifest is not valid JSON")
        print("Status: APPROVED_REAL_PREFLIGHT_BLOCKED")
        return 1
    pass_check("manifest JSON parsed")

    inspect_json_tree(manifest)

    mode = require_string_path(manifest, "mode", "mode")
    if mode == "approved-real":
        pass_check("mode=approved-real")
    elif test_non_empty_string(mode):
        fail_check(f"mode must be approved-real, got '{mode}'")

    require_string_path(manifest, "approved_by", "approved_by")
    require_string_path(manifest, "approval_id", "approval_id")
    require_string_path(manifest, "artifact_root", "artifact_root")

    redaction = require_object_path(manifest, "redaction_policy", "redaction_policy")
    if redaction is not None:
        for path in ("stdout", "stderr", "env", "artifacts"):
            require_string_path(manifest, f"redaction_policy.{path}", f"redaction_policy.{path}")

    require_object_path(manifest, "timeouts", "timeouts")
    require_number_path(manifest, "timeouts.total_seconds", "timeouts.total_seconds")
    require_number_path(manifest, "timeouts.per_step_seconds", "timeouts.per_step_seconds")
    require_string_path(manifest, "timeouts.kill_policy", "timeouts.kill_policy")

    require_object_path(manifest, "budget", "budget")
    require_number_path(manifest, "budget.max_usd", "budget.max_usd")
    require_number_path(manifest, "budget.max_requests", "budget.max_requests")
    require_string_path(manifest, "budget.stop_policy", "budget.stop_policy")

    require_string_path(manifest, "target_runtime.id", "target runtime id")
    require_string_path(manifest, "target_runtime.kind", "target runtime kind")
    require_string_path(manifest, "cli.command_path", "CLI command path")
    require_string_path(manifest, "cli.command_plan", "future CLI command plan")
    require_string_path(manifest, "cli.no_secret_runner", "no-secret runner command/owner")

    require_object_path(manifest, "readiness_claims", "readiness_claims")
    require_bool_path(manifest, "readiness_claims.mock_adapter_used", "MockAdapterUsed preflight claim", False)
    require_bool_path(manifest, "readiness_claims.real_cli_tested", "RealCliTested preflight claim", False)
    require_bool_path(manifest, "readiness_claims.real_model_tested", "RealModelTested preflight claim", False)
    require_bool_path(manifest, "readiness_claims.tokendance_id_login", "TokenDanceID login preflight claim", False)
    require_string_path(manifest, "readiness_claims.real_cli_tested_reason", "RealCliTested blocked reason")
    require_string_path(manifest, "readiness_claims.real_model_tested_reason", "RealModelTested blocked reason")
    require_string_path(manifest, "readiness_claims.tokendance_id_login_reason", "TokenDanceID login blocked reason")
    require_string_path(manifest, "recording_evidence.path", "recording evidence path")
    require_string_path(manifest, "recording_evidence.status", "recording evidence status")

    runtime_readiness = require_array_path(manifest, "runtime_readiness", "runtime_readiness")
    seen_runtime_ids = set()
    for runtime in runtime_readiness:
        test_runtime_readiness_entry(runtime)
        runtime_id = get_value_at_path(runtime, "runtime_id")
        if test_non_empty_string(runtime_id):
            seen_runtime_ids.add(runtime_id)
    for runtime_id in SUPPORTED_RUNTIME_IDS:
        if runtime_id in seen_runtime_ids:
            pass_check(f"runtime_readiness includes {runtime_id}")
        else:
            fail_check(f"runtime_readiness missing {runtime_id}")

    hub_url = require_string_path(manifest, "urls.hub", "Hub URL")
    web_url = require_string_path(manifest, "urls.web", "Web URL")
    desktop_url = require_string_path(manifest, "urls.desktop", "Desktop URL")
    edge_url = require_string_path(manifest, "urls.edge", "Local Edge URL")
    assert_uri_like(hub_url, "Hub URL")
    assert_uri_like(web_url, "Web URL")
    assert_uri_like(desktop_url, "Desktop URL")
    assert_uri_like(edge_url, "Local Edge URL")

    require_string_path(manifest, "test_identifiers.account_id", "test account identifier")
    require_string_path(manifest, "test_identifiers.client_id", "test client identifier")
    require_string_path(manifest, "test_identifiers.target_id", "target identifier")

    print("\nMode boundaries:")
    print("  fixture=not-run")
    print("  observed=not-run")
    print("  approved-real=manifest-validated-only")
    print("  production=blocked-unless-separately-approved")
    print("  MockAdapterUsed=false")
    print("  RealCliTested=false")
    print("  RealModelTested=false")
    print("  TokenDanceIDLogin=false")

    print("\n========================================")
    print(f"  Passed: {passed}  |  Failed: {failed}  |  Blocks: {blocks}")
    print("========================================")

    if failed > 0 or blocks > 0:
        print("Status: APPROVED_REAL_PREFLIGHT_BLOCKED")
        return 1

    print("Status: APPROVED_REAL_PREFLIGHT_MANIFEST_OK")
    print("Approved-real preflight manifest is complete; this is not evidence that real login, CLI/model/API, deploy, signing, notarization, release upload, or production execution occurred.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
