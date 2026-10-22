#!/usr/bin/env python3
"""Assert the CI workflow keeps its security and contract gates wired.

This is a structural policy check, not a workflow interpreter. actionlint owns
workflow syntax and shell parsing; this script only verifies that required
jobs/steps still exist, cannot become advisory, and keep their script wiring.
"""

import argparse
import json
import os
import re
import sys

import yaml

POLICY = {
    "checks.yml": {
        "required_jobs": (
            "validate",
            "go-hub",
            "go-edge",
            "windows-go",
            "windows-frontend",
            "backend-required",
            "frontend-required",
        ),
        "must_always_report": (
            "go-hub",
            "go-edge",
            "windows-go",
            "windows-frontend",
            "backend-required",
            "frontend-required",
        ),
        "verifier_jobs": {
            "vuln-scan-js": "verify-vulnerability-gates.sh",
            "vuln-scan-go": "verify-vulnerability-gates.sh",
            "vuln-scan-rust": "verify-rust-advisories.sh",
        },
        "job_scripts": {
            "validate": (
                "scripts/verify/verify-doc-ssot.py",
                "scripts/verify/verify-openapi-contract.py",
                "scripts/verify/verify-commit-messages.sh",
            ),
        },
        "required_steps": {
            "go-edge-static": {"Security scan (gosec)": ("verify-gosec-gates.sh",)},
            "go-hub-static": {"Security scan (gosec)": ("verify-gosec-gates.sh",)},
            "validate": {
                "Secret guard": ("check-secrets.sh",),
                "Lint Python gates (ruff)": ("ruff check",),
                "Self-test security gates": (
                    "test_verify_vulnerability_gates.sh",
                    "test_verify_gosec_gates.sh",
                    "test_check_secrets.sh",
                ),
                "Self-test repository contract gates": (
                    "verify-doc-ssot.py --self-test",
                    "verify-ci-invariants.py --self-test",
                ),
            },
        },
        "dispatch_only_jobs": {
            "real-e2e-stack": (
                "vars.AGENTHUB_E2E_ACCOUNT_ISSUER",
                "vars.AGENTHUB_E2E_ACCOUNT_CLIENT_ID",
                "secrets.AGENTHUB_E2E_ACCOUNT_CLIENT_SECRET",
                "secrets.AGENTHUB_E2E_USER_EMAIL",
                "secrets.AGENTHUB_E2E_USER_PASSWORD",
                "secrets.AGENTHUB_E2E_PARTNER_EMAIL",
                "secrets.AGENTHUB_E2E_PARTNER_PASSWORD",
            )
        },
    },
    "release.yml": {
        "required_jobs": ("release-gate",),
        "must_always_report": (),
        "verifier_jobs": {"release-gate": "scripts/release/verify-release-gate.py"},
        "job_scripts": {},
        "required_steps": {},
        "protected_environments": {"release-gate": "release"},
    },
    "release-readiness.yml": {
        "required_jobs": ("readiness-policy", "windows-package-dry", "macos-package-dry"),
        "must_always_report": (),
        "verifier_jobs": {"readiness-policy": "scripts/release/verify-tauri-package-readiness.py"},
        "job_scripts": {"windows-package-dry": ("scripts/release/verify-tauri-package-dry.py",)},
        "required_steps": {},
    },
    "cd-pr-check.yml": {
        "required_jobs": ("deployment-files", "docker-build-dry"),
        "must_always_report": (),
        "verifier_jobs": {},
        "job_scripts": {"deployment-files": ("scripts/verify/verify-deployment-shape.py",)},
        "required_steps": {},
    },
}

SCRIPT_REFERENCE = re.compile(r"(?:^|[\s\"'])((?:\./)?scripts/[A-Za-z0-9_./-]+\.(?:py|sh))")


def job_steps(job):
    return [step for step in job.get("steps") or [] if isinstance(step, dict)]


def advisory(item):
    value = item.get("continue-on-error")
    if value is None:
        return False
    return str(value).strip().lower() not in {"false", "${{ false }}", "0", "none", ""}


def command_invokes(step, command):
    pattern = re.compile(rf"(?<![\w.-]){re.escape(command)}(?![\w.-])")
    for raw in str(step.get("run") or "").splitlines():
        line = raw.split("#", 1)[0]
        if pattern.search(line):
            return True
    return False


def step_named(job, name):
    return next((step for step in job_steps(job) if str(step.get("name", "")) == name), None)


def check_workflow(name, workflow, requirements, errors):
    jobs = workflow.get("jobs") or {}
    for job_name in requirements["required_jobs"]:
        if not isinstance(jobs.get(job_name), dict):
            errors.append(f"{name}: required job '{job_name}' is missing")

    for job_name in requirements.get("must_always_report", ()):
        job = jobs.get(job_name)
        if not isinstance(job, dict):
            continue
        if advisory(job):
            errors.append(f"{name}: required job '{job_name}' is warning-only")
        condition = str(job.get("if", ""))
        if condition and "always()" not in condition and "!cancelled()" not in condition:
            errors.append(f"{name}: required job '{job_name}' can be skipped by its condition")

    for job_name, script in requirements.get("verifier_jobs", {}).items():
        job = jobs.get(job_name)
        if not isinstance(job, dict):
            continue
        matching = [step for step in job_steps(job) if command_invokes(step, script)]
        if not matching:
            errors.append(f"{name}: job '{job_name}' does not run {script}")
        for step in matching:
            if advisory(step) or step.get("if"):
                errors.append(f"{name}: {script} in '{job_name}' can be skipped or made advisory")

    for job_name, scripts in requirements.get("job_scripts", {}).items():
        job = jobs.get(job_name)
        if not isinstance(job, dict):
            continue
        for script in scripts:
            matching = [step for step in job_steps(job) if command_invokes(step, script)]
            if not matching:
                errors.append(f"{name}: job '{job_name}' does not run {script}")
            for step in matching:
                if advisory(step):
                    errors.append(f"{name}: {script} in '{job_name}' is advisory")

    for job_name, required_steps in requirements.get("required_steps", {}).items():
        job = jobs.get(job_name)
        if not isinstance(job, dict):
            continue
        for step_name, commands in required_steps.items():
            step = step_named(job, step_name)
            if step is None:
                errors.append(f"{name}: job '{job_name}' is missing required step '{step_name}'")
                continue
            if advisory(step) or step.get("if"):
                errors.append(f"{name}: required step '{step_name}' in '{job_name}' can be skipped or made advisory")
            for command in commands:
                if not command_invokes(step, command):
                    errors.append(
                        f"{name}: required step '{step_name}' in '{job_name}' does not run {command}"
                    )

    for job_name, environment in requirements.get("protected_environments", {}).items():
        job = jobs.get(job_name)
        if isinstance(job, dict) and str(job.get("environment", "")) != environment:
            errors.append(f"{name}: job '{job_name}' must run in the protected '{environment}' environment")

    dispatch_only_jobs = requirements.get("dispatch_only_jobs", {})
    for job_name, required_refs in dispatch_only_jobs.items():
        job = jobs.get(job_name)
        if not isinstance(job, dict):
            continue
        if advisory(job):
            errors.append(f"{name}: job '{job_name}' is warning-only")
        condition = str(job.get("if", "")).replace("${{", "").replace("}}", "").strip()
        if condition not in ("github.event_name == 'workflow_dispatch'", 'github.event_name == "workflow_dispatch"'):
            errors.append(f"{name}: job '{job_name}' must stay workflow_dispatch-only")
        job_text = json.dumps(job)
        for ref in required_refs:
            if ref not in job_text:
                errors.append(f"{name}: job '{job_name}' must read {ref}")
        forbidden_provider_refs = (
            r"inputs\.(?:id_env|id_image|id_base_url|id_source_repo)",
            r"\b(?:OIDC_SOURCE_REPO|OIDC_IMAGE|OIDC_CLONE_TOKEN)\b",
            r"\bAGENTHUB_TOKENDANCE_ID_[A-Z0-9_]+\b",
            r"\b(?:tokendance-id|tokendance-account)\b",
            r"/var/lib/oidc-provider",
        )
        for pattern in forbidden_provider_refs:
            if re.search(pattern, job_text):
                errors.append(
                    f"{name}: job '{job_name}' must use an external Account client, "
                    f"not internal provider wiring ({pattern})"
                )

    # A default PR/push gate may exercise Hub Account-OIDC code against the
    # repo-local fixture, but it must never receive operator Account secrets or
    # depend on an internal Account/provider checkout.
    dispatch_names = set(dispatch_only_jobs)
    for job_name, job in jobs.items():
        if not isinstance(job, dict) or job_name in dispatch_names:
            continue
        job_text = json.dumps(job)
        if re.search(r"\bsecrets\.AGENTHUB_E2E_(?:ACCOUNT_|USER_|PARTNER_)", job_text):
            errors.append(f"{name}: default job '{job_name}' must not receive operator Account E2E secrets")
        if re.search(r"\b(?:tokendance-id|tokendance-account)\b", job_text):
            errors.append(f"{name}: default job '{job_name}' must not depend on an internal Account/provider checkout")


def check_script_references(name, workflow, repo_root, errors):
    for job in (workflow.get("jobs") or {}).values():
        if not isinstance(job, dict):
            continue
        for step in job_steps(job):
            for match in SCRIPT_REFERENCE.finditer(str(step.get("run") or "")):
                relative = match.group(1).lstrip("./")
                if not os.path.isfile(os.path.join(repo_root, relative)):
                    errors.append(
                        f"{name}: step '{step.get('name', '<unnamed>')}' references missing {relative}"
                    )


def verify(repo_root, checks_path, release_path, readiness_path, cd_pr_path):
    errors = []
    paths = {
        "checks.yml": checks_path,
        "release.yml": release_path,
        "release-readiness.yml": readiness_path,
        "cd-pr-check.yml": cd_pr_path,
    }
    for name, path in paths.items():
        with open(path, encoding="utf-8") as handle:
            workflow = yaml.safe_load(handle)
        check_workflow(name, workflow, POLICY[name], errors)
        check_script_references(name, workflow, repo_root, errors)
    return errors


def run_self_test():
    requirements = {
        "required_jobs": ("validate",),
        "must_always_report": ("validate",),
        "verifier_jobs": {},
        "job_scripts": {"validate": ("gate.py",)},
        "required_steps": {"validate": {"Secret guard": ("gate.py",)}},
        "protected_environments": {},
        "dispatch_only_jobs": {},
    }

    def workflow(*, run="python gate.py", step_extra=None, job_extra=None):
        step = {"name": "Secret guard", "run": run}
        step.update(step_extra or {})
        job = {"steps": [step]}
        job.update(job_extra or {})
        return {"jobs": {"validate": job}}

    cases = {
        "valid": (workflow(), None),
        "missing-job": ({"jobs": {}}, "required job 'validate' is missing"),
        "advisory-step": (workflow(step_extra={"continue-on-error": True}), "advisory"),
        "missing-script": (workflow(run="echo no gate"), "does not run gate.py"),
        "conditional-step": (workflow(step_extra={"if": "${{ false }}"}), "can be skipped"),
        "skippable-required-job": (workflow(job_extra={"if": "false"}), "can be skipped"),
    }
    for label, (fixture, expected) in cases.items():
        errors = []
        check_workflow("fixture.yml", fixture, requirements, errors)
        message = "; ".join(errors)
        if expected and expected not in message:
            raise AssertionError(f"{label}: expected {expected!r}, got {message!r}")
        if not expected and errors:
            raise AssertionError(f"{label}: expected no errors, got {message!r}")

    account_requirements = {
        "required_jobs": ("validate", "real-e2e-stack"),
        "must_always_report": (),
        "verifier_jobs": {},
        "job_scripts": {},
        "required_steps": {},
        "protected_environments": {},
        "dispatch_only_jobs": {
            "real-e2e-stack": (
                "vars.AGENTHUB_E2E_ACCOUNT_ISSUER",
                "secrets.AGENTHUB_E2E_ACCOUNT_CLIENT_SECRET",
            )
        },
    }

    def account_workflow(*, condition="github.event_name == 'workflow_dispatch'",
                          refs=("vars.AGENTHUB_E2E_ACCOUNT_ISSUER",
                                "secrets.AGENTHUB_E2E_ACCOUNT_CLIENT_SECRET"),
                          extra=""):
        return {
            "jobs": {
                "validate": {"steps": [{"name": "validate", "run": "python gate.py"}]},
                "real-e2e-stack": {
                    "if": condition,
                    "env": {"ISSUER": refs[0]},
                    "steps": [{"name": "lane", "run": f"echo {refs[1]} {extra}".strip()}],
                },
            }
        }

    account_cases = {
        "account-valid": (account_workflow(), None),
        "account-pr-runnable": (
            account_workflow(condition="github.event_name == 'pull_request'"),
            "must stay workflow_dispatch-only",
        ),
        "account-internal-source": (
            account_workflow(extra="vars.OIDC_SOURCE_REPO"), "not internal provider wiring"
        ),
        "account-missing-secret": (
            account_workflow(refs=("vars.AGENTHUB_E2E_ACCOUNT_ISSUER", "vars.ACCOUNT_PUBLIC")),
            "must read secrets.AGENTHUB_E2E_ACCOUNT_CLIENT_SECRET",
        ),
    }
    for label, (fixture, expected) in account_cases.items():
        errors = []
        check_workflow("fixture.yml", fixture, account_requirements, errors)
        message = "; ".join(errors)
        if expected and expected not in message:
            raise AssertionError(f"{label}: expected {expected!r}, got {message!r}")
        if not expected and errors:
            raise AssertionError(f"{label}: expected no errors, got {message!r}")

    print("CI invariant self-test ok")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--checks", default=".github/workflows/checks.yml")
    parser.add_argument("--release", default=".github/workflows/release.yml")
    parser.add_argument("--readiness", default=".github/workflows/release-readiness.yml")
    parser.add_argument("--cd-pr", default=".github/workflows/cd-pr-check.yml")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        run_self_test()
        return 0
    errors = verify(os.getcwd(), args.checks, args.release, args.readiness, args.cd_pr)
    if errors:
        for error in errors:
            print(f"FAIL: {error}", file=sys.stderr)
        return 1
    print("CI invariant check ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
