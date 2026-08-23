#!/usr/bin/env python3
"""AgentHub release gate verifier — ps1 迁移。

Verifies release readiness: ref divergence, workflow policy, version alignment,
RC tag policy, security risk register, and artifact manifest. Writes a
release-gate report JSON. It does not sign, notarize, staple, tag, push, or
upload releases.

Exit 0 when the gate is ready, exit 1 when blockers remain.
"""

import argparse
import json
import os
import re
import subprocess
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))

ready = []
warnings = []
blockers = []


def step(message: str) -> None:
    print(f"\n>>> {message}", flush=True)


def ready_check(message: str) -> None:
    print(f"READY: {message}", flush=True)
    ready.append(message)


def blocker(message: str) -> None:
    print(f"BLOCKER: {message}", flush=True)
    blockers.append(message)


def warn(message: str) -> None:
    print(f"WARN: {message}", flush=True)
    warnings.append(message)


def add_ready(message: str) -> None:
    ready_check(message)


def read_text(relative_path: str) -> str:
    full_path = os.path.join(REPO_ROOT, relative_path.replace("/", os.sep))
    if not os.path.isfile(full_path):
        blocker(f"required file is missing: {relative_path}")
        return ""
    with open(full_path, encoding="utf-8", errors="replace") as handle:
        return handle.read()


def read_json(relative_path: str) -> object:
    full_path = os.path.join(REPO_ROOT, relative_path.replace("/", os.sep))
    with open(full_path, encoding="utf-8", errors="replace") as handle:
        return json.loads(handle.read())


def test_pattern(text: str, pattern: str, ready_message: str, blocker_message: str) -> None:
    if re.search(pattern, text, re.IGNORECASE):
        add_ready(ready_message)
    else:
        blocker(blocker_message)


def invoke_git(repo_root: str, arguments: list) -> tuple:
    run = subprocess.run(
        ["git", "-C", repo_root, *arguments],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return run.returncode, run.stdout.splitlines()


def assert_release_refs(repo_root: str, base_ref: str, dev_ref: str, skip_ref_check: bool) -> None:
    if skip_ref_check:
        warn("ref check skipped by caller")
        return

    step("dev to master refs")
    for ref in (base_ref, dev_ref):
        probe_exit, probe_output = invoke_git(repo_root, ["rev-parse", "--verify", ref])
        if probe_exit != 0:
            blocker(f"required ref is unavailable: {ref}")
            return
        add_ready(f"{ref} resolves to {probe_output[0] if probe_output else ''}")

    behind_exit, behind_output = invoke_git(repo_root, ["rev-list", "--count", f"{dev_ref}..{base_ref}"])
    ahead_exit, ahead_output = invoke_git(repo_root, ["rev-list", "--count", f"{base_ref}..{dev_ref}"])
    if behind_exit != 0 or ahead_exit != 0:
        blocker(f"could not compute {dev_ref} divergence from {base_ref}")
        return

    behind_count = int(behind_output[0]) if behind_output and behind_output[0].isdigit() else 0
    ahead_count = int(ahead_output[0]) if ahead_output and ahead_output[0].isdigit() else 0
    if behind_count > 0:
        blocker(f"{dev_ref} is behind {base_ref} by {behind_count} commit(s); rebase/merge current master before dev->master")
    else:
        add_ready(f"{dev_ref} is not behind {base_ref}")

    add_ready(f"{dev_ref} is ahead of {base_ref} by {ahead_count} commit(s)")


def assert_workflow_policy(repo_root: str) -> None:
    step("release workflow and dry gates")
    readiness_text = read_text(".github/workflows/release-readiness.yml")
    release_text = read_text(".github/workflows/release.yml")

    test_pattern(readiness_text, "workflow_dispatch", "release readiness workflow is manually dispatchable", "release readiness workflow lacks workflow_dispatch")
    test_pattern(readiness_text, "run_windows_package_dry", "Windows package dry gate has an explicit manual input", "Windows package dry gate input is missing")
    test_pattern(
        readiness_text,
        r"verify-tauri-package-dry\.py[^\r\n]+-RunWindowsBundle[^\r\n]+-StrictToolchain",
        "Windows dry gate delegates to verify-tauri-package-dry.py with bundle and strict toolchain checks",
        "Windows dry gate does not call verify-tauri-package-dry.py with -RunWindowsBundle -StrictToolchain",
    )
    test_pattern(readiness_text, "actions/upload-artifact@v7", "release readiness dry outputs are workflow artifacts only", "release readiness workflow does not upload dry evidence artifacts")
    test_pattern(readiness_text, "run_macos_unsigned_dry_policy", "macOS future dry policy is manual and policy-only", "macOS unsigned dry policy input is missing")
    test_pattern(
        readiness_text,
        r"verify-tauri-package-dry\.py[^\r\n]+-RunMacosBundle",
        "macOS dry gate delegates to verify-tauri-package-dry.py with -RunMacosBundle on a macOS runner",
        "macOS dry gate does not call verify-tauri-package-dry.py with -RunMacosBundle",
    )
    test_pattern(readiness_text, "run_macos_package_dry", "macOS unsigned DMG dry build has an explicit manual input", "macOS package dry gate input is missing")

    if re.search(r"softprops/action-gh-release|^\s*(gh\s+release|xcrun\s+notarytool|notarytool\s+submit|xcrun\s+stapler|stapler\s+staple|codesign\s|TAURI_SIGNING_PRIVATE_KEY|APPLE_)", readiness_text, re.IGNORECASE | re.MULTILINE):
        blocker("release-readiness workflow contains release upload/signing/notarization execution surface")
    else:
        add_ready("release-readiness workflow does not sign, notarize, staple, tag, or upload a GitHub Release")

    test_pattern(release_text, r"tags:\s*\['v\*'\]", "release workflow is tag-triggered on v* only", "release workflow tag trigger is missing or not constrained to v*")
    test_pattern(release_text, "softprops/action-gh-release@v3", "release workflow has the real GitHub Release uploader isolated in the tag workflow", "release workflow GitHub Release uploader is missing")
    test_pattern(
        release_text,
        r"prerelease:\s*\$\{\{\s*contains\(github\.ref_name,\s*'-'\)\s*\}\}",
        "RC tags become GitHub prereleases via contains(github.ref_name, '-')",
        "release workflow prerelease policy is not tied to hyphenated semver tags",
    )


def get_desktop_version(repo_root: str) -> str:
    package_json = read_json("app/desktop/package.json")
    tauri_conf = read_json("app/desktop/src-tauri/tauri.conf.json")
    package_version = str(package_json["version"])
    tauri_version = str(tauri_conf["version"])
    if package_version != tauri_version:
        blocker(f"desktop package.json version ({package_version}) does not match tauri.conf.json version ({tauri_version})")
    else:
        add_ready(f"desktop package metadata version is aligned at {package_version}")
    return package_version


def assert_rc_tag_policy(version: str) -> None:
    step("RC and tag policy")
    if re.fullmatch(r"\d+\.\d+\.\d+-rc\.\d+", version):
        add_ready(f"current desktop version is an RC semver: {version}")
        add_ready(f"next RC tag convention: v{version}")
    elif re.fullmatch(r"\d+\.\d+\.\d+", version):
        warn(f"current desktop version is stable semver: {version}; use only after release blockers are closed")
    else:
        blocker(f"desktop version is not an accepted stable or rc semver: {version}")


SECURITY_GATE_HEADING = "## 发布门禁风险状态"
KNOWN_RISK_SEVERITIES = {"critical", "high", "medium", "low"}
NON_BLOCKING_CRITICAL_HIGH_STATUSES = {
    "accepted",
    "mitigated",
    "mitigated in repo",
    "closed",
}
BLOCKING_CRITICAL_HIGH_STATUS_MARKERS = (
    "rotate required",
    "verification required",
)


def normalize_risk_status(status: str) -> str:
    return " ".join(status.split()).casefold()


def split_markdown_table_row(line: str) -> list[str] | None:
    stripped = line.strip()
    if not stripped.startswith("|") or not stripped.endswith("|"):
        return None
    return [cell.replace(r"\|", "|").strip() for cell in re.split(r"(?<!\\)\|", stripped[1:-1])]


def parse_security_release_risks(security_text: str) -> tuple[list, list]:
    """Return policy blockers and fail-closed register integrity errors.

    Only Critical/High rows participate in release status semantics. Exact
    ``Open`` and statuses containing ``rotate required`` or
    ``verification required`` are policy blockers. Known terminal/accepted
    statuses are allowed; unknown statuses and malformed risk rows are
    integrity failures so a damaged table cannot silently bypass the gate.
    """

    lines = security_text.splitlines()
    heading_index = next((index for index, line in enumerate(lines) if line.strip() == SECURITY_GATE_HEADING), None)
    if heading_index is None:
        return [], [f"required section is missing: {SECURITY_GATE_HEADING}"]

    blocking_risks = []
    integrity_errors = []
    for index in range(heading_index + 1, len(lines)):
        line = lines[index]
        if line.startswith("## "):
            break
        if "AH-SR-" not in line.upper():
            continue

        line_number = index + 1
        cells = split_markdown_table_row(line)
        if cells is None or len(cells) != 4:
            integrity_errors.append(
                f"line {line_number}: malformed risk row; expected exactly four pipe-delimited cells"
            )
            continue

        risk_id, severity, status, risk = cells
        if not re.fullmatch(r"AH-SR-\d+", risk_id, re.IGNORECASE):
            integrity_errors.append(f"line {line_number}: malformed risk ID: {risk_id!r}")
            continue

        severity_key = severity.casefold()
        if severity_key not in KNOWN_RISK_SEVERITIES:
            integrity_errors.append(
                f"line {line_number}: {risk_id} has unknown severity {severity!r}"
            )
            continue
        if severity_key not in {"critical", "high"}:
            continue
        if not status or not risk:
            integrity_errors.append(
                f"line {line_number}: {risk_id}({severity}) must have non-empty Status and summary cells"
            )
            continue

        status_key = normalize_risk_status(status)
        gate_reason = None
        if status_key == "open":
            gate_reason = "status is Open"
        else:
            marker = next(
                (candidate for candidate in BLOCKING_CRITICAL_HIGH_STATUS_MARKERS if candidate in status_key),
                None,
            )
            if marker is not None:
                gate_reason = f"status contains {marker}"

        if gate_reason is not None:
            blocking_risks.append(
                {
                    "id": risk_id,
                    "severity": severity,
                    "status": status,
                    "risk": risk,
                    "gateReason": gate_reason,
                }
            )
        elif status_key not in NON_BLOCKING_CRITICAL_HIGH_STATUSES:
            integrity_errors.append(
                f"line {line_number}: {risk_id}({severity}) has unknown release-gate status {status!r}"
            )

    return blocking_risks, integrity_errors


def get_blocking_high_risks(repo_root: str) -> tuple[list, list]:
    risk_path = os.path.join(repo_root, "SECURITY.md")
    if not os.path.isfile(risk_path):
        return [], ["security policy is missing"]

    with open(risk_path, encoding="utf-8", errors="replace") as handle:
        return parse_security_release_risks(handle.read())


def assert_security_release_gate(repo_root: str, allow_open_high_risks: bool) -> list:
    step("security release gate")
    blocking_risks, integrity_errors = get_blocking_high_risks(repo_root)
    for error in integrity_errors:
        blocker(f"security risk register integrity failure: {error}")

    if not blocking_risks:
        if not integrity_errors:
            add_ready("no policy-blocking Critical/High risks in security register")
        return blocking_risks

    ids = ", ".join(
        f"{risk['id']}({risk['severity']}: {risk['status']})" for risk in blocking_risks
    )
    if allow_open_high_risks:
        warn(
            "policy-blocking Critical/High risks are being reported but not failing "
            f"because -AllowOpenHighRisks was set: {ids}"
        )
    else:
        blocker(f"policy-blocking Critical/High risks block public release: {ids}")
    return blocking_risks


def assert_artifact_manifest(repo_root: str, artifacts_root: str) -> list:
    if not artifacts_root:
        warn("artifact manifest check skipped because -ArtifactsRoot was not provided")
        return []

    step("Windows unsigned artifact manifest")
    artifact_root_full = artifacts_root if os.path.isabs(artifacts_root) else os.path.join(repo_root, artifacts_root)
    if not os.path.isdir(artifact_root_full):
        blocker(f"artifact root does not exist: {artifact_root_full}")
        return []

    manifest_path = os.path.join(artifact_root_full, "artifact-manifest.json")
    package_report_path = os.path.join(artifact_root_full, "package-dry-report.json")
    if not os.path.isfile(manifest_path):
        blocker(f"artifact-manifest.json is missing from {artifact_root_full}")
        return []
    if not os.path.isfile(package_report_path):
        blocker(f"package-dry-report.json is missing from {artifact_root_full}")

    with open(manifest_path, encoding="utf-8", errors="replace") as handle:
        manifest = json.loads(handle.read())

    required_patterns = [
        r"^AgentHub_\d+\.\d+\.\d+-rc\.\d+_x64-setup\.exe$",
        r"^AgentHub_\d+\.\d+\.\d+-rc\.\d+_x64-portable\.zip$",
        r"^agenthub-edge-windows-amd64\.exe$",
        r"^agenthub-desktop\.exe$",
        r"^package-dry-report\.json$",
    ]
    for pattern in required_patterns:
        entry = next((e for e in manifest if re.search(pattern, str(e.get("name", "")))), None)
        if entry is None:
            blocker(f"artifact manifest lacks required artifact pattern: {pattern}")
            continue
        if int(entry.get("bytes", 0)) <= 0 or not re.fullmatch(r"[A-Fa-f0-9]{64}", str(entry.get("sha256", ""))):
            blocker(f"artifact manifest entry is invalid for {entry.get('name')}")
        else:
            add_ready(f"artifact manifest includes {entry['name']} ({entry['bytes']} bytes, sha256 {entry['sha256']})")

    if os.path.isfile(package_report_path):
        with open(package_report_path, encoding="utf-8", errors="replace") as handle:
            dry_report = json.loads(handle.read())
        if str(dry_report.get("signing")) == "out-of-scope" and str(dry_report.get("releaseUpload")) == "out-of-scope":
            add_ready("package dry report keeps signing and release upload out of scope")
        else:
            blocker("package dry report does not preserve signing/release upload boundaries")
        if str(dry_report.get("stages", {}).get("updaterMetadata")) == "not_produced_unsigned_build":
            warn("unsigned dry build did not produce latest.json/.sig; updater metadata remains a signing/release blocker")

    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("-RepoRoot", "--RepoRoot", default=".", help="repository root")
    parser.add_argument("-BaseRef", "--BaseRef", default="origin/master", help="base (master) git ref")
    parser.add_argument("-DevRef", "--DevRef", default="origin/dev/demo-user", help="dev git ref")
    parser.add_argument("-ArtifactsRoot", "--ArtifactsRoot", default="", help="artifact root for the manifest gate")
    parser.add_argument("-ReportPath", "--ReportPath", default=".tmp/release-gate-report.json", help="release gate report output path")
    parser.add_argument(
        "-AllowOpenHighRisks",
        "--AllowOpenHighRisks",
        action="store_true",
        help="report policy-blocking Critical/High risks without failing; malformed/unknown statuses still fail closed",
    )
    parser.add_argument("-SkipRefCheck", "--SkipRefCheck", action="store_true", help="skip the git ref divergence check")
    args = parser.parse_args()

    global REPO_ROOT
    REPO_ROOT = os.path.abspath(args.RepoRoot)

    assert_release_refs(REPO_ROOT, args.BaseRef, args.DevRef, args.SkipRefCheck)
    assert_workflow_policy(REPO_ROOT)
    version = get_desktop_version(REPO_ROOT)
    assert_rc_tag_policy(version)
    blocking_high_risks = assert_security_release_gate(REPO_ROOT, args.AllowOpenHighRisks)
    manifest = assert_artifact_manifest(REPO_ROOT, args.ArtifactsRoot)

    step("blocking external approval slices")
    assert_signing_approval_gate()

    report_full_path = os.path.normpath(args.ReportPath if os.path.isabs(args.ReportPath) else os.path.join(REPO_ROOT, args.ReportPath))
    os.makedirs(os.path.dirname(report_full_path), exist_ok=True)
    report = {
        "mode": "agenthub-release-gate",
        "baseRef": args.BaseRef,
        "devRef": args.DevRef,
        "desktopVersion": version,
        "ready": ready,
        "warnings": warnings,
        "blockers": blockers,
        "blockingCriticalHighRisks": blocking_high_risks,
        "openCriticalHighRisks": blocking_high_risks,
        "artifactsRoot": args.ArtifactsRoot,
        "manifest": manifest,
    }
    with open(report_full_path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, ensure_ascii=False)

    print(f"\nRelease gate report: {report_full_path}", flush=True)
    if blockers:
        print(f"Release gate BLOCKED with {len(blockers)} blocker(s).", flush=True)
        return 1

    print("Release gate READY.", flush=True)
    return 0


def assert_signing_approval_gate() -> None:
    """Release signing policy. Three states, conservative by default:

    - RELEASE_SIGNING_APPROVED=true + signing evidence file → full signed
      release (Authenticode + notarization + signed updater metadata).
    - RELEASE_UNSIGNED_OK=true → Windows unsigned release: the NSIS
      installer and portable zip are published without a code-signing
      certificate (SmartScreen shows a warning; users click "More info →
      Run anyway"). The Tauri updater metadata stays self-signed via
      TAURI_SIGNING_PRIVATE_KEY, so auto-update keeps working. macOS DMG /
      notarization is out of scope entirely.
    - neither → freeze (conservative default), recorded as a blocker.

    Both approvals are explicit operator decisions surfaced via repo
    variables; the unsigned path records a warning in the gate report so
    the decision is auditable at release time.
    """
    approved = os.environ.get("RELEASE_SIGNING_APPROVED", "").lower() == "true"
    unsigned_ok = os.environ.get("RELEASE_UNSIGNED_OK", "").lower() == "true"
    evidence_path = os.path.join(REPO_ROOT, "deployments", "production", "signing-manifest.sha256")
    evidence_present = os.path.isfile(evidence_path)

    if approved and evidence_present:
        add_ready("signing/notarization freeze lifted: RELEASE_SIGNING_APPROVED=true and signing evidence present")
        add_ready("production updater publication approved alongside signing freeze lift")
        return

    if unsigned_ok:
        warn(
            "unsigned release policy approved via RELEASE_UNSIGNED_OK=true: "
            "Windows installer/portable publish without Authenticode signing "
            "(SmartScreen warning expected); updater metadata is self-signed; "
            "macOS DMG/notarization is out of scope"
        )
        return

    if not approved:
        blocker("signing/notarization not approved: set repo variable RELEASE_SIGNING_APPROVED=true to lift the freeze")
    elif not evidence_present:
        blocker("signing/notarization approval set but signing evidence file is missing: deployments/production/signing-manifest.sha256")
    # Updater publication is gated by the same freeze; mirror the reason so the
    # report is explicit about both blocked slices.
    if not (approved and evidence_present):
        blocker("production updater publication remains blocked until signed latest.json and installer signature are produced and approved (signing freeze not lifted)")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— 顶层兜底，对齐 ps1 $ErrorActionPreference='Stop'
        print(f"ERROR: {exc}", file=sys.stderr, flush=True)
        sys.exit(1)
