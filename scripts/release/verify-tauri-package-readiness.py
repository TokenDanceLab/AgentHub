#!/usr/bin/env python3
"""AgentHub Tauri package readiness policy gate — ps1 迁移。

Validates Tauri package metadata, version alignment, bundle configuration,
updater policy, release workflow gates, and generated artifact ignore policy.
Reads source, config, and workflow files only; does not build, sign, or
release anything.

Exit 0 on pass, exit 1 on the first failed assertion.
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import zipfile

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


def assert_file_exists(relative_path: str, label: str) -> None:
    full_path = os.path.join(REPO_ROOT, relative_path.replace("/", os.sep).replace("\\", os.sep))
    if not os.path.isfile(full_path):
        fail_check(f"{label} blocker: required file is missing ({relative_path})")
    pass_check(f"{label} exists ({relative_path})")


def assert_git_ignored(relative_path: str, label: str) -> None:
    run = subprocess.run(["git", "-C", REPO_ROOT, "check-ignore", "-q", "--", relative_path])
    if run.returncode != 0:
        fail_check(f"{label} is not ignored by Git: {relative_path}")
    pass_check(f"{label} is ignored by Git ({relative_path})")


def assert_git_path_clean(relative_path: str, label: str) -> None:
    subprocess.run(["git", "-C", REPO_ROOT, "update-index", "--refresh"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    status = subprocess.run(
        ["git", "-C", REPO_ROOT, "status", "--porcelain", "--", relative_path],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if status.returncode != 0:
        fail_check(f"{label} git status check failed for {relative_path}")

    dirty_lines = [line for line in status.stdout.splitlines() if line.strip()]
    if dirty_lines:
        untracked = [line for line in dirty_lines if line.startswith("??")]
        if untracked:
            fail_check(f"{label} has untracked generated changes: {'; '.join(untracked)}")

        worktree_diff = subprocess.run(["git", "-C", REPO_ROOT, "diff", "--quiet", "--", relative_path])
        index_diff = subprocess.run(["git", "-C", REPO_ROOT, "diff", "--cached", "--quiet", "--", relative_path])
        if worktree_diff.returncode == 0 and index_diff.returncode == 0:
            pass_check(f"{label} has no content changes ({relative_path})")
            return

        fail_check(f"{label} has uncommitted generated changes: {'; '.join(dirty_lines)}")

    pass_check(f"{label} has no uncommitted generated changes ({relative_path})")


def assert_generated_schema_clean() -> None:
    schema_dir_relative = "app/desktop/src-tauri/gen/schemas"
    schema_dir = os.path.join(REPO_ROOT, schema_dir_relative.replace("/", os.sep))
    required_schemas = ["desktop-schema.json", "windows-schema.json"]

    step("Generated Tauri schema policy")
    assert_git_path_clean(schema_dir_relative, "Tauri generated schemas")
    assert_true(os.path.isdir(schema_dir), f"required generated schema directory exists ({schema_dir_relative})")

    schema_files = [
        name
        for name in os.listdir(schema_dir)
        if os.path.isfile(os.path.join(schema_dir, name)) and name.endswith(".json")
    ]
    assert_true(len(schema_files) > 0, "generated Tauri schema directory contains JSON schema files")
    for schema_name in required_schemas:
        assert_true(
            os.path.isfile(os.path.join(schema_dir, schema_name)),
            f"required generated schema file exists ({schema_dir_relative}/{schema_name})",
        )


def assert_windows_unsigned_dev_package_contract() -> None:
    step("Windows unsigned/dev package reproducibility contract")
    assert_file_exists("scripts\\release\\verify-tauri-package-dry.py", "Windows unsigned/dev package dry categorized script")

    dry_text = read_text("scripts/release/verify-tauri-package-dry.py")
    assert_true(
        re.search(r'mode"\s*:\s*"(windows-desktop-package-dry|macos-desktop-package-dry)"', dry_text),
        "package dry report declares windows- or macos-desktop-package-dry mode",
    )
    assert_true(
        re.search(r'"signing"\s*:\s*"out-of-scope"', dry_text)
        and re.search(r'"notarization"\s*:\s*"out-of-scope"', dry_text)
        and re.search(r'"stapling"\s*:\s*"out-of-scope"', dry_text)
        and re.search(r'"releaseUpload"\s*:\s*"out-of-scope"', dry_text),
        "package dry report keeps signing, notarization, stapling, and release upload out of scope",
    )
    assert_true(
        "Build Tauri executable without bundling" in dry_text and '"--no-bundle"' in dry_text,
        "package dry checker proves the dev executable compile path with pnpm tauri build --no-bundle",
    )
    assert_true(
        re.search(r"if\s+args\.RunWindowsBundle", dry_text)
        and "Build unsigned Tauri Windows NSIS package" in dry_text
        and re.search(r'"pnpm",\s*"tauri",\s*"build"', dry_text),
        "package dry checker gates the unsigned Windows NSIS package path behind -RunWindowsBundle",
    )
    assert_true(
        re.search(r'"GOOS"\s*:\s*"windows"', dry_text)
        and re.search(r'"GOARCH"\s*:\s*"amd64"', dry_text)
        and "agenthub-edge-windows-amd64.exe" in dry_text,
        "package dry checker compiles the Windows Local Edge sidecar explicitly",
    )
    assert_true(
        "prepare-tauri-sidecar-local.py" in dry_text and "agenthub-edge-x86_64-pc-windows-msvc.exe" in dry_text,
        "package dry checker places the sidecar at the Tauri Windows target-triple path",
    )
    assert_true(
        "package-dry-report.json" in dry_text
        and "artifact-manifest.json" in dry_text
        and "sha256" in dry_text,
        "package dry checker writes report and manifest evidence with artifact hashes",
    )
    assert_true(
        "RequireUpdaterMetadata" in dry_text and "not_produced_unsigned_build" in dry_text,
        "package dry checker separates unsigned package proof from updater metadata/signature production",
    )
    assert_true(
        "assert_sidecar_sqlite_policy" in dry_text
        and re.search(r"local-edge\\?\.stdout\\?\.log", dry_text)
        and re.search(r"local-edge\\?\.stderr\\?\.log", dry_text)
        and re.search(r"edge_health_url|health_url", dry_text)
        and "direct_cli_spawn" in dry_text,
        "package dry checker preserves reproducible Local Edge diagnostics without renderer direct CLI spawn",
    )


def read_text(relative_path: str) -> str:
    full_path = os.path.join(REPO_ROOT, relative_path.replace("/", os.sep))
    with open(full_path, encoding="utf-8", errors="replace") as handle:
        return handle.read()


def read_json(relative_path: str) -> object:
    return json.loads(read_text(relative_path))


def get_cargo_version(relative_path: str) -> str:
    text = read_text(relative_path)
    match = re.search(r'(?m)^version\s*=\s*"(?P<version>[^"]+)"', text)
    if not match:
        fail_check("Cargo.toml package version is missing")
    return match.group("version")


def get_cargo_lock_package_version(relative_path: str, package_name: str) -> str:
    text = read_text(relative_path)
    escaped_name = re.escape(package_name)
    pattern = re.compile(
        r'(?ms)^\[\[package\]\]\s*\r?\nname\s*=\s*"' + escaped_name + r'"\s*\r?\nversion\s*=\s*"(?P<version>[^"]+)"'
    )
    match = pattern.search(text)
    if not match:
        fail_check(f"Cargo.lock package version is missing for {package_name}")
    return match.group("version")


def invoke_git_quiet(arguments: list) -> tuple:
    run = subprocess.run(
        ["git", "-C", REPO_ROOT, *arguments],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return run.returncode, run.stdout


def get_head_release_tags() -> list:
    head_exit, head_sha = invoke_git_quiet(["rev-parse", "--verify", "HEAD"])
    if head_exit != 0:
        return []

    tag_exit, tag_output = invoke_git_quiet(["tag", "--points-at", "HEAD"])
    if tag_exit != 0:
        return []

    semver_pattern = re.compile(r"^v?(?P<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$")
    tags = []
    for line in tag_output.splitlines():
        tag = line.strip()
        match = semver_pattern.match(tag)
        if match:
            version = match.group("version")
            tags.append({"name": tag, "version": version, "is_prerelease": "-" in version})
    return tags


def assert_release_tag_version_alignment(desktop_version: str) -> None:
    step("Release tag version alignment")
    release_tags = get_head_release_tags()
    if not release_tags:
        pass_check(f"No semver release tag points at HEAD; package metadata version is {desktop_version}")
        return

    for tag in release_tags:
        tag_kind = "pre-release" if tag["is_prerelease"] else "stable release"
        assert_true(
            tag["version"] == desktop_version,
            f"{tag_kind} tag {tag['name']} expects desktop metadata version {tag['version']}; found {desktop_version}",
        )


def has_target(targets, expected: str) -> bool:
    if isinstance(targets, str):
        return targets == expected
    return expected in targets


def assert_artifact(root: str, pattern: str, label: str):
    for dirpath, _dirnames, filenames in os.walk(root):
        for filename in filenames:
            if re.search(pattern.replace("*", ".*"), filename, re.IGNORECASE):
                item = os.path.join(dirpath, filename)
                assert_true(True, f"{label} artifact exists ({pattern})")
                return item
    assert_true(False, f"{label} artifact exists ({pattern})")


def assert_artifact_min_bytes(item_path: str, min_bytes: int, label: str) -> None:
    assert_true(os.path.getsize(item_path) >= min_bytes, f"{label} artifact is non-empty ({os.path.getsize(item_path)} bytes)")


def assert_artifact_manifest(manifest_path: str, expected_artifacts: list) -> None:
    manifest = json.loads(read_file(manifest_path))
    assert_true(len(manifest) > 0, "artifact-manifest.json has entries")

    for artifact_path in expected_artifacts:
        artifact_name = os.path.basename(artifact_path)
        entry = next((e for e in manifest if str(e.get("name")) == artifact_name), None)
        assert_true(entry is not None, f"artifact-manifest.json includes {artifact_name}")

        manifest_bytes = int(entry["bytes"])
        assert_true(manifest_bytes == os.path.getsize(artifact_path), f"artifact-manifest.json bytes match {artifact_name} ({manifest_bytes})")

        expected_hash = file_sha256_upper(artifact_path)
        assert_true(str(entry["sha256"]) == expected_hash, f"artifact-manifest.json sha256 matches {artifact_name}")

    pass_check("artifact-manifest.json verifies dry artifact hashes and sizes")


def file_sha256_upper(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def read_file(path: str) -> str:
    with open(path, encoding="utf-8", errors="replace") as handle:
        return handle.read()


def assert_zip_contains(zip_path: str, entry_name: str, label: str) -> None:
    with zipfile.ZipFile(zip_path) as archive:
        entry = next(
            (info for info in archive.infolist() if info.filename.replace("\\", "/").lower().endswith(entry_name.lower())),
            None,
        )
        assert_true(entry is not None, f"{label} portable.zip contains {entry_name}")


def assert_updater_latest_metadata(latest_json_path: str, setup_artifact_path: str, signature_artifact_path: str, expected_version: str) -> None:
    latest = json.loads(read_file(latest_json_path))
    assert_true(latest.get("version") == expected_version, f"latest.json version matches desktop package version ({expected_version})")
    assert_true(bool(str(latest.get("pub_date") or "").strip()), "latest.json includes pub_date")
    assert_true(latest.get("platforms") is not None, "latest.json includes platforms metadata")

    windows_platform = next(
        (name for name in latest["platforms"] if "windows" in name.lower() and "x86_64" in name.lower()),
        None,
    )
    assert_true(windows_platform is not None, "latest.json includes windows-x86_64 updater platform metadata")

    platform = latest["platforms"][windows_platform]
    signature = str(platform.get("signature") or "")
    url = str(platform.get("url") or "")
    assert_true(bool(signature.strip()), "latest.json windows-x86_64 signature is present")
    assert_true(bool(url.strip()), "latest.json windows-x86_64 URL is present")
    assert_true(url.lower().endswith(os.path.basename(setup_artifact_path).lower()), "latest.json windows-x86_64 URL points at setup.exe artifact")

    signature_text = read_file(signature_artifact_path).strip()
    assert_true(bool(signature_text), "updater .sig artifact is non-empty")
    assert_true(signature_text == signature, "updater .sig artifact matches latest.json signature")


def get_workflow_job_block(workflow_text: str, job_name: str) -> str:
    escaped_job_name = re.escape(job_name)
    pattern = re.compile(r"(?ms)^\s{2}" + escaped_job_name + r"\s*:.*?(?=^\s{2}[A-Za-z0-9_-]+\s*:|\Z)")
    match = pattern.search(workflow_text)
    if not match:
        fail_check(f"release readiness workflow is missing job: {job_name}")
    return match.group(0)


def get_workflow_job_blocks(workflow_text: str) -> list:
    jobs_match = re.search(r"(?ms)^jobs:\s*\r?\n(?P<jobs>.*)\Z", workflow_text)
    if not jobs_match:
        fail_check("release readiness workflow is missing jobs section")

    jobs_text = jobs_match.group("jobs")
    blocks = []
    pattern = re.compile(r"(?ms)^\s{2}(?P<name>[A-Za-z0-9_-]+)\s*:.*?(?=^\s{2}[A-Za-z0-9_-]+\s*:|\Z)")
    for match in pattern.finditer(jobs_text):
        blocks.append({"name": match.group("name"), "text": match.group(0)})

    if not blocks:
        fail_check("release readiness workflow has no jobs")

    return blocks


def test_workflow_job_has_manual_opt_in(job_block: str, input_name: str) -> bool:
    pattern = re.compile(
        r"github\.event_name\s*==\s*'workflow_dispatch'\s*&&\s*inputs\." + re.escape(input_name) + r"\s*==\s*true"
    )
    return pattern.search(job_block) is not None


def assert_workflow_command_explicit_opt_in(workflow_text: str, command_pattern: str, input_name: str, job_name: str, label: str) -> None:
    if not re.search(command_pattern, workflow_text, re.IGNORECASE):
        pass_check(f"{label} command is absent")
        return

    job_block = get_workflow_job_block(workflow_text, job_name)
    input_declaration = re.compile(
        r"(?ms)workflow_dispatch:\s*\r?\n\s*inputs:.*?^\s{6}" + re.escape(input_name) + r"\s*:"
    )
    assert_true(input_declaration.search(workflow_text) is not None, f"{label} opt-in input is declared")
    assert_true(test_workflow_job_has_manual_opt_in(job_block, input_name), f"{label} job is gated by explicit workflow_dispatch input")

    workflow_command_count = len(re.findall(command_pattern, workflow_text, re.IGNORECASE))
    job_command_count = 0
    jobs_with_command = []
    for job in get_workflow_job_blocks(workflow_text):
        matches = re.findall(command_pattern, job["text"], re.IGNORECASE)
        if not matches:
            continue

        job_command_count += len(matches)
        jobs_with_command.append(job["name"])
        assert_true(
            job["name"] == job_name and test_workflow_job_has_manual_opt_in(job["text"], input_name),
            f"{label} command in job '{job['name']}' is isolated to manual opt-in",
        )

    assert_true(job_command_count == workflow_command_count, f"{label} command occurrences are all inside workflow jobs")
    assert_true(len(jobs_with_command) > 0, f"{label} command occurrences were enumerated")
    pass_check(f"{label} command is isolated to manual opt-in job")


def get_forbidden_macos_unsigned_dry_commands(job_block: str) -> list:
    command_pattern = re.compile(r"(^|[\s;&|(`])(?:xcrun\s+)?(?:codesign|notarytool|stapler)(?:\s|$)", re.IGNORECASE)
    offending = []

    for line in job_block.splitlines():
        candidate = line.strip()
        if not candidate:
            continue
        if command_pattern.search(candidate):
            offending.append(candidate)

    return offending


def assert_no_macos_unsigned_dry_commands(job_block: str, job_name: str) -> None:
    offending = get_forbidden_macos_unsigned_dry_commands(job_block)
    if offending:
        fail_check(f"macOS unsigned dry policy job '{job_name}' contains forbidden command: {offending[0]}")

    pass_check(f"macOS unsigned dry policy job '{job_name}' has no codesign, notarytool, or stapler commands")


def get_forbidden_macos_unsigned_dry_release_actions(job_block: str) -> list:
    patterns = [
        re.compile(r"\bsoftprops/action-gh-release\b", re.IGNORECASE),
        re.compile(r"\bactions/upload-release-asset\b", re.IGNORECASE),
        re.compile(r"(^|[\s;&|(`])gh\s+release\s+(?:create|upload)(?:\s|$)", re.IGNORECASE),
        re.compile(r"(^|[\s;&|(`])(?:aws\s+s3\s+cp|az\s+storage\s+blob\s+upload|gsutil\s+cp|rclone\s+copy|wrangler\s+r2\s+object\s+put)(?:\s|$)", re.IGNORECASE),
        re.compile(r"\blatest\.json\b.*\b(?:upload|publish|release|s3|blob|r2|gsutil|rclone)\b", re.IGNORECASE),
        re.compile(r"\bupdater\b.*\bmetadata\b.*\b(?:upload|publish|release)\b", re.IGNORECASE),
    ]

    offending = []
    for line in job_block.splitlines():
        candidate = line.strip()
        if not candidate:
            continue
        for pattern in patterns:
            if pattern.search(candidate):
                offending.append(candidate)
                break

    return offending


def assert_no_macos_unsigned_dry_release_actions(job_block: str, job_name: str) -> None:
    offending = get_forbidden_macos_unsigned_dry_release_actions(job_block)
    if offending:
        fail_check(f"macOS unsigned dry policy job '{job_name}' contains forbidden release/updater publication action: {offending[0]}")

    pass_check(f"macOS unsigned dry policy job '{job_name}' has no GitHub Release upload or updater metadata publication actions")


def assert_release_workflow_prerelease_policy(workflow_text: str) -> None:
    step("Release workflow prerelease policy")
    release_block = get_workflow_job_block(workflow_text, "release")
    assert_true(re.search(r"softprops/action-gh-release@v3", release_block, re.IGNORECASE), "release job creates GitHub Releases through softprops/action-gh-release")
    assert_true(
        not re.search(r"(?m)^\s*prerelease:\s*false\s*$", release_block, re.IGNORECASE),
        "release job is not fixed stable for all v* tags",
    )
    assert_true(
        re.search(r"prerelease:\s*\$\{\{\s*contains\(github\.ref_name,\s*'-'\)\s*\}\}", release_block, re.IGNORECASE),
        "hyphenated semver tags are marked as GitHub prereleases",
    )
    pass_check("RC/pre-release tags avoid the stable releases/latest updater channel; stable tags remain prerelease=false")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("-RepoRoot", "--RepoRoot", default=".", help="repository root")
    parser.add_argument("-BuiltArtifactsRoot", "--BuiltArtifactsRoot", default="", help="root of a built artifact set for the -RequireBuiltArtifacts gate")
    parser.add_argument("-RequireBuiltArtifacts", "--RequireBuiltArtifacts", action="store_true", help="run the built artifact gate")
    parser.add_argument("-RequireBundledSidecar", "--RequireBundledSidecar", action="store_true", help="require the bundled Windows Local Edge sidecar file")
    args = parser.parse_args()

    global REPO_ROOT
    REPO_ROOT = os.path.abspath(args.RepoRoot)

    step("Desktop version metadata")
    workspace_package = read_json("app/package.json")
    package = read_json("app/desktop/package.json")
    tauri = read_json("app/desktop/src-tauri/tauri.conf.json")
    cargo_version = get_cargo_version("app/desktop/src-tauri/Cargo.toml")
    cargo_lock_version = get_cargo_lock_package_version("app/desktop/src-tauri/Cargo.lock", "agenthub-desktop")

    assert_true(package["version"] == tauri["version"], f"package.json and tauri.conf.json versions match ({package['version']})")
    assert_true(cargo_version == tauri["version"], f"Cargo.toml and tauri.conf.json versions match ({cargo_version})")
    assert_true(cargo_lock_version == tauri["version"], f"Cargo.lock and tauri.conf.json versions match ({cargo_lock_version})")
    assert_true(tauri["identifier"] == "com.agenthub.desktop", "Desktop Tauri identifier is stable")
    assert_true(tauri["productName"] == "AgentHub Desktop", "Desktop product name is stable")
    assert_release_tag_version_alignment(str(tauri["version"]))

    package_manager = str(workspace_package.get("packageManager") or "")
    assert_true(package_manager.startswith("pnpm@"), "frontend workspace pins pnpm through packageManager")
    pnpm_version = package_manager.removeprefix("pnpm@")

    step("Windows package policy")
    assert_true(tauri["bundle"]["active"] is True, "Tauri bundle is active")
    assert_true(has_target(tauri["bundle"]["targets"], "nsis"), "Tauri bundle targets Windows NSIS")
    assert_true(not has_target(tauri["bundle"]["targets"], "all"), "Tauri bundle does not use broad all targets for internal package readiness")
    assert_true("binaries/agenthub-edge" in tauri["bundle"]["externalBin"], "Tauri config declares edge-server sidecar basename")
    assert_true(tauri["bundle"]["windows"]["nsis"]["installMode"] == "currentUser", "NSIS installer uses currentUser install mode")

    release_workflow_text = read_text(".github/workflows/release.yml")
    readiness_workflow_text = read_text(".github/workflows/release-readiness.yml")
    checks_workflow_text = read_text(".github/workflows/checks.yml")
    governance_text = read_text("docs/governance/governance-execution.md")
    dry_gate_text = read_text("scripts/release/verify-tauri-package-dry.py")
    checker_text = read_file(os.path.abspath(__file__))
    pnpm_version_pattern = rf'PNPM_VERSION:\s*"{re.escape(pnpm_version)}"'
    for workflow_label, workflow_text in (
        ("checks", checks_workflow_text),
        ("release readiness", readiness_workflow_text),
        ("release", release_workflow_text),
    ):
        assert_true(
            re.search(pnpm_version_pattern, workflow_text, re.IGNORECASE),
            f"{workflow_label} workflow uses workspace pnpm version {pnpm_version}",
        )
    assert_true(re.search(r"agenthub-edge-x86_64-pc-windows-msvc\.exe", dry_gate_text, re.IGNORECASE), "release readiness dry gate prepares Windows sidecar agenthub-edge_x86_64-pc-windows-msvc.exe")
    assert_true(
        re.search(r"AgentHub_\$\{desktopVersion\}_x64-portable\.zip", dry_gate_text, re.IGNORECASE) or re.search(r"portable\.zip", dry_gate_text, re.IGNORECASE),
        "release readiness dry gate names portable.zip artifact",
    )
    assert_true(re.search(r"setup\.exe", dry_gate_text, re.IGNORECASE), "release readiness dry gate collects NSIS setup.exe")

    step("Updater metadata policy")
    assert_true(tauri["plugins"]["updater"]["active"] is True, "Tauri updater plugin is active")
    updater_latest_endpoints = [endpoint for endpoint in tauri["plugins"]["updater"]["endpoints"] if "latest.json" in str(endpoint)]
    assert_true(len(updater_latest_endpoints) > 0, "Updater endpoint points at latest.json metadata")
    assert_true(bool(str(tauri["plugins"]["updater"].get("pubkey") or "").strip()), "Updater public key is configured")
    assert_true(
        "RequireUpdaterMetadata" in dry_gate_text and "not_produced_unsigned_build" in dry_gate_text,
        "unsigned dry gate records updater metadata as a separate signing/release gate",
    )
    assert_true(
        "assert_updater_latest_metadata" in checker_text and "latest.json" in checker_text and ".sig" in checker_text,
        "built artifact mode checks latest.json and .sig when signing/release metadata is supplied",
    )

    step("Tag release policy")
    assert_true(re.search(r"(?ms)on:\s*\r?\n\s*push:\s*\r?\n\s*tags:", release_workflow_text, re.IGNORECASE), "release workflow keeps tag push trigger")
    assert_true(re.search(r"softprops/action-gh-release", release_workflow_text, re.IGNORECASE), "release workflow keeps GitHub Release creation")
    assert_true(re.search(r"TAURI_SIGNING_PRIVATE_KEY", release_workflow_text, re.IGNORECASE), "release workflow keeps production Tauri signing secret boundary")
    assert_release_workflow_prerelease_policy(release_workflow_text)

    step("Dry release policy")
    assert_true(re.search(r"workflow_dispatch", readiness_workflow_text, re.IGNORECASE), "release readiness workflow is manually runnable")
    assert_true(re.search(r"\.github/workflows/release\.yml", readiness_workflow_text, re.IGNORECASE), "release readiness workflow watches release.yml")
    assert_true(
        re.search(r"edge-server/internal/lifecycle/env_\*\.go", readiness_workflow_text, re.IGNORECASE),
        "release readiness workflow watches the Windows environment inheritance contract",
    )
    assert_true(re.search(r"app/desktop/src-tauri/Cargo\.lock", readiness_workflow_text, re.IGNORECASE), "release readiness workflow watches Cargo.lock")
    assert_true(not re.search(r"softprops/action-gh-release", readiness_workflow_text, re.IGNORECASE), "release readiness workflow does not create GitHub releases")
    assert_true(not re.search(r"gh release upload", readiness_workflow_text, re.IGNORECASE), "release readiness workflow does not upload release assets")
    assert_true(not re.search(r"TAURI_SIGNING_PRIVATE_KEY", readiness_workflow_text, re.IGNORECASE), "release readiness workflow does not require production signing secrets")
    assert_true(re.search(r"verify-tauri-package-readiness\.py", readiness_workflow_text, re.IGNORECASE), "release readiness workflow runs this checker")
    assert_true(
        re.search(r"verify-tauri-package-dry\.py", readiness_workflow_text, re.IGNORECASE)
        and re.search(r"RunWindowsBundle", readiness_workflow_text, re.IGNORECASE)
        and re.search(r"ArtifactsRoot dist", readiness_workflow_text, re.IGNORECASE),
        "release readiness workflow delegates unsigned Windows package proof to the dry gate",
    )
    readiness_policy_block = get_workflow_job_block(readiness_workflow_text, "readiness-policy")
    installer_smoke_block = get_workflow_job_block(readiness_workflow_text, "windows-installer-smoke-preflight")
    assert_true(not re.search(r"pnpm\s+tauri\s+build", readiness_policy_block, re.IGNORECASE), "static readiness policy does not run full Tauri build")
    assert_true(not re.search(r"pnpm\s+tauri\s+build", installer_smoke_block, re.IGNORECASE), "installer smoke preflight does not run full Tauri build")
    assert_true(
        re.search(r"Verify Windows environment inheritance contract", installer_smoke_block, re.IGNORECASE)
        and re.search(r"working-directory:\s*edge-server", installer_smoke_block, re.IGNORECASE)
        and re.search(r"go test ./internal/lifecycle", installer_smoke_block, re.IGNORECASE),
        "Windows installer smoke preflight runs the native environment inheritance contract",
    )
    assert_workflow_command_explicit_opt_in(readiness_workflow_text, r"pnpm\s+tauri\s+build", "run_windows_package_dry", "windows-package-dry", "Full Tauri build")

    assert_generated_schema_clean()
    assert_windows_unsigned_dev_package_contract()

    step("Generated artifact ignore policy")
    desktop_version = str(package["version"])
    assert_git_ignored(f"dist/AgentHub_{desktop_version}_x64-setup.exe", "Windows setup.exe dry artifact")
    assert_git_ignored(f"dist/AgentHub_{desktop_version}_x64-portable.zip", "Windows portable.zip dry artifact")
    assert_git_ignored("dist/latest.json", "Updater latest.json dry artifact")
    assert_git_ignored(f"dist/AgentHub_{desktop_version}_x64-setup.exe.sig", "Updater signature dry artifact")
    assert_git_ignored("dist/agenthub-edge-windows-amd64.exe", "Windows sidecar dry intermediate")
    assert_git_ignored(f"app/desktop/src-tauri/target/release/bundle/nsis/AgentHub_{desktop_version}_x64-setup.exe", "Tauri NSIS bundle output")
    assert_git_ignored("app/desktop/src-tauri/binaries/agenthub-edge-x86_64-pc-windows-msvc.exe", "Windows sidecar binary")
    assert_git_ignored("app/desktop/src-tauri/binaries/agenthub-edge-aarch64-apple-darwin", "macOS arm64 sidecar binary")

    if args.RequireBundledSidecar:
        step("Bundled Local Edge sidecar presence gate")
        assert_file_exists("app/desktop/src-tauri/binaries/agenthub-edge-x86_64-pc-windows-msvc.exe", "Windows bundled Local Edge sidecar")

    step("macOS unsigned dry policy boundary")
    assert_true(re.search(r"run_macos_unsigned_dry_policy", readiness_workflow_text, re.IGNORECASE), "release readiness workflow declares explicit macOS unsigned dry policy input")
    macos_unsigned_dry_block = get_workflow_job_block(readiness_workflow_text, "macos-unsigned-dry-policy")
    assert_true(test_workflow_job_has_manual_opt_in(macos_unsigned_dry_block, "run_macos_unsigned_dry_policy"), "macOS unsigned dry policy job is gated by explicit workflow_dispatch input")
    assert_true(re.search(r"macOS unsigned dry", macos_unsigned_dry_block, re.IGNORECASE), "release readiness workflow names macOS step as unsigned dry policy")
    assert_true(re.search(r"agenthub-edge-aarch64-apple-darwin", macos_unsigned_dry_block, re.IGNORECASE), "release readiness workflow documents the future macOS arm64 sidecar boundary")
    assert_true(re.search(r"AgentHub\.app", macos_unsigned_dry_block, re.IGNORECASE) and re.search(r"AgentHub_\$\{version\}_aarch64\.dmg", macos_unsigned_dry_block, re.IGNORECASE), "release readiness workflow documents future macOS app and versioned arm64 DMG bundle boundaries")
    assert_true(re.search(r"workflow artifacts only", macos_unsigned_dry_block, re.IGNORECASE), "release readiness workflow scopes future macOS unsigned outputs to workflow artifacts only")
    assert_true(re.search(r"macos-unsigned-dry-policy\.json", macos_unsigned_dry_block, re.IGNORECASE), "release readiness workflow writes a macOS unsigned dry policy manifest")
    assert_true(
        re.search(r"actions/upload-artifact@v7", macos_unsigned_dry_block, re.IGNORECASE)
        and re.search(r"name:\s*macos-unsigned-package-dry", macos_unsigned_dry_block, re.IGNORECASE)
        and re.search(r"path:\s*dist/macos-unsigned-dry-policy\.json", macos_unsigned_dry_block, re.IGNORECASE),
        "release readiness workflow uploads only the macOS policy manifest as a workflow artifact",
    )
    assert_true(
        re.search(r"Apple Developer ID signing", macos_unsigned_dry_block, re.IGNORECASE)
        and re.search(r"notarytool notarization", macos_unsigned_dry_block, re.IGNORECASE)
        and re.search(r"stapler staple", macos_unsigned_dry_block, re.IGNORECASE),
        "release readiness workflow records Apple signing, notarization, and stapling as explicit approval gates",
    )
    assert_true(
        re.search(r"GitHub Release upload", macos_unsigned_dry_block, re.IGNORECASE)
        and re.search(r"production updater metadata publication", macos_unsigned_dry_block, re.IGNORECASE),
        "release readiness workflow records release upload and updater production metadata as explicit approval gates",
    )
    assert_true(re.search(r"later approval slice", macos_unsigned_dry_block, re.IGNORECASE), "release readiness workflow keeps signing, notarization, release upload, and updater metadata as later approval slice")
    assert_true(
        not re.search(r"pnpm\s+tauri\s+build|softprops/action-gh-release|gh release upload|TAURI_SIGNING_PRIVATE_KEY", macos_unsigned_dry_block, re.IGNORECASE),
        "macOS unsigned dry policy job does not run build, release upload, or production signing secret commands",
    )
    assert_no_macos_unsigned_dry_commands(macos_unsigned_dry_block, "macos-unsigned-dry-policy")
    assert_no_macos_unsigned_dry_release_actions(macos_unsigned_dry_block, "macos-unsigned-dry-policy")

    step("Release dry topology documentation")
    assert_true(re.search(r"D2b\. Release dry build topology", governance_text, re.IGNORECASE), "governance doc records release dry build topology")
    assert_true(re.search(r"topology/preflight only|拓扑/预检", governance_text, re.IGNORECASE), "governance doc keeps release dry topology to topology/preflight scope")
    assert_true(re.search(r"full Tauri build|pnpm tauri build", governance_text, re.IGNORECASE), "governance doc names full Tauri build as separate opt-in scope")
    assert_true(not re.search(r"产出未签名 NSIS|produces unsigned NSIS", governance_text, re.IGNORECASE), "governance doc does not claim dry topology produces installer artifacts")
    assert_true(re.search(r"Windows unsigned NSIS/portable|未签名 NSIS", governance_text, re.IGNORECASE), "governance doc keeps Windows unsigned NSIS/portable as future opt-in artifact scope")
    assert_true(re.search(r"agenthub-edge-x86_64-pc-windows-msvc\.exe", governance_text, re.IGNORECASE), "governance doc records Windows Tauri sidecar name")
    assert_true(re.search(r"latest\.json.*\.sig|\.sig.*latest\.json", governance_text, re.IGNORECASE), "governance doc records updater metadata artifacts")
    assert_true(re.search(r"agenthub-edge-aarch64-apple-darwin", governance_text, re.IGNORECASE), "governance doc records macOS arm64 sidecar name")
    assert_true(re.search(r"macOS.*unsigned|arm64 unsigned", governance_text, re.IGNORECASE), "governance doc keeps macOS validation unsigned")
    assert_true(re.search(r"AgentHub\.app", governance_text, re.IGNORECASE) and re.search(r"AgentHub_\$\{version\}_aarch64\.dmg", governance_text, re.IGNORECASE), "governance doc records future macOS app and versioned arm64 DMG bundle boundaries")
    assert_true(re.search(r"notarytool|notarization", governance_text, re.IGNORECASE), "governance doc names notarization as out of scope")
    assert_true(re.search(r"approval slice|审批", governance_text, re.IGNORECASE), "governance doc keeps signing and notarization behind later approval")
    assert_true(re.search(r"workflow artifact", governance_text, re.IGNORECASE), "governance doc keeps dry artifacts scoped to workflow artifact upload")
    assert_true(re.search(r"GitHub Release|release asset|updater 生产 metadata", governance_text, re.IGNORECASE), "governance doc keeps release creation/upload out of dry topology")

    if args.RequireBuiltArtifacts:
        step("Built artifact gate")
        if not str(args.BuiltArtifactsRoot).strip():
            fail_check("BuiltArtifactsRoot is required when -RequireBuiltArtifacts is set")
        if not os.path.isdir(args.BuiltArtifactsRoot):
            fail_check(f"Built artifacts root not found: {args.BuiltArtifactsRoot}; expected latest.json, setup.exe, portable.zip, and .sig")

        artifact_root = os.path.abspath(args.BuiltArtifactsRoot)
        setup_artifact = assert_artifact(artifact_root, "*setup.exe", "NSIS setup.exe")
        portable_artifact = assert_artifact(artifact_root, "*portable.zip", "Windows portable.zip")
        latest_json = assert_artifact(artifact_root, "latest.json", "Updater latest.json")
        signature_artifact = assert_artifact(artifact_root, "*.sig", "Updater signature .sig")
        manifest_artifact = assert_artifact(artifact_root, "artifact-manifest.json", "Dry artifact manifest")

        assert_artifact_min_bytes(setup_artifact, 1, "NSIS setup.exe")
        assert_artifact_min_bytes(portable_artifact, 1, "Windows portable.zip")
        assert_artifact_manifest(manifest_artifact, [setup_artifact, portable_artifact, latest_json, signature_artifact])
        assert_zip_contains(portable_artifact, "AgentHub.exe", "Windows")
        assert_zip_contains(portable_artifact, "agenthub-edge.exe", "Windows")
        assert_zip_contains(portable_artifact, "README.txt", "Windows")
        assert_updater_latest_metadata(latest_json, setup_artifact, signature_artifact, str(package["version"]))

    print("\nTauri package readiness policy OK", flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr, flush=True)
        sys.exit(1)
