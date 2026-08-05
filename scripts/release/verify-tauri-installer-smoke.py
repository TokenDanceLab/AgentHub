#!/usr/bin/env python3
"""Windows installer smoke preflight — ps1 迁移。

Runs the baseline package readiness policy, then validates the Windows
installer dry preflight inputs: pnpm 10 pinning, Tauri build contract,
sidecar layout, installer asset/output paths, and optional strict toolchain
availability. It does not install dependencies, run the full Tauri bundle
build, Authenticode signing, GitHub Release creation, macOS codesign,
notarization, or stapling.

Exit 0 on pass, exit 1 on the first failed assertion.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))


def step(text: str) -> None:
    print(f"\n>>> {text}", flush=True)


def pass_check(text: str) -> None:
    print(f"PASS: {text}", flush=True)


def fail_check(text: str) -> None:
    print(f"FAIL: {text}", flush=True)
    raise SystemExit(1)


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        fail_check(message)
    pass_check(message)


def assert_path(relative_path: str, label: str) -> None:
    full_path = os.path.join(REPO_ROOT, relative_path.replace("/", os.sep).replace("\\", os.sep))
    assert_true(os.path.exists(full_path), f"{label} exists ({relative_path})")


def assert_git_ignored(relative_path: str, label: str) -> None:
    run = subprocess.run(["git", "-C", REPO_ROOT, "check-ignore", "-q", "--", relative_path])
    if run.returncode != 0:
        fail_check(f"{label} is not ignored by Git: {relative_path}")
    pass_check(f"{label} is ignored by Git ({relative_path})")


def assert_command_available(command: str, label: str) -> None:
    resolved = shutil.which(command)
    assert_true(resolved is not None, f"{label} command is available ({command})")


def read_json(relative_path: str) -> object:
    full_path = os.path.join(REPO_ROOT, relative_path.replace("/", os.sep))
    with open(full_path, encoding="utf-8", errors="replace") as handle:
        return json.loads(handle.read())


def assert_package_script(package: object, name: str, expected_pattern: str) -> None:
    value = str(package["scripts"].get(name) or "")
    assert_true(bool(value.strip()), f"desktop package defines '{name}' script")
    assert_true(re.search(expected_pattern, value, re.IGNORECASE), f"desktop '{name}' script matches installer preflight expectation")


def invoke_package_readiness(repo_root: str) -> None:
    full_path = os.path.join(repo_root, "scripts", "release", "verify-tauri-package-readiness.py")
    run = subprocess.run([sys.executable, full_path, "-RepoRoot", repo_root])
    if run.returncode != 0:
        fail_check("baseline Tauri package readiness policy failed")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("-RepoRoot", "--RepoRoot", default=".", help="repository root")
    parser.add_argument("-StrictToolchain", "--StrictToolchain", action="store_true", help="require git/node/pnpm/go/cargo/rustc availability")
    args = parser.parse_args()

    global REPO_ROOT
    REPO_ROOT = os.path.abspath(args.RepoRoot)

    step("Baseline package readiness policy")
    invoke_package_readiness(REPO_ROOT)

    step("Windows installer dry preflight inputs")
    root_package = read_json("app/package.json")
    desktop_package = read_json("app/desktop/package.json")
    tauri = read_json("app/desktop/src-tauri/tauri.conf.json")

    assert_true(re.search(r"^pnpm@10\.", str(root_package.get("packageManager") or "")), "workspace pins pnpm 10 for release-readiness parity")
    assert_path("app\\pnpm-lock.yaml", "workspace pnpm lockfile")
    assert_path("app\\pnpm-workspace.yaml", "workspace pnpm workspace file")
    assert_package_script(desktop_package, "build", r"vite build")
    assert_package_script(desktop_package, "tauri", r"\btauri\b")
    assert_true(re.search(r"pnpm build", str(tauri["build"].get("beforeBuildCommand") or ""), re.IGNORECASE), "Tauri beforeBuildCommand runs the desktop frontend build")
    assert_true(tauri["build"].get("frontendDist") == "../dist", "Tauri frontendDist points at desktop dist")

    step("Windows sidecar dry preflight")
    assert_path("edge-server\\cmd\\agenthub-edge\\main.go", "Edge sidecar entrypoint")
    assert_true("binaries/agenthub-edge" in tauri["bundle"]["externalBin"], "Tauri externalBin keeps the sidecar basename")
    assert_git_ignored("dist/agenthub-edge-windows-amd64.exe", "Windows sidecar dry intermediate")
    assert_git_ignored("app/desktop/src-tauri/binaries/agenthub-edge-x86_64-pc-windows-msvc.exe", "Windows Tauri sidecar target")

    step("Installer asset and output preflight")
    for icon_path in tauri["bundle"]["icon"]:
        assert_path(os.path.join("app\\desktop\\src-tauri", str(icon_path)).replace("/", "\\"), "Tauri bundle icon asset")
    assert_path("app\\desktop\\src-tauri\\icons\\installer-header.bmp", "NSIS header bitmap")
    assert_path("app\\desktop\\src-tauri\\icons\\installer-sidebar.bmp", "NSIS sidebar bitmap")

    desktop_version = str(desktop_package["version"])
    assert_git_ignored(f"dist/AgentHub_{desktop_version}_x64-setup.exe", "Windows NSIS setup output")
    assert_git_ignored(f"dist/AgentHub_{desktop_version}_x64-portable.zip", "Windows portable zip output")
    assert_git_ignored("dist/AgentHub-portable/AgentHub.exe", "Windows portable staging app")
    assert_git_ignored("dist/AgentHub-portable/agenthub-edge.exe", "Windows portable staging sidecar")
    assert_git_ignored(f"app/desktop/src-tauri/target/release/bundle/nsis/AgentHub_{desktop_version}_x64-setup.exe", "Tauri NSIS target output")

    step("Toolchain availability")
    if args.StrictToolchain:
        for command, label in (
            ("git", "Git"),
            ("node", "Node.js"),
            ("pnpm", "pnpm"),
            ("go", "Go"),
            ("cargo", "Cargo"),
            ("rustc", "Rust compiler"),
        ):
            assert_command_available(command, label)
    else:
        print("SKIP: strict toolchain command checks not requested", flush=True)

    step("Build boundary")
    if os.environ.get("TAURI_SIGNING_PRIVATE_KEY"):
        print("INFO: TAURI_SIGNING_PRIVATE_KEY is present in the environment but is not read by this smoke preflight.", flush=True)
    else:
        print("INFO: TAURI_SIGNING_PRIVATE_KEY is not set and is not required by this smoke preflight.", flush=True)
    print("INFO: Windows sidecar command remains GOOS=windows GOARCH=amd64 go build ./cmd/agenthub-edge/.", flush=True)
    print("INFO: This smoke does not run dependency installation, the full Tauri bundle build, Authenticode signing, GitHub Release creation, macOS codesign, notarization, or stapling.", flush=True)
    print("INFO: macOS compatibility remains a policy note only: future unsigned arm64 dry validation should check agenthub-edge-aarch64-apple-darwin on macos-latest.", flush=True)

    print("\nTauri installer smoke preflight OK", flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr, flush=True)
        sys.exit(1)
