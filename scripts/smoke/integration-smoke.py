#!/usr/bin/env python3
"""integration-smoke — AgentHub live Agent Runtime smoke test.

ps1 迁移（契约见 server docs/design/ps1-to-python-migration.md）：stdlib only、
CLI 参数/退出码兼容（0=通过/1=失败/2=非法 agent）、机器可读行（`  PASS  `/
`  FAIL  ` 与 `=== ... ===` step）与原 ps1 一致。

启动 Edge Server（真实 agent CLI），发送 prompt，通过 WebSocket 事件流验证端到端
事件流。本脚本刻意不回退到 mock executor；CI-safe 的 mock 覆盖见
`scripts/smoke/client-smoke.py`。
"""

import argparse
import json
import locale
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

OUTPUT_ENCODING = locale.getpreferredencoding(False) or "utf-8"

passed = 0
failed = 0
edge_proc = None
started_edge = False


def normalize_stdout_lf() -> None:
    """Disable newline translation; emit in the console locale encoding (GBK on
    zh-CN) so redirected output is byte-identical to pwsh."""
    try:
        sys.stdout.reconfigure(encoding=OUTPUT_ENCODING, errors="replace", newline="", line_buffering=True)
        sys.stderr.reconfigure(encoding=OUTPUT_ENCODING, errors="replace", newline="", line_buffering=True)
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


def resolve_path_executable(command_name: str) -> str | None:
    """Resolve a CLI command to a native executable path; mirrors ps1 Resolve-PathExecutable.

    Uses where.exe first (like the ps1) so the returned path casing matches
    byte-for-byte; falls back to shutil.which for non-Windows hosts.
    """
    candidates = []
    if os.name == "nt":
        try:
            run = subprocess.run(["where.exe", command_name], capture_output=True, text=True)
            if run.returncode == 0:
                candidates = [line.strip() for line in run.stdout.splitlines() if line.strip()]
        except Exception:  # noqa: BLE001
            candidates = []
    if not candidates:
        found = shutil.which(command_name)
        if found:
            candidates = [found]
    for candidate in candidates:
        if re.search(r"\.(exe|cmd|bat|com)$", candidate, re.IGNORECASE):
            return candidate
    for candidate in candidates:
        if candidate and not re.search(r"\.ps1$", candidate, re.IGNORECASE):
            return candidate
    return None


def resolve_agent_path(agent_id: str) -> str | None:
    env_vars = {
        "claude-code": ("AGENTHUB_CLAUDE_CODE_PATH", "CLAUDE_PATH", "claude"),
        "codex-acp": ("AGENTHUB_CODEX_ACP_PATH", "", "npx"),
        "opencode-acp": ("AGENTHUB_OPENCODE_ACP_PATH", "", "opencode"),
    }
    var1, var2, command = env_vars[agent_id]
    if os.environ.get(var1):
        return resolve_path_executable(os.environ[var1])
    if os.environ.get(var2):
        return resolve_path_executable(os.environ[var2])
    return resolve_path_executable(command)


def get_agent_path_flag(agent_id: str) -> str:
    return {
        "claude-code": "--claude-code-path",
        "codex-acp": "--codex-acp-path",
        "opencode-acp": "--opencode-acp-path",
    }[agent_id]


def test_edge_health(edge_url: str) -> bool:
    try:
        with urllib.request.urlopen(f"{edge_url}/v1/health", timeout=2) as response:
            health = json.loads(response.read().decode("utf-8", errors="replace"))
        return isinstance(health, dict) and health.get("status") == "ok" and health.get("version") == "v1"
    except Exception:  # noqa: BLE001 —— 对齐 ps1 catch 语义
        return False


def read_event_error_summary(event: dict) -> str:
    payload = event.get("payload") or {}
    if payload.get("error") is None:
        return ""
    error_value = payload["error"]
    if isinstance(error_value, str):
        return error_value
    try:
        return json.dumps(error_value, ensure_ascii=False, separators=(",", ":"))
    except Exception:  # noqa: BLE001
        return str(error_value)


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


def get_event_run_id(event: dict) -> str:
    scope = event.get("scope") or {}
    payload = event.get("payload") or {}
    if scope.get("runId"):
        return str(scope["runId"])
    if payload.get("runId"):
        return str(payload["runId"])
    return ""


def main() -> int:
    global passed, failed, edge_proc, started_edge
    normalize_stdout_lf()
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--SkipBuild", action="store_true", help="skip the Edge Server build")
    parser.add_argument("--Agent", default="claude-code", choices=["claude-code", "codex-acp", "opencode-acp"], help="agent adapter to use")
    parser.add_argument("--Prompt", default="reply with just the word ok", help="prompt sent to the runtime")
    parser.add_argument("--RunTimeoutSec", type=int, default=60, help="run/event timeout")
    parser.add_argument("--EdgeAddr", default="127.0.0.1:3210", help="Edge address host:port")
    args = parser.parse_args()

    repo_root = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    edge_url = f"http://{args.EdgeAddr}"
    edge_binary = os.path.join(repo_root, "edge-server", "agenthub-edge-tmp.exe")

    passed = 0
    failed = 0
    edge_proc = None
    started_edge = False

    try:
        # ── Prerequisites ──────────────────────────────────

        write_step("Environment check")

        go_out = subprocess.run(["go", "version"], capture_output=True, text=True).stdout
        go_match = re.search(r"go(\d+\.\d+)", go_out)
        if go_match:
            go_ver = tuple(int(part) for part in go_match.group(1).split("."))
            assert_true(go_ver >= (1, 24), f"Go 1.24+ (go{go_match.group(1)})")
        else:
            fail_check("Go not found or unexpected version output")

        node_out = subprocess.run(["node", "--version"], capture_output=True, text=True)
        assert_true(node_out.returncode == 0, "node available")

        existing_edge = test_edge_health(edge_url)
        if existing_edge:
            fail_check(f"Edge already running on {args.EdgeAddr}; stop it first")
            raise RuntimeError(f"edge already running on {args.EdgeAddr}")

        # ── Resolve agent CLI ──────────────────────────────

        write_step(f"Resolve agent CLI: {args.Agent}")
        agent_path = resolve_agent_path(args.Agent)
        if not agent_path:
            fail_check(f"agent CLI not found for {args.Agent}")
            raise RuntimeError(
                f"agent CLI not found for {args.Agent}; install it or set AGENTHUB_CLAUDE_CODE_PATH / AGENTHUB_CODEX_ACP_PATH / AGENTHUB_OPENCODE_ACP_PATH"
            )
        assert_true(True, f"agent CLI found: {agent_path}")
        test_strategy = f"live runtime ({args.Agent} via {agent_path})"
        emit(f"  Strategy: {test_strategy}")

        # ── Build ──────────────────────────────────────────

        if not args.SkipBuild:
            write_step("Build Edge Server")
            build_run = subprocess.run(
                ["go", "build", "-o", edge_binary, "./cmd/agenthub-edge/"],
                cwd=os.path.join(repo_root, "edge-server"),
                capture_output=True,
                text=True,
            )
            assert_true(os.path.isfile(edge_binary), "edge-server binary")

        # ── Start Edge Server ──────────────────────────────

        write_step("Start Edge Server")
        if not os.path.isfile(edge_binary):
            fail_check(f"edge binary missing: {edge_binary}")
            raise RuntimeError("edge binary missing")

        edge_args = ["--addr", args.EdgeAddr, "--agent-default", args.Agent, get_agent_path_flag(args.Agent), agent_path]
        edge_proc = subprocess.Popen(
            [edge_binary, *edge_args],
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        started_edge = True

        ready = False
        for _ in range(30):
            time.sleep(0.25)
            if edge_proc.poll() is not None:
                break
            if test_edge_health(edge_url):
                ready = True
                break
        assert_true(ready, f"Edge process ready (PID {edge_proc.pid})")

        try:
            assert_true(edge_proc.poll() is None, f"Edge process alive (PID {edge_proc.pid})")

            # Health
            write_step("GET /v1/health")
            try:
                with urllib.request.urlopen(f"{edge_url}/v1/health", timeout=5) as response:
                    health = json.loads(response.read().decode("utf-8", errors="replace"))
                assert_true(isinstance(health, dict) and health.get("status") == "ok", "status=ok")
                assert_true(isinstance(health, dict) and health.get("version") == "v1", "version=v1")
            except Exception as exc:  # noqa: BLE001
                fail_check(f"health: {exc}")

            # POST /v1/runs
            write_step("POST /v1/runs")
            run = None
            try:
                body = {"projectId": "proj_local", "threadId": "thread_local", "prompt": args.Prompt, "agentId": args.Agent}
                request = urllib.request.Request(
                    f"{edge_url}/v1/runs",
                    data=json.dumps(body).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                try:
                    with urllib.request.urlopen(request, timeout=10) as response:
                        run = json.loads(response.read().decode("utf-8", errors="replace"))
                except urllib.error.HTTPError as exc:
                    raw = ""
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
                    raise RuntimeError(raw if raw.strip() else f"Response status code does not indicate success: {exc.code} ({exc.reason}).") from exc
                assert_true(run and re.match(r"^run_", str(run.get("runId", ""))), f"runId prefix ({run.get('runId') if run else None})")
                assert_true(run and run.get("status") == "queued", "status=queued")
                if run and run.get("runId"):
                    emit(f"    runId={run['runId']}")
            except Exception as exc:  # noqa: BLE001
                fail_check(f"POST runs: {exc}")

            # ── WebSocket event verification ─────────────────

            write_step("WebSocket /v1/events — verify event stream")

            deadline = time.time() + args.RunTimeoutSec
            cursor = 0
            received_frames = 0
            seen_run_events = []
            first_frame_preview = ""
            terminal_error = ""

            while time.time() < deadline:
                ws = WebSocketClient(f"ws://{args.EdgeAddr}/v1/events?cursor={cursor}", {"Origin": "http://localhost"}, 5000)
                try:
                    ws.connect()
                    assert_true(ws.sock is not None, "WS connected")

                    while time.time() < deadline and ws.sock is not None:
                        raw = receive_ws_text(ws, 5000)
                        if not raw:
                            break

                        received_frames += 1
                        if first_frame_preview == "":
                            first_frame_preview = raw[: min(150, len(raw))]
                            emit(f"    first frame: {first_frame_preview}")

                        try:
                            event = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        if event.get("seq") is not None:
                            cursor = int(event["seq"])

                        event_run_id = get_event_run_id(event)
                        if run and event_run_id == str(run.get("runId", "")):
                            seen_run_events.append(str(event.get("type", "")))

                        if run and event_run_id == str(run.get("runId", "")) and re.match(r"^run\.(finished|failed|cancelled)$", str(event.get("type", ""))):
                            emit(f"    terminal event: {event.get('type')}")
                            if event.get("type") == "run.failed":
                                terminal_error = read_event_error_summary(event)
                            break
                except OSError:
                    # 对齐 ps1 ConnectAsync 抛错语义：WS 握手失败（如 401）直接向上抛
                    raise
                finally:
                    ws.close()
                if any(re.match(r"run\.(finished|failed|cancelled)", t) for t in seen_run_events):
                    break

            assert_true(received_frames > 0, f"received WS frames ({received_frames})")
            emit(f"    run events: {', '.join(seen_run_events)}")
            if terminal_error:
                emit(f"    terminal error: {terminal_error}")

            # ── Verify live runtime events ─────────────────

            write_step("Verify live runtime events")

            has_text_delta = "run.agent.text_delta" in seen_run_events
            has_text_block = "run.agent.text_block" in seen_run_events
            has_result = "run.agent.result" in seen_run_events
            has_session_init = "run.agent.session_init" in seen_run_events
            has_thinking = "run.agent.thinking" in seen_run_events
            has_tool_call = "run.agent.tool_call" in seen_run_events
            has_started = "run.started" in seen_run_events
            has_finished = "run.finished" in seen_run_events
            has_runtime_event = has_session_init or has_text_delta or has_text_block or has_result or has_thinking or has_tool_call

            assert_true(has_started, "run.started present")
            assert_true(has_runtime_event, "runtime structured event present")
            assert_true(has_text_delta or has_text_block or has_result, "runtime output/result present")
            assert_true(has_finished, "run.finished present")

            emit(f"    live runtime events verified: session_init={has_session_init} text={has_text_delta or has_text_block} result={has_result} thinking={has_thinking} tool_call={has_tool_call}")

            # ── Verify run completed successfully ───────────

            write_step("GET /v1/runs — verify run status")
            try:
                if run and run.get("runId"):
                    with urllib.request.urlopen(f"{edge_url}/v1/runs/{run['runId']}", timeout=5) as response:
                        final_run = json.loads(response.read().decode("utf-8", errors="replace"))
                    assert_true(isinstance(final_run, dict) and final_run.get("status") in ("finished", "completed"), f"final run status={final_run.get('status') if isinstance(final_run, dict) else None}")
                else:
                    fail_check("GET run: missing runId from POST")
            except Exception as exc:  # noqa: BLE001
                fail_check(f"GET run: {exc}")

        finally:
            if started_edge and edge_proc and edge_proc.poll() is None:
                write_step(f"Stop Edge Server (PID {edge_proc.pid})")
                edge_proc.kill()
                try:
                    edge_proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    pass

    except Exception as exc:  # noqa: BLE001 —— 对齐 ps1 $ErrorActionPreference='Stop'
        emit(f"ERROR: {exc}")
        return 1

    # ── Summary ────────────────────────────────────────────

    emit("\n========================================")
    emit(f"  Integration smoke: {test_strategy}")
    emit(f"  Passed: {passed}  |  Failed: {failed}")
    emit("========================================")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
