#!/usr/bin/env python3
"""AgentHub local stack E2E readiness runner（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

组合既有 localhost fixture、localhost real-services、login-readiness、
Edge CLI-readiness、observed-dispatch 门禁，区分：

- FixtureOnly：只跑 fixture product-loop harness。
- ReadinessOnly：检查命令、端口、环境变量名、artifact root、
  approval-gate blockers，可选探测已运行服务。
- ApprovedReal：评审独立的 observed-dispatch evidence artifact；自身不
  执行 TokenDanceID 登录或真实 CLI/model 执行。

默认 fail-closed。除非显式提供 -StartServices 与 -StartServicePlanPath
才启动服务，且启动委托给受限的既有 real-services readiness verifier。

迁移差异（双跑对照记录）：内部子脚本调用改为 python 执行（对应
verify-localhost-product-loop / verify-login-e2e-readiness /
verify-edge-cli-real-readiness / verify-localhost-real-services /
verify-observed-localhost-dispatch 的 py 版本）；子脚本缺失时的输出
（"missing ..."）与错误文案随环境变化，对照时按文本归一化；CLI 参数、
退出码（0=通过 / 1=失败 / 2=参数非法）与 PASS/FAIL/WARN 行前缀格式
与原 ps1 一致。

用法：
  python scripts/smoke/verify-local-stack-e2e-readiness.py
  python scripts/smoke/verify-local-stack-e2e-readiness.py -Mode FixtureOnly
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
from datetime import datetime, timezone

failures = []
warnings = []
gate_results = []
real_tested = False


def add_ps_compat(parser, *names, **kwargs):
    """Register a parameter with both ps1-style (-Xxx) and python-style (--Xxx) names."""
    full_names = []
    for name in names:
        full_names.append(name)
        if name.startswith("--"):
            full_names.append("-" + name[2:])
    parser.add_argument(*full_names, **kwargs)

DEFAULT_REQUIRED_COMMANDS = ["node", "go", "powershell"]
DEFAULT_REQUIRED_ENVIRONMENTS = [
    "AGENTHUB_WEB_URL",
    "AGENTHUB_HUB_URL",
    "AGENTHUB_DESKTOP_BRIDGE_URL",
    "AGENTHUB_LOCAL_EDGE_URL",
    "AGENTHUB_LOCAL_STACK_ARTIFACT_ROOT",
]


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def step(text):
    print(f"\n=== {text} ===", flush=True)


def add_failure(text):
    failures.append(text)
    print(f"  FAIL  {text}", flush=True)


def add_warning(text):
    warnings.append(text)
    print(f"  WARN  {text}", flush=True)


def pass_check(text):
    print(f"  PASS  {text}", flush=True)


def add_gate_result(name, mode_label, exit_code, status_label, evidence=""):
    gate_results.append({
        "name": name,
        "mode": mode_label,
        "exit_code": exit_code,
        "status": status_label,
        "evidence": evidence,
    })


def invoke_captured_process(file_name, arguments, working_directory):
    try:
        completed = subprocess.run([file_name] + arguments, cwd=working_directory, capture_output=True, text=True, errors="replace")
        return {
            "ExitCode": completed.returncode,
            "Output": completed.stdout + "\n" + completed.stderr,
        }
    except OSError as error:
        return {
            "ExitCode": -1,
            "Output": str(error),
        }


def invoke_repo_script(relative_path, arguments, repo_root):
    script_path = os.path.join(repo_root, *relative_path.split("\\"))
    if not os.path.isfile(script_path):
        return {
            "ExitCode": -1,
            "Output": f"missing {relative_path}",
            "ScriptPath": script_path,
        }

    python_exe = sys.executable
    if not python_exe:
        return {
            "ExitCode": -1,
            "Output": "Python executable is unavailable",
            "ScriptPath": script_path,
        }

    run = invoke_captured_process(python_exe, [script_path] + arguments, repo_root)
    run["ScriptPath"] = script_path
    return run


def resolve_repo_path(path, repo_root):
    if not path:
        return ""
    if os.path.isabs(path):
        return os.path.normpath(path)
    return os.path.join(repo_root, path)


def test_path_under_root(path, root):
    normalized = os.path.normpath(os.path.abspath(path)).rstrip("\\/")
    normalized_root = os.path.normpath(os.path.abspath(root)).rstrip("\\/")
    if normalized.lower() == normalized_root.lower():
        return True
    prefix = normalized_root + os.sep
    return normalized.lower().startswith(prefix.lower())


def test_allowed_artifact_root(path, repo_root):
    if not path:
        return False
    candidate = os.path.abspath(resolve_repo_path(path, repo_root))
    temp_base = os.environ.get("TEMP") or tempfile.gettempdir()
    allowed_roots = [
        os.path.join(repo_root, ".tmp", "local-stack-e2e-readiness"),
        os.path.join(repo_root, "tmp", "local-stack-e2e-readiness"),
        os.path.join(temp_base, "AgentHub", "local-stack-e2e-readiness"),
    ]
    for root in allowed_roots:
        if test_path_under_root(candidate, root):
            return True
    return False


def test_allowed_evidence_path(path, repo_root, artifact_root, evidence_path_was_supplied):
    if not path:
        return False
    if not evidence_path_was_supplied:
        return True

    candidate = os.path.abspath(resolve_repo_path(path, repo_root))
    if test_allowed_artifact_root(candidate, repo_root):
        return True

    if artifact_root and test_allowed_artifact_root(artifact_root, repo_root):
        artifact_root_full = os.path.abspath(resolve_repo_path(artifact_root, repo_root))
        if test_path_under_root(candidate, artifact_root_full):
            return True

    return False


SECRET_LIKE_PATTERN = re.compile(
    r"(?i)(sk-[a-z0-9_-]{8,}|eyJ[a-z0-9_-]{12,}|bearer\s+[a-z0-9._-]{12,}|"
    r"refresh[_-]?token\s*=|access[_-]?token\s*=|id[_-]?token\s*=|password\s*=|client_secret\s*=)"
)


def test_secret_like(value):
    if not value:
        return False
    return SECRET_LIKE_PATTERN.search(value) is not None


def test_loopback_host(host_name):
    if not host_name:
        return False
    normalized = host_name.lower().strip("[]")
    if normalized in ("localhost", "::1"):
        return True
    return re.fullmatch(r"127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}", normalized) is not None


def test_loopback_http_url(url):
    try:
        parsed = urllib.parse.urlsplit(url)
        return parsed.scheme == "http" and test_loopback_host(parsed.hostname or "")
    except ValueError:
        return False


def get_origin(url):
    try:
        parsed = urllib.parse.urlsplit(url)
        scheme = parsed.scheme.lower()
        host = (parsed.hostname or "").lower()
        if not scheme or not host:
            return ""
        if parsed.port is None:
            port = 443 if scheme == "https" else 80
        else:
            port = parsed.port
        return f"{scheme}://{host}:{port}"
    except ValueError:
        return ""


def test_direct_local_edge_url(url, configured_local_edge_url):
    try:
        parsed = urllib.parse.urlsplit(url)
        edge = urllib.parse.urlsplit(configured_local_edge_url)
        if parsed.scheme not in ("http", "https"):
            return False
        if not test_loopback_host(parsed.hostname or ""):
            return False
        return parsed.port == edge.port
    except ValueError:
        return False


def get_url_port(url):
    try:
        parsed = urllib.parse.urlsplit(url)
        if parsed.port is not None:
            return parsed.port
        return 443 if parsed.scheme == "https" else 80
    except ValueError:
        return None


def assert_artifact_root(artifact_root, repo_root):
    if not artifact_root or not artifact_root.strip():
        add_failure("artifact root is required; use .tmp\\local-stack-e2e-readiness\\<run>")
        return
    if test_secret_like(artifact_root):
        add_failure("artifact root contains secret-like material")
        return
    if test_allowed_artifact_root(artifact_root, repo_root):
        pass_check("artifact root is inside allowed temp/readiness roots")
    else:
        add_failure("artifact root must stay under .tmp\\local-stack-e2e-readiness, tmp\\local-stack-e2e-readiness, or $env:TEMP\\AgentHub\\local-stack-e2e-readiness")


def assert_evidence_path(evidence_path, repo_root, artifact_root, evidence_path_was_supplied):
    if test_allowed_evidence_path(evidence_path, repo_root, artifact_root, evidence_path_was_supplied):
        if evidence_path_was_supplied:
            pass_check("EvidencePath is inside an allowed readiness root or validated ArtifactRoot")
        else:
            pass_check("default EvidencePath uses the process temp directory")
        return True

    add_failure("EvidencePath must stay under an allowed readiness temp root or the validated ArtifactRoot")
    return False


def assert_commands(required_command_names):
    for name in required_command_names:
        if not name or not name.strip():
            add_failure("required command name is blank")
            continue
        if test_secret_like(name):
            add_failure("required command name contains secret-like material")
            continue
        if shutil.which(name):
            pass_check(f"required command available: {name}")
        else:
            add_failure(f"required command missing: {name}")


def assert_environment_names(required_environment_names, supplied_environment_names, use_environment):
    available = {}
    for raw_name in supplied_environment_names:
        for name in str(raw_name).split(","):
            trimmed = name.strip()
            if trimmed:
                available[trimmed] = True
    if use_environment:
        for name in required_environment_names:
            if os.environ.get(name):
                available[name] = True

    for name in required_environment_names:
        if test_secret_like(name):
            add_failure("required environment name contains secret-like material")
            continue
        if name in available:
            pass_check(f"required environment name supplied: {name}")
        else:
            add_failure(f"required environment name missing: {name}")


def assert_urls_and_ports(args):
    for name, value, expected_port in [
        ("WebUrl", args.WebUrl, 5174),
        ("HubUrl", args.HubUrl, 8080),
        ("DesktopBridgeUrl", args.DesktopBridgeUrl, 5173),
        ("LocalEdgeUrl", args.LocalEdgeUrl, 3210),
    ]:
        if test_loopback_http_url(value):
            pass_check(f"{name} is loopback HTTP")
        else:
            add_failure(f"{name} must be loopback HTTP")

        port = get_url_port(value)
        if port == expected_port:
            pass_check(f"{name} uses expected local stack port {expected_port}")
        else:
            add_warning(f"{name} uses port {port} instead of expected {expected_port}; dynamic test ports are readiness-only")

    if test_direct_local_edge_url(args.WebUrl, args.LocalEdgeUrl):
        add_failure("Web URL must not point directly at Local Edge")
    if args.WebUpstreamMode != "hub":
        add_failure(f"Web upstream mode must be Hub, not {args.WebUpstreamMode}")
    if args.DesktopUpstreamMode != "local-edge":
        add_failure(f"Desktop bridge upstream mode must be Local Edge, not {args.DesktopUpstreamMode}")

    if args.RegisteredTargetUrl and test_direct_local_edge_url(args.RegisteredTargetUrl, args.LocalEdgeUrl):
        add_failure("registered target URL must point to Desktop bridge, not Local Edge")
    if args.HubDispatchTargetUrl and test_direct_local_edge_url(args.HubDispatchTargetUrl, args.LocalEdgeUrl):
        add_failure("Hub dispatch target URL must point to Desktop bridge, not Local Edge")


def write_report(status_label, evidence_path, repo_root, artifact_root, mode, required_command_names, required_environment_names, supplied_environment_names, args):
    report = {
        "schema": "agenthub-local-stack-e2e-readiness-v1",
        "mode": mode,
        "status": status_label,
        "real_tested": real_tested,
        "generated_at": now_iso(),
        "repo_root": repo_root,
        "artifact_root": artifact_root,
        "required_commands": required_command_names,
        "required_environment_names": required_environment_names,
        "supplied_environment_names": supplied_environment_names,
        "topology": {
            "web_url": args.WebUrl,
            "hub_url": args.HubUrl,
            "desktop_bridge_url": args.DesktopBridgeUrl,
            "local_edge_url": args.LocalEdgeUrl,
            "registered_target_url": args.RegisteredTargetUrl,
            "hub_dispatch_target_url": args.HubDispatchTargetUrl,
            "web_upstream_mode": args.WebUpstreamMode,
            "desktop_upstream_mode": args.DesktopUpstreamMode,
            "web_to_local_edge_direct": test_direct_local_edge_url(args.WebUrl, args.LocalEdgeUrl),
        },
        "gates": gate_results,
        "failures": failures,
        "warnings": warnings,
        "claims": {
            "fixture_only": mode == "FixtureOnly",
            "readiness_only": mode == "ReadinessOnly",
            "approved_real": mode == "ApprovedReal",
            "real_tokendance_id_login": False,
            "real_cli_or_model_invoked_by_this_script": False,
            "public_deploy_signing_or_release": False,
        },
        "blockers": [
            "real TokenDanceID login is not performed by this runner",
            "real CLI/model adapter invocation is not performed by this runner",
            "ApprovedReal requires an observed-dispatch manifest plus explicit approval",
            "caller-supplied URL topology is never accepted as real dispatch proof",
        ],
    }

    directory = os.path.dirname(evidence_path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(evidence_path, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(report, ensure_ascii=False, separators=(",", ":")))


def main() -> int:
    parser = argparse.ArgumentParser(description="AgentHub local stack E2E readiness runner（ps1 迁移）")
    add_ps_compat(parser, "--RepoRoot", default=".", help="repository root")
    add_ps_compat(parser, "--Mode", default="ReadinessOnly", choices=["FixtureOnly", "ReadinessOnly", "ApprovedReal"], help="runner mode")
    add_ps_compat(parser, "--EvidencePath", default="", help="evidence JSON output path")
    add_ps_compat(parser, "--ArtifactRoot", default="", help="artifact root")
    add_ps_compat(parser, "--RequiredCommandNames", action="append", default=None, help="required command name (repeatable)")
    add_ps_compat(parser, "--RequiredEnvironmentNames", action="append", default=None, help="required environment variable name (repeatable)")
    add_ps_compat(parser, "--SuppliedEnvironmentNames", action="append", default=None, help="supplied environment variable name (repeatable)")
    add_ps_compat(parser, "--UseEnvironment", action="store_true", help="read required environment variables from the process environment")
    add_ps_compat(parser, "--WebUrl", default="http://127.0.0.1:5174", help="web base URL")
    add_ps_compat(parser, "--HubUrl", default="http://127.0.0.1:8080", help="hub base URL")
    add_ps_compat(parser, "--DesktopBridgeUrl", default="http://127.0.0.1:5173", help="desktop bridge base URL")
    add_ps_compat(parser, "--LocalEdgeUrl", default="http://127.0.0.1:3210", help="local edge base URL")
    add_ps_compat(parser, "--RegisteredTargetUrl", default="", help="registered target URL evidence")
    add_ps_compat(parser, "--HubDispatchTargetUrl", default="", help="hub dispatch target URL evidence")
    add_ps_compat(parser, "--WebUpstreamMode", default="hub", choices=["hub", "local-edge", "unknown"], help="web upstream mode")
    add_ps_compat(parser, "--DesktopUpstreamMode", default="local-edge", choices=["local-edge", "hub", "unknown"], help="desktop bridge upstream mode")
    add_ps_compat(parser, "--WebHealthPath", default="/", help="web health path")
    add_ps_compat(parser, "--HubHealthPath", default="/health/live", help="hub health path")
    add_ps_compat(parser, "--DesktopHealthPath", default="/", help="desktop health path")
    add_ps_compat(parser, "--EdgeHealthPath", default="/v1/health", help="local edge health path")
    add_ps_compat(parser, "--ExpectedWebMarker", default="", help="expected web identity marker")
    add_ps_compat(parser, "--ExpectedHubMarker", default="", help="expected hub identity marker")
    add_ps_compat(parser, "--ExpectedDesktopMarker", default="", help="expected desktop bridge identity marker")
    add_ps_compat(parser, "--ExpectedEdgeMarker", default="", help="expected local edge identity marker")
    add_ps_compat(parser, "--TimeoutSec", type=int, default=12, help="probe deadline in seconds")
    add_ps_compat(parser, "--ProbeServices", action="store_true", help="probe already-running local services")
    add_ps_compat(parser, "--StartServices", action="store_true", help="start services from the explicit start plan")
    add_ps_compat(parser, "--StartServicePlanPath", default="", help="explicit start plan JSON path")
    add_ps_compat(parser, "--ObservedEvidencePath", default="", help="observed dispatch evidence artifact path")
    add_ps_compat(parser, "--ApproveRealEvidence", action="store_true", help="accept approval-gated observed dispatch RealTested evidence")
    args = parser.parse_args()

    if args.TimeoutSec <= 0:
        print("FAIL: -TimeoutSec must be greater than zero.", flush=True)
        return 2

    required_command_names = args.RequiredCommandNames if args.RequiredCommandNames else list(DEFAULT_REQUIRED_COMMANDS)
    required_environment_names = args.RequiredEnvironmentNames if args.RequiredEnvironmentNames else list(DEFAULT_REQUIRED_ENVIRONMENTS)
    supplied_environment_names = args.SuppliedEnvironmentNames if args.SuppliedEnvironmentNames else []

    evidence_path_was_supplied = bool(args.EvidencePath and args.EvidencePath.strip())
    repo_root = os.path.abspath(args.RepoRoot)
    if not args.EvidencePath.strip():
        evidence_path = os.path.join(tempfile.gettempdir(), f"agenthub-local-stack-e2e-readiness-{os.getpid()}.json")
    else:
        evidence_path = args.EvidencePath

    print("AgentHub local stack E2E readiness runner", flush=True)
    print(f"Mode: {args.Mode}", flush=True)
    print("RealTested=false unless ApprovedReal validates approval-gated observed evidence.", flush=True)

    step("Evidence output path")
    if not assert_evidence_path(evidence_path, repo_root, args.ArtifactRoot, evidence_path_was_supplied):
        print("Status: LOCAL_STACK_E2E_READINESS_FAILED", flush=True)
        print("RealTested=false", flush=True)
        return 1

    step("Static safety checks")
    assert_artifact_root(args.ArtifactRoot, repo_root)
    assert_commands(required_command_names)

    if args.Mode != "FixtureOnly":
        assert_environment_names(required_environment_names, supplied_environment_names, args.UseEnvironment)
        assert_urls_and_ports(args)

    if args.Mode == "FixtureOnly":
        step("FixtureOnly product-loop gate")
        if not args.ArtifactRoot.strip():
            fixture_evidence = os.path.join(tempfile.gettempdir(), f"agenthub-local-stack-fixture-{os.getpid()}.json")
        else:
            fixture_evidence = os.path.join(resolve_repo_path(args.ArtifactRoot, repo_root), "localhost-product-loop.json")
        fixture_run = invoke_repo_script("scripts\\smoke\\verify-localhost-product-loop.py", ["--RepoRoot", repo_root, "--EvidencePath", fixture_evidence], repo_root)
        print(fixture_run["Output"], flush=True)
        add_gate_result("verify-localhost-product-loop.py", "FixtureOnly", fixture_run["ExitCode"], "PASS" if fixture_run["ExitCode"] == 0 else "FAIL", fixture_evidence)
        if fixture_run["ExitCode"] != 0:
            add_failure("fixture product-loop gate failed")

        status = "FIXTURE_ONLY_PASSED" if len(failures) == 0 else "LOCAL_STACK_E2E_READINESS_FAILED"
        write_report(status, evidence_path, repo_root, args.ArtifactRoot, args.Mode, required_command_names, required_environment_names, supplied_environment_names, args)
        print(f"Status: {status}", flush=True)
        print("RealTested=false", flush=True)
        return 0 if len(failures) == 0 else 1

    step("Approval-boundary gates")
    login_run = invoke_repo_script("scripts\\verify\\verify-login-e2e-readiness.py", ["--RepoRoot", repo_root], repo_root)
    print(login_run["Output"], flush=True)
    if login_run["ExitCode"] == 2 and re.search("BLOCKED_UNTIL_APPROVED", login_run["Output"]):
        pass_check("login E2E gate is blocked until explicit approval")
        add_gate_result("verify-login-e2e-readiness.py", "ProposalOnly", login_run["ExitCode"], "EXPECTED_BLOCKED", "")
    else:
        add_failure("login E2E readiness gate did not fail closed as expected")
        add_gate_result("verify-login-e2e-readiness.py", "ProposalOnly", login_run["ExitCode"], "UNEXPECTED", "")

    edge_run = invoke_repo_script("scripts\\verify\\verify-edge-cli-real-readiness.py", ["--RepoRoot", repo_root], repo_root)
    print(edge_run["Output"], flush=True)
    if edge_run["ExitCode"] == 0 and re.search("Status: PROPOSAL_ONLY", edge_run["Output"]):
        pass_check("Edge CLI real-readiness gate remains proposal-only")
        add_gate_result("verify-edge-cli-real-readiness.py", "ProposalOnly", edge_run["ExitCode"], "PASS", "")
    else:
        add_failure("Edge CLI real-readiness proposal gate failed")
        add_gate_result("verify-edge-cli-real-readiness.py", "ProposalOnly", edge_run["ExitCode"], "FAIL", "")

    if args.ProbeServices or args.StartServices:
        step("ReadinessOnly service probes")
        if not args.ArtifactRoot.strip():
            real_services_evidence = os.path.join(tempfile.gettempdir(), f"agenthub-local-stack-real-services-{os.getpid()}.json")
        else:
            real_services_evidence = os.path.join(resolve_repo_path(args.ArtifactRoot, repo_root), "localhost-real-services.json")
        service_args = [
            "--RepoRoot", repo_root,
            "--EvidencePath", real_services_evidence,
            "--RealServices",
            "--WebUrl", args.WebUrl,
            "--HubUrl", args.HubUrl,
            "--DesktopBridgeUrl", args.DesktopBridgeUrl,
            "--LocalEdgeUrl", args.LocalEdgeUrl,
            "--WebHealthPath", args.WebHealthPath,
            "--HubHealthPath", args.HubHealthPath,
            "--DesktopHealthPath", args.DesktopHealthPath,
            "--EdgeHealthPath", args.EdgeHealthPath,
            "--ExpectedWebMarker", args.ExpectedWebMarker,
            "--ExpectedHubMarker", args.ExpectedHubMarker,
            "--ExpectedDesktopMarker", args.ExpectedDesktopMarker,
            "--ExpectedEdgeMarker", args.ExpectedEdgeMarker,
            "--RegisteredTargetUrl", args.RegisteredTargetUrl,
            "--HubDispatchTargetUrl", args.HubDispatchTargetUrl,
            "--WebUpstreamMode", args.WebUpstreamMode,
            "--DesktopUpstreamMode", args.DesktopUpstreamMode,
            "--TimeoutSec", str(args.TimeoutSec),
        ]
        if args.StartServices:
            service_args += ["--StartServices", "--StartServicePlanPath", args.StartServicePlanPath]
        services_run = invoke_repo_script("scripts\\smoke\\verify-localhost-real-services.py", service_args, repo_root)
        print(services_run["Output"], flush=True)
        add_gate_result("verify-localhost-real-services.py", "ReadinessOnly", services_run["ExitCode"], "PASS" if services_run["ExitCode"] == 0 else "FAIL", real_services_evidence)
        if services_run["ExitCode"] != 0:
            add_failure("localhost real-services readiness gate failed")
    else:
        add_failure("service probe not requested; pass -ProbeServices for already-running services or -StartServices with -StartServicePlanPath")
        add_gate_result("verify-localhost-real-services.py", "ReadinessOnly", 2, "NOT_RUN", "")

    if args.Mode == "ApprovedReal":
        step("ApprovedReal observed dispatch gate")
        if not args.ApproveRealEvidence:
            add_failure("ApprovedReal requires -ApproveRealEvidence")
        if not args.ObservedEvidencePath.strip():
            add_failure("ApprovedReal requires -ObservedEvidencePath")
        else:
            if not args.ArtifactRoot.strip():
                observed_report = os.path.join(tempfile.gettempdir(), f"agenthub-local-stack-observed-{os.getpid()}.json")
            else:
                observed_report = os.path.join(resolve_repo_path(args.ArtifactRoot, repo_root), "observed-localhost-dispatch-report.json")
            observed_args = [
                "--RepoRoot", repo_root,
                "--ObservedEvidencePath", args.ObservedEvidencePath,
                "--EvidencePath", observed_report,
                "--TimeoutSec", str(args.TimeoutSec),
            ]
            if args.ApproveRealEvidence:
                observed_args += ["--AllowRealTestedApproval"]
            observed_run = invoke_repo_script("scripts\\smoke\\verify-observed-localhost-dispatch.py", observed_args, repo_root)
            print(observed_run["Output"], flush=True)
            add_gate_result("verify-observed-localhost-dispatch.py", "ApprovedReal", observed_run["ExitCode"], "PASS" if observed_run["ExitCode"] == 0 else "FAIL", observed_report)
            if observed_run["ExitCode"] != 0:
                add_failure("observed localhost dispatch gate failed")
            elif os.path.isfile(observed_report):
                with open(observed_report, encoding="utf-8") as handle:
                    observed_json = json.load(handle)
                global real_tested
                if observed_json.get("real_tested") is True and args.ApproveRealEvidence:
                    real_tested = True
                    pass_check("ApprovedReal accepted observed dispatch RealTested evidence")
                else:
                    add_warning("observed dispatch passed but did not promote RealTested=true")

    if len(failures) == 0:
        if args.Mode == "ApprovedReal":
            status = "APPROVED_REAL_PASSED" if real_tested else "APPROVED_REAL_READINESS_ONLY_PASSED"
        else:
            status = "READINESS_ONLY_PASSED"
    else:
        status = "LOCAL_STACK_E2E_READINESS_FAILED"

    write_report(status, evidence_path, repo_root, args.ArtifactRoot, args.Mode, required_command_names, required_environment_names, supplied_environment_names, args)

    step("Boundary summary")
    print(f"  Mode={args.Mode}", flush=True)
    print(f"  RealTested={str(real_tested).lower()}", flush=True)
    print("  FixtureOnly proves only fixture product-loop ordering.", flush=True)
    print("  ReadinessOnly proves only local prerequisites and optional localhost health/topology probes.", flush=True)
    print("  ApprovedReal requires separate observed dispatch evidence and explicit approval.", flush=True)
    print("  No real TokenDanceID login or real CLI/model execution is performed by this runner.", flush=True)
    print(f"  EvidencePath: {evidence_path}", flush=True)

    print(f"Status: {status}", flush=True)
    return 0 if len(failures) == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
