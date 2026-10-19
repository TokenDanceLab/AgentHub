#!/usr/bin/env python3
"""AgentHub release gate verifier.

Verifies release readiness: ref divergence, workflow policy, version alignment,
RC tag policy, and explicit release approvals. It does not sign, notarize,
staple, tag, push, or upload releases.

Exit 0 when the gate is ready, exit 1 when blockers remain.
"""

import argparse
import json
import os
import re
import subprocess
import sys

import yaml

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

    step("release refs")
    for ref in (base_ref, dev_ref):
        probe_exit, probe_output = invoke_git(repo_root, ["rev-parse", "--verify", ref])
        if probe_exit != 0:
            blocker(f"required ref is unavailable: {ref}")
            return
        ready_check(f"{ref} resolves to {probe_output[0] if probe_output else ''}")

    behind_exit, behind_output = invoke_git(repo_root, ["rev-list", "--count", f"{dev_ref}..{base_ref}"])
    ahead_exit, ahead_output = invoke_git(repo_root, ["rev-list", "--count", f"{base_ref}..{dev_ref}"])
    if behind_exit != 0 or ahead_exit != 0:
        blocker(f"could not compute {dev_ref} divergence from {base_ref}")
        return

    behind_count = int(behind_output[0]) if behind_output and behind_output[0].isdigit() else 0
    ahead_count = int(ahead_output[0]) if ahead_output and ahead_output[0].isdigit() else 0
    if behind_count > 0:
        blocker(f"{dev_ref} is behind {base_ref} by {behind_count} commit(s); rebase or merge before releasing")
    else:
        ready_check(f"{dev_ref} is not behind {base_ref}")
    ready_check(f"{dev_ref} is ahead of {base_ref} by {ahead_count} commit(s)")


SIGNING_TOKENS = ("TAURI_SIGNING_PRIVATE_KEY", "APPLE_")


def load_workflow(relative_path: str):
    text = read_text(relative_path)
    full_path = os.path.join(REPO_ROOT, relative_path.replace("/", os.sep))
    if not os.path.isfile(full_path):
        return None
    if not text.strip():
        blocker(f"{relative_path} is empty - cannot verify its policy")
        return None
    try:
        workflow = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        blocker(f"{relative_path} is not valid YAML: {exc}")
        return None
    if not isinstance(workflow, dict):
        blocker(f"{relative_path} does not parse to a workflow mapping")
        return None
    return workflow


def workflow_triggers(workflow) -> dict:
    triggers = workflow.get("on", workflow.get(True))
    return triggers if isinstance(triggers, dict) else {}


def advisory(item) -> bool:
    value = item.get("continue-on-error")
    if value is None:
        return False
    return str(value).strip().lower() not in {"false", "${{ false }}", "0", "none", ""}


def disabled(item) -> bool:
    return advisory(item) or str(item.get("if", "")).strip().lower() in {"false", "${{ false }}"}


def steps(job) -> list:
    return [step for step in job.get("steps") or [] if isinstance(step, dict) and not disabled(step)]


def step_invokes(step, script: str, *required_args: str) -> bool:
    for raw in str(step.get("run") or "").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or line.startswith(("echo ", "printf ", "cat ", "test ", "which ")):
            continue
        if script in line and all(argument in line for argument in required_args):
            return True
    return False


def job_uses_input(job, input_name: str) -> bool:
    condition = str(job.get("if", ""))
    return "workflow_dispatch" in condition and f"inputs.{input_name}" in condition


def has_artifact_upload_after(job, gate_step) -> bool:
    ordered = steps(job)
    gate_index = ordered.index(gate_step)
    return any(
        str(candidate.get("uses", "")).startswith("actions/upload-artifact@v7")
        for candidate in ordered[gate_index + 1:]
    )


def workflow_release_surface(workflow) -> bool:
    """Readiness must not upload a release or carry signing material."""
    environments = [workflow.get("env")]
    for job in (workflow.get("jobs") or {}).values():
        if not isinstance(job, dict):
            continue
        environments.append(job.get("env"))
        for workflow_step in job.get("steps") or []:
            if not isinstance(workflow_step, dict):
                continue
            if "softprops/action-gh-release" in str(workflow_step.get("uses", "")):
                return True
            if any(token in json.dumps(workflow_step) for token in SIGNING_TOKENS):
                return True
    return any(
        isinstance(environment, dict)
        and any(token in json.dumps(environment) for token in SIGNING_TOKENS)
        for environment in environments
    )


def workflow_grants_contents_write(workflow) -> bool:
    """A read-only workflow cannot create a release even if one is scripted."""

    def grants_write(permissions) -> bool:
        return isinstance(permissions, dict) and str(permissions.get("contents", "")).strip().lower() == "write"

    if grants_write(workflow.get("permissions")):
        return True
    return any(
        isinstance(job, dict) and grants_write(job.get("permissions"))
        for job in (workflow.get("jobs") or {}).values()
    )


def assert_workflow_policy(repo_root: str) -> None:
    step("release workflow and dry gates")
    readiness = load_workflow(".github/workflows/release-readiness.yml")
    release = load_workflow(".github/workflows/release.yml")

    if readiness is not None:
        triggers = workflow_triggers(readiness)
        dispatch = triggers.get("workflow_dispatch")
        if dispatch is None:
            blocker("release readiness workflow lacks workflow_dispatch")
            inputs = {}
        else:
            ready_check("release readiness workflow is manually dispatchable")
            inputs = dispatch.get("inputs") if isinstance(dispatch, dict) else {}
            inputs = inputs if isinstance(inputs, dict) else {}
        for input_name, ready_message, missing_message in (
            ("run_windows_package_dry", "Windows package dry gate has an explicit manual input", "Windows package dry gate input is missing"),
            ("run_macos_unsigned_dry_policy", "macOS future dry policy is manual and policy-only", "macOS unsigned dry policy input is missing"),
            ("run_macos_package_dry", "macOS unsigned DMG dry build has an explicit manual input", "macOS package dry gate input is missing"),
        ):
            (ready_check if input_name in inputs else blocker)(ready_message if input_name in inputs else missing_message)

        jobs = readiness.get("jobs") or {}
        windows = jobs.get("windows-package-dry")
        if not isinstance(windows, dict) or not job_uses_input(windows, "run_windows_package_dry"):
            blocker("Windows dry gate job is missing or not gated by run_windows_package_dry")
        else:
            gate = next(
                (
                    candidate
                    for candidate in steps(windows)
                    if step_invokes(candidate, "verify-tauri-package-dry.py", "-RunWindowsBundle", "-StrictToolchain")
                ),
                None,
            )
            if gate is None:
                blocker("Windows dry gate does not call verify-tauri-package-dry.py with -RunWindowsBundle -StrictToolchain")
            else:
                ready_check("Windows dry gate delegates to verify-tauri-package-dry.py with bundle and strict toolchain checks")
                if has_artifact_upload_after(windows, gate):
                    ready_check("Windows dry outputs are workflow artifacts only")
                else:
                    blocker("Windows dry gate does not upload evidence after the gate")

        macos_policy = jobs.get("macos-unsigned-dry-policy")
        if not isinstance(macos_policy, dict) or not job_uses_input(macos_policy, "run_macos_unsigned_dry_policy"):
            blocker("macOS unsigned policy job is missing or not manually gated")
        else:
            ready_check("macOS unsigned dry policy is manual and policy-only")

        macos = jobs.get("macos-package-dry")
        if not isinstance(macos, dict) or not job_uses_input(macos, "run_macos_package_dry"):
            blocker("macOS dry gate job is missing or not gated by run_macos_package_dry")
        elif "macos" not in str(macos.get("runs-on", "")).lower():
            blocker("macOS dry gate does not run on a macOS runner")
        else:
            gate = next(
                (
                    candidate
                    for candidate in steps(macos)
                    if step_invokes(candidate, "verify-tauri-package-dry.py", "-RunMacosBundle")
                ),
                None,
            )
            if gate is None:
                blocker("macOS dry gate does not call verify-tauri-package-dry.py with -RunMacosBundle")
            else:
                ready_check("macOS dry gate delegates to verify-tauri-package-dry.py on a macOS runner")
                if has_artifact_upload_after(macos, gate):
                    ready_check("macOS dry outputs are workflow artifacts only")
                else:
                    blocker("macOS dry gate does not upload evidence after the gate")

        if workflow_grants_contents_write(readiness):
            blocker("release-readiness workflow can write repository contents; readiness must stay read-only")
        else:
            ready_check("release-readiness workflow cannot publish a GitHub Release (contents: read only)")
        if workflow_release_surface(readiness):
            blocker("release-readiness workflow contains a release uploader or signing material")
        else:
            ready_check("release-readiness workflow carries no release uploader or signing material")

    if release is not None:
        triggers = workflow_triggers(release)
        push = triggers.get("push")
        tag_triggered = (
            set(triggers) == {"push"}
            and isinstance(push, dict)
            and set(push) == {"tags"}
            and push.get("tags") == ["v*"]
        )
        (ready_check if tag_triggered else blocker)(
            "release workflow is tag-triggered on v* only"
            if tag_triggered
            else "release workflow tag trigger is missing or not constrained to v*"
        )

        release_job = (release.get("jobs") or {}).get("release")
        uploader = None
        if isinstance(release_job, dict):
            uploader = next(
                (
                    candidate
                    for candidate in steps(release_job)
                    if str(candidate.get("uses", "")).startswith("softprops/action-gh-release@v3")
                ),
                None,
            )
        if uploader is None:
            blocker("release workflow GitHub Release uploader is missing")
        else:
            ready_check("release workflow has the real GitHub Release uploader in the release job")
            prerelease = str((uploader.get("with") or {}).get("prerelease", "")).strip()
            if re.fullmatch(r"\$\{\{\s*contains\(\s*github\.ref_name\s*,\s*'-'\s*\)\s*\}\}", prerelease):
                ready_check("RC tags become GitHub prereleases via contains(github.ref_name, '-')")
            else:
                blocker("release workflow prerelease policy is not tied to hyphenated semver tags")


def get_desktop_version(repo_root: str) -> str:
    package_json = read_json("app/desktop/package.json")
    tauri_conf = read_json("app/desktop/src-tauri/tauri.conf.json")
    package_version = str(package_json["version"])
    tauri_version = str(tauri_conf["version"])
    if package_version != tauri_version:
        blocker(f"desktop package.json version ({package_version}) does not match tauri.conf.json version ({tauri_version})")
    else:
        ready_check(f"desktop package metadata version is aligned at {package_version}")
    return package_version


def assert_rc_tag_policy(version: str) -> None:
    step("RC and tag policy")
    if re.fullmatch(r"\d+\.\d+\.\d+-rc\.\d+", version):
        ready_check(f"current desktop version is an RC semver: {version}")
        ready_check(f"next RC tag convention: v{version}")
    elif re.fullmatch(r"\d+\.\d+\.\d+", version):
        warn(f"current desktop version is stable semver: {version}; use only after release blockers are closed")
    else:
        blocker(f"desktop version is not an accepted stable or rc semver: {version}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("-RepoRoot", "--RepoRoot", default=".", help="repository root")
    parser.add_argument("-BaseRef", "--BaseRef", default="origin/master", help="base (master) git ref")
    parser.add_argument("-DevRef", "--DevRef", default="HEAD", help="release candidate git ref")
    parser.add_argument("-ReportPath", "--ReportPath", default=".tmp/release-gate-report.json", help="release gate report output path")
    parser.add_argument("-SkipRefCheck", "--SkipRefCheck", action="store_true", help="skip the git ref divergence check")
    parser.add_argument("-ReleaseTag", "--ReleaseTag", default="", help="release tag the risk review must name (default: RELEASE_TAG)")
    args = parser.parse_args()

    global REPO_ROOT
    REPO_ROOT = os.path.abspath(args.RepoRoot)

    assert_release_refs(REPO_ROOT, args.BaseRef, args.DevRef, args.SkipRefCheck)
    assert_workflow_policy(REPO_ROOT)
    version = get_desktop_version(REPO_ROOT)
    assert_rc_tag_policy(version)

    step("blocking external approvals")
    assert_risk_review_gate(args.ReleaseTag)
    assert_signing_approval_gate()

    report_full_path = os.path.normpath(args.ReportPath if os.path.isabs(args.ReportPath) else os.path.join(REPO_ROOT, args.ReportPath))
    os.makedirs(os.path.dirname(report_full_path), exist_ok=True)
    report = {
        "mode": "agenthub-release-gate",
        "baseRef": args.BaseRef,
        "releaseRef": args.DevRef,
        "desktopVersion": version,
        "ready": ready,
        "warnings": warnings,
        "blockers": blockers,
    }
    with open(report_full_path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, ensure_ascii=False)

    print(f"\nRelease gate report: {report_full_path}", flush=True)
    if blockers:
        print(f"Release gate BLOCKED with {len(blockers)} blocker(s).", flush=True)
        return 1
    print("Release gate READY.", flush=True)
    return 0


def assert_risk_review_gate(release_tag: str = "") -> None:
    step("security risk review")
    tag = (release_tag or os.environ.get("RELEASE_TAG", "")).strip()
    reviewed = os.environ.get("RELEASE_RISK_REVIEWED", "").strip()
    if not tag:
        blocker("release tag is required to scope the security risk review (set RELEASE_TAG)")
    elif reviewed == tag:
        ready_check(f"security risk review recorded for {tag}")
    elif reviewed.lower() == "true":
        blocker("RELEASE_RISK_REVIEWED=true is not release-scoped; set it to the release tag")
    else:
        blocker(f"security risk review not recorded for {tag}; set RELEASE_RISK_REVIEWED={tag} after maintainer review")


def assert_signing_approval_gate() -> None:
    approved = os.environ.get("RELEASE_SIGNING_APPROVED", "").lower() == "true"
    unsigned_ok = os.environ.get("RELEASE_UNSIGNED_OK", "").lower() == "true"
    evidence_path = os.path.join(REPO_ROOT, "deployments", "production", "signing-manifest.sha256")
    evidence_present = os.path.isfile(evidence_path)

    if approved and evidence_present:
        ready_check("signing/notarization freeze lifted: RELEASE_SIGNING_APPROVED=true and signing evidence present")
        ready_check("production updater publication approved alongside signing freeze lift")
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
    blocker("production updater publication remains blocked until signed latest.json and installer signature are approved")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr, flush=True)
        sys.exit(1)
