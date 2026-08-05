#!/usr/bin/env python3
"""AgentHub P1 localhost real-services smoke verifier（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

对已运行或显式启动的 localhost 服务做显式 opt-in 就绪探测。不执行
TokenDanceID 登录、不观测实时 Hub 注册/派发、不运行真实 CLI/model
adapter、不部署/签名/上传、不调用公开端点。

RealTested 恒为 false。健康标记与调用方提供的 topology 提示只能证明就绪；
实时 Hub 派发证明需要独立的 observed Hub/Desktop evidence 来源。

迁移差异（双跑对照记录）：失败探测行的底层错误文案随运行时环境变化
（.NET "Unable to connect..." 与 urllib WinError 文案不同，且服务若
在探测窗口内变化会漂移），对照时按错误文本归一化；CLI 参数、退出码
（0=通过 / 1=失败 / 2=opt-in 缺失或参数非法）与 PASS/FAIL/WARN 行
前缀格式与原 ps1 一致。

用法：
  python scripts/smoke/verify-localhost-real-services.py
  python scripts/smoke/verify-localhost-real-services.py -RealServices -ExpectedWebMarker "AgentHub"
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

failures = []
warnings = []
started_processes = []
started_by_harness = False
started_at = ""


def add_ps_compat(parser, *names, **kwargs):
    """Register a parameter with both ps1-style (-Xxx) and python-style (--Xxx) names."""
    full_names = []
    for name in names:
        full_names.append(name)
        if name.startswith("--"):
            full_names.append("-" + name[2:])
    parser.add_argument(*full_names, **kwargs)


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


def test_loopback_http_url(url):
    try:
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != "http":
            return False
        host = (parsed.hostname or "").lower()
        return host in ("127.0.0.1", "localhost", "::1")
    except ValueError:
        return False


def join_url_path(base_url, path):
    if not path:
        return base_url
    if path.startswith("/"):
        return base_url.rstrip("/") + path
    return base_url.rstrip("/") + "/" + path


def write_evidence(services, status, evidence_path, repo_root, args):
    evidence = {
        "schema": "agenthub-localhost-real-services-v1",
        "mode": "ReadinessOnly" if args.RealServices else "RealServicesOptInRequired",
        "status": status,
        "real_tested": False,
        "generated_at": now_iso(),
        "repo_root": repo_root,
        "started_by_harness": started_by_harness,
        "no_real_tokendance_id_login": True,
        "no_real_cli_or_model_spend": None if args.StartServices else True,
        "cli_or_model_spend_claim": "operator_attested_start_plan_not_verified_by_harness" if args.StartServices else "not_started_by_harness",
        "no_public_deploy_signing_or_release": True,
        "services": services,
        "readiness_only": True,
        "real_dispatch_proof_required": True,
        "topology": {
            "web": {"url": args.WebUrl, "upstream_mode": args.WebUpstreamMode, "allowed_upstream": "hub"},
            "hub": {"url": args.HubUrl, "registered_target_url": args.RegisteredTargetUrl, "dispatch_target_url": args.HubDispatchTargetUrl, "must_route_to_registered_desktop_bridge": True},
            "desktop_bridge": {"url": args.DesktopBridgeUrl, "upstream_mode": args.DesktopUpstreamMode, "allowed_upstream": "local-edge"},
            "local_edge": {"url": args.LocalEdgeUrl, "real_cli_or_model_invoked": False},
        },
        "failures": failures,
        "warnings": warnings,
        "blockers": [
            "real TokenDanceID login is intentionally not performed",
            "live Hub registration/dispatch proof is not observed by this readiness-only verifier",
            "real CLI/model adapter invocation is not performed by this verifier",
            "public deploy/signing/release upload is intentionally not performed",
        ],
    }
    if args.StartServices:
        evidence["blockers"].append("CLI/model spend cannot be asserted by this verifier when StartServices runs operator-supplied commands")

    directory = os.path.dirname(evidence_path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(evidence_path, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(evidence, ensure_ascii=False, separators=(",", ":")))


def invoke_service_probe(name, base_url, health_path, expected_marker, timeout_sec):
    health_url = join_url_path(base_url, health_path)
    deadline = time.monotonic() + timeout_sec
    last_error = ""

    while True:
        try:
            with urllib.request.urlopen(health_url, timeout=2) as response:
                body = response.read().decode("utf-8", errors="replace")
                marker_matched = re.search(expected_marker, body, re.IGNORECASE) is not None
                result = {
                    "service": name,
                    "url": base_url,
                    "health_url": health_url,
                    "status_code": response.status,
                    "status": "healthy" if marker_matched else "wrong_marker",
                    "expected_marker": expected_marker,
                    "marker_matched": marker_matched,
                    "body_excerpt": body[:240],
                }
                if marker_matched:
                    pass_check(f"{name} service responded with expected identity marker")
                else:
                    add_failure(f"{name} identity marker mismatch")
                return result
        except (urllib.error.URLError, OSError, ValueError) as error:
            last_error = str(error)
            if time.monotonic() >= deadline:
                break
            time.sleep(0.25)

    add_failure(f"missing service: {name} at {health_url} ({last_error})")
    return {
        "service": name,
        "url": base_url,
        "health_url": health_url,
        "status_code": None,
        "status": "missing",
        "expected_marker": expected_marker,
        "marker_matched": False,
        "error": last_error,
    }


def assert_expected_marker_supplied(name, expected_marker):
    if not expected_marker or not expected_marker.strip():
        add_failure(f"expected identity marker missing: {name}")
        return
    pass_check(f"{name} expected identity marker is explicit")


def start_services_from_plan(plan_path, repo_root):
    if not plan_path or not plan_path.strip():
        add_failure("StartServices requires -StartServicePlanPath; no hardcoded dev-start command is run implicitly")
        return
    if not os.path.isfile(plan_path):
        add_failure(f"start service plan is missing: {plan_path}")
        return

    with open(plan_path, encoding="utf-8") as handle:
        plan = json.load(handle)

    for entry in plan.get("services", []):
        file_name = str(entry.get("fileName") or "")
        if not file_name:
            add_failure("start service plan entry is missing fileName")
            continue

        working_directory = str(entry.get("workingDirectory") or "")
        if not working_directory:
            working_directory = repo_root
        if not os.path.isabs(working_directory):
            working_directory = os.path.join(repo_root, working_directory)

        arguments = list(entry.get("arguments") or [])
        name = str(entry.get("name") or file_name)
        try:
            process = subprocess.Popen(arguments, executable=file_name, cwd=working_directory, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except OSError as error:
            add_failure(f"failed to start {name}: {error}")
            continue
        started_processes.append(process)
        global started_by_harness
        started_by_harness = True
        pass_check(f"started {name} process from explicit start plan")


def main() -> int:
    parser = argparse.ArgumentParser(description="AgentHub localhost real-services smoke verifier（ps1 迁移）")
    add_ps_compat(parser, "--RepoRoot", default=".", help="repository root")
    add_ps_compat(parser, "--EvidencePath", default="", help="evidence JSON output path")
    add_ps_compat(parser, "--RealServices", action="store_true", help="opt in to probe local services")
    add_ps_compat(parser, "--StartServices", action="store_true", help="start services from the explicit start plan")
    add_ps_compat(parser, "--StartServicePlanPath", default="", help="explicit start plan JSON path")
    add_ps_compat(parser, "--TimeoutSec", type=int, default=12, help="probe deadline in seconds")
    add_ps_compat(parser, "--WebUrl", default="http://127.0.0.1:5174", help="web base URL")
    add_ps_compat(parser, "--HubUrl", default="http://127.0.0.1:8080", help="hub base URL")
    add_ps_compat(parser, "--DesktopBridgeUrl", default="http://127.0.0.1:5173", help="desktop bridge base URL")
    add_ps_compat(parser, "--LocalEdgeUrl", default="http://127.0.0.1:3210", help="local edge base URL")
    add_ps_compat(parser, "--WebHealthPath", default="/", help="web health path")
    add_ps_compat(parser, "--HubHealthPath", default="/health/live", help="hub health path")
    add_ps_compat(parser, "--DesktopHealthPath", default="/", help="desktop health path")
    add_ps_compat(parser, "--EdgeHealthPath", default="/v1/health", help="local edge health path")
    add_ps_compat(parser, "--ExpectedWebMarker", default="", help="expected web identity marker")
    add_ps_compat(parser, "--ExpectedHubMarker", default="", help="expected hub identity marker")
    add_ps_compat(parser, "--ExpectedDesktopMarker", default="", help="expected desktop bridge identity marker")
    add_ps_compat(parser, "--ExpectedEdgeMarker", default="", help="expected local edge identity marker")
    add_ps_compat(parser, "--RegisteredTargetUrl", default="", help="registered target URL evidence")
    add_ps_compat(parser, "--HubDispatchTargetUrl", default="", help="hub dispatch target URL evidence")
    add_ps_compat(parser, "--WebUpstreamMode", default="hub", choices=["hub", "local-edge", "unknown"], help="web upstream mode")
    add_ps_compat(parser, "--DesktopUpstreamMode", default="local-edge", choices=["local-edge", "hub", "unknown"], help="desktop bridge upstream mode")
    args = parser.parse_args()

    if args.TimeoutSec <= 0:
        print("FAIL: -TimeoutSec must be greater than zero.", flush=True)
        return 2

    repo_root = os.path.abspath(args.RepoRoot)
    if not args.EvidencePath.strip():
        evidence_path = os.path.join(tempfile.gettempdir(), f"agenthub-localhost-real-services-{os.getpid()}.json")
    else:
        evidence_path = args.EvidencePath

    global started_at
    started_at = now_iso()

    print("AgentHub localhost real-services smoke verifier", flush=True)
    print("No TokenDanceID login, live Hub dispatch proof, deploy, signing, or release upload will be performed.", flush=True)
    print("CLI/model spend is not asserted if -StartServices runs operator-supplied commands.", flush=True)

    if not args.RealServices:
        add_warning("Real services opt-in required: rerun with -RealServices to probe local services.")
        write_evidence([], "BLOCKED_OPT_IN_REQUIRED", evidence_path, repo_root, args)
        print("Status: BLOCKED_OPT_IN_REQUIRED", flush=True)
        print("RealTested=false", flush=True)
        return 2

    try:
        if args.StartServices:
            step("Explicit service start plan")
            start_services_from_plan(args.StartServicePlanPath, repo_root)

        step("Localhost service probes")
        assert_expected_marker_supplied("web", args.ExpectedWebMarker)
        assert_expected_marker_supplied("hub", args.ExpectedHubMarker)
        assert_expected_marker_supplied("desktop-bridge", args.ExpectedDesktopMarker)
        assert_expected_marker_supplied("local-edge", args.ExpectedEdgeMarker)

        services = [
            invoke_service_probe("web", args.WebUrl, args.WebHealthPath, args.ExpectedWebMarker, args.TimeoutSec),
            invoke_service_probe("hub", args.HubUrl, args.HubHealthPath, args.ExpectedHubMarker, args.TimeoutSec),
            invoke_service_probe("desktop-bridge", args.DesktopBridgeUrl, args.DesktopHealthPath, args.ExpectedDesktopMarker, args.TimeoutSec),
            invoke_service_probe("local-edge", args.LocalEdgeUrl, args.EdgeHealthPath, args.ExpectedEdgeMarker, args.TimeoutSec),
        ]

        step("Registered target topology")
        for pair in [
            ("WebUrl", args.WebUrl),
            ("HubUrl", args.HubUrl),
            ("DesktopBridgeUrl", args.DesktopBridgeUrl),
            ("LocalEdgeUrl", args.LocalEdgeUrl),
        ]:
            if test_loopback_http_url(pair[1]):
                pass_check(f"{pair[0]} is loopback HTTP")
            else:
                add_failure(f"{pair[0]} must be a loopback HTTP URL")

        if not args.RegisteredTargetUrl.strip():
            add_failure("registered target URL evidence missing")
        elif not test_loopback_http_url(args.RegisteredTargetUrl):
            add_failure("registered target URL must be a loopback HTTP URL")

        if not args.HubDispatchTargetUrl.strip():
            add_failure("Hub dispatch target URL evidence missing")
        elif not test_loopback_http_url(args.HubDispatchTargetUrl):
            add_failure("Hub dispatch target URL must be a loopback HTTP URL")

        registered_origin = get_origin(args.RegisteredTargetUrl)
        hub_dispatch_origin = get_origin(args.HubDispatchTargetUrl)
        desktop_origin = get_origin(args.DesktopBridgeUrl)
        edge_origin = get_origin(args.LocalEdgeUrl)

        if registered_origin and desktop_origin:
            if registered_origin == desktop_origin:
                pass_check("registered target URL matches Desktop bridge URL")
            else:
                add_failure("registered target URL mismatch: registered target must match Desktop bridge URL")

        if hub_dispatch_origin and registered_origin:
            if hub_dispatch_origin == registered_origin:
                pass_check("Hub dispatch target URL matches registered target URL")
            else:
                add_failure("target URL mismatch: Hub dispatch target URL does not match registered target URL")

        if registered_origin and registered_origin == edge_origin:
            add_failure("registered target URL points directly to Local Edge instead of Desktop bridge")
        if hub_dispatch_origin and hub_dispatch_origin == edge_origin:
            add_failure("Hub dispatch target URL points directly to Local Edge instead of registered Desktop bridge")

        if args.WebUpstreamMode == "hub":
            pass_check("Web upstream mode is Hub")
        else:
            add_failure(f"Web upstream mode must be Hub, not {args.WebUpstreamMode}")

        if args.DesktopUpstreamMode == "local-edge":
            pass_check("Desktop bridge upstream mode is Local Edge")
        else:
            add_failure(f"Desktop bridge upstream mode must be Local Edge, not {args.DesktopUpstreamMode}")

        readiness_passed = len(failures) == 0
        status = "READINESS_ONLY_PASSED" if readiness_passed else "READINESS_ONLY_FAILED"
        write_evidence(services, status, evidence_path, repo_root, args)

        step("Boundary summary")
        print("  ReadinessOnly=true", flush=True)
        print("  RealTested=false", flush=True)
        print("  no real TokenDanceID login", flush=True)
        if args.StartServices:
            print("  CLI/model spend not asserted; StartServices used operator-supplied commands", flush=True)
        else:
            print("  no real CLI/model adapter invocation by this verifier", flush=True)
        print("  live Hub registration/dispatch proof requires separate observed evidence", flush=True)
        print("  no public deploy/signing/release upload", flush=True)
        print(f"  EvidencePath: {evidence_path}", flush=True)

        if readiness_passed:
            print("Status: READINESS_ONLY_PASSED", flush=True)
            return 0

        print("Status: READINESS_ONLY_FAILED", flush=True)
        print("RealTested=false", flush=True)
        return 1
    finally:
        for process in started_processes:
            if process.poll() is None:
                process.kill()


if __name__ == "__main__":
    sys.exit(main())
