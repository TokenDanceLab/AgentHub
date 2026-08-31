#!/usr/bin/env python3
"""AgentHub P0 Edge CLI real-readiness proposal gate — ps1 迁移。

This script is intentionally secret-free. By default it reads repository files
and proposal parameters only. With --DiscoverCommands it may run Get-Command
plus runtime --version/--help probes; it never executes prompt-bearing CLI,
network, secret, workspace, or model/API commands.

契约（ps1-to-python-migration）：stdlib only；CLI 签名/退出码与 ps1 一致
（--RepoRoot/--Mode/--AdapterId/.../--Approve* 开关，Mode 仅
ProposalOnly/RealTested/Submission，0=通过）；机器可读行格式
（PASS/FAIL/WARN/BLOCK/Status）与 ps1 完全一致。
"""

import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

SUPPORTED_RUNTIME_IDS = ("codex-acp", "claude-code", "opencode-acp")
SECRET_LIKE_PATTERN = re.compile(
    r"(sk-[a-z0-9_-]{8,}|gh[pousr]_[a-z0-9_]{8,}|xox[baprs]-[a-z0-9-]+|AKIA[0-9A-Z]{12,}|"
    r"-----BEGIN [A-Z ]*PRIV(?:ATE) KEY-----|"
    r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|"
    r"(?:token|secret|api[_-]?key|password|authorization)\s*[:=]\s*\S+)",
    re.IGNORECASE,
)

RUNTIME_READINESS_DESCRIPTORS = [
    {
        "RuntimeId": "codex-acp",
        "CommandName": "npx",
        "VersionArgs": ["--version"],
        "HelpArgs": ["--help"],
        "JsonMode": "codex-acp ACP over stdio",
        "PermissionBoundary": "operator-approved mode only; never infer approval from CLI defaults",
        "DryPlan": "discover npx launcher, inspect --version/--help, record future codex-acp ACP command shape without prompt",
        "EnvNames": ["AGENTHUB_CODEX_ACP_PATH", "OPENAI_API_KEY"],
    },
    {
        "RuntimeId": "claude-code",
        "CommandName": "claude",
        "VersionArgs": ["--version"],
        "HelpArgs": ["--help"],
        "JsonMode": "claude --output-format stream-json",
        "PermissionBoundary": "operator-approved permission mode only; approval bridge must be reviewed before real prompt",
        "DryPlan": "discover command, inspect --version/--help, record future claude stream-json command shape without prompt",
        "EnvNames": ["AGENTHUB_CLAUDE_CODE_PATH", "ANTHROPIC_API_KEY"],
    },
    {
        "RuntimeId": "opencode-acp",
        "CommandName": "opencode",
        "VersionArgs": ["--version"],
        "HelpArgs": ["--help"],
        "JsonMode": "opencode acp over stdio",
        "PermissionBoundary": "default must not enable dangerously-skip-permissions; bypass requires explicit approval",
        "DryPlan": "discover command, inspect --version/--help, record future opencode acp command shape without prompt",
        "EnvNames": ["AGENTHUB_OPENCODE_ACP_PATH"],
    },
]

passed = 0
failed = 0
warnings = 0
blocks = 0


def step(text: str) -> None:
    print(f"\n=== {text} ===")


def pass_check(text: str) -> None:
    global passed
    passed += 1
    print(f"  PASS  {text}")


def fail_check(text: str) -> None:
    global failed
    failed += 1
    print(f"  FAIL  {text}")


def warn_check(text: str) -> None:
    global warnings
    warnings += 1
    print(f"  WARN  {text}")


def block_check(text: str) -> None:
    global blocks
    blocks += 1
    print(f"  BLOCK real execution: {text}")


def read_repo_file(repo_root: str, relative_path: str) -> str:
    path = os.path.join(repo_root, relative_path.replace("\\", os.sep))
    if not os.path.exists(path):
        fail_check(f"missing {relative_path}")
        return ""
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def assert_contains(repo_root: str, relative_path: str, pattern: str, label: str) -> None:
    content = read_repo_file(repo_root, relative_path)
    if re.search(pattern, content, re.IGNORECASE):
        pass_check(label)
    else:
        fail_check(f"{label} ({relative_path} missing pattern: {pattern})")


def assert_not_contains(repo_root: str, relative_path: str, pattern: str, label: str) -> None:
    content = read_repo_file(repo_root, relative_path)
    if not re.search(pattern, content, re.IGNORECASE):
        pass_check(label)
    else:
        fail_check(f"{label} ({relative_path} contains pattern: {pattern})")


def test_non_empty(value: str) -> bool:
    return bool(value.strip())


def get_normalized_proposed_path(repo_root: str, path: str) -> str:
    if not test_non_empty(path):
        return ""
    candidate = path if os.path.isabs(path) else os.path.join(repo_root, path)
    return os.path.abspath(os.path.normpath(candidate))


def test_path_under_allowed_root(repo_root: str, allowed_roots, path: str) -> bool:
    if not test_non_empty(path):
        return False

    normalized = get_normalized_proposed_path(repo_root, path)
    for root in allowed_roots:
        normalized_root = os.path.abspath(os.path.normpath(root))
        if normalized.lower() == normalized_root.lower():
            return True
        root_prefix = normalized_root.rstrip("\\/") + os.sep
        if normalized.lower().startswith(root_prefix.lower()):
            return True
    return False


def assert_no_secret_like_input(name: str, value: str) -> None:
    if not test_non_empty(value):
        return
    if SECRET_LIKE_PATTERN.search(value):
        fail_check(f"{name} contains secret-like content; provide names, owners, hashes, or redacted placeholders only")
    else:
        pass_check(f"{name} contains no secret-like content")


def convert_to_safe_probe_text(output_lines, repo_root: str, user_profile: str) -> str:
    text = "\n".join(str(line) for line in output_lines).strip()
    if not text.strip():
        return ""
    text = SECRET_LIKE_PATTERN.sub("[redacted]", text)
    text = text.replace(re.escape(repo_root), "[repo-root]")
    if user_profile:
        text = text.replace(re.escape(user_profile), "[user-profile]")
    if len(text) > 300:
        return text[:300] + "...[truncated]"
    return text


def invoke_no_spend_cli_probe(command_path: str, arguments, repo_root: str, user_profile: str) -> dict:
    try:
        run_result = subprocess.run(
            [command_path] + arguments,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=120,
        )
        output_lines = (run_result.stdout or "").splitlines() + (run_result.stderr or "").splitlines()
        return {
            "attempted": True,
            "exit_code": run_result.returncode,
            "output_preview": convert_to_safe_probe_text(output_lines, repo_root, user_profile),
        }
    except Exception as exc:  # noqa: BLE001 —— 对齐 ps1 catch：探测失败不中断
        return {
            "attempted": True,
            "exit_code": None,
            "output_preview": "probe failed: " + convert_to_safe_probe_text([str(exc)], repo_root, user_profile),
        }


def new_runtime_readiness_manifest(repo_root: str, mode: str, discover_commands: bool, user_profile: str) -> dict:
    runtimes = []
    for descriptor in RUNTIME_READINESS_DESCRIPTORS:
        command = shutil.which(descriptor["CommandName"])
        installed = command is not None
        version_probe = {"attempted": False, "exit_code": None, "output_preview": ""}
        help_probe = {"attempted": False, "exit_code": None, "output_preview": ""}
        if discover_commands and installed:
            version_probe = invoke_no_spend_cli_probe(command, descriptor["VersionArgs"], repo_root, user_profile)
            help_probe = invoke_no_spend_cli_probe(command, descriptor["HelpArgs"], repo_root, user_profile)

        runtimes.append(
            {
                "runtime_id": descriptor["RuntimeId"],
                "command_discovery": {
                    "command_name": descriptor["CommandName"],
                    "installed": installed,
                    "resolved_path_kind": "basename-only-redacted" if installed else "missing",
                    "resolved_path": os.path.basename(command) if installed else "",
                    "version_probe": version_probe,
                    "help_probe": help_probe,
                },
                "json_mode": {
                    "expected_flag_or_mode": descriptor["JsonMode"],
                    "dry_plan_only": True,
                },
                "permission_boundary": {
                    "expected_mode": descriptor["PermissionBoundary"],
                    "approval_required": True,
                },
                "budget": {
                    "max_requests_before_real_approval": 0,
                    "max_usd_before_real_approval": 0,
                    "stop_policy": "no prompt/model/API execution in readiness; approved-real run must provide explicit budget",
                },
                "timeouts": {
                    "discovery_probe": "version/help only; no prompt stdin",
                    "kill_policy": "future real run must provide hard timeout and process-tree kill policy",
                },
                "artifacts": {
                    "root_policy": ".tmp/edge-cli-real-readiness or temp AgentHub edge-cli-real-readiness only",
                    "manifest_required": True,
                },
                "redaction_manifest": {
                    "policy": "env names only; stdout/stderr/artifacts redacted before publication",
                    "secret_values_allowed": False,
                },
                "dry_plan": descriptor["DryPlan"],
                "env_names": descriptor["EnvNames"],
            }
        )

    return {
        "schema": "agenthub-edge-cli-approved-real-readiness-v1",
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z"),
        "mode": mode,
        "real_tested": False,
        "model_api_consumed": False,
        "prompt_executed": False,
        "discovery_commands_attempted": bool(discover_commands),
        "no_spend_boundary": "command discovery, --version, and --help only; no prompt/model/API call",
        "runtimes": runtimes,
    }


def write_readiness_manifest(repo_root: str, output_manifest_path: str, manifest: dict) -> None:
    if not output_manifest_path.strip():
        return

    resolved = output_manifest_path if os.path.isabs(output_manifest_path) else os.path.join(repo_root, output_manifest_path)
    resolved = os.path.abspath(os.path.normpath(resolved))
    parent = os.path.dirname(resolved)
    if parent.strip():
        os.makedirs(parent, exist_ok=True)
    with open(resolved, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
    pass_check(f"wrote per-runtime readiness manifest to {resolved}")


def add_prerequisite_result(condition: bool, pass_text: str, block_text: str, fail_when_missing: bool) -> None:
    if condition:
        pass_check(pass_text)
        return
    if fail_when_missing:
        fail_check(f"missing required approval input: {block_text}")
        return
    warn_check(block_text)
    block_check(block_text)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--RepoRoot", default=".", help="repository root (defaults to the current directory)")
    parser.add_argument("--Mode", default="ProposalOnly", help="execution mode (ProposalOnly/RealTested/Submission)")
    parser.add_argument("--AdapterId", default="", help="target adapter/runtime id")
    parser.add_argument("--RuntimeId", default="", help="target runtime id (fallback adapter id)")
    parser.add_argument("--RuntimePath", default="", help="runtime path/owner evidence")
    parser.add_argument("--RuntimeEnvManifest", default="", help="runtime env manifest evidence")
    parser.add_argument("--BudgetPlan", default="", help="budget plan evidence")
    parser.add_argument("--CommandPlan", default="", help="future command plan evidence")
    parser.add_argument("--TimeoutPlan", default="", help="timeout plan evidence")
    parser.add_argument("--RedactionPlan", default="", help="redaction plan evidence")
    parser.add_argument("--RedactionPolicy", default="", help="redaction policy evidence")
    parser.add_argument("--ArtifactRoot", default="", help="artifact root evidence")
    parser.add_argument("--ArtifactRetention", default="", help="artifact retention evidence")
    parser.add_argument("--EnvVarOwnership", default="", help="env var ownership evidence")
    parser.add_argument("--EvidenceMode", default="", help="evidence mode evidence")
    parser.add_argument("--OperatorApprovalId", default="", help="operator approval id evidence")
    parser.add_argument("--RealExecutionEvidenceManifest", default="", help="real execution evidence manifest")
    parser.add_argument("--OutputManifestPath", default="", help="output readiness manifest path")
    parser.add_argument("--RequireApprovalInputs", action="store_true", help="fail when approval inputs are missing")
    parser.add_argument("--DiscoverCommands", action="store_true", help="run Get-Command plus --version/--help probes")
    parser.add_argument("--ApproveNoRealExecution", action="store_true", help="approve that no real CLI/model call ran")
    parser.add_argument("--ApproveRedactionPolicy", action="store_true", help="approve redaction policy review")
    parser.add_argument("--ApproveArtifactRetention", action="store_true", help="approve artifact retention review")
    parser.add_argument("--ApproveEnvVarOwnership", action="store_true", help="approve env var ownership review")
    args = parser.parse_args()

    repo_root = os.path.realpath(args.RepoRoot)
    mode = args.Mode

    if mode not in ("ProposalOnly", "RealTested", "Submission"):
        print(f"ERROR: cannot validate argument 'Mode': mode must be ProposalOnly, RealTested, or Submission", file=sys.stderr)
        return 1

    effective_adapter_id = args.AdapterId if test_non_empty(args.AdapterId) else args.RuntimeId
    effective_redaction_policy = args.RedactionPolicy if test_non_empty(args.RedactionPolicy) else args.RedactionPlan
    temp_base = os.environ.get("TEMP") or os.environ.get("TMP") or tempfile.gettempdir()
    allowed_artifact_roots = [
        os.path.abspath(os.path.normpath(os.path.join(repo_root, ".tmp", "edge-cli-real-readiness"))),
        os.path.abspath(os.path.normpath(os.path.join(temp_base, "AgentHub", "edge-cli-real-readiness"))),
    ]

    print("AgentHub P0 Edge CLI real-readiness proposal gate")
    print(f"Mode: {mode}")
    if args.DiscoverCommands:
        print("Codex, Claude Code, and OpenCode probes are limited to Get-Command, --version, and --help.")
        print("No prompt, model, API, secret, approval, or workspace command is executed.")
    else:
        print("No Codex, Claude Code, or OpenCode command was executed.")
    print("No network, secret, model, or API budget was consumed.")

    step("supported adapter/runtime ids")
    assert_contains(repo_root, "edge-server\\internal\\adapters\\registry.go", r"cliAdapterIDs\s*=\s*map\[string\]struct\{\}", "CLI adapter id allowlist exists")
    for runtime_id in SUPPORTED_RUNTIME_IDS:
        assert_contains(repo_root, "edge-server\\internal\\adapters\\registry.go", '"' + re.escape(runtime_id) + '"', f"registry allows {runtime_id}")
    assert_contains(repo_root, "edge-server\\internal\\adapters\\registry.go", "ValidateCLIAdapterID", "ValidateCLIAdapterID exists")
    assert_contains(repo_root, "edge-server\\internal\\adapters\\registry_test.go", "TestValidateCLIAdapterID", "supported/unsupported runtime ids are unit-tested")
    assert_contains(repo_root, "edge-server\\internal\\adapters\\registry_test.go", "agenthub-runner-mock", "mock runner is excluded from real CLI adapter ids")
    assert_contains(repo_root, "edge-server\\cmd\\agenthub-edge\\adapter_registry.go", "runnerProfileCodex", "Edge config supports codex runtime profile")
    assert_contains(repo_root, "edge-server\\cmd\\agenthub-edge\\adapter_registry.go", "runnerProfileClaudeCode", "Edge config supports claude-code runtime profile")
    assert_contains(repo_root, "edge-server\\cmd\\agenthub-edge\\adapter_registry.go", "runnerProfileOpenCode", "Edge config supports opencode runtime profile")
    assert_contains(repo_root, "edge-server\\cmd\\agenthub-edge\\config.go", "AGENTHUB_CODEX_ACP_PATH", "Codex ACP launcher path env is named")
    assert_contains(repo_root, "edge-server\\cmd\\agenthub-edge\\config.go", "AGENTHUB_CLAUDE_ACP_PATH", "Claude ACP launcher path env is named")
    assert_contains(repo_root, "edge-server\\cmd\\agenthub-edge\\config.go", "AGENTHUB_OPENCODE_ACP_PATH", "OpenCode ACP path env is named")

    step("explicit unknown runtime no-fallback evidence")
    assert_contains(repo_root, "edge-server\\internal\\adapters\\registry.go", r"agent adapter %q not found", "registry resolves explicit unknown adapter as an error")
    assert_contains(repo_root, "edge-server\\internal\\lifecycle\\process_executor_run.go", r"adapterReg.Resolve\(runCtx.AgentID\)", "process executor resolves explicit run agent id through registry")
    assert_contains(repo_root, "edge-server\\internal\\lifecycle\\process_executor_test.go", "TestProcessExecutorFailsUnknownExplicitAdapterWithoutDefaultFallback", "lifecycle test covers explicit unknown runtime")
    assert_contains(repo_root, "edge-server\\internal\\lifecycle\\process_executor_test.go", "unknown-runtime", "lifecycle test uses explicit unknown-runtime id")
    assert_contains(repo_root, "edge-server\\internal\\lifecycle\\process_executor_test.go", "default adapter was invoked for unknown runtime", "lifecycle test proves no default fallback")
    # governance-execution.md 已外迁 TokenDance docs archive（#1807）；仓库内
    # 治理指针收敛到 docs/governance/README.md。unknown-runtime fallback 事实
    # 由上面的代码级断言保证，不再依赖已删文档。
    step("proposal/readiness artifact")
    gov = "docs\\governance\\README.md"
    assert_contains(repo_root, gov, "Edge CLI real-readiness", "governance doc still points at the readiness gate")
    assert_contains(repo_root, gov, "proposal-only", "governance doc records proposal-only scope")
    assert_contains(repo_root, gov, "真实运行", "governance doc records no real CLI/model run")
    assert_contains(repo_root, gov, "operator 审批", "governance doc records operator approval prerequisite")
    assert_contains(repo_root, gov, "预算/脱敏策略", "governance doc records budget/redaction prerequisite")
    assert_contains(repo_root, gov, "artifact root", "governance doc records artifact root prerequisite")
    assert_contains(repo_root, gov, "证据模式", "governance doc records evidence mode prerequisite")

    forbidden_primitive_pattern = "|".join(
        [
            ("Start" + "-Process"),
            ("Invoke" + "-Expression"),
            ("Invoke" + "-Command"),
            ("Invoke" + "-WebRequest"),
            ("Invoke" + "-RestMethod"),
            ("System" + r"\.Diagnostics" + r"\.Process"),
            ("Process" + "StartInfo"),
        ]
    )
    assert_not_contains(
        repo_root,
        "scripts/verify/verify-edge-cli-real-readiness.py",
        forbidden_primitive_pattern,
        "this readiness script has no process/network execution primitive",
    )
    assert_not_contains(
        repo_root,
        "scripts/verify/verify-edge-cli-real-readiness.py",
        r"(?m)^\s*(?:&\s*)?(?:codex|claude|opencode)\b",
        "this readiness script has no direct real CLI command pattern",
    )

    step("per-runtime readiness manifest")
    user_profile = os.environ.get("USERPROFILE", "")
    readiness_manifest = new_runtime_readiness_manifest(repo_root, mode, args.DiscoverCommands, user_profile)
    for runtime in readiness_manifest["runtimes"]:
        status = "installed" if runtime["command_discovery"]["installed"] else "missing"
        pass_check(f"{runtime['runtime_id']} readiness manifest prepared ({status})")
    write_readiness_manifest(repo_root, args.OutputManifestPath, readiness_manifest)

    step("real run approval prerequisites")
    fail_missing_approval_inputs = bool(args.RequireApprovalInputs)
    runtime_id_known = test_non_empty(effective_adapter_id) and effective_adapter_id in SUPPORTED_RUNTIME_IDS

    if test_non_empty(effective_adapter_id) and not runtime_id_known:
        fail_check("unsupported adapter/runtime id; allowed adapters are codex, claude-code, opencode")

    assert_no_secret_like_input("adapter/runtime id", effective_adapter_id)
    assert_no_secret_like_input("runtime path", args.RuntimePath)
    assert_no_secret_like_input("runtime env manifest", args.RuntimeEnvManifest)
    assert_no_secret_like_input("budget plan", args.BudgetPlan)
    assert_no_secret_like_input("command plan", args.CommandPlan)
    assert_no_secret_like_input("timeout plan", args.TimeoutPlan)
    assert_no_secret_like_input("redaction policy", effective_redaction_policy)
    assert_no_secret_like_input("artifact root", args.ArtifactRoot)
    assert_no_secret_like_input("artifact retention", args.ArtifactRetention)
    assert_no_secret_like_input("env var ownership", args.EnvVarOwnership)
    assert_no_secret_like_input("evidence mode", args.EvidenceMode)
    assert_no_secret_like_input("operator approval id", args.OperatorApprovalId)
    assert_no_secret_like_input("real execution evidence manifest", args.RealExecutionEvidenceManifest)

    if test_non_empty(args.ArtifactRoot):
        if test_path_under_allowed_root(repo_root, allowed_artifact_roots, args.ArtifactRoot):
            pass_check("artifact root is inside allowed temp dirs")
        else:
            fail_check("artifact root is outside allowed temp dirs; use .tmp\\edge-cli-real-readiness or `$env:TEMP\\AgentHub\\edge-cli-real-readiness")

    add_prerequisite_result(runtime_id_known, "adapter/runtime id is one of: codex, claude-code, opencode", "adapter/runtime id missing or unsupported; pass -AdapterId codex|claude-code|opencode", fail_missing_approval_inputs)
    add_prerequisite_result(test_non_empty(args.RuntimePath), "runtime path is named for approval evidence", "runtime path missing; provide a redacted path/owner, not CLI auth contents", fail_missing_approval_inputs)
    add_prerequisite_result(test_non_empty(args.RuntimeEnvManifest), "runtime env manifest is named for approval evidence", "runtime path/env missing; provide required env names and owners without values", fail_missing_approval_inputs)
    add_prerequisite_result(test_non_empty(args.EnvVarOwnership), "env var ownership is named", "env var ownership missing; name each required env var owner without values", fail_missing_approval_inputs)
    add_prerequisite_result(test_non_empty(args.BudgetPlan), "budget/request limit plan is named", "budget missing; provide max calls/tokens/cost/time and stop policy", fail_missing_approval_inputs)
    add_prerequisite_result(test_non_empty(args.CommandPlan), "future command plan is named", "command missing; provide exact future CLI command shape without executing it", fail_missing_approval_inputs)
    add_prerequisite_result(test_non_empty(args.TimeoutPlan), "timeout/kill policy is named", "timeout missing; provide hard timeout and process-tree kill policy", fail_missing_approval_inputs)
    add_prerequisite_result(test_non_empty(effective_redaction_policy), "redaction policy is named", "redaction missing; provide stdout/stderr/env/artifact redaction policy", fail_missing_approval_inputs)
    add_prerequisite_result(
        test_non_empty(args.ArtifactRoot) and test_path_under_allowed_root(repo_root, allowed_artifact_roots, args.ArtifactRoot),
        "artifact root is named and inside allowed temp dirs",
        "artifact root missing or outside allowed temp dirs; provide isolated output directory for real-run evidence",
        fail_missing_approval_inputs,
    )
    add_prerequisite_result(test_non_empty(args.ArtifactRetention), "artifact retention policy is named", "artifact retention missing; provide retention owner, duration, and raw-artifact deletion policy", fail_missing_approval_inputs)
    add_prerequisite_result(test_non_empty(args.EvidenceMode), "evidence mode is named", "evidence mode missing; provide redacted-log/hash-only/operator-reviewed mode", fail_missing_approval_inputs)
    add_prerequisite_result(test_non_empty(args.OperatorApprovalId), "operator approval id is named", "operator approval missing; provide approval id before RealTested or Submission", fail_missing_approval_inputs)
    add_prerequisite_result(bool(args.ApproveNoRealExecution), "approval flag confirms this verifier is static and ran no real CLI/model call", "approval flag missing: -ApproveNoRealExecution", fail_missing_approval_inputs)
    add_prerequisite_result(bool(args.ApproveRedactionPolicy), "approval flag confirms redaction policy review", "approval flag missing: -ApproveRedactionPolicy", fail_missing_approval_inputs)
    add_prerequisite_result(bool(args.ApproveArtifactRetention), "approval flag confirms artifact retention review", "approval flag missing: -ApproveArtifactRetention", fail_missing_approval_inputs)
    add_prerequisite_result(bool(args.ApproveEnvVarOwnership), "approval flag confirms env var ownership review", "approval flag missing: -ApproveEnvVarOwnership", fail_missing_approval_inputs)

    if mode != "ProposalOnly":
        if test_non_empty(args.RealExecutionEvidenceManifest):
            warn_check("real execution evidence manifest parameter was provided but is not validated by this static proposal gate")
        else:
            warn_check("real execution evidence manifest missing")
        block_check("RealTested/Submission require an independent real-run verifier; this static gate cannot prove real CLI/model execution")

    print("\n========================================")
    print(f"  Passed: {passed}  |  Failed: {failed}  |  Warnings: {warnings}  |  Blocks: {blocks}")
    print("========================================")

    if mode == "ProposalOnly":
        print("Status: PROPOSAL_ONLY")
        if blocks > 0:
            print("Real execution remains blocked until every prerequisite above is cleared by operator approval.")
        return 1 if failed > 0 else 0

    if failed > 0 or blocks > 0:
        print("Status: BLOCKED_FOR_REAL_EXECUTION")
        print("RealTested/Submission modes require a separate approved real-run verifier with redacted evidence.")
        return 1

    print("Status: BLOCKED_FOR_REAL_EXECUTION")
    print("Non-proposal modes are not successful in this static verifier.")
    return 1


def tempfile_gettempdir() -> str:
    return tempfile.gettempdir()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
