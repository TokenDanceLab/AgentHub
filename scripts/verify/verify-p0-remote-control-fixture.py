#!/usr/bin/env python3
"""AgentHub P0 remote-control fixture readiness gate — ps1 迁移。

This is a FixtureRehearsal-only umbrella gate. It orchestrates existing
offline/source-focused fixture checks and the Edge SDK fixture test. It does
not start real Hub, Desktop, or Edge services; does not run real CLI/model
adapters; does not log in to TokenDanceID; and does not deploy.
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile

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
skipped = 0


def step(text: str) -> None:
    print(f"\n=== {text} ===")


def pass_check(text: str) -> None:
    global passed
    passed += 1
    print(f"  PASS  {text}")


def fail_check(text: str, detail: str = "") -> None:
    global failed
    failed += 1
    print(f"  FAIL  {text}")
    if detail.strip():
        print(f"        {detail}")


def warn_check(text: str, detail: str = "") -> None:
    global warned
    warned += 1
    print(f"  WARN  {text}")
    if detail.strip():
        print(f"        {detail}")


def skip_check(text: str, detail: str = "") -> None:
    global skipped
    skipped += 1
    print(f"  SKIP  {text}")
    if detail.strip():
        print(f"        {detail}")


def find_powershell() -> str | None:
    return shutil.which("pwsh") or shutil.which("powershell")


def invoke_captured_process(file_name: str, arguments: list, working_directory: str) -> tuple:
    """Run a child process, capturing combined output; mirrors the ps1 ProcessStartInfo helper."""
    try:
        run = subprocess.run(
            [file_name, *arguments],
            cwd=working_directory,
            capture_output=True,
            text=True,
        )
        output = (run.stdout + "\n" + run.stderr).replace("\r\n", "\n")
        return run.returncode, output
    except Exception as exc:  # noqa: BLE001 —— 对齐 ps1 try/catch 返回 ExitCode=-1
        return -1, str(exc)


def test_prerequisite_failure(output: str) -> bool:
    return bool(output.strip()) and bool(PREREQUISITE_FAILURE_PATTERN.search(output))


def to_python_style_arguments(arguments: list) -> list:
    """Translate ps1-style -Xxx flags to argparse-style --Xxx for Python sub-gates."""
    return [
        "--" + argument[1:] if argument.startswith("-") and not argument.startswith("--") else argument
        for argument in arguments
    ]


def invoke_required_script_gate(repo_root: str, label: str, relative_path: str, arguments: list) -> None:
    script_path = os.path.join(repo_root, relative_path)
    if not os.path.isfile(script_path):
        fail_check(label, f"missing {relative_path}")
        return

    if relative_path.lower().endswith(".py"):
        exit_code, output = invoke_captured_process(
            sys.executable, [script_path, *to_python_style_arguments(arguments)], repo_root
        )
    else:
        powershell_exe = find_powershell()
        if not powershell_exe:
            skip_check(label, "PowerShell executable is unavailable; gate was not run.")
            return
        exit_code, output = invoke_captured_process(
            powershell_exe, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script_path, *arguments], repo_root
        )
    if exit_code == 0:
        pass_check(label)
        return

    if test_prerequisite_failure(output):
        warn_check(label, output.strip())
        return

    fail_check(label, output.strip())


def invoke_required_native_gate(file_name: str, arguments: list, working_directory: str, label: str) -> None:
    if not os.path.isdir(working_directory):
        fail_check(label, f"missing working directory: {working_directory}")
        return

    resolved = shutil.which(file_name) or file_name
    exit_code, output = invoke_captured_process(resolved, arguments, working_directory)
    if exit_code == 0:
        pass_check(label)
        return

    if test_prerequisite_failure(output):
        warn_check(label, output.strip())
        return

    fail_check(label, output.strip())


def main() -> int:
    global passed, failed, warned, skipped
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--RepoRoot", default=".", help="repository root (defaults to the current directory)")
    parser.add_argument("--Mode", default="FixtureRehearsal", help="execution mode (must stay FixtureRehearsal)")
    parser.add_argument("--Claim", default="FixtureOnly", help="evidence claim (must stay FixtureOnly)")
    args = parser.parse_args()

    repo_root = os.path.abspath(args.RepoRoot)
    passed = 0
    failed = 0
    warned = 0
    skipped = 0

    print("AgentHub P0 remote-control fixture readiness gate")

    step("Fixture boundary")
    if args.Mode != "FixtureRehearsal":
        fail_check("mode is FixtureRehearsal", f"actual={args.Mode}")
    else:
        pass_check("mode is FixtureRehearsal")
    if args.Claim != "FixtureOnly":
        fail_check("claim is FixtureOnly", f"actual={args.Claim}")
    else:
        pass_check("claim is FixtureOnly")

    print("  Boundary: FixtureRehearsal only.")
    print("  Boundary: does not start real Hub, Desktop, or Edge services.")
    print("  Boundary: does not run real CLI/model adapters.")
    print("  Boundary: does not log in to TokenDanceID.")
    print("  Boundary: does not deploy.")

    if failed == 0:
        step("Login fixture topology")
        invoke_required_script_gate(
            repo_root, "verify-login-fixture-topology.py", os.path.join("scripts", "verify", "verify-login-fixture-topology.py"), ["-RepoRoot", repo_root]
        )

        step("Web Hub boundary")
        invoke_required_script_gate(repo_root, "verify-web-hub-boundary.py", os.path.join("scripts", "verify", "verify-web-hub-boundary.py"), [])

        step("Remote-control fixture E2E")
        remote_output_root = tempfile.mkdtemp(prefix="agenthub-p0-remote-control-fixture-")
        invoke_required_script_gate(
            repo_root,
            "verify-remote-control-fixture-e2e.py",
            os.path.join("scripts", "smoke", "verify-remote-control-fixture-e2e.py"),
            ["-OutputRoot", remote_output_root, "-Stamp", "p0-fixture-readiness"],
        )

        step("Remote-control fixture E2E script tests")
        invoke_required_script_gate(
            repo_root, "verify-remote-control-fixture-e2e.py", os.path.join("scripts", "verify", "verify-remote-control-fixture-e2e.py"), ["-RepoRoot", repo_root]
        )

        step("TeamRun demo contract tests")
        invoke_required_script_gate(
            repo_root, "verify-teamrun-demo-contract.py", os.path.join("scripts", "verify", "verify-teamrun-demo-contract.py"), ["-RepoRoot", repo_root]
        )

        step("Edge SDK fixture focused gate")
        invoke_required_native_gate(
            "go",
            ["test", "./internal/adapters", "-run", "SDKFixture", "-short", "-count=1"],
            os.path.join(repo_root, "edge-server"),
            "go test ./internal/adapters -run SDKFixture -short -count=1",
        )
    else:
        skip_check("downstream fixture gates", "Mode/claim boundary failed before running child gates.")

    print("\n========================================")
    print(f"  Passed: {passed}  |  Failed: {failed}  |  Warned: {warned}  |  Skipped: {skipped}")
    print("========================================")

    if failed > 0:
        print("\nP0 remote-control fixture readiness failed. Real services, login, adapter execution, and deployment remain out of scope.\n")
        return 1
    if warned > 0 or skipped > 0:
        print("\nP0 remote-control fixture readiness is incomplete because at least one child gate was WARN/SKIP, not PASS.\n")
        return 2

    print("\nP0 remote-control fixture readiness passed for FixtureRehearsal only.\n")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
