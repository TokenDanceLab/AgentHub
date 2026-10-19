#!/usr/bin/env python3
"""AgentHub Tauri package readiness gate.

Static contract: desktop version alignment, Tauri bundle/updater configuration,
pnpm pin consistency, clean generated schemas, and ignored build outputs.
With -RequireBuiltArtifacts it also accepts a produced package: artifact
manifest hashes, portable ZIP contents, and updater metadata/signature.

Reads source, config, and artifact files only; never builds, signs or releases.
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORKFLOWS = (".github/workflows/checks.yml", ".github/workflows/release-readiness.yml", ".github/workflows/release.yml")


def fail(message: str) -> None:
    print(f"FAIL: {message}", flush=True)
    raise SystemExit(1)


def check(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def path(relative: str) -> Path:
    return Path(REPO_ROOT) / relative


def read(relative: str) -> str:
    return (path(relative)).read_text(encoding="utf-8", errors="replace")


def read_json(relative: str):
    return json.loads(read(relative))


def cargo_package_version(relative: str) -> str:
    match = re.search(r'(?m)^version\s*=\s*"([^"]+)"', read(relative))
    if not match:
        fail(f"{relative} has no package version")
    return match.group(1)


def cargo_lock_version(relative: str, package: str) -> str:
    match = re.search(
        r'(?ms)^\[\[package\]\]\s*\r?\nname\s*=\s*"' + re.escape(package) + r'"\s*\r?\nversion\s*=\s*"([^"]+)"',
        read(relative),
    )
    if not match:
        fail(f"{relative} has no locked {package} version")
    return match.group(1)


def check_versions() -> dict:
    print(">>> desktop version metadata")
    workspace = read_json("app/package.json")
    package = read_json("app/desktop/package.json")
    tauri = read_json("app/desktop/src-tauri/tauri.conf.json")
    versions = {
        "app/desktop/package.json": package["version"],
        "app/desktop/src-tauri/tauri.conf.json": tauri["version"],
        "app/desktop/src-tauri/Cargo.toml": cargo_package_version("app/desktop/src-tauri/Cargo.toml"),
        "app/desktop/src-tauri/Cargo.lock": cargo_lock_version("app/desktop/src-tauri/Cargo.lock", "agenthub-desktop"),
    }
    distinct = set(versions.values())
    check(len(distinct) == 1, f"desktop versions disagree: {versions}")

    manager = str(workspace.get("packageManager") or "")
    match = re.fullmatch(r"pnpm@(\d+\.\d+\.\d+)", manager)
    check(match is not None, f"app/package.json must pin pnpm@X.Y.Z, found {manager!r}")
    for workflow in WORKFLOWS:
        check(
            re.search(rf'PNPM_VERSION:\s*"{re.escape(match.group(1))}"', read(workflow)) is not None,
            f"{workflow} does not use the workspace pnpm version {match.group(1)}",
        )
    return tauri


def check_tauri_config(tauri: dict) -> None:
    print(">>> Tauri bundle and updater configuration")
    check(tauri["identifier"] == "com.agenthub.desktop", "desktop identifier must stay com.agenthub.desktop")
    check(tauri["productName"] == "AgentHub Desktop", "product name must stay AgentHub Desktop")

    bundle = tauri["bundle"]
    targets = bundle["targets"] if isinstance(bundle["targets"], list) else [bundle["targets"]]
    check(bundle["active"] is True, "bundle must stay active")
    check("nsis" in targets and "all" not in targets, f"bundle targets must be explicit (found {targets})")
    check(any("binaries/agenthub-edge" in binary for binary in bundle["externalBin"]), "bundle must declare the edge sidecar")
    check(bundle["windows"]["nsis"]["installMode"] == "currentUser", "NSIS must install per user")

    updater = tauri["plugins"]["updater"]
    check(updater["active"] is True, "updater must stay active")
    check(any("latest.json" in str(endpoint) for endpoint in updater["endpoints"]), "updater must read latest.json")
    check(bool(str(updater.get("pubkey") or "").strip()), "updater public key must be configured")


def check_generated_schemas() -> None:
    print(">>> generated Tauri schemas")
    relative = "app/desktop/src-tauri/gen/schemas"
    status = subprocess.run(
        ["git", "-C", REPO_ROOT, "status", "--porcelain", "--", relative],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    check(status.returncode == 0, f"could not read git status for {relative}")
    check(not status.stdout.strip(), f"{relative} has unreviewed gen changes:\n{status.stdout}")
    for schema in ("desktop-schema.json", "windows-schema.json"):
        check(path(f"{relative}/{schema}").is_file(), f"missing generated schema {relative}/{schema}")


IGNORED_ARTIFACTS = (
    ("dist/AgentHub_{version}_x64-setup.exe", "Windows setup.exe"),
    ("dist/AgentHub_{version}_x64-portable.zip", "Windows portable.zip"),
    ("dist/latest.json", "updater metadata"),
    ("dist/AgentHub_{version}_x64-setup.exe.sig", "updater signature"),
    ("dist/agenthub-edge-windows-amd64.exe", "Windows sidecar intermediate"),
    ("app/desktop/src-tauri/target/release/bundle/nsis/AgentHub_{version}_x64-setup.exe", "Tauri NSIS bundle"),
    ("app/desktop/src-tauri/binaries/agenthub-edge-x86_64-pc-windows-msvc.exe", "Windows sidecar"),
    ("app/desktop/src-tauri/binaries/agenthub-edge-aarch64-apple-darwin", "macOS sidecar"),
)


def check_ignored_artifacts(version: str) -> None:
    print(">>> generated artifact ignore policy")
    for template, label in IGNORED_ARTIFACTS:
        relative = template.format(version=version)
        result = subprocess.run(["git", "-C", REPO_ROOT, "check-ignore", "-q", "--", relative])
        check(result.returncode == 0, f"{label} is not gitignored: {relative}")


def find_artifact(root: Path, label: str, pattern: str) -> Path:
    matches = sorted(item for item in root.rglob(pattern) if item.is_file())
    check(bool(matches), f"built package is missing {label} ({pattern}) under {root}")
    return matches[0]


def sha256_upper(item: Path) -> str:
    digest = hashlib.sha256()
    with open(item, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def check_manifest(manifest_path: Path, artifacts: list) -> None:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    check(isinstance(manifest, list) and manifest, "artifact-manifest.json must list artifacts")
    for artifact in artifacts:
        entry = next((item for item in manifest if str(item.get("name")) == artifact.name), None)
        check(entry is not None, f"artifact-manifest.json omits {artifact.name}")
        check(int(entry["bytes"]) == artifact.stat().st_size, f"artifact-manifest.json size mismatch for {artifact.name}")
        check(str(entry["sha256"]).upper() == sha256_upper(artifact), f"artifact-manifest.json hash mismatch for {artifact.name}")


def check_portable_zip(archive_path: Path) -> None:
    with zipfile.ZipFile(archive_path) as archive:
        names = [name.replace("\\", "/").lower() for name in archive.namelist()]
    for required in ("agenthub.exe", "agenthub-edge.exe", "readme.txt"):
        check(any(name.endswith(required) for name in names), f"portable.zip is missing {required}")


def check_updater_metadata(latest: Path, setup: Path, signature_file: Path, version: str) -> None:
    metadata = json.loads(latest.read_text(encoding="utf-8"))
    check(metadata.get("version") == version, f"latest.json version {metadata.get('version')!r} != {version}")
    check(bool(str(metadata.get("pub_date") or "").strip()), "latest.json is missing pub_date")
    platform = next(
        (value for name, value in (metadata.get("platforms") or {}).items() if "windows" in name and "x86_64" in name),
        None,
    )
    check(platform is not None, "latest.json has no windows-x86_64 platform")
    check(str(platform["url"]).lower().endswith(setup.name.lower()), "latest.json URL must point at the setup.exe")
    signature = signature_file.read_text(encoding="utf-8").strip()
    check(bool(signature), "updater .sig is empty")
    check(signature == str(platform["signature"]), "latest.json signature does not match the .sig artifact")


def check_built_artifacts(root: Path, version: str) -> None:
    print(">>> built package artifacts")
    check(root.is_dir(), f"built artifact root not found: {root}")
    setup = find_artifact(root, "NSIS setup.exe", "*setup.exe")
    portable = find_artifact(root, "portable.zip", "*portable.zip")
    latest = find_artifact(root, "updater latest.json", "latest.json")
    signature = find_artifact(root, "updater signature", "*.sig")
    manifest = find_artifact(root, "artifact manifest", "artifact-manifest.json")

    for artifact in (setup, portable, latest, signature):
        check(artifact.stat().st_size > 0, f"{artifact.name} is empty")
    check_manifest(manifest, [setup, portable, latest, signature])
    check_portable_zip(portable)
    check_updater_metadata(latest, setup, signature, version)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("-RepoRoot", "--RepoRoot", default=".", help="repository root")
    parser.add_argument("-BuiltArtifactsRoot", "--BuiltArtifactsRoot", default="", help="produced package directory")
    parser.add_argument("-RequireBuiltArtifacts", "--RequireBuiltArtifacts", action="store_true", help="verify a produced package")
    args = parser.parse_args()

    global REPO_ROOT
    REPO_ROOT = os.path.abspath(args.RepoRoot)

    tauri = check_versions()
    check_tauri_config(tauri)
    check_generated_schemas()
    check_ignored_artifacts(str(tauri["version"]))
    if args.RequireBuiltArtifacts:
        check(bool(args.BuiltArtifactsRoot.strip()), "-BuiltArtifactsRoot is required with -RequireBuiltArtifacts")
        check_built_artifacts(Path(args.BuiltArtifactsRoot).resolve(), str(tauri["version"]))

    print("\nTauri package readiness OK", flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 - fail closed
        print(f"ERROR: {exc}", file=sys.stderr, flush=True)
        sys.exit(1)
