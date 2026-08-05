#!/usr/bin/env python3
"""AgentHub runtime readiness wrapper — ps1 迁移。

This command is kept for compatibility with older local workflows. It now
delegates to the current maintained gates and remains proposal-only: no real
CLI prompt, model/API call, production access, secret read, or package build.
"""

import os
import shutil
import subprocess
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def invoke_gate(name: str, script_path: str, arguments: list) -> None:
    print(f"\n=== {name} ===", flush=True)
    full_path = os.path.join(REPO_ROOT, script_path.replace("/", os.sep))
    if script_path.endswith(".py"):
        command = [sys.executable, full_path, *arguments]
    else:
        powershell_exe = shutil.which("pwsh") or shutil.which("powershell")
        if not powershell_exe:
            raise RuntimeError(f"{name} failed: PowerShell executable not found")
        command = [powershell_exe, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", full_path, *arguments]
    run = subprocess.run(command)
    if run.returncode != 0:
        raise RuntimeError(f"{name} failed with exit code {run.returncode}")


def main() -> int:
    print("AgentHub runtime readiness wrapper", flush=True)
    print("Evidence level: proposal-only / structural", flush=True)
    print("No real CLI prompt, model/API call, production access, secret read, or package build is executed.", flush=True)

    invoke_gate("Doc SSOT", "scripts/verify/verify-doc-ssot.py", [])
    invoke_gate("Web Hub-only boundary", "scripts/verify/verify-web-hub-boundary.py", [])
    invoke_gate("Edge CLI real-readiness proposal", "scripts/verify/verify-edge-cli-real-readiness.ps1", ["-Mode", "ProposalOnly"])

    print("\nruntime readiness wrapper ok", flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
