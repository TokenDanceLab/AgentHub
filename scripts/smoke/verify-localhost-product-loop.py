#!/usr/bin/env python3
"""AgentHub localhost product-loop fixture harness（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

启动 localhost-only 的 Web / Hub / Desktop bridge / Local Edge fixture HTTP 服务，
证明链路：

Web -> Hub -> registered Desktop/Edge -> Local Edge -> fixture/SDK adapter -> Hub replay -> Web render

边界：
- 不涉及真实 TokenDanceID 或浏览器 secrets
- 无真实 CLI/model/runtime 花费
- 无公开部署、签名、release 上传或移动端路径
- RealTested=false

迁移差异（双跑对照记录）：原 ps1 内嵌 node fixture 并先检查 node 可执行文件
（缺失时 BLOCKED 退出码 2）；py 版本 fixture 用 stdlib http.server 实现，
不再依赖 node，--NodePath 仅保留以兼容 CLI 签名，node 缺失时的 BLOCKED 路径
不再存在。其余 CLI 参数、退出码（0=通过）与 stdout 行格式与原 ps1 一致。

用法：
  python scripts/smoke/verify-localhost-product-loop.py
  python scripts/smoke/verify-localhost-product-loop.py -FaultMode ForgedCallback -EvidencePath <path>
"""

import argparse
import json
import os
import shutil
import sys
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def add_ps_compat(parser, *names, **kwargs):
    """Register a parameter with both ps1-style (-Xxx) and python-style (--Xxx) names."""
    full_names = []
    for name in names:
        full_names.append(name)
        if name.startswith("--"):
            full_names.append("-" + name[2:])
    parser.add_argument(*full_names, **kwargs)

IDS = {
    "teamRunId": "teamrun-localhost-fixture-001",
    "hubTaskId": "task-localhost-fixture-001",
    "targetId": "target-localhost-desktop-edge-001",
    "edgeDeviceId": "desktop-edge-localhost-001",
    "edgeRunId": "edge-run-localhost-fixture-001",
    "adapterId": "fixture-sdk-adapter",
}

events = []
tasks = []
negative_checks = []
targets = {}
urls = {}
servers = []


class FixtureError(Exception):
    pass


def now_iso():
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def log(text):
    print(text, flush=True)


def record(event_type, actor, fields=None):
    event = {
        "id": f"evt-local-{len(events) + 1:03d}",
        "type": event_type,
        "actor": actor,
        "team_run_id": IDS["teamRunId"],
        "at": now_iso(),
    }
    if fields:
        event.update(fields)
    events.append(event)
    return event


def read_json_body(request):
    content_length = int(request.headers.get("Content-Length") or 0)
    raw = request.rfile.read(content_length).decode("utf-8")
    if not raw.strip():
        return {}
    return json.loads(raw)


def write_json(request, status_code, body):
    payload = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    request.send_response(status_code)
    request.send_header("Content-Type", "application/json")
    request.send_header("Content-Length", str(len(payload)))
    request.end_headers()
    request.wfile.write(payload)


def request_json(method, url, body=None):
    payload = None if body is None else json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method=method)
    if payload is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as response:
            text = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        text = error.read().decode("utf-8")
        raise FixtureError(f"{method} {url} failed {error.code}: {text}") from None
    if not text.strip():
        return {}
    return json.loads(text)


def expect_rejected_json(method, url, body, label):
    payload = None if body is None else json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method=method)
    if payload is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as response:
            text = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        text = error.read().decode("utf-8")
        parsed = {}
        if text.strip():
            parsed = json.loads(text)
        negative_checks.append({"label": label, "status": error.code, "error": parsed.get("error", text)})
        return parsed
    raise FixtureError(f"{label} was accepted unexpectedly: {text}")


def is_localhost_http_url(value):
    if not isinstance(value, str) or value.strip() == "":
        return False
    try:
        parsed = urllib.parse.urlsplit(value)
        return parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost", "::1")
    except ValueError:
        return False


def service_health(service, apply_fault=True):
    health = {
        "web": {"service": "web", "status": "ok", "identity": "agenthub-web-localhost-fixture", "upstream": "hub-only"},
        "hub": {"service": "hub", "status": "ok", "identity": "agenthub-hub-localhost-fixture", "upstream": "registered-desktop-target-router"},
        "desktop": {"service": "desktop", "status": "ok", "identity": "agenthub-desktop-bridge-localhost-fixture", "bridge": "tauri-sidecar-fixture"},
        "local-edge": {"service": "local-edge", "status": "ok", "identity": "agenthub-local-edge-localhost-fixture", "adapter": "fixture-sdk", "runner": "fixture-local-edge-runner"},
    }.get(service)
    if health is None:
        raise FixtureError(f"unknown service health fixture {service}")
    if apply_fault and FAULT_MODE == "MissingIdentityMarker" and service == "web":
        health = dict(health)
        health.pop("identity", None)
    return health


class FixtureHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _dispatch(self):
        try:
            self.server.handler_fn(self)
        except FixtureError as error:
            write_json(self, 500, {"error": str(error), "service": self.server.service_name})
        except BrokenPipeError:
            pass
        except Exception as error:  # noqa: BLE001 - fixture parity with node Promise.catch
            write_json(self, 500, {"error": str(error), "service": self.server.service_name})

    def do_GET(self):
        self._dispatch()

    def do_POST(self):
        self._dispatch()


def create_service(service, handler_fn):
    server = ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
    server.daemon_threads = True
    server.handler_fn = handler_fn
    server.service_name = service
    threading.Thread(target=server.serve_forever, daemon=True).start()
    servers.append(server)
    urls[service] = f"http://127.0.0.1:{server.server_address[1]}"
    return server


def start_hub():
    def handler(request):
        route = urllib.parse.urlsplit(request.path)

        if request.command == "GET" and route.path == "/health":
            write_json(request, 200, service_health("hub"))
            return

        if request.command == "POST" and route.path == "/api/targets/register":
            body = read_json_body(request)
            if body.get("targetId") != IDS["targetId"] or body.get("edgeDeviceId") != IDS["edgeDeviceId"]:
                write_json(request, 400, {"error": "unexpected target registration"})
                return
            if not is_localhost_http_url(body.get("desktopUrl")):
                write_json(request, 400, {"error": "desktopUrl must be a localhost http URL"})
                return
            targets[body["targetId"]] = body
            record("target.registered", "orchestrator", {
                "target_id": body["targetId"],
                "edge_device_id": body["edgeDeviceId"],
                "desktop_url": body["desktopUrl"],
                "registration_mode": "localhost-fixture-seed",
            })
            write_json(request, 200, {"status": "registered", "targetId": body["targetId"]})
            return

        if request.command == "POST" and route.path == "/api/teamruns":
            body = read_json_body(request)
            target = targets.get(body.get("targetId"))
            if not target:
                write_json(request, 404, {"error": "target is not registered"})
                return
            task = {
                "id": IDS["hubTaskId"],
                "team_run_id": IDS["teamRunId"],
                "status": "dispatching",
                "target_id": IDS["targetId"],
                "edge_device_id": IDS["edgeDeviceId"],
                "edge_run_id": "",
                "adapter_id": "",
                "expected_callback_type": "adapter.run.completed",
                "expected_edge_run_id": IDS["edgeRunId"],
                "expected_adapter_id": IDS["adapterId"],
            }
            tasks.append(task)
            record("hub.agent.dispatch", "hub", {
                "target_id": IDS["targetId"],
                "edge_device_id": IDS["edgeDeviceId"],
                "hub_task_id": IDS["hubTaskId"],
                "desktop_url": target["desktopUrl"],
            })
            request_json("POST", f"{target['desktopUrl']}/dispatch", {
                "teamRunId": IDS["teamRunId"],
                "hubTaskId": IDS["hubTaskId"],
                "targetId": IDS["targetId"],
                "edgeDeviceId": IDS["edgeDeviceId"],
                "hubCallbackUrl": f"{urls['hub']}/api/events",
            })
            write_json(request, 200, {"status": "dispatched", "hubTaskId": IDS["hubTaskId"]})
            return

        if request.command == "POST" and route.path == "/api/events":
            body = read_json_body(request)
            task = next((item for item in tasks if item["id"] == body.get("hubTaskId")), None)
            if not task:
                write_json(request, 400, {"error": "callback hubTaskId has no in-flight run"})
                return
            if task["status"] != "dispatching":
                write_json(request, 409, {"error": "callback order is invalid for task status"})
                return
            if body.get("type") != task["expected_callback_type"]:
                write_json(request, 400, {"error": "callback type does not match expected in-flight run"})
                return
            if body.get("edgeRunId") != task["expected_edge_run_id"]:
                write_json(request, 400, {"error": "callback edgeRunId does not match expected in-flight run"})
                return
            if body.get("adapterId") != task["expected_adapter_id"]:
                write_json(request, 400, {"error": "callback adapterId does not match expected in-flight run"})
                return
            task["status"] = "completed"
            task["edge_run_id"] = body["edgeRunId"]
            task["adapter_id"] = body["adapterId"]
            record("hub.replay.recorded", "hub", {
                "target_id": IDS["targetId"],
                "edge_device_id": IDS["edgeDeviceId"],
                "edge_run_id": body["edgeRunId"],
                "adapter_id": body["adapterId"],
                "callback_type": body["type"],
            })
            write_json(request, 200, {"status": "recorded"})
            return

        if request.command == "GET" and route.path == f"/api/replay/{IDS['teamRunId']}":
            write_json(request, 200, {
                "teamRunId": IDS["teamRunId"],
                "targetId": IDS["targetId"],
                "edgeDeviceId": IDS["edgeDeviceId"],
                "events": events,
                "tasks": tasks,
            })
            return

        write_json(request, 404, {"error": "not found", "service": "hub"})

    create_service("hub", handler)


def start_local_edge():
    def handler(request):
        route = urllib.parse.urlsplit(request.path)

        if request.command == "GET" and route.path == "/health":
            write_json(request, 200, service_health("local-edge"))
            return

        if request.command == "POST" and route.path == "/runs":
            body = read_json_body(request)
            record("edge.run.started", "local-edge", {
                "target_id": body.get("targetId"),
                "edge_device_id": body.get("edgeDeviceId"),
                "edge_run_id": IDS["edgeRunId"],
                "adapter_id": IDS["adapterId"],
            })

            if FAULT_MODE == "ForgedCallback":
                request_json("POST", body["hubCallbackUrl"], {
                    "type": "adapter.run.started",
                    "hubTaskId": body["hubTaskId"],
                    "edgeRunId": "forged-edge-run",
                    "adapterId": "forged-adapter",
                })

            expect_rejected_json("POST", body["hubCallbackUrl"], {
                "type": "adapter.run.completed",
                "hubTaskId": "forged-hub-task",
                "edgeRunId": IDS["edgeRunId"],
                "adapterId": IDS["adapterId"],
            }, "forged hubTaskId callback")
            expect_rejected_json("POST", body["hubCallbackUrl"], {
                "type": "adapter.run.started",
                "hubTaskId": body["hubTaskId"],
                "edgeRunId": IDS["edgeRunId"],
                "adapterId": IDS["adapterId"],
            }, "forged callback type")
            expect_rejected_json("POST", body["hubCallbackUrl"], {
                "type": "adapter.run.completed",
                "hubTaskId": body["hubTaskId"],
                "edgeRunId": "forged-edge-run",
                "adapterId": IDS["adapterId"],
            }, "forged edgeRunId callback")
            expect_rejected_json("POST", body["hubCallbackUrl"], {
                "type": "adapter.run.completed",
                "hubTaskId": body["hubTaskId"],
                "edgeRunId": IDS["edgeRunId"],
                "adapterId": "forged-adapter",
            }, "forged adapterId callback")

            record("adapter.run.completed", "fixture-sdk", {
                "target_id": body.get("targetId"),
                "edge_device_id": body.get("edgeDeviceId"),
                "edge_run_id": IDS["edgeRunId"],
                "adapter_id": IDS["adapterId"],
                "real_cli_or_model_invoked": False,
            })
            request_json("POST", body["hubCallbackUrl"], {
                "type": "adapter.run.completed",
                "hubTaskId": body["hubTaskId"],
                "edgeRunId": IDS["edgeRunId"],
                "adapterId": IDS["adapterId"],
            })
            write_json(request, 200, {
                "status": "completed",
                "edgeRunId": IDS["edgeRunId"],
                "adapterId": IDS["adapterId"],
            })
            return

        write_json(request, 404, {"error": "not found", "service": "local-edge"})

    create_service("local-edge", handler)


def start_desktop():
    def handler(request):
        route = urllib.parse.urlsplit(request.path)

        if request.command == "GET" and route.path == "/health":
            write_json(request, 200, service_health("desktop"))
            return

        if request.command == "POST" and route.path == "/dispatch":
            body = read_json_body(request)
            record("desktop.dispatch.accepted", "desktop", {
                "target_id": body.get("targetId"),
                "edge_device_id": body.get("edgeDeviceId"),
                "hub_task_id": body.get("hubTaskId"),
            })
            edge_result = request_json("POST", f"{urls['local-edge']}/runs", {
                "teamRunId": body["teamRunId"],
                "hubTaskId": body["hubTaskId"],
                "targetId": body["targetId"],
                "edgeDeviceId": body["edgeDeviceId"],
                "hubCallbackUrl": body["hubCallbackUrl"],
            })
            write_json(request, 200, {"status": "accepted", "edge": edge_result})
            return

        write_json(request, 404, {"error": "not found", "service": "desktop"})

    create_service("desktop", handler)


def start_web():
    def handler(request):
        route = urllib.parse.urlsplit(request.path)

        if request.command == "GET" and route.path == "/health":
            write_json(request, 200, service_health("web"))
            return

        if request.command == "POST" and route.path == "/start":
            record("web.teamrun.start", "web", {
                "target_id": IDS["targetId"],
                "source": "localhost-fixture-web",
            })
            result = request_json("POST", f"{urls['hub']}/api/teamruns", {
                "teamRunId": IDS["teamRunId"],
                "targetId": IDS["targetId"],
                "source": "web",
            })
            write_json(request, 200, {"status": "started", "hub": result})
            return

        if request.command == "GET" and route.path == f"/render/{IDS['teamRunId']}":
            replay = request_json("GET", f"{urls['hub']}/api/replay/{IDS['teamRunId']}")
            rendered_types = [event["type"] for event in replay["events"]]
            assert_condition("hub.replay.recorded" in rendered_types, "Web render requires Hub replay record")
            render_event = record("web.replay.rendered", "web", {
                "target_id": IDS["targetId"],
                "edge_device_id": IDS["edgeDeviceId"],
                "team_run_id": IDS["teamRunId"],
                "source": "hub-replay",
                "rendered_event_types": rendered_types,
            })
            write_json(request, 200, {
                "status": "rendered",
                "teamRunId": IDS["teamRunId"],
                "renderedEventId": render_event["id"],
                "renderedEventTypes": rendered_types,
            })
            return

        write_json(request, 404, {"error": "not found", "service": "web"})

    create_service("web", handler)


def assert_condition(condition, message):
    if not condition:
        raise FixtureError(message)


def event_index(event_type):
    for index, event in enumerate(events):
        if event["type"] == event_type:
            return index
    return -1


def validate_service_identity(service, health):
    expected = service_health(service, False)
    for key, value in expected.items():
        assert_condition(health.get(key) == value, f"{service} health identity marker mismatch for {key}")


def validate_replay(replay):
    required = [
        "target.registered",
        "web.teamrun.start",
        "hub.agent.dispatch",
        "desktop.dispatch.accepted",
        "edge.run.started",
        "adapter.run.completed",
        "hub.replay.recorded",
    ]
    last_index = -1
    for event_type in required:
        index = event_index(event_type)
        assert_condition(index > last_index, f"event {event_type} is not in product-loop order")
        last_index = index
    assert_condition(len(replay["tasks"]) == 1, "Hub replay should contain one task")
    assert_condition(replay["tasks"][0]["status"] == "completed", "Hub replay task should be completed")
    assert_condition(replay["tasks"][0]["target_id"] == IDS["targetId"], "Hub replay task target_id mismatch")
    assert_condition(replay["tasks"][0]["edge_device_id"] == IDS["edgeDeviceId"], "Hub replay task edge_device_id mismatch")
    assert_condition(replay["tasks"][0]["edge_run_id"] == IDS["edgeRunId"], "Hub replay task edge_run_id mismatch")
    assert_condition(replay["tasks"][0]["adapter_id"] == IDS["adapterId"], "Hub replay task adapter_id mismatch")


def validate_web_render(rendered):
    assert_condition(rendered["status"] == "rendered", "Web render status mismatch")
    assert_condition(rendered["teamRunId"] == IDS["teamRunId"], "Web render teamRunId mismatch")
    assert_condition("hub.replay.recorded" in rendered["renderedEventTypes"], "Web render did not consume Hub replay")
    assert_condition(event_index("web.replay.rendered") > event_index("hub.replay.recorded"), "Web render must happen after Hub replay")


def run_fixture(evidence_path, repo_root, fault_mode):
    global FAULT_MODE
    FAULT_MODE = fault_mode
    started_at = now_iso()

    log("AgentHub localhost product-loop harness")
    log("Sequence: Web -> Hub -> registered Desktop/Edge -> Local Edge -> fixture/SDK adapter -> Hub replay -> Web render")
    log("RealTested=false")

    start_hub()
    start_local_edge()
    start_desktop()
    start_web()

    services = [
        {"service": "web", "url": urls["web"], "status": "started"},
        {"service": "hub", "url": urls["hub"], "status": "started"},
        {"service": "desktop", "url": urls["desktop"], "status": "started"},
        {"service": "local-edge", "url": urls["local-edge"], "status": "started"},
    ]

    for service in services:
        health = request_json("GET", f"{service['url']}/health")
        validate_service_identity(service["service"], health)
        service["health"] = health

    log("PASS: localhost fixture services started with identity markers")

    registration = {
        "targetId": IDS["targetId"],
        "edgeDeviceId": IDS["edgeDeviceId"],
        "desktopUrl": urls["desktop"],
        "registrationMode": "localhost-fixture-seed",
    }
    if fault_mode == "WrongDesktopUrl":
        registration["desktopUrl"] = urls["local-edge"]
    elif fault_mode == "MissingDesktopUrl":
        del registration["desktopUrl"]
    elif fault_mode == "NonLocalhostDesktopUrl":
        registration["desktopUrl"] = "https://example.com/desktop"

    request_json("POST", f"{urls['hub']}/api/targets/register", registration)
    log("PASS: Hub has registered Desktop/Edge target")

    request_json("POST", f"{urls['web']}/start", {})
    replay = request_json("GET", f"{urls['hub']}/api/replay/{IDS['teamRunId']}")
    validate_replay(replay)
    rendered = request_json("GET", f"{urls['web']}/render/{IDS['teamRunId']}")
    validate_web_render(rendered)
    expect_rejected_json("POST", f"{urls['hub']}/api/events", {
        "type": "adapter.run.completed",
        "hubTaskId": IDS["hubTaskId"],
        "edgeRunId": IDS["edgeRunId"],
        "adapterId": IDS["adapterId"],
    }, "duplicate callback order")

    log("PASS: Web starts TeamRun through Hub-only boundary")
    log("PASS: Hub routes to the registered Desktop/Edge target")
    log("PASS: Desktop bridge dispatches only to Local Edge")
    log("PASS: Local Edge runs fixture/SDK adapter without CLI/model spend")
    log("PASS: Hub rejects forged and out-of-order callbacks before replay")
    log("PASS: Hub replay records completed localhost fixture chain")
    log("PASS: Web renders Hub replay into localhost fixture view")

    manifest = {
        "hubTaskId": IDS["hubTaskId"],
        "targetId": IDS["targetId"],
        "edgeDeviceId": IDS["edgeDeviceId"],
        "edgeRunId": IDS["edgeRunId"],
        "adapterId": IDS["adapterId"],
        "mode": "LocalhostFixture",
        "startedAt": started_at,
        "eventRefs": [f"{event['actor']}:{event['type']}:{event['id']}" for event in events],
        "chain": [
            {"stage": "target_registered", "label": "Hub has registered Desktop/Edge target", "eventRef": "orchestrator:target.registered:evt-local-001"},
            {"stage": "web_start", "label": "Web starts TeamRun through Hub-only boundary", "eventRef": "web:web.teamrun.start:evt-local-002"},
            {"stage": "hub_exact_route", "label": "Hub routes to the registered Desktop/Edge target", "eventRef": "hub:hub.agent.dispatch:evt-local-003"},
            {"stage": "desktop_bridge_start", "label": "Desktop bridge dispatches only to Local Edge", "eventRef": "desktop:desktop.dispatch.accepted:evt-local-004"},
            {"stage": "edge_events_callback", "label": "Local Edge starts fixture run", "eventRef": "local-edge:edge.run.started:evt-local-005"},
            {"stage": "adapter_callback_result", "label": "Local Edge runs fixture/SDK adapter without CLI/model spend", "eventRef": "fixture-sdk:adapter.run.completed:evt-local-006"},
            {"stage": "hub_replay", "label": "Hub replay records completed localhost fixture chain", "eventRef": "hub:hub.replay.recorded:evt-local-007"},
            {"stage": "web_render", "label": "Web renders Hub replay into localhost fixture view", "eventRef": "web:web.replay.rendered:evt-local-008"},
        ],
    }

    evidence = {
        "schema": "agenthub-localhost-product-loop-v1",
        "mode": "LocalhostFixture",
        "real_tested": False,
        "generated_at": now_iso(),
        "repo_root": repo_root,
        "sequence": "Web -> Hub -> registered Desktop/Edge -> Local Edge -> fixture/SDK adapter -> Hub replay -> Web render",
        "claims": {
            "real_tokendance_id_login": False,
            "real_cli_or_model_invoked": False,
            "public_deploy_used": False,
            "mobile_path_touched": False,
        },
        "services": services,
        "topology": {
            "web": {"allowed_upstreams": ["hub"]},
            "hub": {"routes_to": ["registered-desktop-edge-target"], "replay_owner": True},
            "desktop": {"allowed_upstreams": ["local-edge"], "bridge": "tauri-sidecar-fixture"},
            "local_edge": {"adapter": "fixture-sdk", "real_cli_or_model_invoked": False},
        },
        "remote_control_manifest": manifest,
        "negative_checks": negative_checks,
        "tasks": tasks,
        "events": events,
        "blockers": [
            "real TokenDanceID login remains blocked",
            "real CLI/model adapter invocation remains blocked",
            "public deploy remains blocked",
        ],
    }
    if fault_mode == "RealTestedOverclaim":
        evidence["real_tested"] = True

    os.makedirs(os.path.dirname(evidence_path), exist_ok=True)
    with open(evidence_path, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(evidence, indent=2, ensure_ascii=False))
    log(f"EvidencePath: {evidence_path}")


def main() -> int:
    parser = argparse.ArgumentParser(description="AgentHub localhost product-loop fixture harness（ps1 迁移）")
    add_ps_compat(parser, "--RepoRoot", default=".", help="repository root")
    add_ps_compat(parser, "--EvidencePath", default="", help="evidence JSON output path")
    add_ps_compat(parser, "--NodePath", default="node", help="kept for CLI compatibility; the Python fixture does not require node")
    add_ps_compat(parser, "--FaultMode", default="", choices=["", "WrongDesktopUrl", "MissingDesktopUrl", "NonLocalhostDesktopUrl", "ForgedCallback", "MissingIdentityMarker", "RealTestedOverclaim"], help="injected fixture fault")
    args = parser.parse_args()

    repo_root = os.path.abspath(args.RepoRoot)
    if not args.EvidencePath.strip():
        evidence_path = os.path.join(tempfile.gettempdir(), f"agenthub-localhost-product-loop-{os.getpid()}.json")
    else:
        evidence_path = args.EvidencePath

    temp_root = tempfile.mkdtemp(prefix="agenthub-localhost-product-loop-")

    print("\n=== Localhost product-loop fixture ===", flush=True)
    try:
        run_fixture(evidence_path, repo_root, args.FaultMode)
    except FixtureError as error:
        print(f"FAIL: {error}", file=sys.stderr, flush=True)
        shutil.rmtree(temp_root, ignore_errors=True)
        # Write-Host appends a terminator newline after the captured fixture output.
        print("", flush=True)
        print("localhost product-loop harness failed. RealTested=false", flush=True)
        return 1
    except Exception as error:  # noqa: BLE001 - parity with node main().catch
        print(f"FAIL: {error}", file=sys.stderr, flush=True)
        shutil.rmtree(temp_root, ignore_errors=True)
        print("", flush=True)
        print("localhost product-loop harness failed. RealTested=false", flush=True)
        return 1
    finally:
        for server in servers:
            server.shutdown()
            server.server_close()

    # Write-Host appends a terminator newline after the captured fixture output.
    print("", flush=True)

    if not os.path.isfile(evidence_path):
        print("localhost product-loop harness failed: evidence file was not written. RealTested=false", flush=True)
        return 1

    with open(evidence_path, encoding="utf-8") as handle:
        evidence = json.load(handle)
    if evidence.get("real_tested") is not False:
        print("localhost product-loop harness failed: evidence must keep RealTested=false.", flush=True)
        return 1

    print("\n=== Boundary summary ===", flush=True)
    print("  no real TokenDanceID login", flush=True)
    print("  no real CLI/model adapter invocation", flush=True)
    print("  no public deploy/signing/release upload", flush=True)
    print("  RealTested=false", flush=True)

    shutil.rmtree(temp_root, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
