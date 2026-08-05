#!/usr/bin/env python3
"""package-teamrun-demo-evidence — 打包本地、gitignored 的 TeamRun demo 证据包（ps1 迁移，契约见 server docs/design/ps1-to-python-migration.md）。

只复制调用方提供的证据文件并写 manifest。不跑 agent CLI、不调 model API、
不起服务、不上传数据。

契约：stdlib only；参数名/退出码与 ps1 一致（0=通过/1=失败）；stdout 行
（`Created TeamRun demo evidence package:` / `  <path>` / `Manifest:`）与原 ps1
一致；redacted-manifest.json 用 ConvertTo-Json 等价格式（2-space indent）；
敏感值扫描与校验失败抛 ERROR → 非零退出（对齐 $ErrorActionPreference='Stop'）。
"""

import argparse
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))

SENSITIVE_VALUE_PATTERN = re.compile(
    r"(?i)(Authorization\s*:\s*Bearer\s+(?!<redacted)[^\s,;]+"
    r"|Cookie\s*:\s*[^\r\n]+"
    r"|(?:password|passwd|client[_ -]?secret|api[_ -]?key|access[_ -]?token"
    r"|refresh[_ -]?token|id[_ -]?token|auth[_ -]?token)\s*[:=]\s*"
    r'(?!"?(?:false|true|null|none|not[_ -]?required|not[_ -]?available'
    r'|blocked|redacted|<redacted|fixture|manifest|approved|redact)[^"]*"?)'
    r'(?!"?\s*(?:false|true|null)"?\s*(?:,|$))["\']?[^"\'\s,;}]{8,}'
    r"|(?<![A-Za-z0-9_])(?:sk|ghp|gho|ghu|ghs|glpat|xox[baprs])-[-_A-Za-z0-9]{12,})"
)
TEXT_SCAN_EXTENSIONS = {".json", ".md", ".txt", ".log", ".csv", ".yaml", ".yml"}


def resolve_repo_path(repo_root: str, path_value: str):
    if not path_value or not path_value.strip():
        return None
    if os.path.isabs(path_value) or os.path.splitdrive(path_value)[0]:
        return path_value
    return os.path.join(repo_root, path_value)


def copy_required_file(source: str, destination_directory: str, destination_name: str, repo_root: str) -> str:
    resolved = resolve_repo_path(repo_root, source)
    if not resolved or not os.path.isfile(resolved):
        raise RuntimeError(f"required file not found: {source}")
    destination = os.path.join(destination_directory, destination_name)
    os.makedirs(os.path.dirname(destination) or ".", exist_ok=True)
    shutil.copy2(resolved, destination)
    return destination


def copy_optional_file(source: str, destination_directory: str, repo_root: str) -> str:
    resolved = resolve_repo_path(repo_root, source)
    if not resolved or not os.path.isfile(resolved):
        raise RuntimeError(f"optional file not found: {source}")
    destination = os.path.join(destination_directory, os.path.basename(resolved))
    shutil.copy2(resolved, destination)
    return destination


def get_file_sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def get_package_relative_path(path_value: str, root_path: str) -> str:
    root = os.path.abspath(root_path).rstrip("/\\") + os.sep
    full = os.path.abspath(path_value)
    if not full.lower().startswith(root.lower()):
        raise RuntimeError(f"packaged file escapes output boundary: {path_value}")
    return full[len(root):].replace("\\", "/")


def test_redacted_text_file(path_value: str) -> None:
    extension = os.path.splitext(path_value)[1].lower()
    if extension not in TEXT_SCAN_EXTENSIONS:
        return
    with open(path_value, encoding="utf-8", errors="replace") as handle:
        content = handle.read()
    if SENSITIVE_VALUE_PATTERN.search(content):
        raise RuntimeError(f"sensitive value detected in packaged evidence: {os.path.basename(path_value)}")


def new_file_entry(path_value: str, root_path: str, role: str) -> dict:
    test_redacted_text_file(path_value)
    return {
        "path": get_package_relative_path(path_value, root_path),
        "role": role,
        "sha256": get_file_sha256(path_value),
        "bytes": os.path.getsize(path_value),
        "redacted": True,
    }


def get_boundary_label(evidence: dict, package_mode: str, fixture_only: bool, real_runtime_executed: bool) -> str:
    if fixture_only:
        return "fixture"
    if package_mode == "Submission":
        return "approved-real"
    if real_runtime_executed:
        return "RealTested"
    return "observed"


def format_powershell_datetime(value: datetime.datetime, template: str) -> str:
    if template == "yyyy-MM-ddTHH:mm:sszzz":
        return value.isoformat(timespec="seconds")
    base = value.strftime("%Y-%m-%d %H:%M:%S")
    offset = value.strftime("%z")
    return f"{base} {offset[:3]}:{offset[3:]}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--EvidencePath", "-EvidencePath", required=True)
    parser.add_argument("--ScreenshotPath", "-ScreenshotPath", action="append", default=[])
    parser.add_argument("--VideoPath", "-VideoPath", default="")
    parser.add_argument("--OutputRoot", "-OutputRoot", default=".tmp/submission-evidence")
    parser.add_argument("--Stamp", "-Stamp", default="")
    parser.add_argument("--PackageMode", "-PackageMode", default="FixtureRehearsal", choices=["FixtureRehearsal", "Submission"])
    args = parser.parse_args()

    repo_root = os.path.realpath(REPO_ROOT)
    if not args.Stamp.strip():
        args.Stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")

    output_root_path = resolve_repo_path(repo_root, args.OutputRoot)
    output_dir = os.path.join(output_root_path, f"teamrun-demo-{args.Stamp}")
    screenshots_dir = os.path.join(output_dir, "screenshots")
    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(screenshots_dir, exist_ok=True)

    copied_evidence = copy_required_file(args.EvidencePath, output_dir, "teamrun-evidence.json", repo_root)
    copied_screenshots = []
    for screenshot in args.ScreenshotPath:
        copied_screenshots.append(copy_optional_file(screenshot, screenshots_dir, repo_root))

    copied_video = None
    if args.VideoPath.strip():
        copied_video = copy_optional_file(args.VideoPath, output_dir, repo_root)

    commit = "unknown"
    try:
        run = subprocess.run(
            ["git", "-C", repo_root, "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if run.returncode == 0:
            commit = run.stdout.strip()
    except Exception:  # noqa: BLE001 —— 对齐 ps1 try/catch 回退 unknown
        commit = "unknown"

    with open(copied_evidence, encoding="utf-8-sig") as handle:
        evidence = json.load(handle)
    claims = evidence.get("claims")
    if claims is None:
        raise RuntimeError("evidence claims are required")
    runtime_profiles = evidence.get("runtime_profiles")
    if runtime_profiles is None or len(runtime_profiles) < 2:
        raise RuntimeError("evidence must include at least two runtime_profiles")
    if evidence.get("screenshot_or_video_rehearsal") is None:
        raise RuntimeError("evidence must include screenshot_or_video_rehearsal metadata")
    source = evidence.get("source") or {}
    fixture_only = source.get("fixture_only") is True
    if fixture_only and (
        claims.get("real_runtime_executed") is not False
        or claims.get("final_recording_complete") is not False
        or claims.get("submission_ready") is not False
    ):
        raise RuntimeError("fixture evidence cannot claim real runtime execution, final recording completion, or submission readiness")
    if args.PackageMode == "Submission":
        if fixture_only:
            raise RuntimeError("fixture evidence cannot be packaged in Submission mode")
        if claims.get("real_runtime_executed") is not True or claims.get("final_recording_complete") is not True or claims.get("submission_ready") is not True:
            raise RuntimeError("Submission mode requires real_runtime_executed=true, final_recording_complete=true, and submission_ready=true")
        if not args.VideoPath.strip() or not copied_video:
            raise RuntimeError("Submission mode requires a final video path")
    runtime_profiles_count = len(runtime_profiles)
    counts = evidence.get("counts") or {}
    runtime_types = int(counts.get("runtime_types") or 0)
    real_runtime_executed = claims.get("real_runtime_executed") is True
    final_recording_complete = claims.get("final_recording_complete") is True
    submission_ready = claims.get("submission_ready") is True
    rehearsal = evidence.get("screenshot_or_video_rehearsal") or {}
    rehearsal_mode = str(rehearsal.get("mode") or "missing")

    manifest_path = os.path.join(output_dir, "manifest.md")
    redacted_manifest_path = os.path.join(output_dir, "redacted-manifest.json")
    screenshot_lines = "\n".join(f"- screenshots/{os.path.basename(path)}" for path in copied_screenshots) if copied_screenshots else "- none"
    video_line = os.path.basename(copied_video) if copied_video else "not included"

    boundary_label = get_boundary_label(evidence, args.PackageMode, fixture_only, real_runtime_executed)
    file_entries = [new_file_entry(copied_evidence, output_dir, "evidence-json")]
    for screenshot in copied_screenshots:
        file_entries.append(new_file_entry(screenshot, output_dir, "screenshot"))
    if copied_video:
        file_entries.append(new_file_entry(copied_video, output_dir, "video"))

    now = datetime.datetime.now().astimezone()
    redacted_manifest = {
        "schema": "agenthub-redacted-evidence-manifest-v1",
        "generated_at": format_powershell_datetime(now, "yyyy-MM-ddTHH:mm:sszzz"),
        "commit": commit,
        "package_mode": args.PackageMode,
        "evidence_boundary": {
            "label": boundary_label,
            "fixture": boundary_label == "fixture",
            "observed": boundary_label == "observed",
            "real_tested": boundary_label == "RealTested",
            "approved_real": boundary_label == "approved-real",
            "source_claims": {
                "fixture_only": fixture_only,
                "real_runtime_executed": real_runtime_executed,
                "final_recording_complete": final_recording_complete,
                "submission_ready": submission_ready,
            },
        },
        "path_boundary": {
            "package_root": f".tmp/submission-evidence/teamrun-demo-{args.Stamp}",
            "file_paths": "package-relative only",
            "source_paths": "not recorded",
        },
        "redaction": {
            "status": "passed",
            "policy": "no sensitive credential values in text evidence",
            "checked_files": len(file_entries),
        },
        "files": list(file_entries),
        "notes": [
            "This manifest is a redacted package index, not a competition submission bundle.",
            "The packager copies caller-provided files only and never runs real CLI/model/API flows.",
        ],
    }
    with open(redacted_manifest_path, "w", encoding="utf-8") as handle:
        json.dump(redacted_manifest, handle, ensure_ascii=False, indent=2)

    hash_lines = "\n".join(f"- {entry['path']} sha256={entry['sha256']}" for entry in file_entries)
    manifest_md = (
        "# TeamRun Demo Evidence Package\n"
        "\n"
        f"Generated: {format_powershell_datetime(now, 'yyyy-MM-dd HH:mm:ss zzz')}\n"
        f"Commit: {commit}\n"
        f"Package mode: {args.PackageMode}\n"
        "\n"
        "## Files\n"
        "\n"
        "- teamrun-evidence.json\n"
        "- redacted-manifest.json\n"
        f"{screenshot_lines}\n"
        "\n"
        f"Video: {video_line}\n"
        "\n"
        "## Redacted Manifest\n"
        "\n"
        f"- boundary_label: {boundary_label}\n"
        f"- path_boundary: package-relative files under .tmp/submission-evidence/teamrun-demo-{args.Stamp}\n"
        "- sensitive_value_scan: passed\n"
        "\n"
        "## Artifact Hashes\n"
        "\n"
        f"{hash_lines}\n"
        "\n"
        "## Evidence Summary\n"
        "\n"
        f"- fixture_only: {'True' if fixture_only else 'False'}\n"
        f"- real_runtime_executed: {'True' if real_runtime_executed else 'False'}\n"
        f"- final_recording_complete: {'True' if final_recording_complete else 'False'}\n"
        f"- submission_ready: {'True' if submission_ready else 'False'}\n"
        f"- runtime_profiles: {runtime_profiles_count}\n"
        f"- runtime_types: {runtime_types}\n"
        f"- screenshot_or_video_rehearsal: {rehearsal_mode}\n"
        "\n"
        "## Notes\n"
        "\n"
        "- This package is generated under .tmp/ and is intentionally ignored by Git.\n"
        "- The script only packages caller-provided files. It does not run real CLI/model gates or upload artifacts.\n"
        "- Fixture rehearsal packages are blocked from Submission mode until real runtime execution and the final recording are present.\n"
    )
    with open(manifest_path, "w", encoding="utf-8") as handle:
        handle.write(manifest_md)

    print("Created TeamRun demo evidence package:")
    print(f"  {os.path.normpath(output_dir)}")
    print("Manifest:")
    print(f"  {os.path.normpath(manifest_path)}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'，禁止静默吞错
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
