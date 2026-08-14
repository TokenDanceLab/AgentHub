#!/usr/bin/env python3
"""edge-runtime-smoke — Edge runtime smoke gate.

ps1 迁移（契约见 server docs/design/ps1-to-python-migration.md）：stdlib only、
CLI 参数/退出码兼容（0=通过或 -AllowMissingCli 跳过/1=失败/2=非法用法）、机器
可读输出（`PASS`/`FAIL` 断言行与 `=== Structured result ===` JSON）与原 ps1
一致。

本脚本本地启动 AgentHub Edge、创建一个 run，并验证 Edge REST + WebSocket
runtime 事件链路。不是完整 Hub/PG/Redis/OIDC E2E gate。

默认 fake-process-fixture 模式（CI-safe）：用 pwsh 伪造 runtime 进程，不调真实
CLI/model；`--RealCli` 才走真实 runtime（需要 CLI 路径/环境变量）。
"""

import argparse
import base64
import datetime
import json
import os
import re
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request


def iso_timestamp() -> str:
    return datetime.datetime.now().astimezone().isoformat(timespec="microseconds")


def emit(text: str) -> None:
    sys.stdout.write(text + "\r\n")
    sys.stdout.flush()


def step(text: str) -> None:
    emit(f"\n=== {text} ===")


def protect_local_text(text: str | None, max_length: int = 800) -> str | None:
    """Redact local paths and secret-like tokens; mirrors ps1 Protect-LocalText."""
    if text is None:
        return None
    safe = text
    paths = []
    for path in (repo_root, log_dir, os.environ.get("TEMP"), os.environ.get("TMP"), os.environ.get("USERPROFILE")):
        if path:
            paths.append(path)
    for path in sorted(paths, key=len, reverse=True):
        safe = safe.replace(path, "<local-path>")
        try:
            resolved = os.path.realpath(path)
            if resolved:
                safe = safe.replace(resolved, "<local-path>")
        except OSError:
            pass
    safe = re.sub(r"(?i)[A-Z]:\\[^\"'\s,}]+", "<local-path>", safe)
    safe = re.sub(r"(?i)(Authorization:\s*Bearer\s+)[^\"'\s,}]+", r"\1<redacted-token>", safe)
    safe = re.sub(
        r"(?i)(\b[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*)[^\"'\s,}]+", r"\1<redacted-secret>", safe
    )
    safe = re.sub(r'(?i)("?(?:access[_-]?token|refresh[_-]?token|id[_-]?token)"?\s*:\s*")[^"]+', r"\1<redacted-token>", safe)
    safe = re.sub(r"(?i)((?:access[_-]?token|refresh[_-]?token|id[_-]?token)\s*[=:]\s*)[^\"'\s,}]+", r"\1<redacted-token>", safe)
    safe = re.sub(r"(?i)(sk|ghp|gho|ghu|ghs|glpat|xox[baprs])-[-_A-Za-z0-9]{12,}", "<redacted-token>", safe)
    if max_length > 0 and len(safe) > max_length:
        safe = safe[:max_length] + "...<truncated>"
    return safe


def format_result(result: dict, output_json: str) -> None:
    result["endedAt"] = iso_timestamp()
    result["durationMs"] = int((time.time() - started_at) * 1000)
    json_text = json.dumps(result, ensure_ascii=False, indent=2)
    json_text = protect_local_text(json_text, 0) or json_text
    if output_json:
        with open(output_json, "w", encoding="utf-8") as handle:
            handle.write(json_text)
    step("Structured result")
    emit(json_text)


def resolve_path_executable(command_name: str) -> str | None:
    """Resolve a CLI command to a native executable path; mirrors ps1 Resolve-PathExecutable."""
    if not command_name or not command_name.strip():
        return None

    def resolve_script_wrapper(script_path: str) -> str | None:
        if os.path.isfile(script_path):
            dir_name = os.path.dirname(script_path)
            stem = os.path.splitext(os.path.basename(script_path))[0]
            for ext in (".cmd", ".exe", ".bat", ".com"):
                sibling = os.path.join(dir_name, stem + ext)
                if os.path.isfile(sibling):
                    return sibling
        return None

    if os.path.isfile(command_name):
        resolved = os.path.realpath(command_name)
        if re.search(r"\.(exe|cmd|bat|com)$", resolved):
            return resolved
        if resolved.endswith(".ps1"):
            wrapped = resolve_script_wrapper(resolved)
            if wrapped:
                return wrapped
            raise RuntimeError(f"PowerShell script CLI path requires a sibling native wrapper (.cmd/.exe/.bat/.com): {resolved}")
        return resolved

    candidates = []
    try:
        found = shutil.which(command_name)
        if found:
            candidates = [found]
    except Exception:  # noqa: BLE001
        candidates = []
    for candidate in candidates:
        if re.search(r"\.(exe|cmd|bat|com)$", candidate):
            return candidate
    for candidate in candidates:
        if candidate and not candidate.endswith(".ps1"):
            return candidate
    for candidate in candidates:
        if candidate.endswith(".ps1"):
            wrapped = resolve_script_wrapper(candidate)
            if wrapped:
                return wrapped
            raise RuntimeError(
                f"PowerShell script CLI path requires a sibling native wrapper (.cmd/.exe/.bat/.com): {candidate}"
            )
    return None


def resolve_agent_path(runtime_id: str, explicit_path: str) -> str | None:
    if explicit_path and explicit_path.strip():
        return resolve_path_executable(explicit_path)
    env_vars = {
        "claude-code": ("AGENTHUB_CLAUDE_CODE_PATH", "CLAUDE_PATH", "claude"),
        "codex-acp": ("AGENTHUB_CODEX_ACP_PATH", "", "npx"),
        "opencode-acp": ("AGENTHUB_OPENCODE_ACP_PATH", "", "opencode"),
    }
    var1, var2, command = env_vars[runtime_id]
    if os.environ.get(var1):
        return resolve_path_executable(os.environ[var1])
    if os.environ.get(var2):
        return resolve_path_executable(os.environ[var2])
    return resolve_path_executable(command)


def get_agent_path_flag(runtime_id: str) -> str:
    return {
        "claude-code": "--claude-code-path",
        "codex-acp": "--codex-acp-path",
        "opencode-acp": "--opencode-acp-path",
    }[runtime_id]


def test_edge_health(url: str) -> bool:
    try:
        with urllib.request.urlopen(f"{url}/v1/health", timeout=2) as response:
            health = json.loads(response.read().decode("utf-8", errors="replace"))
        if health is None:
            return False
        if health.get("version") == "v1":
            return True
        if isinstance(health.get("data"), dict) and health["data"].get("version") == "v1":
            return True
        return health.get("code") == "OK"
    except Exception:  # noqa: BLE001 —— 对齐 ps1 catch 语义
        return False


def start_edge_process(arguments: list) -> subprocess.Popen:
    stdout_log = open(edge_stdout_log, "wb")
    stderr_log = open(edge_stderr_log, "wb")
    return subprocess.Popen(
        [edge_binary, *arguments],
        stdout=stdout_log,
        stderr=stderr_log,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


def save_async_text_task(proc: subprocess.Popen) -> None:
    """Flush captured edge stdout/stderr to their log files; mirrors ps1 Save-AsyncTextTask."""
    for stream, path in ((proc.stdout, edge_stdout_log), (proc.stderr, edge_stderr_log)):
        if stream is None:
            if not os.path.exists(path):
                with open(path, "w", encoding="utf-8") as handle:
                    handle.write("")
            continue
        try:
            data = stream.read()
            with open(path, "wb") as handle:
                handle.write(data)
        except Exception:  # noqa: BLE001
            with open(path, "w", encoding="utf-8") as handle:
                handle.write("[log stream read failed]")


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
    """Read one message with a timeout; mirrors ps1 Receive-WebSocketText."""
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


def read_run_output_text(event: dict) -> str:
    if event.get("type") != "run.output.batch":
        return ""
    payload = event.get("payload") or {}
    text = ""
    for chunk in payload.get("chunks") or []:
        if chunk.get("text"):
            text += str(chunk["text"])
    return text


def add_event_count(result: dict, event_type: str) -> None:
    if not event_type:
        return
    counts = result["eventCounts"]
    counts[event_type] = counts.get(event_type, 0) + 1


def get_run_id_from_response(response: dict | None) -> str:
    if response is None:
        return ""
    if response.get("runId"):
        return str(response["runId"])
    if isinstance(response.get("data"), dict) and response["data"].get("runId"):
        return str(response["data"]["runId"])
    return ""


def set_assertion(result: dict, name: str, passed: bool) -> None:
    result["assertions"][name] = passed
    if passed:
        emit(f"PASS {name}")
    else:
        emit(f"FAIL {name}")


def convert_to_safe_payload(payload: dict | None) -> dict | None:
    if payload is None:
        return None
    json_text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    json_text = protect_local_text(json_text, 0) or json_text
    try:
        parsed = json.loads(json_text)
    except json.JSONDecodeError:
        parsed = {"truncated": False, "text": json_text}
    if len(json_text) > 1200:
        return {"truncated": True, "json": json_text[:1200] + "...<truncated>"}
    return parsed


def read_runtime_result(event: dict) -> dict | None:
    if event.get("type") != "run.agent.result" or event.get("payload") is None:
        return None
    payload = convert_to_safe_payload(event["payload"])
    return {"seq": event.get("seq"), "success": bool(payload.get("success")) if payload else False, "payload": payload}


def resolve_endpoint(edge_url: str, edge_host: str, port: int) -> dict:
    if edge_url and edge_url.strip():
        parsed = urllib.parse.urlsplit(edge_url)
        if parsed.scheme != "http":
            raise RuntimeError("-EdgeUrl must use http:// because this local smoke starts a plain HTTP Edge server")
        if not parsed.port:
            raise RuntimeError("-EdgeUrl must include an explicit port")
        authority = parsed.netloc
        host = parsed.hostname or "127.0.0.1"
        port_value = parsed.port
        return {
            "Url": f"http://{authority}".rstrip("/"),
            "Addr": f"{host}:{port_value}",
            "WebSocketUrl": f"ws://{authority}/v1/events",
            "Port": port_value,
        }
    url = f"http://{edge_host}:{port}"
    return {"Url": url, "Addr": f"{edge_host}:{port}", "WebSocketUrl": f"ws://{edge_host}:{port}/v1/events", "Port": port}


def main() -> int:
    global repo_root, log_dir, edge_stdout_log, edge_stderr_log, events_log, build_log, event_log_path, edge_binary, started_at

    normalize_stdout_lf()
    parser = argparse.ArgumentParser(
        description=__doc__.splitlines()[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Exit codes:\n"
            "  0  smoke passed or real CLI was explicitly skipped with -AllowMissingCli\n"
            "  1  smoke failed\n"
            "  2  invalid usage/configuration"
        ),
    )
    parser.add_argument("--Help", action="store_true", help="show help and exit 0")
    parser.add_argument("--SkipBuild", action="store_true", help="skip building the Edge server binary")
    parser.add_argument("--Runtime", default="claude-code", choices=["claude-code", "codex-acp", "opencode-acp"], help="runtime adapter to require")
    parser.add_argument("--CliPath", default="", help="explicit CLI path for the selected runtime")
    parser.add_argument("--RealCli", action="store_true", help="opt in to real CLI/model execution")
    parser.add_argument("--AllowMissingCli", action="store_true", help="if the selected CLI is missing, warn and skip with exit 0")
    parser.add_argument("--SkipCli", action="store_true", help="deprecated alias for the default fake process fixture mode")
    parser.add_argument("--Prompt", default="reply with just the word ok", help="prompt sent to the runtime")
    parser.add_argument("--TimeoutSec", type=int, default=60, help="run/event timeout")
    parser.add_argument("--EdgeUrl", default="", help="Edge URL to use; defaults to -EdgeHost/-Port")
    parser.add_argument("--EdgeHost", default="127.0.0.1", help="local Edge host when -EdgeUrl is not set")
    parser.add_argument("--Port", type=int, default=3299, help="local Edge port when -EdgeUrl is not set")
    parser.add_argument(
        "--EdgeBinary",
        default=os.path.join(tempfile.gettempdir(), "agenthub-edge-runtime-smoke.exe"),
        help="path to the Edge binary to build/use",
    )
    parser.add_argument("--LogDir", default="", help="directory for edge/event logs")
    parser.add_argument("--OutputJson", default="", help="optional path for the structured result JSON")
    parser.add_argument("--IncludeLocalPaths", action="store_true", help="include absolute local log paths in JSON")
    args = parser.parse_args()

    if args.Help:
        parser.print_help()
        return 0
    if args.TimeoutSec <= 0:
        print("-TimeoutSec must be greater than 0", file=sys.stderr)
        return 2
    if args.Port <= 0 or args.Port > 65535:
        print("-Port must be between 1 and 65535", file=sys.stderr)
        return 2

    repo_root = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    if args.LogDir and args.LogDir.strip():
        log_dir = args.LogDir
    else:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        log_dir = os.path.join(tempfile.gettempdir(), f"agenthub-edge-runtime-smoke-{stamp}-{os.getpid()}")
    os.makedirs(log_dir, exist_ok=True)

    edge_stdout_log = os.path.join(log_dir, "edge.stdout.log")
    edge_stderr_log = os.path.join(log_dir, "edge.stderr.log")
    events_log = os.path.join(log_dir, "events.ndjson")
    build_log = os.path.join(log_dir, "build.log")
    event_log_path = os.path.join(log_dir, "edge-event-log.ndjson")

    started_at = time.time()
    edge_binary = args.EdgeBinary
    exit_code = 1
    effective_cli_path = None
    started_edge = False
    edge_proc = None

    result = {
        "script": "edge-runtime-smoke",
        "status": "failed",
        "mode": "fake-process-fixture",
        "runtime": args.Runtime,
        "cliPath": None,
        "edgeUrl": None,
        "port": args.Port,
        "prompt": args.Prompt,
        "timeoutSec": args.TimeoutSec,
        "runId": None,
        "startedAt": iso_timestamp(),
        "endedAt": None,
        "durationMs": None,
        "eventCounts": {},
        "seenTypes": [],
        "terminal": {"type": None, "seq": None, "error": None},
        "runtimeResult": None,
        "runtimeFailures": [],
        "frames": {"received": 0, "matchedRun": 0, "ignoredOtherRun": 0, "lastCursor": 0},
        "assertions": {},
        "warnings": [],
        "errors": [],
        "logs": {
            "dirName": os.path.basename(log_dir),
            "edgeStdout": os.path.basename(edge_stdout_log),
            "edgeStderr": os.path.basename(edge_stderr_log),
            "events": os.path.basename(events_log),
            "build": os.path.basename(build_log),
            "edgeEventLog": os.path.basename(event_log_path),
        },
    }
    if args.IncludeLocalPaths:
        result["localLogs"] = {
            "dir": log_dir,
            "edgeStdout": edge_stdout_log,
            "edgeStderr": edge_stderr_log,
            "events": events_log,
            "build": build_log,
            "edgeEventLog": event_log_path,
        }

    try:
        endpoint = resolve_endpoint(args.EdgeUrl, args.EdgeHost, args.Port)
        result["edgeUrl"] = endpoint["Url"]
        result["port"] = endpoint["Port"]

        step("Resolve runtime")
        if args.SkipCli:
            add_warning(
                result, "-SkipCli is deprecated; fake process fixture mode is now the default. Pass -RealCli to run a real CLI/model smoke."
            )
        if not args.RealCli:
            result["mode"] = "fake-process-fixture"
            add_warning(result, "Running the default fake process fixture. Pass -RealCli to run a real CLI/model smoke.")
            fake_command = resolve_path_executable("pwsh")
            if not fake_command:
                raise RuntimeError("fake process fixture requires pwsh")
            effective_cli_path = fake_command
            result["cliPath"] = os.path.basename(fake_command).replace(".EXE", ".exe")
            if args.IncludeLocalPaths:
                result["localCliPath"] = fake_command
        else:
            result["mode"] = "real-cli"
            resolved_cli = resolve_agent_path(args.Runtime, args.CliPath)
            if not resolved_cli:
                message = (
                    f"missing CLI for runtime '{args.Runtime}'. Install it, set the runtime path env var, pass -CliPath, "
                    "use -AllowMissingCli, or omit -RealCli to run the default fake fixture."
                )
                if args.AllowMissingCli:
                    add_warning(result, message)
                    result["status"] = "skipped"
                    result["mode"] = "missing-cli-skipped"
                    return 0
                raise RuntimeError(message)
            effective_cli_path = resolved_cli
            result["cliPath"] = os.path.basename(resolved_cli)
            if args.IncludeLocalPaths:
                result["localCliPath"] = resolved_cli
            emit(f"Runtime CLI: {result['cliPath']}")

        step("Build Edge")
        if not args.SkipBuild:
            run = subprocess.run(
                ["go", "build", "-o", edge_binary, ".\\cmd\\agenthub-edge\\"],
                cwd=os.path.join(repo_root, "edge-server"),
                capture_output=True,
                text=True,
            )
            with open(build_log, "w", encoding="utf-8") as handle:
                handle.write(run.stdout + run.stderr)
            if run.returncode != 0:
                raise RuntimeError(f"go build failed; see {build_log}")
        elif not os.path.exists(edge_binary):
            raise RuntimeError(f"edge binary missing: {edge_binary}; rerun without -SkipBuild or pass -EdgeBinary")
        else:
            with open(build_log, "w", encoding="utf-8") as handle:
                handle.write(f"build skipped; using {edge_binary}")

        if test_edge_health(endpoint["Url"]):
            raise RuntimeError(
                f"Edge is already responding on {endpoint['Url']}; choose a different -Port/-EdgeUrl or stop the existing process"
            )

        step("Start Edge")
        edge_args = ["--addr", endpoint["Addr"], "--dev", "--event-log-path", event_log_path]
        if not args.RealCli:
            edge_args += [
                "--runner-command",
                effective_cli_path,
                "--runner-arg",
                "-NoProfile",
                "--runner-arg",
                "-Command",
                "--runner-arg",
                "Write-Output 'agenthub fake runtime ok'",
            ]
        else:
            edge_args += ["--runner-profile", args.Runtime, get_agent_path_flag(args.Runtime), effective_cli_path]

        edge_proc = start_edge_process(edge_args)
        started_edge = True
        emit(f"Edge PID: {edge_proc.pid}")

        ready_deadline = time.time() + min(15, max(3, args.TimeoutSec))
        ready = False
        while time.time() < ready_deadline:
            time.sleep(0.25)
            if edge_proc.poll() is not None:
                raise RuntimeError(f"Edge exited before health check passed; see {edge_stderr_log}")
            if test_edge_health(endpoint["Url"]):
                ready = True
                break
        if not ready:
            raise RuntimeError(f"Edge did not become healthy before timeout; see {edge_stderr_log}")

        step("Create run")
        body = {"projectId": "proj_local", "threadId": "thread_local", "prompt": args.Prompt}
        if args.RealCli:
            body["agentId"] = args.Runtime
        run_request = urllib.request.Request(
            f"{endpoint['Url']}/v1/runs",
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(run_request, timeout=10) as response:
                run = json.loads(response.read().decode("utf-8", errors="replace"))
        except urllib.error.HTTPError as exc:
            # 对齐 ps1 Invoke-RestMethod 的异常消息格式
            raise RuntimeError(f"Response status code does not indicate success: {exc.code} ({exc.reason}).") from exc
        result["runId"] = get_run_id_from_response(run)
        if not result["runId"]:
            raise RuntimeError("POST /v1/runs did not return runId")
        emit(f"Run ID: {result['runId']}")

        step("Read WebSocket events")
        deadline = time.time() + args.TimeoutSec
        cursor = 0
        seen_types = []
        stdout = ""
        terminal_type = ""
        terminal_error = ""
        while time.time() < deadline and not terminal_type:
            ws = WebSocketClient(endpoint["WebSocketUrl"] + f"?cursor={cursor}", {"Origin": "http://localhost"}, 5000)
            try:
                ws.connect()
                while time.time() < deadline and ws.sock is not None:
                    raw = receive_ws_text(ws, 5000)
                    if not raw:
                        break
                    with open(events_log, "a", encoding="utf-8") as handle:
                        handle.write(raw + "\n")
                    result["frames"]["received"] += 1
                    event = json.loads(raw)
                    if event.get("seq") is not None:
                        cursor = int(event["seq"]) + 1
                        result["frames"]["lastCursor"] = int(event["seq"])
                    event_run_id = get_event_run_id(event)
                    if event_run_id == result["runId"]:
                        result["frames"]["matchedRun"] += 1
                        event_type = str(event.get("type", ""))
                        if event_type not in seen_types:
                            seen_types.append(event_type)
                        result["seenTypes"].append(event_type)
                        add_event_count(result, event_type)
                        stdout += read_run_output_text(event)
                        runtime_result = read_runtime_result(event)
                        if runtime_result is not None:
                            result["runtimeResult"] = runtime_result
                            if not runtime_result["success"]:
                                result["runtimeFailures"].append(runtime_result)
                        if event_type == "run.failed":
                            terminal_type = event_type
                            result["terminal"]["type"] = event_type
                            result["terminal"]["seq"] = event.get("seq")
                            payload = event.get("payload")
                            if payload and payload.get("error") is not None:
                                terminal_error = protect_local_text(
                                    json.dumps(payload["error"], ensure_ascii=False, separators=(",", ":"))
                                )
                                result["terminal"]["error"] = terminal_error
                            break
                        if event_type in ("run.finished", "run.cancelled"):
                            terminal_type = event_type
                            result["terminal"]["type"] = event_type
                            result["terminal"]["seq"] = event.get("seq")
                            break
                    elif event_run_id:
                        result["frames"]["ignoredOtherRun"] += 1
            except (ConnectionError, OSError, json.JSONDecodeError, urllib.error.URLError):
                pass
            finally:
                ws.close()

        emit(f"Run events: {', '.join(seen_types)}")
        if terminal_error:
            emit(f"Terminal error: {terminal_error}")

        step("Assertions")
        has_started = "run.started" in seen_types
        has_finished = "run.finished" in seen_types
        has_failed = "run.failed" in seen_types
        has_cancelled = "run.cancelled" in seen_types
        has_run_output = "run.output.batch" in seen_types
        has_text_delta = "run.agent.text_delta" in seen_types
        has_text_block = "run.agent.text_block" in seen_types
        has_result = "run.agent.result" in seen_types
        runtime_succeeded = bool(result["runtimeResult"] and result["runtimeResult"].get("success"))
        has_session_init = "run.agent.session_init" in seen_types
        has_thinking = "run.agent.thinking" in seen_types
        has_tool_call = "run.agent.tool_call" in seen_types
        has_runtime_event = has_session_init or has_text_delta or has_text_block or has_result or has_thinking or has_tool_call
        has_terminal = bool(terminal_type)

        set_assertion(result, "run.started present", has_started)
        set_assertion(result, "terminal event present", has_terminal)
        set_assertion(result, "run did not fail/cancel", not has_failed and not has_cancelled)
        if not args.RealCli:
            set_assertion(result, "fake fixture emitted raw output", has_run_output and "agenthub fake runtime ok" in stdout)
            set_assertion(result, "run.finished present", has_finished)
        else:
            set_assertion(result, "runtime structured event present", has_runtime_event)
            set_assertion(result, "runtime output or result present", has_text_delta or has_text_block or has_result)
            set_assertion(result, "runtime result success", runtime_succeeded)
            set_assertion(result, "run.finished present", has_finished)

        failed_assertions = [name for name, passed in result["assertions"].items() if not passed]
        if failed_assertions:
            raise RuntimeError(f"smoke assertions failed: {', '.join(failed_assertions)}")

        result["status"] = "passed"
        exit_code = 0
    except Exception as exc:  # noqa: BLE001 —— 对齐 ps1 catch：记录错误并失败
        add_error(result, str(exc))
        result["status"] = "failed"
        exit_code = 1
    finally:
        if started_edge and edge_proc and edge_proc.poll() is None:
            step("Stop Edge")
            edge_proc.kill()
            try:
                edge_proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass

        save_async_text_task(edge_proc)
        if not os.path.exists(events_log):
            with open(events_log, "w", encoding="utf-8") as handle:
                handle.write("")
        if not os.path.exists(build_log):
            with open(build_log, "w", encoding="utf-8") as handle:
                handle.write("")

        format_result(result, args.OutputJson)

    return exit_code


def add_warning(result: dict, message: str) -> None:
    safe = protect_local_text(message)
    result["warnings"].append(safe)
    emit(f"WARNING: {safe}")


def add_error(result: dict, message: str) -> None:
    safe = protect_local_text(message)
    result["errors"].append(safe)
    emit(f"ERROR {safe}")


def normalize_stdout_lf() -> None:
    """Disable newline translation; emit UTF-8 so redirected output is byte-identical to pwsh."""
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace", newline="", line_buffering=True)
        sys.stderr.reconfigure(encoding="utf-8", errors="replace", newline="", line_buffering=True)
    except (AttributeError, ValueError):
        pass


repo_root = ""
log_dir = ""
edge_stdout_log = ""
edge_stderr_log = ""
events_log = ""
build_log = ""
event_log_path = ""
edge_binary = ""
started_at = 0.0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
