#!/usr/bin/env python3
"""Windows unsigned/dev Tauri package dry gate — ps1 迁移。

Builds and verifies the unsigned Windows Tauri package reproducibility path:
static readiness gates, the Windows Local Edge sidecar, an optional dev
executable compile, and an optional unsigned NSIS/portable bundle. Writes
package-dry-report.json and artifact-manifest.json into the artifact root.
It never signs, notarizes, staples, uploads, or creates a GitHub Release.

Exit 0 on pass, exit 1 on the first failed step.
"""

import argparse
import hashlib
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


def read_text(relative_path: str) -> str:
    full_path = os.path.join(REPO_ROOT, relative_path.replace("/", os.sep))
    with open(full_path, encoding="utf-8", errors="replace") as handle:
        return handle.read()


def read_json(relative_path: str) -> object:
    return json.loads(read_text(relative_path))


def invoke_checked(label: str, working_directory: str, command: list, environment: dict) -> None:
    step(label)
    env = os.environ.copy()
    env.update({key: str(value) for key, value in environment.items()})
    run = subprocess.run(command, cwd=working_directory, env=env)
    if run.returncode != 0:
        fail_check(f"{label} failed with exit code {run.returncode}")
    pass_check(f"{label} completed")


def assert_under_repo(path_value: str, label: str) -> str:
    full = os.path.abspath(path_value).rstrip("\\/")
    repo_full = os.path.abspath(REPO_ROOT).rstrip("\\/")
    repo_child_prefix = repo_full + os.sep
    assert_true(full.lower().startswith(repo_child_prefix.lower()), f"{label} stays inside repo worktree")
    return full


def reset_artifact_root(artifacts_root: str) -> str:
    full = assert_under_repo(artifacts_root, "dry artifact root")
    if os.path.isdir(full):
        shutil.rmtree(full)
    os.makedirs(full, exist_ok=True)
    return full


def add_artifact_manifest(root: str) -> None:
    entries = []
    for name in sorted(os.listdir(root)):
        full_path = os.path.join(root, name)
        if not os.path.isfile(full_path):
            continue
        digest = hashlib.sha256()
        with open(full_path, "rb") as handle:
            for chunk in iter(lambda: handle.read(65536), b""):
                digest.update(chunk)
        entries.append({"name": name, "bytes": os.path.getsize(full_path), "sha256": digest.hexdigest().upper()})

    manifest_path = os.path.join(root, "artifact-manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as handle:
        json.dump(entries, handle, indent=2, ensure_ascii=False)


def assert_sidecar_sqlite_policy() -> None:
    step("Packaged Local Edge SQLite app-data policy")
    edge_manager = read_text("app/desktop/src-tauri/src/edge_manager.rs")
    host_edge = read_text("app/desktop/src-tauri/src/host/edge.rs")
    lib = read_text("app/desktop/src-tauri/src/lib.rs")
    use_health = read_text("app/desktop/src/hooks/useHealth.ts")
    desktop_platform_test = read_text("app/desktop/src/platform/desktopPlatform.test.ts")

    assert_true(re.search(r'EDGE_STORE_DB_FILE_NAME:\s*&str\s*=\s*"agenthub-edge\.sqlite"', edge_manager, re.IGNORECASE), "Edge manager pins the SQLite db filename")
    assert_true(re.search(r"<app-data>/agenthub-edge\.sqlite", edge_manager, re.IGNORECASE), "Readiness exposes only the app-data SQLite placeholder")
    assert_true(
        re.search(r"--store-backend", edge_manager, re.IGNORECASE)
        and re.search(r'"sqlite"', edge_manager, re.IGNORECASE)
        and re.search(r"--store-db", edge_manager, re.IGNORECASE),
        "Sidecar launch args use explicit sqlite store backend and db path",
    )
    assert_true(
        re.search(r"app_data_dir\(\)", edge_manager, re.IGNORECASE) and re.search(r"edge_store_db_path", edge_manager, re.IGNORECASE),
        "Packaged sidecar resolves store db under Tauri app data",
    )
    assert_true(
        re.search(r"new_unavailable", edge_manager, re.IGNORECASE) and re.search(r"Local Edge startup is blocked", lib, re.IGNORECASE),
        "Token generation failure keeps Local Edge fail-closed",
    )
    assert_true(
        re.search(r"local-edge\.stdout\.log", edge_manager, re.IGNORECASE) and re.search(r"local-edge\.stderr\.log", edge_manager, re.IGNORECASE),
        "Local Edge stdout/stderr log paths are exposed for diagnostics",
    )
    assert_true(
        re.search(r"edge_health_url", edge_manager, re.IGNORECASE) and re.search(r"/v1/health", edge_manager, re.IGNORECASE),
        "Local Edge health URL is included in readiness/status",
    )
    assert_true(
        re.search(r"get_edge_host_readiness", lib, re.IGNORECASE)
        and re.search(r"host_readiness_for_app", host_edge, re.IGNORECASE)
        and re.search(r"local_auth_token\(\)\.map", host_edge, re.IGNORECASE),
        "Tauri host commands expose readiness and fail closed on missing Edge auth token",
    )
    assert_true(
        re.search(r"lastError", use_health, re.IGNORECASE) and re.search(r"Local Edge health check failed", use_health, re.IGNORECASE),
        "Desktop health hook preserves the last Local Edge health error",
    )
    assert_true(
        re.search(r"direct_cli_spawn:\s*false", desktop_platform_test, re.IGNORECASE)
        and re.search(r"<app-data>/agenthub-edge\.sqlite", desktop_platform_test, re.IGNORECASE)
        and re.search(r"local-edge\.stderr\.log", desktop_platform_test, re.IGNORECASE),
        "Desktop platform test preserves no direct CLI spawn, app-data SQLite policy, and log diagnostics",
    )


def invoke_python_script(relative_path: str, arguments: list) -> None:
    full_path = os.path.join(REPO_ROOT, relative_path.replace("/", os.sep))
    run = subprocess.run([sys.executable, full_path, *arguments])
    if run.returncode != 0:
        fail_check(f"{relative_path} failed with exit code {run.returncode}")


def invoke_prepare_sidecar(arguments: list) -> None:
    python_exe = shutil.which("python") or shutil.which("python3")
    if not python_exe:
        fail_check("Python executable not found for prepare-tauri-sidecar-local.py")
    full_path = os.path.join(REPO_ROOT, "scripts", "release", "prepare-tauri-sidecar-local.py")
    run = subprocess.run([python_exe, full_path, *arguments])
    if run.returncode != 0:
        fail_check(f"prepare-tauri-sidecar-local.py failed with exit code {run.returncode}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("-RepoRoot", "--RepoRoot", default=".", help="repository root")
    parser.add_argument("-ArtifactsRoot", "--ArtifactsRoot", default=".tmp/tauri-package-dry", help="dry artifact output root")
    parser.add_argument("-SkipInstall", "--SkipInstall", action="store_true", help="skip pnpm install from lockfile")
    parser.add_argument("-SkipExecutableCompile", "--SkipExecutableCompile", action="store_true", help="skip the dev executable compile")
    parser.add_argument("-RunWindowsBundle", "--RunWindowsBundle", action="store_true", help="build the unsigned Windows NSIS/portable bundle")
    parser.add_argument("-RequireUpdaterMetadata", "--RequireUpdaterMetadata", action="store_true", help="fail when latest.json/.sig were not produced")
    parser.add_argument("-StrictToolchain", "--StrictToolchain", action="store_true", help="require the full toolchain in the installer smoke preflight")
    args = parser.parse_args()

    global REPO_ROOT
    REPO_ROOT = os.path.abspath(args.RepoRoot)

    artifacts_root = os.path.abspath(args.ArtifactsRoot) if os.path.isabs(args.ArtifactsRoot) else os.path.join(REPO_ROOT, args.ArtifactsRoot)
    artifact_root = reset_artifact_root(artifacts_root)
    desktop_package = read_json("app/desktop/package.json")
    desktop_version = str(desktop_package["version"])
    report = {
        "mode": "windows-desktop-package-dry",
        "version": desktop_version,
        "repoRoot": REPO_ROOT,
        "artifactRoot": artifact_root,
        "signing": "out-of-scope",
        "notarization": "out-of-scope",
        "stapling": "out-of-scope",
        "releaseUpload": "out-of-scope",
        "realTokenDanceId": "out-of-scope",
        "realCliOrModelExecution": "out-of-scope",
        "stages": {},
    }

    step("Static package readiness gates")
    invoke_python_script("scripts/release/verify-tauri-package-readiness.py", ["-RepoRoot", REPO_ROOT])
    report["stages"]["staticReadiness"] = "passed"

    invoke_python_script(
        "scripts/release/verify-tauri-installer-smoke.py",
        ["-RepoRoot", REPO_ROOT, "-StrictToolchain"] if args.StrictToolchain else ["-RepoRoot", REPO_ROOT],
    )
    report["stages"]["installerSmoke"] = "passed"

    assert_sidecar_sqlite_policy()
    report["stages"]["sqliteAppDataPolicy"] = "passed"

    if not args.SkipInstall:
        invoke_checked(
            "Install app dependencies from lockfile",
            os.path.join(REPO_ROOT, "app"),
            [shutil.which("corepack") or "corepack", "pnpm", "install", "--frozen-lockfile"],
            {"CI": "true"},
        )
        report["stages"]["dependencyInstall"] = "passed"
    else:
        report["stages"]["dependencyInstall"] = "skipped"

    invoke_checked(
        "Build Windows Local Edge sidecar",
        os.path.join(REPO_ROOT, "edge-server"),
        ["go", "build", "-ldflags=-s -w", "-o", os.path.join("..", "dist", "agenthub-edge-windows-amd64.exe"), os.path.join(".", "cmd", "agenthub-edge")],
        {"GOOS": "windows", "GOARCH": "amd64", "CGO_ENABLED": "0"},
    )
    sidecar_intermediate = os.path.join(REPO_ROOT, "dist", "agenthub-edge-windows-amd64.exe")
    assert_true(os.path.isfile(sidecar_intermediate), "Windows Local Edge sidecar intermediate exists")
    sidecar_artifact = os.path.join(artifact_root, "agenthub-edge-windows-amd64.exe")
    if os.path.abspath(sidecar_intermediate).lower() != os.path.abspath(sidecar_artifact).lower():
        shutil.copyfile(sidecar_intermediate, sidecar_artifact)

    step("Prepare Tauri external sidecar")
    invoke_prepare_sidecar(["-RepoRoot", REPO_ROOT, "-SourceBinary", sidecar_intermediate, "-NoBuild"])
    tauri_sidecar = os.path.join(REPO_ROOT, "app", "desktop", "src-tauri", "binaries", "agenthub-edge-x86_64-pc-windows-msvc.exe")
    assert_true(os.path.isfile(tauri_sidecar), "Tauri external sidecar exists at Windows target triple path")
    report["stages"]["sidecar"] = "passed"

    if not args.SkipExecutableCompile:
        invoke_checked(
            "Build Tauri executable without bundling",
            os.path.join(REPO_ROOT, "app", "desktop"),
            [shutil.which("corepack") or "corepack", "pnpm", "tauri", "build", "--no-bundle"],
            {"CI": "true"},
        )
        desktop_exe = os.path.join(REPO_ROOT, "app", "desktop", "src-tauri", "target", "release", "agenthub-desktop.exe")
        assert_true(os.path.isfile(desktop_exe), "Tauri executable compile artifact exists")
        shutil.copyfile(desktop_exe, os.path.join(artifact_root, "agenthub-desktop.exe"))
        report["stages"]["executableCompile"] = "passed"
    else:
        report["stages"]["executableCompile"] = "skipped"

    if args.RunWindowsBundle:
        invoke_checked(
            "Build unsigned Tauri Windows NSIS package",
            os.path.join(REPO_ROOT, "app", "desktop"),
            [shutil.which("corepack") or "corepack", "pnpm", "tauri", "build", "--no-sign"],
            {"CI": "true"},
        )

        nsis_dir = os.path.join(REPO_ROOT, "app", "desktop", "src-tauri", "target", "release", "bundle", "nsis")
        nsis = next(
            (os.path.join(nsis_dir, name) for name in os.listdir(nsis_dir) if name.endswith("setup.exe") and os.path.isfile(os.path.join(nsis_dir, name))),
            None,
        )
        assert_true(nsis is not None, "NSIS setup.exe artifact exists")
        shutil.copyfile(nsis, os.path.join(artifact_root, f"AgentHub_{desktop_version}_x64-setup.exe"))
        report["stages"]["nsisPackage"] = "passed"

        portable_dir = os.path.join(artifact_root, "AgentHub-portable")
        os.makedirs(portable_dir, exist_ok=True)
        shutil.copyfile(
            os.path.join(REPO_ROOT, "app", "desktop", "src-tauri", "target", "release", "agenthub-desktop.exe"),
            os.path.join(portable_dir, "AgentHub.exe"),
        )
        shutil.copyfile(sidecar_intermediate, os.path.join(portable_dir, "agenthub-edge.exe"))
        with open(os.path.join(portable_dir, "README.txt"), "w", encoding="utf-8") as handle:
            handle.write(f"AgentHub v{desktop_version} portable dry package.\n\nInternal dry-run artifact only. This is not a signed public release.\n")
        portable_zip_path = os.path.join(artifact_root, f"AgentHub_{desktop_version}_x64-portable.zip")
        shutil.make_archive(portable_zip_path[:-4], "zip", portable_dir)
        report["stages"]["portablePackage"] = "passed"

        bundle_root = os.path.join(REPO_ROOT, "app", "desktop", "src-tauri", "target", "release", "bundle")
        latest_json = next(
            (os.path.join(dirpath, name) for dirpath, _dirnames, filenames in os.walk(bundle_root) for name in filenames if name == "latest.json"),
            None,
        )
        signature = next(
            (os.path.join(dirpath, name) for dirpath, _dirnames, filenames in os.walk(bundle_root) for name in filenames if name.endswith(".sig")),
            None,
        )

        if latest_json and signature:
            shutil.copyfile(latest_json, os.path.join(artifact_root, "latest.json"))
            shutil.copyfile(signature, os.path.join(artifact_root, f"AgentHub_{desktop_version}_x64-setup.exe.sig"))
            invoke_python_script(
                "scripts/release/verify-tauri-package-readiness.py",
                ["-RepoRoot", REPO_ROOT, "-BuiltArtifactsRoot", artifact_root, "-RequireBuiltArtifacts"],
            )
            report["stages"]["updaterMetadata"] = "passed"
        else:
            report["stages"]["updaterMetadata"] = "not_produced_unsigned_build"
            if args.RequireUpdaterMetadata:
                fail_check("updater metadata was required but latest.json/.sig were not produced by the unsigned local build")
            print("INFO: unsigned local Tauri bundle did not produce latest.json/.sig; updater metadata remains a signing/release gate.", flush=True)
    else:
        report["stages"]["nsisPackage"] = "skipped"
        report["stages"]["portablePackage"] = "skipped"
        report["stages"]["updaterMetadata"] = "skipped"

    step("Post-build static readiness gates")
    invoke_python_script("scripts/release/verify-tauri-package-readiness.py", ["-RepoRoot", REPO_ROOT])
    report["stages"]["postBuildReadiness"] = "passed"

    report["stages"]["macosUnsignedDry"] = "policy_only"
    with open(os.path.join(artifact_root, "package-dry-report.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, ensure_ascii=False)
    add_artifact_manifest(artifact_root)

    print("\nTauri package dry gate OK", flush=True)
    print(f"Artifacts: {artifact_root}", flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr, flush=True)
        sys.exit(1)
