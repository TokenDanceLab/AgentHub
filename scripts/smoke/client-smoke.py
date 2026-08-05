#!/usr/bin/env python3
"""client-smoke — AgentHub client local smoke test.

ps1 迁移（契约见 server docs/design/ps1-to-python-migration.md）：stdlib only、
CLI 参数/退出码兼容（0=通过/1=失败）、机器可读行（`  PASS  `/`  FAIL  ` 与
`=== ... ===` step）与原 ps1 一致。

串联 Edge 与 Desktop-facing API 端到端验证。先运行 `scripts/dev/setup.ps1`，
再运行本脚本。默认用 mock runner（powershell 输出 "Initializing mock runner"），
不调真实 CLI/model。
"""

import argparse
import json
import os
import re
import shutil
import socket
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import base64

passed = 0
failed = 0
edge_proc = None
started_edge = False
current_run_id = ""


def normalize_stdout_lf() -> None:
    """Disable newline translation so redirected output is byte-identical to pwsh."""
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace", newline="", line_buffering=True)
        sys.stderr.reconfigure(encoding="utf-8", errors="replace", newline="", line_buffering=True)
    except (AttributeError, ValueError):
        pass


def emit(text: str) -> None:
    sys.stdout.write(text + "\r\n")
    sys.stdout.flush()


def write_step(text: str) -> None:
    emit(f"\n=== {text} ===")


def pass_check(text: str) -> None:
    global passed
    passed += 1
    emit(f"  PASS  {text}")


def fail_check(text: str) -> None:
    global failed
    failed += 1
    emit(f"  FAIL  {text}")


def assert_true(condition: bool, label: str) -> None:
    if condition:
        pass_check(label)
    else:
        fail_check(label)


def unwrap_edge_data(response):
    if isinstance(response, dict) and "data" in response:
        return response["data"]
    return response


def invoke_edge_rest(url: str, method: str = "GET", body=None, timeout_sec: int = 5, headers: dict | None = None):
    request_headers = {}
    if headers:
        request_headers.update(headers)
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=request_headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout_sec) as response:
            raw = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        try:
            raw = exc.read().decode("utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            raw = ""
        if raw.strip():
            try:
                # 对齐 ps1 Invoke-RestMethod 异常消息：CRLF + 2-space 缩进 JSON body
                raw = "\r\n" + json.dumps(json.loads(raw), ensure_ascii=False, indent=2).replace("\n", "\r\n")
            except json.JSONDecodeError:
                pass
        raise RuntimeError(raw if raw.strip() else f"HTTP {exc.code}") from exc
    if not raw.strip():
        return None
    return unwrap_edge_data(json.loads(raw))


def test_edge_health(edge_url: str, edge_headers: dict, timeout_sec: int = 2) -> bool:
    try:
        health = invoke_edge_rest(f"{edge_url}/v1/health", timeout_sec=timeout_sec, headers=edge_headers)
        return isinstance(health, dict) and health.get("status") == "ok" and health.get("version") == "v1"
    except Exception:  # noqa: BLE001 —— 对齐 ps1 catch 语义
        return False


def get_smoke_runner_command() -> str:
    powershell = shutil.which("powershell")
    if powershell:
        return powershell
    return shutil.which("pwsh")


def run_native(args: list, cwd: str | None = None) -> subprocess.CompletedProcess:
    """Run a native command, resolving .cmd/.bat shims via cmd.exe on Windows.

    Mirrors pwsh native command resolution; subprocess cannot CreateProcess a
    .cmd file directly.
    """
    executable = shutil.which(args[0]) if args else None
    if executable and re.search(r"\.(cmd|bat)$", executable, re.IGNORECASE):
        return subprocess.run(["cmd", "/c", executable, *args[1:]], cwd=cwd, capture_output=True, text=True)
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True)


# ── Minimal RFC6455 WebSocket client (stdlib only) ──────────────


class WebSocketClient:
    def __init__(self, uri: str, headers: dict, timeout_ms: int) -> None:
        parsed = urllib.parse.urlsplit(uri)
        self.host = parsed.hostname or "127.0.0.1"
        self.port = parsed.port or 80
        self.path = parsed.path or "/"
        if parsed.query:
            self.path += "?" + parsed.query
        self.headers = headers
        self.timeout_ms = timeout_ms
        self.sock = None

    def connect(self) -> None:
        key_b64 = base64.b64encode(os.urandom(16)).decode()
        request = (
            f"GET {self.path} HTTP/1.1\r\n"
            f"Host: {self.host}:{self.port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key_b64}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
        )
        for name, value in self.headers.items():
            request += f"{name}: {value}\r\n"
        request += "\r\n"
        self.sock = socket.create_connection((self.host, self.port), timeout=self.timeout_ms / 1000.0)
        self.sock.sendall(request.encode("ascii"))
        response = b""
        while b"\r\n\r\n" not in response:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("websocket handshake failed: connection closed")
            response += chunk
        header_text = response.split(b"\r\n\r\n", 1)[0].decode("latin-1")
        status_line = header_text.split("\r\n", 1)[0]
        if " 101 " not in status_line:
            raise ConnectionError(f"websocket handshake failed: {status_line}")

    def _recv_exact(self, count: int) -> bytes:
        data = b""
        while len(data) < count:
            chunk = self.sock.recv(count - len(data))
            if not chunk:
                raise ConnectionError("websocket connection closed")
            data += chunk
        return data

    def _recv_frame(self) -> tuple:
        self.sock.settimeout(self.timeout_ms / 1000.0)
        first = self._recv_exact(2)
        fin = bool(first[0] & 0x80)
        opcode = first[0] & 0x0F
        masked = bool(first[1] & 0x80)
        length = first[1] & 0x7F
        if length == 126:
            length = struct.unpack(">H", self._recv_exact(2))[0]
        elif length == 127:
            length = struct.unpack(">Q", self._recv_exact(8))[0]
        mask = self._recv_exact(4) if masked else b""
        payload = self._recv_exact(length) if length else b""
        if masked:
            payload = bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload))
        return fin, opcode, payload

    def receive_text(self) -> str | None:
        """Receive one text message; returns None on timeout/close."""
        try:
            fragments = []
            while True:
                fin, opcode, payload = self._recv_frame()
                if opcode == 0x8:  # close
                    return None
                if opcode == 0x9:  # ping → pong
                    self._send_frame(0xA, payload)
                    continue
                if opcode == 0xA:  # pong
                    continue
                if opcode == 0x1 or opcode == 0x0:  # text or continuation
                    fragments.append(payload)
                    if fin:
                        return b"".join(fragments).decode("utf-8", errors="replace")
        except (socket.timeout, ConnectionError, OSError):
            return None

    def _send_frame(self, opcode: int, payload: bytes) -> None:
        length = len(payload)
        header = bytes([0x80 | opcode])
        if length < 126:
            header += bytes([0x80 | length])
        elif length < 65536:
            header += bytes([0x80 | 126]) + struct.pack(">H", length)
        else:
            header += bytes([0x80 | 127]) + struct.pack(">Q", length)
        mask = os.urandom(4)
        masked_payload = bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload))
        self.sock.sendall(header + mask + masked_payload)

    def close(self) -> None:
        if self.sock:
            try:
                self._send_frame(0x8, b"")
            except OSError:
                pass
            try:
                self.sock.close()
            except OSError:
                pass
            self.sock = None


def receive_ws_text(ws: WebSocketClient, timeout_ms: int) -> str | None:
    ws.timeout_ms = timeout_ms
    return ws.receive_text()


def read_run_output_text(event: dict) -> str:
    if event.get("type") != "run.output.batch":
        return ""
    if event.get("payload", {}).get("runId") != current_run_id:
        return ""
    if event.get("payload", {}).get("stream") != "stdout":
        return ""
    text = ""
    for chunk in event.get("payload", {}).get("chunks") or []:
        if chunk.get("text"):
            text += str(chunk["text"])
    return text


def test_websocket_run_output(run_id: str, assert_builtin_mock_events: bool, edge_addr: str, edge_auth_token: str, edge_headers: dict) -> None:
    global current_run_id
    current_run_id = run_id
    deadline = time.time() + 15
    cursor = 0
    received_any = False
    seen_current_run_event = False
    seen_current_run_types = []
    stdout = ""
    preview = ""

    while time.time() < deadline:
        ws = WebSocketClient(
            f"ws://{edge_addr}/v1/events?cursor={cursor}",
            {"Origin": "http://localhost"},
            5000,
        )
        try:
            ws.connect()
            assert_true(ws.sock is not None, "WS connected")

            while time.time() < deadline and ws.sock is not None:
                raw = receive_ws_text(ws, 5000)
                if not raw:
                    break

                received_any = True
                if preview == "":
                    preview = raw[: min(120, len(raw))]

                try:
                    event = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if event.get("seq") is not None:
                    cursor = int(event["seq"])

                event_run_id = ""
                scope = event.get("scope") or {}
                payload = event.get("payload") or {}
                if scope.get("runId"):
                    event_run_id = str(scope["runId"])
                elif payload.get("runId"):
                    event_run_id = str(payload["runId"])
                if event_run_id == run_id:
                    seen_current_run_event = True
                    seen_current_run_types.append(str(event.get("type", "")))

                stdout += read_run_output_text(event)
                if assert_builtin_mock_events:
                    if (
                        "run.started" in seen_current_run_types
                        and "run.output.batch" in seen_current_run_types
                        and "run.finished" in seen_current_run_types
                        and "Initializing mock runner" in stdout
                    ):
                        assert_true(True, "built-in mock executor emitted started/output/finished")
                        emit(f"    matched built-in mock events for {run_id}")
                        return
                else:
                    if seen_current_run_event:
                        assert_true(True, "received WS frame for current run")
                        if preview != "":
                            emit(f"    first event: {preview}")
                        emit(f"    current run events: {', '.join(seen_current_run_types)}")
                        emit("    skipped built-in mock assertion: -ReuseExistingEdge runtime configuration is unknown")
                        return
        except (ConnectionError, OSError):
            pass
        finally:
            ws.close()

    assert_true(received_any, "received WS frame")
    assert_true(seen_current_run_event, "received WS frame for current run")
    if seen_current_run_types:
        emit(f"    current run events: {', '.join(seen_current_run_types)}")
    if assert_builtin_mock_events:
        assert_true("run.started" in seen_current_run_types, "run.started present")
        assert_true("run.output.batch" in seen_current_run_types, "run.output.batch present")
        assert_true("run.finished" in seen_current_run_types, "run.finished present")
        assert_true("Initializing mock runner" in stdout, "built-in mock output present")


def main() -> int:
    global passed, failed, edge_proc, started_edge
    normalize_stdout_lf()
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--SkipBuild", action="store_true", help="skip build steps")
    parser.add_argument("--SkipGoTests", action="store_true", help="skip edge-server Go unit tests")
    parser.add_argument("--SkipCancel", action="store_true", help="skip the run cancel check")
    parser.add_argument("--ReuseExistingEdge", action="store_true", help="use an already-running Edge on -EdgeAddr")
    parser.add_argument("--EdgeAddr", default="127.0.0.1:3210", help="Edge address host:port")
    parser.add_argument("--EdgeAuthToken", default="", help="optional bearer token for Edge API calls")
    args = parser.parse_args()

    repo_root = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    edge_url = f"http://{args.EdgeAddr}"
    edge_binary = os.path.join(repo_root, "edge-server", "agenthub-edge-tmp.exe")
    edge_headers = {}
    if args.EdgeAuthToken.strip():
        edge_headers["Authorization"] = f"Bearer {args.EdgeAuthToken}"

    passed = 0
    failed = 0
    edge_proc = None
    started_edge = False

    try:
        # ── Prerequisites ──────────────────────────────────

        write_step("Environment check")

        go_out = run_native(["go", "version"]).stdout
        go_match = re.search(r"go(\d+\.\d+)", go_out)
        if go_match:
            go_ver = tuple(int(part) for part in go_match.group(1).split("."))
            assert_true(go_ver >= (1, 24), f"Go 1.24+ (go{go_match.group(1)})")
        else:
            fail_check("Go not found or unexpected version output")

        pnpm_out = run_native(["pnpm", "--version"])
        assert_true(pnpm_out.returncode == 0, f"pnpm ({pnpm_out.stdout.strip()})")

        node_out = run_native(["node", "--version"])
        assert_true(node_out.returncode == 0, "node available")

        existing_edge = test_edge_health(edge_url, edge_headers)
        if existing_edge and not args.ReuseExistingEdge:
            fail_check(f"Edge already running on {args.EdgeAddr}; stop it or pass -ReuseExistingEdge")
            raise RuntimeError(f"edge already running on {args.EdgeAddr}")

        # ── Build ──────────────────────────────────────────

        if not args.SkipBuild:
            write_step("Build Edge Server")
            build_run = run_native(
                ["go", "build", "-o", edge_binary, "./cmd/agenthub-edge/"],
                cwd=os.path.join(repo_root, "edge-server"),
            )
            assert_true(os.path.isfile(edge_binary), "edge-server binary")

            write_step("Install App Workspace Dependencies")
            pnpm_install = run_native(
                ["corepack", "pnpm", "install", "--frozen-lockfile"],
                cwd=os.path.join(repo_root, "app"),
            )
            assert_true(pnpm_install.returncode == 0, "app workspace pnpm install")

            write_step("Build Desktop (web only)")
            desktop_build = run_native(
                ["corepack", "pnpm", "--dir", os.path.join(repo_root, "app", "desktop"), "build"],
                cwd=repo_root,
            )
            assert_true(
                desktop_build.returncode == 0 and os.path.isfile(os.path.join(repo_root, "app", "desktop", "dist", "index.html")),
                "pnpm build OK",
            )

        # ── Edge Server ────────────────────────────────────

        write_step("Start Edge Server")
        if test_edge_health(edge_url, edge_headers):
            if args.ReuseExistingEdge:
                pass_check(f"reuse existing Edge on {args.EdgeAddr}")
            else:
                fail_check(f"Edge already running on {args.EdgeAddr}; stop it or pass -ReuseExistingEdge")
                raise RuntimeError(f"edge already running on {args.EdgeAddr}")
        else:
            if not os.path.isfile(edge_binary):
                fail_check(f"edge binary missing: {edge_binary}")
                raise RuntimeError("edge binary missing")
            smoke_runner_command = get_smoke_runner_command()
            smoke_runner_script = "Write-Output 'Initializing mock runner'; Write-Output 'AgentHub client smoke mock output'"
            edge_args = [
                "--addr",
                args.EdgeAddr,
                "--runner-profile",
                "agenthub-runner-mock",
                "--runner-command",
                smoke_runner_command,
                "--runner-arg",
                "-NoProfile",
                "--runner-arg",
                "-Command",
                "--runner-arg",
                smoke_runner_script,
            ]
            if args.EdgeAuthToken.strip():
                edge_args += ["--local-auth-token", args.EdgeAuthToken]
            edge_proc = subprocess.Popen(
                [edge_binary, *edge_args],
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            started_edge = True

            ready = False
            for _ in range(20):
                time.sleep(0.25)
                if edge_proc.poll() is not None:
                    break
                if test_edge_health(edge_url, edge_headers):
                    ready = True
                    break
            assert_true(ready, f"Edge process ready (PID {edge_proc.pid})")

        try:
            if started_edge:
                assert_true(edge_proc.poll() is None, f"Edge process alive (PID {edge_proc.pid})")

            # Health
            write_step("GET /v1/health")
            try:
                health = unwrap_edge_data(invoke_edge_rest(f"{edge_url}/v1/health", timeout_sec=5, headers=edge_headers))
                assert_true(isinstance(health, dict) and health.get("status") == "ok", "status=ok")
                assert_true(isinstance(health, dict) and health.get("version") == "v1", "version=v1")
                assert_true(isinstance(health, dict) and health.get("edgeId") == "local", "edgeId=local")
            except Exception as exc:  # noqa: BLE001 —— 对齐 ps1 catch 语义
                fail_check(f"health: {exc}")

            # Runners
            write_step("GET /v1/runners")
            try:
                runners = invoke_edge_rest(f"{edge_url}/v1/runners", timeout_sec=5, headers=edge_headers)
                count = len(runners.get("items") or []) if isinstance(runners, dict) else 0
                assert_true(count > 0, f"runners count={count}")
                if count > 0:
                    first_runner = (runners.get("items") or [])[0]
                    assert_true(first_runner.get("status") == "online", "mock runner online")
                assert_true(runners.get("page", {}).get("hasMore") is False, "hasMore=false")
            except Exception as exc:  # noqa: BLE001
                fail_check(f"runners: {exc}")

            # POST /v1/runs
            write_step("POST /v1/runs")
            run = None
            try:
                run = invoke_edge_rest(f"{edge_url}/v1/runs", method="POST", timeout_sec=5, headers=edge_headers)
                assert_true(run and re.match(r"^run_", str(run.get("runId", ""))), f"runId prefix ({run.get('runId') if run else None})")
                assert_true(run and run.get("status") == "queued", "status=queued")
                assert_true(run and run.get("createdAt") is not None, "createdAt non-null")
            except Exception as exc:  # noqa: BLE001
                fail_check(f"POST runs: {exc}")

            # WebSocket
            write_step("WebSocket /v1/events")
            try:
                if run is None or not str(run.get("runId", "")).strip():
                    fail_check("WebSocket: POST /v1/runs did not return a runId")
                else:
                    test_websocket_run_output(str(run["runId"]), not args.ReuseExistingEdge, args.EdgeAddr, args.EdgeAuthToken, edge_headers)
            except Exception as exc:  # noqa: BLE001
                fail_check(f"WebSocket: {exc}")

            if args.SkipCancel:
                write_step("POST /v1/runs/{runId}:cancel")
                pass_check("cancel smoke skipped by -SkipCancel")
            else:
                write_step("POST /v1/runs/{runId}:cancel")
                try:
                    cancel_run = invoke_edge_rest(f"{edge_url}/v1/runs", method="POST", timeout_sec=5, headers=edge_headers)
                    if cancel_run is None or not str(cancel_run.get("runId", "")).strip():
                        fail_check("cancel: POST /v1/runs did not return a runId")
                    else:
                        cancel = invoke_edge_rest(
                            f"{edge_url}/v1/runs/{cancel_run['runId']}:cancel", method="POST", timeout_sec=15, headers=edge_headers
                        )
                        assert_true(cancel and cancel.get("runId") == cancel_run.get("runId"), f"runId={cancel_run.get('runId')}")
                        assert_true(
                            cancel and cancel.get("status") in ("cancelling", "finished", "failed", "cancelled"),
                            f"status={cancel.get('status') if cancel else None}",
                        )
                except Exception as exc:  # noqa: BLE001
                    fail_check(f"cancel: {exc}")

            # ── Go tests ────────────────────────────────────

            if args.SkipGoTests:
                write_step("Go unit tests")
                pass_check("edge-server tests skipped by -SkipGoTests")
            else:
                write_step("Go unit tests")
                go_test = run_native(
                    ["go", "test", "./..."],
                    cwd=os.path.join(repo_root, "edge-server"),
                )
                assert_true(go_test.returncode == 0, "edge-server tests pass")

        finally:
            if started_edge and edge_proc and edge_proc.poll() is None:
                write_step("Stop Edge Server")
                edge_proc.kill()
                try:
                    edge_proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    pass

        # ── Summary ───────────────────────────────────────

        emit("\n========================================")
        emit(f"  Passed: {passed}  |  Failed: {failed}")
        emit("========================================")

        emit("\nManual UI verification steps:")
        emit("  1. Start Edge:   cd edge-server; go run ./cmd/agenthub-edge --runner-profile agenthub-runner-mock")
        emit("  2. Start Desktop: cd app/desktop; pnpm tauri dev")
        emit("  3. Verify status bar shows green Online dot")
        emit("  4. Verify Runtime/Target readiness shows Mock Runner (local) online")
        emit("  5. Trigger POST /v1/runs and check event log panel updates with run.output.batch")
        emit("  6. Stop Edge and verify UI shows red Offline without crash")

        return 0 if failed == 0 else 1

    except Exception as exc:  # noqa: BLE001 —— 对齐 ps1 $ErrorActionPreference='Stop' 顶层抛错
        emit(f"ERROR: {exc}")
        return 1 if failed == 0 else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
