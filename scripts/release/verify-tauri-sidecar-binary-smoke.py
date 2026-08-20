#!/usr/bin/env python3
"""Tauri sidecar binary smoke — ps1 迁移。

Verifies the bundled Windows Local Edge sidecar placement: Tauri externalBin
declaration, target-triple filename, git-ignore policy, non-empty binary, an
optional executable information probe, and the strict package readiness
sidecar gate. It does not start Edge, install dependencies, build the bundle,
sign, or release.

Exit 0 on pass, exit 1 on the first failed assertion.
"""

import argparse
import json
import os
import re
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


def read_json(relative_path: str) -> object:
    full_path = os.path.join(REPO_ROOT, relative_path.replace("/", os.sep))
    with open(full_path, encoding="utf-8", errors="replace") as handle:
        return json.loads(handle.read())


def convert_to_repo_relative(path: str) -> str:
    full = os.path.abspath(path)
    repo_full = os.path.abspath(REPO_ROOT).rstrip("\\/")
    prefix = repo_full + os.sep
    if not full.lower().startswith(prefix.lower()):
        fail_check(f"Path is outside repo worktree: {path}")
    return full[len(prefix):]


def assert_git_ignored(path: str, label: str) -> None:
    relative = convert_to_repo_relative(path)
    run = subprocess.run(["git", "-C", REPO_ROOT, "check-ignore", "-q", "--", relative])
    if run.returncode != 0:
        fail_check(f"{label} is not ignored by Git: {relative}")
    pass_check(f"{label} is ignored by Git ({relative})")


def get_tauri_sidecar_target(target_triple: str) -> dict:
    tauri = read_json("app/desktop/src-tauri/tauri.conf.json")
    external_bins = [str(value) for value in tauri["bundle"]["externalBin"]]
    edge_bin = next((value for value in external_bins if value == "binaries/agenthub-edge"), None)
    if not edge_bin:
        fail_check("Tauri config must declare bundle.externalBin entry binaries/agenthub-edge")

    bin_relative = edge_bin
    bin_dir = os.path.dirname(bin_relative)
    bin_base = os.path.basename(bin_relative)
    target_name = f"{bin_base}-{target_triple}.exe"
    target_path = os.path.join(REPO_ROOT, "app", "desktop", "src-tauri", bin_dir, target_name)

    return {
        "external_bin": bin_relative,
        "base_name": bin_base,
        "target_name": target_name,
        "target_path": target_path,
        "relative_target_path": f"app/desktop/src-tauri/{bin_dir}/{target_name}",
    }


def test_package_readiness_prerequisites() -> bool:
    required = [
        "scripts/release/verify-tauri-package-readiness.py",
        ".github/workflows/release.yml",
        ".github/workflows/release-readiness.yml",
        "app/desktop/package.json",
        "app/desktop/src-tauri/Cargo.toml",
        "app/desktop/src-tauri/Cargo.lock",
        "docs/governance/README.md",
    ]

    for relative in required:
        if not os.path.isfile(os.path.join(REPO_ROOT, relative.replace("/", os.sep))):
            return False

    return True


def invoke_package_readiness_gate() -> None:
    if not test_package_readiness_prerequisites():
        print("INFO: full package readiness prerequisites are absent; direct sidecar gate remains strict.", flush=True)
        return

    step("Strict package readiness sidecar gate")
    full_path = os.path.join(REPO_ROOT, "scripts", "release", "verify-tauri-package-readiness.py")
    run = subprocess.run([sys.executable, full_path, "-RepoRoot", REPO_ROOT, "-RequireBundledSidecar"])
    if run.returncode != 0:
        fail_check("verify-tauri-package-readiness.py -RequireBundledSidecar failed")


def invoke_executable_probe(path: str, skip_probe: bool) -> None:
    if skip_probe:
        pass_check("executable probe skipped by caller")
        return

    step("Sidecar executable information probe")
    run = subprocess.run([path, "--help"], capture_output=True, text=True, encoding="utf-8", errors="replace")
    output = run.stdout + run.stderr
    looks_like_help = re.search(r"Usage of agenthub-edge|agenthub-edge|listen address|runner profile", output, re.IGNORECASE) is not None
    assert_true((run.returncode == 0 or run.returncode == 2) and looks_like_help, "sidecar --help returns executable information without starting Edge")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("-RepoRoot", "--RepoRoot", default=".", help="repository root")
    parser.add_argument("-TargetTriple", "--TargetTriple", default="x86_64-pc-windows-msvc", help="Rust target triple for the sidecar filename")
    parser.add_argument("-SkipExecutableProbe", "--SkipExecutableProbe", action="store_true", help="skip the sidecar --help executable probe")
    args = parser.parse_args()

    global REPO_ROOT
    REPO_ROOT = os.path.abspath(args.RepoRoot)

    target = get_tauri_sidecar_target(args.TargetTriple)

    step("Tauri sidecar binary placement")
    assert_true(target["external_bin"] == "binaries/agenthub-edge", "Tauri config uses the Local Edge sidecar basename binaries/agenthub-edge")
    assert_true(target["target_name"] == "agenthub-edge-x86_64-pc-windows-msvc.exe", "Windows sidecar filename matches Tauri target triple")
    assert_git_ignored(target["target_path"], "Windows bundled Local Edge sidecar")

    if not os.path.isfile(target["target_path"]):
        fail_check(f"Windows bundled Local Edge sidecar blocker: required file is missing ({target['relative_target_path']})")

    assert_true(os.path.getsize(target["target_path"]) > 0, "Windows bundled Local Edge sidecar is non-empty")
    invoke_executable_probe(target["target_path"], args.SkipExecutableProbe)
    invoke_package_readiness_gate()

    print("\nTauri sidecar binary smoke OK", flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr, flush=True)
        sys.exit(1)
