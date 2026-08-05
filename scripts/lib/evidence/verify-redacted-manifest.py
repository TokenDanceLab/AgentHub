#!/usr/bin/env python3
"""AgentHub redacted evidence manifest verifier — ps1 迁移。

Verifies an AgentHub redacted evidence manifest without running CLIs, model
APIs, services, uploads, or competition packaging.

Exit 0 on pass, exit 1 if any check fails.
"""

import argparse
import hashlib
import json
import os
import re
import sys

SENSITIVE_VALUE_PATTERN = re.compile(
    r"(Authorization\s*:\s*Bearer\s+(?!<redacted)[^\s,;]+"
    r"|Cookie\s*:\s*[^\r\n]+"
    r"|(?:password|passwd|client[_ -]?secret|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|id[_ -]?token|auth[_ -]?token)\s*[:=]\s*"
    r"(?!\"?(?:false|true|null|none|not[_ -]?required|not[_ -]?available|blocked|redacted|<redacted|fixture|manifest|approved|redact)[^\"]*\"?)"
    r"(?!\"?\s*(?:false|true|null)\"?\s*(?:,|$))"
    r"[\"']?[^\"'\s,;}]{8,}"
    r"|(?<![A-Za-z0-9_])(?:sk|ghp|gho|ghu|ghs|glpat|xox[baprs])-[-_A-Za-z0-9]{12,})",
    re.IGNORECASE,
)
TEXT_SCAN_EXTENSIONS = (".json", ".md", ".txt", ".log", ".csv", ".yaml", ".yml")

passed = 0
failed = 0


def pass_check(text: str) -> None:
    global passed
    passed += 1
    print(f"  PASS  {text}", flush=True)


def fail_check(text: str) -> None:
    global failed
    failed += 1
    print(f"  FAIL  {text}", flush=True)


def resolve_input_path(path_value: str) -> str | None:
    if not path_value or not path_value.strip():
        return None
    if os.path.isabs(path_value):
        return os.path.abspath(path_value)
    return os.path.abspath(os.path.join(os.getcwd(), path_value))


def test_package_relative_path(relative_path: str) -> bool:
    if not relative_path or not relative_path.strip():
        return False
    if os.path.isabs(relative_path):
        return False
    if re.search(r"(^|/|\\)\.\.($|/|\\)", relative_path):
        return False
    return True


def test_text_redaction(path: str) -> bool:
    extension = os.path.splitext(path)[1].lower()
    if extension not in TEXT_SCAN_EXTENSIONS:
        return True
    with open(path, encoding="utf-8", errors="replace") as handle:
        content = handle.read()
    return SENSITIVE_VALUE_PATTERN.search(content) is None


def get_sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("-ManifestPath", "--ManifestPath", default="", help="path to the redacted evidence manifest")
    parser.add_argument("-PackagePath", "--PackagePath", default="", help="package directory containing redacted-manifest.json")
    args = parser.parse_args()

    manifest_path_value = args.ManifestPath
    if not manifest_path_value.strip() and args.PackagePath.strip():
        manifest_path_value = os.path.join(args.PackagePath, "redacted-manifest.json")

    resolved_manifest = resolve_input_path(manifest_path_value)
    if not resolved_manifest or not os.path.isfile(resolved_manifest):
        fail_check("redacted manifest exists")
        print(f"\nRedacted manifest verification: {passed} passed, {failed} failed", flush=True)
        return 1
    pass_check("redacted manifest exists")

    package_root = os.path.dirname(resolved_manifest)
    root_full = os.path.abspath(package_root)
    if not root_full.endswith(os.sep):
        root_full += os.sep

    manifest = None
    try:
        with open(resolved_manifest, encoding="utf-8", errors="replace") as handle:
            manifest = json.loads(handle.read())
        pass_check("redacted manifest parses")
    except (OSError, ValueError):
        fail_check("redacted manifest parses")

    if manifest:
        if manifest.get("schema") == "agenthub-redacted-evidence-manifest-v1":
            pass_check("redacted manifest schema is supported")
        else:
            fail_check("redacted manifest schema is supported")

        label = str(manifest.get("evidence_boundary", {}).get("label") or "")
        if label in ("fixture", "observed", "RealTested", "approved-real"):
            pass_check("evidence boundary label is explicit")
        else:
            fail_check("evidence boundary label is explicit")

        if manifest.get("redaction", {}).get("status") == "passed":
            pass_check("redaction status is passed")
        else:
            fail_check("redaction status is passed")

        files = [entry for entry in manifest.get("files", [])]
        if files:
            pass_check("manifest lists files")
        else:
            fail_check("manifest lists files")

        for file in files:
            relative = str(file.get("path") or "")
            if test_package_relative_path(relative):
                pass_check(f"file path is package-relative: {relative}")
            else:
                fail_check(f"file path is package-relative: {relative}")
                continue

            full = os.path.abspath(os.path.join(package_root, relative))
            if full.lower().startswith(root_full.lower()):
                pass_check(f"file stays under package root: {relative}")
            else:
                fail_check(f"file stays under package root: {relative}")
                continue

            if os.path.isfile(full):
                pass_check(f"file exists: {relative}")
            else:
                fail_check(f"file exists: {relative}")
                continue

            actual_hash = get_sha256(full)
            if actual_hash == str(file.get("sha256") or "").lower():
                pass_check(f"file hash matches: {relative}")
            else:
                fail_check(f"file hash matches: {relative}")

            if test_text_redaction(full):
                pass_check(f"text file has no sensitive values: {relative}")
            else:
                fail_check(f"text file has no sensitive values: {relative}")

    print(f"\nRedacted manifest verification: {passed} passed, {failed} failed", flush=True)
    if failed > 0:
        return 1
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr, flush=True)
        sys.exit(1)
