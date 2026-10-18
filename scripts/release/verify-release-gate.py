#!/usr/bin/env python3
"""AgentHub release gate verifier.

Verifies release readiness: ref divergence, workflow policy, version alignment,
RC tag policy. Writes a release-gate report JSON. It
does not sign, notarize, staple, tag, push, or upload releases.

Exit 0 when the gate is ready, exit 1 when blockers remain.
"""

import argparse
import json
import os
import re
import subprocess
import sys

import yaml

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "verify"))
from shell_guard import (  # noqa: E402
    executed_lines,
    command_segment,
    masks_failure,
    script_execution,
    short_circuited,
    step_constructs,
    strip_comment,
    statically_false,
    warning_only,
)

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
        blocker(f"{dev_ref} is behind {base_ref} by {behind_count} commit(s); rebase or merge the current base before releasing")
    else:
        ready_check(f"{dev_ref} is not behind {base_ref}")

    ready_check(f"{dev_ref} is ahead of {base_ref} by {ahead_count} commit(s)")


FORBIDDEN_COMMAND = re.compile(
    r"(?:gh\s+release|xcrun\s+notarytool|notarytool\s+submit|xcrun\s+stapler|stapler\s+staple|codesign\b)",
    re.IGNORECASE,
)
SIGNING_TOKENS = ("TAURI_SIGNING_PRIVATE_KEY", "APPLE_")


def load_workflow(relative_path: str):
    """Parse a workflow; a missing, empty, or unparseable file is a blocker."""
    text = read_text(relative_path)
    full_path = os.path.join(REPO_ROOT, relative_path.replace("/", os.sep))
    if not os.path.isfile(full_path):
        return None  # read_text already recorded the missing-file blocker
    if not text.strip():
        blocker(f"{relative_path} is empty — cannot verify its policy")
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
    # YAML 1.1 parses the unquoted `on:` key as boolean True.
    triggers = workflow.get("on", workflow.get(True))
    return triggers if isinstance(triggers, dict) else {}


def active_jobs(workflow, triggers=frozenset(), event=None, job_outputs=None):
    for job in (workflow.get("jobs") or {}).values():
        if not isinstance(job, dict):
            continue
        if statically_false(job.get("if"), triggers, event, job_outputs) or warning_only(job):
            continue
        yield job


def workflow_job_steps(workflow, triggers=frozenset(), event=None, job_outputs=None):
    for job in active_jobs(workflow, triggers, event, job_outputs):
        for step in job.get("steps") or []:
            if isinstance(step, dict):
                yield job, step


def workflow_steps(workflow, triggers=frozenset(), event=None, job_outputs=None):
    for _job, step in workflow_job_steps(workflow, triggers, event, job_outputs):
        yield step


def declared_job_outputs(workflow) -> dict:
    return {
        name: set(job.get("outputs") or {})
        for name, job in (workflow.get("jobs") or {}).items()
        if isinstance(job, dict)
    }


























def step_runs(
    step,
    script: str,
    *required_args: str,
    triggers=frozenset(),
    event=None,
    job_outputs=None,
) -> bool:
    if statically_false(step.get("if"), triggers, event, job_outputs) or warning_only(step):
        return False
    if step_constructs(step.get("run", "")):
        return False  # the invocation may be unreachable or its status masked
    for line in executed_lines(step.get("run", "")):
        line = strip_comment(line)
        for match in re.finditer(re.escape(script), line):
            index = match.start()
            tail = re.split(r"[;&|]", line[index + len(script):], maxsplit=1)[0]
            argv = [token.strip("'\"") for token in tail.split()]
            if not all(arg in argv for arg in required_args):
                continue
            if command_segment(line, index).strip().startswith("!"):
                continue
            if masks_failure(line[index + len(script):]):
                continue
            if short_circuited(line, index):
                continue
            if script_execution(line, script, skip_masked=False, skip_negated=False) is None:
                continue
            return True
    return False


def workflow_has_artifact_upload(workflow, triggers=frozenset(), event=None, job_outputs=None) -> bool:
    """A dry-gate job must upload its evidence after the gate step.

    An upload step in an unrelated job (or before the dry gate) does not carry
    the evidence this workflow claims to produce.
    """
    for job in active_jobs(workflow, triggers, event, job_outputs):
        steps = [step for step in job.get("steps") or [] if isinstance(step, dict)]
        for index, step in enumerate(steps):
            if not step_runs(
                step,
                "verify-tauri-package-dry.py",
                triggers=triggers,
                event=event,
                job_outputs=job_outputs,
            ):
                continue
            if any(
                str(later.get("uses", "")).startswith("actions/upload-artifact@v7")
                and not statically_false(later.get("if"), triggers, event, job_outputs)
                and not warning_only(later)
                for later in steps[index + 1:]
            ):
                return True
    return False


def forbidden_line(line: str) -> bool:
    """Quoted or split command words still name the same executable.

    A line that is only a quoted string (a policy/label list entry) names a
    capability; it does not execute it.
    """
    stripped = strip_comment(line).strip()
    if re.fullmatch(r"['\"][^'\"]*['\"]\s*,?", stripped):
        return False
    normalized = re.sub(r"[\"'`\\]", "", stripped)
    return FORBIDDEN_COMMAND.search(normalized) is not None


def workflow_forbidden_surface(workflow) -> bool:
    environments = [workflow.get("env")]
    for job in (workflow.get("jobs") or {}).values():
        if not isinstance(job, dict):
            continue
        environments.append(job.get("env"))
        for step in job.get("steps") or []:
            if not isinstance(step, dict):
                continue
            if "softprops/action-gh-release" in str(step.get("uses", "")):
                return True
            if any(token in json.dumps(step) for token in SIGNING_TOKENS):
                return True
            # Raw lines (continuations joined) include heredoc bodies: a shell
            # fed by a heredoc runs them.
            run_text = str(step.get("run", "")).replace("\\\r\n", " ").replace("\\\n", " ")
            if any(forbidden_line(line) for line in run_text.splitlines()):
                return True
    return any(isinstance(env, dict) and any(token in json.dumps(env) for token in SIGNING_TOKENS) for env in environments)


def assert_workflow_policy(repo_root: str) -> None:
    step("release workflow and dry gates")
    readiness = load_workflow(".github/workflows/release-readiness.yml")
    release = load_workflow(".github/workflows/release.yml")

    if readiness is not None:
        triggers = workflow_triggers(readiness)
        if "workflow_dispatch" not in triggers:
            blocker("release readiness workflow lacks workflow_dispatch")
            inputs = {}
        else:
            ready_check("release readiness workflow is manually dispatchable")
            dispatch = triggers.get("workflow_dispatch") or {}
            inputs = dispatch.get("inputs") if isinstance(dispatch, dict) else {}
            inputs = inputs if isinstance(inputs, dict) else {}
        for input_name, ready_message, missing_message in (
            ("run_windows_package_dry", "Windows package dry gate has an explicit manual input", "Windows package dry gate input is missing"),
            ("run_macos_unsigned_dry_policy", "macOS future dry policy is manual and policy-only", "macOS unsigned dry policy input is missing"),
            ("run_macos_package_dry", "macOS unsigned DMG dry build has an explicit manual input", "macOS package dry gate input is missing"),
        ):
            if input_name in inputs:
                ready_check(ready_message)
            else:
                blocker(missing_message)
        event_names = set(triggers)
        event = "workflow_dispatch"
        job_outputs = declared_job_outputs(readiness)
        if any(
            step_runs(
                item,
                "verify-tauri-package-dry.py",
                "-RunWindowsBundle",
                "-StrictToolchain",
                triggers=event_names,
                event=event,
                job_outputs=job_outputs,
            )
            for item in workflow_steps(readiness, event_names, event, job_outputs)
        ):
            ready_check("Windows dry gate delegates to verify-tauri-package-dry.py with bundle and strict toolchain checks")
        else:
            blocker("Windows dry gate does not call verify-tauri-package-dry.py with -RunWindowsBundle -StrictToolchain")
        if workflow_has_artifact_upload(readiness, event_names, event, job_outputs):
            ready_check("release readiness dry outputs are workflow artifacts only")
        else:
            blocker("release readiness workflow does not upload dry evidence artifacts")
        if any(
            step_runs(
                item,
                "verify-tauri-package-dry.py",
                "-RunMacosBundle",
                triggers=event_names,
                event=event,
                job_outputs=job_outputs,
            )
            and "macos" in str(job.get("runs-on", "")).lower()
            for job, item in workflow_job_steps(readiness, event_names, event, job_outputs)
        ):
            ready_check("macOS dry gate delegates to verify-tauri-package-dry.py with -RunMacosBundle on a macOS runner")
        else:
            blocker("macOS dry gate does not call verify-tauri-package-dry.py with -RunMacosBundle")
        if workflow_forbidden_surface(readiness):
            blocker("release-readiness workflow contains release upload/signing/notarization execution surface")
        else:
            ready_check("release-readiness workflow does not sign, notarize, staple, tag, or upload a GitHub Release")

    if release is not None:
        triggers = workflow_triggers(release)
        event = "push"
        job_outputs = declared_job_outputs(release)
        push = triggers.get("push")
        tag_triggered = (
            set(triggers) == {"push"}
            and isinstance(push, dict)
            and set(push) == {"tags"}
            and push.get("tags") == ["v*"]
        )
        if tag_triggered:
            ready_check("release workflow is tag-triggered on v* only")
        else:
            blocker("release workflow tag trigger is missing or not constrained to v*")
        uploader_step = next(
            (
                item
                for item in workflow_steps(release, set(triggers), event, job_outputs)
                if str(item.get("uses", "")).startswith("softprops/action-gh-release@v3")
                and not statically_false(item.get("if"), set(triggers), event, job_outputs)
                and not warning_only(item)
            ),
            None,
        )
        if uploader_step is not None:
            ready_check("release workflow has the real GitHub Release uploader isolated in the tag workflow")
        else:
            blocker("release workflow GitHub Release uploader is missing")
        prerelease_ok = (
            isinstance(uploader_step, dict)
            and isinstance(uploader_step.get("with"), dict)
            and re.fullmatch(
                r"\$\{\{\s*contains\(\s*github\.ref_name\s*,\s*'-'\s*\)\s*\}\}",
                str(uploader_step["with"].get("prerelease", "")).strip(),
            )
        )
        if prerelease_ok:
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
    """Release requires a security-risk review scoped to this release tag.

    The gate records that a maintainer reviewed the risks for this tag; the
    review itself stays with the maintainer release checklist. A bare "true" is rejected:
    a repository variable is not per-release state, so it would satisfy every
    future release after one flip.
    """
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
    # Updater publication is gated by the same freeze; mirror the reason so the
    # report is explicit about both blocked items.
    if not (approved and evidence_present):
        blocker("production updater publication remains blocked until signed latest.json and installer signature are produced and approved (signing freeze not lifted)")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 —— fail closed：未捕获异常返回非零
        print(f"ERROR: {exc}", file=sys.stderr, flush=True)
        sys.exit(1)
