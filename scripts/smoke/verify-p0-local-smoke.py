#!/usr/bin/env python3
"""verify-p0-local-smoke — AgentHub P0 localhost smoke harness.

ps1 迁移（契约见 server docs/design/ps1-to-python-migration.md）：stdlib only、
CLI 参数/退出码兼容（0=通过/1=失败/2=WARN 或 RunLocalhost 阻塞）、机器可读行
（`  PASS  ` / `  FAIL  ` / `  WARN  ` / `  BLOCKED  ` / `  SKIP  ` 与 evidence
matrix JSON）与原 ps1 一致。

默认 Plan 模式（dry-run）：运行可重复的 FixtureOnly/LocalOnly 检查、把
localhost 服务探测记录为 blocked、写出 evidence matrix。PASS 输出绝不意味着
RealTested。`--RunLocalhost` 仅在本地 Hub/Web/Desktop/Edge fixture 服务已启动
时使用；localhost 探测要求每个 fixture 服务的 /health 返回 JSON 身份标记，
纯 TCP 可达不算证据。

本脚本不启动真实 TokenDanceID、不运行真实 CLI/model 适配器、不部署公网、
不签名包、不上传发布、不碰 Mobile。
"""

import argparse
import datetime
import json
import locale
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

OUTPUT_ENCODING = locale.getpreferredencoding(False) or "utf-8"

PREREQUISITE_FAILURE_PATTERN = re.compile(
    "not recognized as the name|"
    "executable file not found|"
    "No such file or directory|"
    "Cannot find path|"
    "command not found|"
    "missing required environment|"
    "prerequisite",
    re.IGNORECASE,
)

passed = 0
failed = 0
warned = 0
blocked = 0
skipped = 0
evidence_rows = []


def normalize_stdout_lf() -> None:
    """Disable newline translation so redirected output is byte-identical to pwsh.

    pwsh captures/emits child output in the console locale encoding (GBK on
    zh-CN systems) with `\r\n` terminators; mirror that here.
    """
    try:
        sys.stdout.reconfigure(encoding=OUTPUT_ENCODING, errors="replace", newline="", line_buffering=True)
        sys.stderr.reconfigure(encoding=OUTPUT_ENCODING, errors="replace", newline="", line_buffering=True)
    except (AttributeError, ValueError):
        pass


def emit(text: str) -> None:
    sys.stdout.write(text + "\r\n")
    sys.stdout.flush()


def step(text: str) -> None:
    emit(f"\n=== {text} ===")


def add_evidence_row(claim: str, check: str, status: str, evidence: str) -> None:
    evidence_rows.append(
        {
            "claim": claim,
            "check": check,
            "status": status,
            "real_tested": False,
            "evidence": evidence,
        }
    )


def pass_check(text: str, claim: str = "LocalOnly", evidence: str = "") -> None:
    global passed
    passed += 1
    emit(f"  PASS  {text}")
    add_evidence_row(claim, text, "PASS", evidence)


def fail_check(text: str, detail: str = "", claim: str = "LocalOnly") -> None:
    global failed
    failed += 1
    emit(f"  FAIL  {text}")
    if detail.strip():
        emit(f"        {detail}")
    add_evidence_row(claim, text, "FAIL", detail)


def warn_check(text: str, detail: str = "", claim: str = "LocalOnly") -> None:
    global warned
    warned += 1
    emit(f"  WARN  {text}")
    if detail.strip():
        emit(f"        {detail}")
    add_evidence_row(claim, text, "WARN", detail)


def block_check(text: str, detail: str = "", claim: str = "LocalhostSmoke") -> None:
    global blocked
    blocked += 1
    emit(f"  BLOCKED  {text}")
    if detail.strip():
        emit(f"           {detail}")
    add_evidence_row(claim, text, "BLOCKED", detail)


def skip_check(text: str, detail: str = "", claim: str = "RealApprovalRequired") -> None:
    global skipped
    skipped += 1
    emit(f"  SKIP  {text}")
    if detail.strip():
        emit(f"        {detail}")
    add_evidence_row(claim, text, "SKIP", detail)


def find_powershell() -> str | None:
    return shutil.which("pwsh") or shutil.which("powershell")


def invoke_captured_process(file_name: str, arguments: list, working_directory: str) -> tuple:
    """Run a child process, capturing combined output; mirrors the ps1 ProcessStartInfo helper.

    Bytes are decoded without newline translation so embedded child output keeps
    its original CRLF, matching the ps1 ReadToEnd() + Trim() behavior.
    """
    try:
        run = subprocess.run([file_name, *arguments], cwd=working_directory, capture_output=True)
        output = (run.stdout + b"\n" + run.stderr).decode(OUTPUT_ENCODING, errors="replace")
        return run.returncode, output
    except Exception as exc:  # noqa: BLE001 —— 对齐 ps1 try/catch 返回 ExitCode=-1
        return -1, str(exc)


def test_prerequisite_failure(output: str) -> bool:
    if not output.strip():
        return False
    return bool(PREREQUISITE_FAILURE_PATTERN.search(output))


def invoke_required_script_gate(repo_root: str, label: str, relative_path: str, arguments: list, claim: str) -> None:
    script_path = os.path.join(repo_root, relative_path)
    if not os.path.isfile(script_path):
        fail_check(label, f"missing {relative_path}", claim)
        return

    if relative_path.endswith(".py"):
        python_exe = shutil.which("python") or shutil.which("py")
        if not python_exe:
            block_check(label, "Python executable is unavailable; gate was not run.", claim)
            return
        exit_code, output = invoke_captured_process(python_exe, [script_path, *arguments], repo_root)
    else:
        powershell_exe = find_powershell()
        if not powershell_exe:
            block_check(label, "PowerShell executable is unavailable; gate was not run.", claim)
            return
        exit_code, output = invoke_captured_process(
            powershell_exe, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script_path, *arguments], repo_root
        )

    if exit_code == 0:
        pass_check(label, claim, "exit=0")
        return

    if test_prerequisite_failure(output):
        warn_check(label, output.strip(), claim)
        return

    fail_check(label, output.strip(), claim)


def invoke_required_native_gate(file_name: str, arguments: list, working_directory: str, label: str, claim: str) -> None:
    if not os.path.isdir(working_directory):
        fail_check(label, f"missing working directory: {working_directory}", claim)
        return

    resolved = shutil.which(file_name) or file_name
    exit_code, output = invoke_captured_process(resolved, arguments, working_directory)
    if exit_code == 0:
        pass_check(label, claim, "exit=0")
        return

    if test_prerequisite_failure(output):
        warn_check(label, output.strip(), claim)
        return

    fail_check(label, output.strip(), claim)


EXPECTED_HEALTH_MARKERS = {
    "hub": {"service": "hub", "identity": "agenthub-hub-localhost-fixture", "upstream": "registered-desktop-target-router"},
    "web": {"service": "web", "identity": "agenthub-web-localhost-fixture", "upstream": "hub-only"},
    "desktop": {"service": "desktop", "identity": "agenthub-desktop-bridge-localhost-fixture", "bridge": "tauri-sidecar-fixture"},
    "local-edge": {"service": "local-edge", "identity": "agenthub-local-edge-localhost-fixture", "adapter": "fixture-sdk", "runner": "fixture-local-edge-runner"},
}


def invoke_health_probe(url: str, timeout: int) -> dict:
    try:
        with urllib.request.urlopen(url, timeout=timeout / 1000.0) as response:
            body = response.read().decode("utf-8", errors="replace")
            if response.status != 200:
                return {"Ok": False, "Detail": f"GET {url} returned HTTP {response.status}: {body}", "Health": None}
            try:
                health = json.loads(body)
            except json.JSONDecodeError:
                health = None
            return {"Ok": True, "Detail": body, "Health": health}
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read().decode("utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            body = ""
        return {"Ok": False, "Detail": f"GET {url} returned HTTP {exc.code}: {body}", "Health": None}
    except Exception as exc:  # noqa: BLE001 —— 对齐 ps1 catch 语义
        return {"Ok": False, "Detail": f"GET {url} failed: {exc}", "Health": None}


def test_localhost_service(label: str, port: int, service: str, run_localhost: bool, timeout_ms: int) -> None:
    if not run_localhost:
        block_check(
            label,
            f"Plan mode only. Start/check localhost fixture services separately, then rerun with -RunLocalhost. Expected 127.0.0.1:{port}.",
        )
        return

    expected = EXPECTED_HEALTH_MARKERS.get(service)
    if not expected:
        fail_check(label, f"missing expected health marker definition for service {service}")
        return

    url = f"http://127.0.0.1:{port}/health"
    probe = invoke_health_probe(url, timeout_ms)
    if not probe["Ok"]:
        block_check(label, f"{probe['Detail']}. Start the local fixture service or keep this as a blocked smoke check.")
        return

    for key, expected_value in expected.items():
        actual = str(probe["Health"].get(key)) if probe["Health"] else ""
        if actual != str(expected_value):
            block_check(
                label,
                f"missing identity marker for {service}.{key}. Expected '{expected_value}', got '{actual}'. Raw health: {probe['Detail']}",
            )
            return

    detail = f"GET {url} returned expected {service} identity marker. RealTested=false"
    pass_check(f"{label} health identity marker", "LocalhostSmoke", detail)
    emit(f"        {detail}")


def write_evidence_matrix(evidence_path: str, mode: str, repo_root: str, ports: dict) -> None:
    matrix = {
        "schema": "agenthub-p0-local-smoke-evidence-v1",
        "mode": mode,
        "real_tested": False,
        "repo_root": repo_root,
        "generated_at": datetime.datetime.now().astimezone().isoformat(),
        "claims": {
            "FixtureOnly": "offline fixture/source gates only",
            "LocalOnly": "local fake/static or httptest gates only",
            "LocalhostSmoke": "localhost service probes only; fake/local session and fixture adapter required",
            "RealApprovalRequired": "not run without explicit approval",
        },
        "ports": ports,
        "rows": evidence_rows,
    }

    parent = os.path.dirname(evidence_path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(evidence_path, "w", encoding="utf-8") as handle:
        json.dump(matrix, handle, ensure_ascii=False, indent=2)

    step("Evidence matrix")
    emit(f"  EvidencePath: {evidence_path}")
    emit("  RealTested=false")
    emit(f"  Rows: {len(evidence_rows)}")


def main() -> int:
    global passed, failed, warned, blocked, skipped
    normalize_stdout_lf()
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--RepoRoot", default=".", help="repository root (defaults to the current directory)")
    parser.add_argument("--RunLocalhost", action="store_true", help="probe localhost fixture services (they must already be running)")
    parser.add_argument("--EvidencePath", default="", help="evidence matrix JSON output path")
    parser.add_argument("--HubPort", type=int, default=8080, help="Hub Server port")
    parser.add_argument("--WebPort", type=int, default=5174, help="Web frontend port")
    parser.add_argument("--DesktopPort", type=int, default=5173, help="Desktop bridge port")
    parser.add_argument("--EdgePort", type=int, default=3210, help="Local Edge port")
    parser.add_argument("--TimeoutMs", type=int, default=500, help="localhost probe timeout in milliseconds")
    args = parser.parse_args()

    repo_root = os.path.abspath(args.RepoRoot)
    mode = "RunLocalhost" if args.RunLocalhost else "Plan"
    evidence_path = args.EvidencePath
    if not evidence_path.strip():
        evidence_path = os.path.join(tempfile.gettempdir(), f"agenthub-p0-local-smoke-{os.getpid()}.json")

    passed = 0
    failed = 0
    warned = 0
    blocked = 0
    skipped = 0
    evidence_rows.clear()

    emit("AgentHub P0 localhost smoke harness")
    emit(f"Mode: {mode}")

    step("Smoke boundary")
    emit("  FixtureOnly: fixture evidence and static/source gates only")
    emit("  LocalOnly: local fake/static or httptest gates only")
    emit("  LocalhostSmoke: localhost probes only; fake/local session and fixture adapter required")
    emit("  RealApprovalRequired: real TokenDanceID login was not run")
    emit("  RealApprovalRequired: real CLI/model adapter execution was not run")
    emit("  RealApprovalRequired: public deploy/signing/release upload was not run")
    emit("  Boundary: Mobile is out of scope for this smoke gate.")
    emit("  RealTested=false")
    pass_check("smoke claim labels are explicit", "LocalOnly", "Dry-run/plan output cannot claim real execution.")

    step("FixtureOnly gates")
    invoke_required_script_gate(
        repo_root,
        "verify-p0-remote-control-fixture.py",
        os.path.join("scripts", "verify", "verify-p0-remote-control-fixture.py"),
        ["--RepoRoot", repo_root],
        "FixtureOnly",
    )

    step("LocalOnly gates")
    invoke_required_script_gate(
        repo_root,
        "verify-oidc-flow.ps1 -LocalOnly -SkipTD",
        os.path.join("scripts", "verify", "verify-oidc-flow.ps1"),
        ["-LocalOnly", "-SkipTD", "-RepoRoot", repo_root],
        "LocalOnly",
    )

    hub_root = os.path.join(repo_root, "hub-server")
    edge_root = os.path.join(repo_root, "edge-server")

    invoke_required_native_gate(
        "go",
        ["test", "./tests/oidc", "-run", "TestOIDCSmoke", "-short", "-count=1"],
        hub_root,
        "go test ./tests/oidc -run TestOIDCSmoke -short -count=1",
        "LocalOnly",
    )
    emit("        Hub OIDC mock smoke")

    invoke_required_native_gate(
        "go",
        ["test", "./internal/service", "-run", "TestExecutionTargetPingRequiresLiveProofForRemoteTargets", "-short", "-count=1"],
        hub_root,
        "go test ./internal/service -run TestExecutionTargetPingRequiresLiveProofForRemoteTargets -short -count=1",
        "LocalOnly",
    )
    emit("        Hub remote target live-proof boundary")

    invoke_required_native_gate(
        "go",
        ["test", "./internal/adapters", "-run", "SDKFixture", "-short", "-count=1"],
        edge_root,
        "go test ./internal/adapters -run SDKFixture -short -count=1",
        "LocalOnly",
    )
    emit("        Edge fixture adapter boundary")

    invoke_required_native_gate(
        "go",
        ["test", "./internal/security", "./internal/httpserver", "-run", "RemoteMode", "-short", "-count=1"],
        edge_root,
        "go test ./internal/security ./internal/httpserver -run RemoteMode -short -count=1",
        "LocalOnly",
    )
    emit("        Edge remote origin boundary")

    step("Localhost service probes")
    test_localhost_service("localhost Hub service probe", args.HubPort, "hub", args.RunLocalhost, args.TimeoutMs)
    test_localhost_service("localhost Web service probe", args.WebPort, "web", args.RunLocalhost, args.TimeoutMs)
    test_localhost_service("localhost Desktop service probe", args.DesktopPort, "desktop", args.RunLocalhost, args.TimeoutMs)
    test_localhost_service("localhost Local Edge service probe", args.EdgePort, "local-edge", args.RunLocalhost, args.TimeoutMs)
    block_check(
        "localhost fake/local session chain proof",
        "Requires pre-started Hub/Web/Desktop/Local Edge fixture services plus a fake/local session path and fixture adapter run evidence; this script only records the blocked check until those services are available.",
    )

    step("RealApprovalRequired gates")
    skip_check(
        "real TokenDanceID browser login",
        "Requires approved OAuth client, disposable/test account, live Hub environment, browser evidence boundary, and no token disclosure.",
    )
    skip_check(
        "real CLI/model adapter execution",
        "Requires runtime choice, budget approval, redaction policy, and artifact upload policy.",
    )
    skip_check(
        "public deploy/signing/release upload",
        "Requires target environment, signing/notarization/release approval, and no-secret deploy logs.",
    )

    write_evidence_matrix(
        evidence_path,
        mode,
        repo_root,
        {"hub": args.HubPort, "web": args.WebPort, "desktop": args.DesktopPort, "edge": args.EdgePort},
    )

    emit("\n========================================")
    emit(f"  Passed: {passed}  |  Failed: {failed}  |  Warned: {warned}  |  Blocked: {blocked}  |  Skipped: {skipped}")
    emit("========================================")

    if failed > 0:
        emit("\nP0 localhost smoke harness failed. RealApprovalRequired gates were not run.\n")
        return 1
    if warned > 0:
        emit("\nP0 localhost smoke harness is incomplete because at least one fixture/local gate was WARN, not PASS.\n")
        return 2
    if args.RunLocalhost and blocked > 0:
        emit(
            "\nP0 localhost smoke harness is blocked because one or more localhost service checks are unavailable. RealTested=false.\n"
        )
        return 2

    emit(
        f"\nP0 localhost smoke harness completed in {mode} mode. FixtureOnly/LocalOnly gates ran; localhost chain checks are blocked unless -RunLocalhost services are available. RealTested=false.\n"
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
