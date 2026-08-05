#!/usr/bin/env python3
"""AgentHub observed localhost dispatch verifier（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

对 observed Hub/Desktop evidence artifact 或本地 endpoint export 的
fail-closed 校验门禁。不启动服务、不执行 TokenDanceID 登录、不调用真实
CLI/model adapter、不部署/签名/上传，不信任调用方提供的 URL topology
hint 作为 dispatch proof。

RealTested 保持 false，除非校验通过且未来 approval-gated manifest 被
显式 -AllowRealTestedApproval 接受。

迁移差异（双跑对照记录）：observed evidence URL 拉取的底层错误文案随
运行时环境变化（.NET 与 urllib 文案不同），对照时按错误文本归一化；
CLI 参数、退出码（0=通过 / 1=失败 / 2=参数非法）与 PASS/FAIL/WARN 行
前缀格式与原 ps1 一致。

用法：
  python scripts/smoke/verify-observed-localhost-dispatch.py
  python scripts/smoke/verify-observed-localhost-dispatch.py -ObservedEvidencePath <observed-dispatch.json>
"""

import argparse
import json
import os
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

failures = []
warnings = []
manifest = None
source = ""


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


def get_field(obj, name):
    if obj is None:
        return None
    return obj.get(name)


def require_text(obj, name, label):
    value = get_field(obj, name)
    text = "" if value is None else str(value)
    if not text.strip():
        add_failure(f"{label} missing {name}")
    return text


def get_event_by_ref(event_ref):
    if not event_ref:
        return None
    for event in manifest.get("events", []) or []:
        if str(event.get("id")) == event_ref:
            return event
    return None


def require_observed_event(event_ref, expected_type, label):
    event = get_event_by_ref(event_ref)
    if event is None:
        add_failure(f"{label} references missing event {event_ref}")
        return
    if str(event.get("type")) != expected_type:
        add_failure(f"{label} event type mismatch: expected {expected_type}")
        return
    if event.get("observed") is not True:
        add_failure(f"{label} event is not marked observed")
        return
    pass_check(f"{label} references observed {expected_type} event")


def get_event_index(event_type):
    for index, event in enumerate(manifest.get("events", []) or []):
        if str(event.get("type")) == event_type:
            return index
    return -1


def assert_same(left, right, message):
    if not str(left or "").strip() or not str(right or "").strip():
        return
    if left != right:
        add_failure(message)


def read_observed_manifest(observed_evidence_path, observed_evidence_url, timeout_sec):
    global source
    if observed_evidence_path and observed_evidence_url:
        add_failure("provide only one observed evidence source")
        return None

    if observed_evidence_path:
        if not os.path.isfile(observed_evidence_path):
            add_failure(f"observed evidence artifact missing: {observed_evidence_path}")
            return None
        source = os.path.abspath(observed_evidence_path)
        try:
            with open(observed_evidence_path, encoding="utf-8") as handle:
                return json.load(handle)
        except (OSError, ValueError) as error:
            add_failure(f"observed evidence artifact unreadable: {error}")
            return None

    if observed_evidence_url:
        if not test_loopback_http_url(observed_evidence_url):
            add_failure("observed evidence endpoint must be a loopback HTTP URL")
            return None
        source = observed_evidence_url
        try:
            with urllib.request.urlopen(observed_evidence_url, timeout=timeout_sec) as response:
                return json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, OSError, ValueError) as error:
            add_failure(f"observed evidence endpoint fetch failed: {error}")
            return None

    add_failure("observed evidence artifact or endpoint is required")
    return None


def write_report(status, evidence_path, repo_root):
    registration = get_field(manifest, "target_registration")
    dispatch = get_field(manifest, "dispatch")
    desktop_accept = get_field(manifest, "desktop_accept")
    edge_run = get_field(manifest, "edge_run")
    hub_replay = get_field(manifest, "hub_replay")
    web_render = get_field(manifest, "web_render")

    validation_passed = status == "OBSERVED_DISPATCH_PASSED" and len(failures) == 0
    real_tested = False
    if get_field(manifest, "real_tested") is True:
        if validation_passed and ALLOW_REAL_TESTED_APPROVAL and str(get_field(manifest, "approval_gate")) == "observed-localhost-dispatch-approved":
            real_tested = True
        elif not validation_passed:
            add_warning("input RealTested claim was downgraded because observed dispatch validation failed")
        else:
            add_warning("input RealTested claim was downgraded because explicit approval gate is absent")

    replay_refs = []
    for value in [
        get_field(hub_replay, "event_ref"),
        get_field(hub_replay, "replay_ref"),
        get_field(web_render, "replay_ref"),
    ]:
        if value is not None and str(value).strip() and value not in replay_refs:
            replay_refs.append(value)

    report = {
        "schema": "agenthub-observed-localhost-dispatch-report-v1",
        "status": status,
        "real_tested": real_tested,
        "generated_at": now_iso(),
        "repo_root": repo_root,
        "source": source,
        "no_real_tokendance_id_login": True,
        "no_real_cli_or_model_spend_by_verifier": True,
        "no_public_deploy_signing_or_release": True,
        "observed": {
            "target_id": get_field(registration, "target_id"),
            "edge_device_id": get_field(registration, "edge_device_id"),
            "hub_task_id": get_field(dispatch, "hub_task_id"),
            "dispatch_target_url": get_field(dispatch, "dispatch_target_url"),
            "desktop_bridge_url": get_field(registration, "desktop_bridge_url"),
            "local_edge_url": get_field(desktop_accept, "local_edge_url"),
            "edge_run_id": get_field(edge_run, "edge_run_id"),
            "adapter_id": get_field(edge_run, "adapter_id"),
            "web_render_event_ref": get_field(web_render, "event_ref"),
            "web_render_source": get_field(web_render, "render_source"),
            "replay_refs": replay_refs,
        },
        "readiness_only_sources_rejected": True,
        "failures": failures,
        "warnings": warnings,
        "blockers": [
            "caller-supplied URL topology is not accepted as dispatch proof",
            "real TokenDanceID login is intentionally not performed",
            "real CLI/model adapter invocation is not performed by this verifier",
            "public deploy/signing/release upload is intentionally not performed",
        ],
    }

    directory = os.path.dirname(evidence_path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(evidence_path, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(report, ensure_ascii=False, separators=(",", ":")))


def main() -> int:
    parser = argparse.ArgumentParser(description="AgentHub observed localhost dispatch verifier（ps1 迁移）")
    add_ps_compat(parser, "--RepoRoot", default=".", help="repository root")
    add_ps_compat(parser, "--ObservedEvidencePath", default="", help="observed dispatch evidence artifact path")
    add_ps_compat(parser, "--ObservedEvidenceUrl", default="", help="observed dispatch evidence loopback endpoint URL")
    add_ps_compat(parser, "--EvidencePath", default="", help="verifier report JSON output path")
    add_ps_compat(parser, "--TimeoutSec", type=int, default=8, help="endpoint fetch timeout in seconds")
    add_ps_compat(parser, "--AllowRealTestedApproval", action="store_true", help="accept approval-gated observed dispatch RealTested evidence")
    args = parser.parse_args()

    if args.TimeoutSec <= 0:
        print("FAIL: -TimeoutSec must be greater than zero.", flush=True)
        return 2

    global ALLOW_REAL_TESTED_APPROVAL
    ALLOW_REAL_TESTED_APPROVAL = args.AllowRealTestedApproval

    repo_root = os.path.abspath(args.RepoRoot)
    if not args.EvidencePath.strip():
        evidence_path = os.path.join(tempfile.gettempdir(), f"agenthub-observed-localhost-dispatch-{os.getpid()}.json")
    else:
        evidence_path = args.EvidencePath

    print("AgentHub observed localhost dispatch verifier", flush=True)
    print("No TokenDanceID login, real CLI/model spend, deploy, signing, or release upload will be performed.", flush=True)

    global manifest
    step("Load observed evidence")
    manifest = read_observed_manifest(args.ObservedEvidencePath, args.ObservedEvidenceUrl, args.TimeoutSec)
    if manifest is None:
        write_report("OBSERVED_DISPATCH_FAILED", evidence_path, repo_root)
        print("Status: OBSERVED_DISPATCH_FAILED", flush=True)
        print("RealTested=false", flush=True)
        return 1
    pass_check("observed evidence source loaded")

    step("Reject readiness-only proof")
    schema = str(get_field(manifest, "schema") or "")
    origin = str(get_field(manifest, "evidence_origin") or "")
    if schema != "agenthub-observed-localhost-dispatch-v1":
        add_failure("caller-only URL proof is not accepted")
    if origin in ("caller_params", "readiness_only", "self_supplied"):
        add_failure("caller-only URL proof is not accepted")
    if origin not in ("observed_hub_manifest", "observed_desktop_path"):
        add_failure("observed evidence origin must be observed_hub_manifest or observed_desktop_path")

    step("Required observed chain")
    registration = get_field(manifest, "target_registration")
    dispatch = get_field(manifest, "dispatch")
    desktop_accept = get_field(manifest, "desktop_accept")
    edge_run = get_field(manifest, "edge_run")
    hub_replay = get_field(manifest, "hub_replay")
    web_render = get_field(manifest, "web_render")

    if registration is None:
        add_failure("missing observed target registration")
    if dispatch is None:
        add_failure("missing observed dispatch event")
    if desktop_accept is None:
        add_failure("missing observed Desktop bridge accept event")
    if edge_run is None:
        add_failure("missing observed Edge run id")
    if hub_replay is None:
        add_failure("missing observed Hub replay refs")
    if web_render is None:
        add_failure("missing observed Web render proof")

    target_id = require_text(registration, "target_id", "target registration")
    edge_device_id = require_text(registration, "edge_device_id", "target registration")
    target_kind = require_text(registration, "target_kind", "target registration")
    registered_desktop_url = require_text(registration, "desktop_bridge_url", "target registration")
    hub_task_id = require_text(dispatch, "hub_task_id", "dispatch")
    dispatch_target_url = require_text(dispatch, "dispatch_target_url", "dispatch")
    desktop_accept_url = require_text(desktop_accept, "desktop_bridge_url", "Desktop accept")
    local_edge_url = require_text(desktop_accept, "local_edge_url", "Desktop accept")
    edge_run_id = require_text(edge_run, "edge_run_id", "Edge run")
    adapter_id = require_text(edge_run, "adapter_id", "Edge run")
    replay_ref = require_text(hub_replay, "replay_ref", "Hub replay")
    replay_event_ref = require_text(hub_replay, "event_ref", "Hub replay")
    web_render_event_ref = require_text(web_render, "event_ref", "Web render")
    web_render_replay_ref = require_text(web_render, "replay_ref", "Web render")
    web_render_source = require_text(web_render, "render_source", "Web render")

    for url_pair in [
        ("target registration desktop_bridge_url", registered_desktop_url),
        ("dispatch dispatch_target_url", dispatch_target_url),
        ("Desktop accept desktop_bridge_url", desktop_accept_url),
        ("Desktop accept local_edge_url", local_edge_url),
    ]:
        if url_pair[1]:
            if test_loopback_http_url(url_pair[1]):
                pass_check(f"{url_pair[0]} is loopback HTTP")
            else:
                add_failure(f"{url_pair[0]} must be loopback HTTP")

    assert_same(get_field(dispatch, "target_id"), target_id, "dispatch target_id does not match registration")
    assert_same(get_field(desktop_accept, "target_id"), target_id, "Desktop accept target_id does not match registration")
    assert_same(get_field(edge_run, "target_id"), target_id, "Edge run target_id does not match registration")
    assert_same(get_field(hub_replay, "target_id"), target_id, "Hub replay target_id does not match registration")
    assert_same(get_field(dispatch, "edge_device_id"), edge_device_id, "dispatch edge_device_id does not match registration")
    assert_same(get_field(desktop_accept, "edge_device_id"), edge_device_id, "Desktop accept edge_device_id does not match registration")
    assert_same(get_field(edge_run, "edge_device_id"), edge_device_id, "Edge run edge_device_id does not match registration")
    assert_same(get_field(hub_replay, "edge_device_id"), edge_device_id, "Hub replay edge_device_id does not match registration")
    assert_same(get_field(desktop_accept, "hub_task_id"), hub_task_id, "Desktop accept hub_task_id does not match dispatch")
    assert_same(get_field(edge_run, "hub_task_id"), hub_task_id, "Edge run hub_task_id does not match dispatch")
    assert_same(get_field(hub_replay, "hub_task_id"), hub_task_id, "Hub replay hub_task_id does not match dispatch")
    assert_same(get_field(web_render, "hub_task_id"), hub_task_id, "Web render hub_task_id does not match dispatch")
    assert_same(get_field(web_render, "team_run_id"), get_field(hub_replay, "team_run_id"), "Web render team_run_id does not match Hub replay")
    assert_same(get_field(hub_replay, "edge_run_id"), edge_run_id, "forged Hub replay reference")
    assert_same(get_field(web_render, "edge_run_id"), edge_run_id, "Web render edge_run_id does not match Edge run")
    assert_same(get_field(hub_replay, "adapter_id"), adapter_id, "Hub replay adapter_id does not match Edge run")
    assert_same(get_field(web_render, "adapter_id"), adapter_id, "Web render adapter_id does not match Edge run")

    registered_origin = get_origin(registered_desktop_url)
    dispatch_origin = get_origin(dispatch_target_url)
    desktop_accept_origin = get_origin(desktop_accept_url)
    local_edge_origin = get_origin(local_edge_url)

    if target_kind not in ("desktop_bridge", "registered_desktop_bridge"):
        add_failure("direct Hub-to-LocalEdge target is not accepted")
    if dispatch_origin and dispatch_origin == local_edge_origin:
        add_failure("direct Hub-to-LocalEdge target is not accepted")
    if dispatch_origin and registered_origin and dispatch_origin != registered_origin:
        add_failure("observed Hub dispatch target does not match registered Desktop bridge")
    if desktop_accept_origin and registered_origin and desktop_accept_origin != registered_origin:
        add_failure("observed Desktop accept URL does not match registered Desktop bridge")

    require_observed_event(get_field(registration, "event_ref"), "target.registered", "target registration")
    require_observed_event(get_field(dispatch, "event_ref"), "hub.agent.dispatch", "dispatch")
    require_observed_event(get_field(desktop_accept, "event_ref"), "desktop.dispatch.accepted", "Desktop accept")
    require_observed_event(get_field(edge_run, "event_ref"), "edge.run.started", "Edge run")
    require_observed_event(replay_event_ref, "hub.replay.recorded", "Hub replay")
    require_observed_event(web_render_event_ref, "web.replay.rendered", "Web render")

    if replay_ref != replay_event_ref:
        add_failure("forged Hub replay reference")
    if get_event_by_ref(replay_ref) is None:
        add_failure("forged Hub replay reference")
    if web_render_replay_ref != replay_ref:
        add_failure("Web render replay_ref does not match Hub replay")
    if web_render_source != "hub-replay":
        add_failure("Web render source must be hub-replay")
    if get_field(web_render, "observed") is not True:
        add_failure("Web render proof is not marked observed")

    required_types = [
        "target.registered",
        "hub.agent.dispatch",
        "desktop.dispatch.accepted",
        "edge.run.started",
        "hub.replay.recorded",
        "web.replay.rendered",
    ]
    last_index = -1
    for event_type in required_types:
        index = get_event_index(event_type)
        if index < 0:
            if event_type == "hub.agent.dispatch":
                add_failure("missing observed dispatch event")
            else:
                add_failure(f"missing observed event: {event_type}")
            continue
        if index <= last_index:
            add_failure(f"observed event order is invalid at {event_type}")
        last_index = index

    status = "OBSERVED_DISPATCH_PASSED" if len(failures) == 0 else "OBSERVED_DISPATCH_FAILED"
    write_report(status, evidence_path, repo_root)

    step("Boundary summary")
    print("  caller URL hints are not accepted as dispatch proof", flush=True)
    print("  no real TokenDanceID login", flush=True)
    print("  no real CLI/model adapter invocation by this verifier", flush=True)
    print("  no public deploy/signing/release upload", flush=True)
    print(f"  EvidencePath: {evidence_path}", flush=True)

    if len(failures) == 0:
        print("Status: OBSERVED_DISPATCH_PASSED", flush=True)
        with open(evidence_path, encoding="utf-8") as handle:
            if json.load(handle).get("real_tested") is True:
                print("RealTested=true", flush=True)
            else:
                print("RealTested=false", flush=True)
        return 0

    print("Status: OBSERVED_DISPATCH_FAILED", flush=True)
    print("RealTested=false", flush=True)
    return 1


if __name__ == "__main__":
    sys.exit(main())
