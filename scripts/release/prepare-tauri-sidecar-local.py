#!/usr/bin/env python3
"""prepare-tauri-sidecar-local — 本地准备 Tauri Windows Local Edge sidecar（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

按 tauri.conf.json 的 bundle.externalBin 计算 Windows target triple 路径，
校验产物 gitignore，需要时用 GOOS=windows GOARCH=amd64 CGO_ENABLED=0 交叉编译
edge-server 并拷贝到 Tauri external bin 位置。

契约：stdlib only；参数名/退出码与 ps1 一致（0=通过/1=失败）；机器可读行
（`PASS: `/`FAIL: `、`>>> `）与原 ps1 一致；`-DryRun` 只做 placement plan 与
gitignore 校验不构建。失败即 exit 1（对齐 ps1 Fail 语义）。
"""

import argparse
import json
import os
import shutil
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))

EXPECTED_WINDOWS_SIDECAR_NAME = "agenthub-edge-x86_64-pc-windows-msvc.exe"


def step(message: str) -> None:
    print(f"\n>>> {message}")


def pass_check(message: str) -> None:
    print(f"PASS: {message}")


def fail_check(message: str) -> int:
    print(f"FAIL: {message}")
    return 1


def read_json(repo_root: str, relative_path: str) -> dict:
    with open(os.path.join(repo_root, relative_path), encoding="utf-8-sig") as handle:
        return json.load(handle)


def convert_to_repo_relative_path(path: str, repo_root: str) -> str:
    full = os.path.abspath(path)
    repo_full = os.path.abspath(repo_root).rstrip("\\/")
    prefix = repo_full + os.sep
    if not full.lower().startswith(prefix.lower()):
        raise RuntimeError(f"Path is outside repo worktree: {path}")
    return full[len(prefix):]


def assert_git_ignored(repo_root: str, path: str, label: str) -> int:
    try:
        relative = convert_to_repo_relative_path(path, repo_root)
    except RuntimeError as exc:
        return fail_check(str(exc))
    run = subprocess.run(["git", "-C", repo_root, "check-ignore", "-q", "--", relative], capture_output=True, text=True)
    if run.returncode != 0:
        return fail_check(f"{label} is not ignored by Git: {relative}")
    pass_check(f"{label} is ignored by Git ({relative})")
    return 0


def get_tauri_sidecar_target(repo_root: str, target_triple: str) -> dict:
    tauri = read_json(repo_root, os.path.join("app", "desktop", "src-tauri", "tauri.conf.json"))
    external_bins = tauri.get("bundle", {}).get("externalBin") or []
    edge_bin = next((entry for entry in external_bins if str(entry) == "binaries/agenthub-edge"), None)
    if not edge_bin:
        raise RuntimeError("Tauri config must declare bundle.externalBin entry binaries/agenthub-edge")

    bin_relative = str(edge_bin)
    bin_dir = os.path.dirname(bin_relative)
    bin_base = os.path.basename(bin_relative)
    target_name = f"{bin_base}-{target_triple}.exe"
    if target_triple == "x86_64-pc-windows-msvc" and target_name != EXPECTED_WINDOWS_SIDECAR_NAME:
        raise RuntimeError(f"Unexpected Windows sidecar name: {target_name}")
    target_dir = os.path.join(repo_root, "app", "desktop", "src-tauri", bin_dir)
    target_path = os.path.join(target_dir, target_name)

    return {
        "ExternalBin": bin_relative,
        "BaseName": bin_base,
        "TargetName": target_name,
        "TargetDir": target_dir,
        "TargetPath": target_path,
        "RelativeTargetPath": f"app/desktop/src-tauri/{bin_dir}/{target_name}",
    }


def invoke_checked_build(repo_root: str, output_path: str) -> int:
    step("Build Windows Local Edge sidecar")
    old_env = {
        "GOOS": os.environ.get("GOOS"),
        "GOARCH": os.environ.get("GOARCH"),
        "CGO_ENABLED": os.environ.get("CGO_ENABLED"),
    }
    os.environ["GOOS"] = "windows"
    os.environ["GOARCH"] = "amd64"
    os.environ["CGO_ENABLED"] = "0"
    try:
        run = subprocess.run(
            ["go", "build", "-ldflags=-s -w", "-o", output_path, ".\\cmd\\agenthub-edge\\"],
            cwd=os.path.join(repo_root, "edge-server"),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        exit_code = run.returncode
    finally:
        for key, value in old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
    if exit_code != 0:
        return fail_check(f"go build for Windows Local Edge sidecar failed with exit code {exit_code}")
    pass_check("Windows Local Edge sidecar build completed")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--RepoRoot", "-RepoRoot", default=".")
    parser.add_argument("--SourceBinary", "-SourceBinary", default="")
    parser.add_argument("--TargetTriple", "-TargetTriple", default="x86_64-pc-windows-msvc")
    parser.add_argument("--NoBuild", "-NoBuild", action="store_true")
    parser.add_argument("--DryRun", "-DryRun", action="store_true")
    args = parser.parse_args()

    repo_root = os.path.realpath(args.RepoRoot)

    target = get_tauri_sidecar_target(repo_root, args.TargetTriple)
    default_source = os.path.join(repo_root, "dist", "agenthub-edge-windows-amd64.exe")
    if not args.SourceBinary.strip():
        source_path = default_source
    elif os.path.isabs(args.SourceBinary):
        source_path = args.SourceBinary
    else:
        source_path = os.path.join(repo_root, args.SourceBinary)
    source_path = os.path.abspath(source_path)

    step("Tauri sidecar placement plan")
    print(f"externalBin: {target['ExternalBin']}")
    print(f"source:      {source_path}")
    print(f"target:      {target['TargetPath']}")
    print(f"target name: {target['TargetName']}")

    result = assert_git_ignored(repo_root, target["TargetPath"], "Tauri Windows sidecar binary")
    if result != 0:
        return result
    result = assert_git_ignored(repo_root, source_path, "Windows sidecar intermediate")
    if result != 0:
        return result

    if args.DryRun:
        print("\nTauri sidecar local prepare dry-run OK")
        return 0

    if not args.NoBuild:
        os.makedirs(os.path.dirname(source_path), exist_ok=True)
        result = invoke_checked_build(repo_root, source_path)
        if result != 0:
            return result
    else:
        if not os.path.isfile(source_path):
            return fail_check("NoBuild source sidecar exists")

    if os.path.getsize(source_path) <= 0:
        return fail_check("Windows sidecar source is non-empty")

    step("Place Tauri external sidecar")
    os.makedirs(target["TargetDir"], exist_ok=True)
    shutil.copy2(source_path, target["TargetPath"])
    if not os.path.isfile(target["TargetPath"]):
        return fail_check("Tauri external sidecar exists at Windows target triple path")
    if os.path.getsize(target["TargetPath"]) <= 0:
        return fail_check("Tauri external sidecar is non-empty")

    print("\nTauri sidecar local prepare OK")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'，禁止静默吞错
        print(f"FAIL: {exc}")
        sys.exit(1)
