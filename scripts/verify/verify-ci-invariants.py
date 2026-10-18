#!/usr/bin/env python3
"""Assert the CI workflow keeps its security and contract gates wired.

Parses the workflow YAML instead of matching raw text: required jobs, verifier
invocations, hard-blocking security steps, and referenced script paths.
"""

import argparse
import json
import os
import re
import sys

import yaml

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shell_guard import (  # noqa: E402
    executed_lines,
    command_segment,
    masks_failure,
    NEEDS_OUTPUT,
    script_execution,
    short_circuited,
    step_constructs,
    strip_comment,
    statically_false,
    trigger_names,
    warning_only,
)

JOB_REQUIREMENTS = {
    "checks.yml": {
        "jobs": {"validate", "go-hub", "go-edge", "backend-required", "frontend-required", "windows-go", "windows-frontend"},
        "verifiers": {
            "vuln-scan-js": "verify-vulnerability-gates.sh",
            "vuln-scan-go": "verify-vulnerability-gates.sh",
            "vuln-scan-rust": "verify-rust-advisories.sh",
        },
        "job_scripts": {
            "validate": (
                "scripts/verify/verify-doc-ssot.py",
                "scripts/verify/verify-openapi-contract.py",
                "scripts/verify/check-secrets.sh",
                "scripts/verify/verify-commit-messages.sh",
            ),
        },
        "required_steps": {
            "go-edge-static": {"Security scan (gosec)": "verify-gosec-gates.sh"},
            "go-hub-static": {"Security scan (gosec)": "verify-gosec-gates.sh"},
            "validate": {
                "Secret guard": "check-secrets.sh",
                "Self-test security gates": (
                    "verify-vulnerability-gates.Tests.sh",
                    "verify-gosec-gates.Tests.sh",
                    "check-secrets.Tests.sh",
                ),
            },
        },
        "dispatch_only_jobs": {"real-e2e-stack": ("vars.OIDC_SOURCE_REPO", "vars.OIDC_IMAGE")},
    },
    "release.yml": {
        "jobs": {"release-gate"},
        "verifiers": {"release-gate": "scripts/release/verify-release-gate.py"},
        "job_scripts": {},
        "protected_environments": {"release-gate": "release"},
    },
    "cd-pr-check.yml": {
        "jobs": {"deployment-files", "docker-build-dry"},
        "verifiers": {},
        "job_scripts": {"deployment-files": ("scripts/verify/verify-deployment-shape.py",)},
    },
}

SCRIPT_REFERENCE = re.compile(r"(?:^|[\s\"'])((?:\./)?scripts/[A-Za-z0-9_./-]+\.(?:py|sh))")










def run_commands(job):
    """Return executed shell lines with their owning step."""
    commands = []
    for step in (job.get("steps") or []):
        if not isinstance(step, dict):
            continue
        for line in executed_lines(step.get("run", "")):
            commands.append((step, line))
    return commands






def report_constructs(name, job_name, step, errors, reported):
    step_name = str(step.get("name", "<unnamed>"))
    if step_name in reported:
        return
    reasons = step_constructs(step.get("run", ""))
    if reasons:
        reported.add(step_name)
        errors.append(
            f"{name}: step '{step_name}' in '{job_name}' uses unmodeled shell constructs ({', '.join(reasons)})"
        )








def statically_disabled(item, triggers=frozenset(), event=None, job_outputs=None):
    return statically_false(item.get("if"), triggers, event, job_outputs)




def neutralized(line, script=None):
    """A gate command whose failure is discarded cannot block.

    Without a script this checks the whole line: a `!` negation or a masking
    `||`/pipeline/background/success suffix. With a script it checks every
    execution site, since an earlier masked site must not hide behind a later
    textual mention. A pipe feeding the script (the script is the last stage)
    propagates its exit status.
    """
    stripped = strip_comment(line)
    if not script:
        return re.match(r"^\s*!", stripped) is not None or masks_failure(stripped)
    for match in re.finditer(re.escape(script), stripped):
        index = match.start()
        if command_segment(stripped, index).strip().startswith("!"):
            return True
        if masks_failure(stripped[index + len(script):]):
            return True
    return False


def job_gate(name, job_name, job, errors, triggers, event=None, job_outputs=None, allow_path_filter=False):
    """A required job must not be switched off or path-filtered at job level."""
    if statically_disabled(job, triggers, event, job_outputs):
        errors.append(f"{name}: job '{job_name}' is disabled by its condition")
    if not allow_path_filter and NEEDS_OUTPUT.search(str(job.get("if", ""))):
        errors.append(
            f"{name}: required job '{job_name}' is path-filtered by a needs output and can skip a merge event"
        )
    if warning_only(job):
        errors.append(f"{name}: job '{job_name}' is warning-only (continue-on-error)")




def command_invokes(line, script):
    """True only when the script is executed, not merely named as an argument.

    Masked sites still count as invocations here: `neutralized()` reports the
    discarded failure separately instead of calling the gate unwired.
    """
    return script_execution(line, script, skip_masked=False, skip_negated=False) is not None


def workflow_steps(workflow):
    for job in (workflow.get("jobs") or {}).values():
        if not isinstance(job, dict):
            continue
        for step in job.get("steps") or []:
            yield step


def check_workflow(name, workflow, requirements, repo_root, errors):
    jobs = workflow.get("jobs") or {}
    triggers = trigger_names(workflow)
    event = "pull_request" if "pull_request" in triggers else ("push" if "push" in triggers else None)
    job_outputs = {
        job_name: set((job.get("outputs") or {}))
        for job_name, job in jobs.items()
        if isinstance(job, dict)
    }
    reported = set()
    for job_name in requirements["jobs"]:
        job = jobs.get(job_name)
        if not isinstance(job, dict):
            errors.append(f"{name}: required job '{job_name}' is missing")
            continue
        job_gate(name, job_name, job, errors, triggers, event, job_outputs)

    for job_name, verifier in requirements["verifiers"].items():
        job = jobs.get(job_name)
        if not isinstance(job, dict):
            errors.append(f"{name}: job '{job_name}' is missing")
            continue
        job_gate(name, job_name, job, errors, triggers, event, job_outputs, allow_path_filter=True)
        commands = [line for _step, line in run_commands(job)]
        if not any(command_invokes(line, verifier) for line in commands):
            errors.append(f"{name}: job '{job_name}' does not run {verifier}")
        for step, line in run_commands(job):
            if not command_invokes(line, verifier):
                continue
            report_constructs(name, job_name, step, errors, reported)
            if warning_only(step):
                errors.append(f"{name}: step '{step.get('name', '<unnamed>')}' makes {verifier} advisory")
            if statically_disabled(step, triggers, event, job_outputs):
                errors.append(f"{name}: step '{step.get('name', '<unnamed>')}' disables {verifier}")
            if neutralized(line, verifier):
                errors.append(f"{name}: step '{step.get('name', '<unnamed>')}' discards {verifier} failures")

    for job_name, scripts in requirements.get("job_scripts", {}).items():
        job = jobs.get(job_name)
        if not isinstance(job, dict):
            errors.append(f"{name}: job '{job_name}' is missing")
            continue
        job_gate(name, job_name, job, errors, triggers, event, job_outputs, allow_path_filter=True)
        commands = run_commands(job)
        for script in scripts:
            matching = [(step, line) for step, line in commands if command_invokes(line, script)]
            if not matching:
                errors.append(f"{name}: job '{job_name}' does not run {script}")
                continue
            if all(neutralized(line, script) for _step, line in matching):
                errors.append(f"{name}: job '{job_name}' discards {script} failures")
            for step, line in matching:
                report_constructs(name, job_name, step, errors, reported)
                if warning_only(step):
                    errors.append(f"{name}: step '{step.get('name', '<unnamed>')}' makes {script} advisory")
                if statically_disabled(step, triggers, event, job_outputs):
                    errors.append(f"{name}: step '{step.get('name', '<unnamed>')}' disables {script}")

    for job_name, step_names in requirements.get("required_steps", {}).items():
        job = jobs.get(job_name)
        if not isinstance(job, dict):
            errors.append(f"{name}: job '{job_name}' is missing")
            continue
        job_gate(name, job_name, job, errors, triggers, event, job_outputs, allow_path_filter=True)
        steps = [step for step in job.get("steps") or [] if isinstance(step, dict)]
        present = {str(step.get("name", "")): step for step in steps}
        for step_name, required in step_names.items():
            if step_name not in present:
                errors.append(f"{name}: job '{job_name}' is missing required step '{step_name}'")
                continue
            step = present[step_name]
            if statically_disabled(step, triggers, event, job_outputs):
                errors.append(f"{name}: required step '{step_name}' in '{job_name}' is disabled by its condition")
            if warning_only(step):
                errors.append(f"{name}: required step '{step_name}' in '{job_name}' is warning-only")
            report_constructs(name, job_name, step, errors, reported)
            lines = executed_lines(step.get("run", ""))
            commands = required if isinstance(required, (list, tuple)) else (required,)
            for command in commands:
                matching = [line for line in lines if command_invokes(line, command)]
                if not matching:
                    errors.append(f"{name}: required step '{step_name}' in '{job_name}' does not run {command}")
                    continue
                if all(neutralized(line, command) for line in matching):
                    errors.append(f"{name}: required step '{step_name}' in '{job_name}' discards {command} failures")

    for job_name, environment in requirements.get("protected_environments", {}).items():
        job = jobs.get(job_name)
        if not isinstance(job, dict):
            errors.append(f"{name}: job '{job_name}' is missing")
            continue
        job_gate(name, job_name, job, errors, triggers, event)
        if str(job.get("environment", "")) != environment:
            errors.append(f"{name}: job '{job_name}' must run in the protected '{environment}' environment")

    for job_name, required_refs in requirements.get("dispatch_only_jobs", {}).items():
        job = jobs.get(job_name)
        if not isinstance(job, dict):
            errors.append(f"{name}: job '{job_name}' is missing")
            continue
        if warning_only(job):
            errors.append(f"{name}: job '{job_name}' is warning-only (continue-on-error)")
        condition = str(job.get("if", "")).replace("${{", "").replace("}}", "").strip()
        dispatch_only = condition in (
            "github.event_name == 'workflow_dispatch'",
            'github.event_name == "workflow_dispatch"',
        )
        if not dispatch_only:
            errors.append(f"{name}: '{job_name}' must stay workflow_dispatch-only")
        job_text = json.dumps(job)
        for ref in required_refs:
            if ref not in job_text:
                errors.append(f"{name}: '{job_name}' must read {ref} from repository variables")
        if re.search(r"inputs\.(id_image|id_base_url|id_source_repo)", job_text):
            errors.append(f"{name}: '{job_name}' must not accept dispatch inputs for OIDC source/image")
        if job_name == "real-e2e-stack":
            issuer = str((job.get("env") or {}).get("AGENTHUB_TOKENDANCE_ID_ISSUER_URL", ""))
            if not re.match(r"http://(127\.0\.0\.1|localhost|\[::1\]):\d+/?$", issuer):
                errors.append(f"{name}: 'real-e2e-stack' must use a loopback TokenDance ID issuer, got {issuer!r}")

    security_steps = {"Secret guard", "Self-test security gates"}
    for step in workflow_steps(workflow):
        step_name = str(step.get("name", "<unnamed>"))
        run = str(step.get("run", ""))
        if warning_only(step) and ("gosec" in run.lower() or step_name in security_steps):
            errors.append(f"{name}: step '{step_name}' must not be warning-only")

        for line in executed_lines(run):
            for match in SCRIPT_REFERENCE.finditer(line):
                relative = match.group(1).lstrip("./")
                if not os.path.isfile(os.path.join(repo_root, relative)):
                    errors.append(f"{name}: step '{step.get('name', '<unnamed>')}' references missing {relative}")


def verify(repo_root, checks_path, release_path, cd_pr_path):
    errors = []
    paths = {
        "checks.yml": checks_path,
        "release.yml": release_path,
        "cd-pr-check.yml": cd_pr_path,
    }
    for name, path in paths.items():
        with open(path, encoding="utf-8") as handle:
            workflow = yaml.safe_load(handle)
        check_workflow(name, workflow, JOB_REQUIREMENTS[name], repo_root, errors)
    return errors


def run_self_test():
    import tempfile

    valid = "jobs:\n  validate:\n    steps:\n      - name: step\n        run: echo ok\n"
    cases = {
        "missing-required-job": (
            "jobs:\n  validate:\n    steps:\n      - name: step\n        run: echo ok\n",
            "required job 'go-hub' is missing",
        ),
        "gosec-warning-only": (
            "jobs:\n  validate:\n  go-hub:\n    steps:\n      - name: gosec\n        run: gosec ./...\n"
            "        continue-on-error: true\n",
            "must not be warning-only",
        ),
        "secret-guard-warning-only": (
            "jobs:\n  validate:\n    steps:\n      - name: Secret guard\n        run: bash check-secrets.sh\n"
            "        continue-on-error: true\n",
            "step 'Secret guard' must not be warning-only",
        ),
        "deployment-verifier-unwired": (
            "jobs:\n  deployment-files:\n    steps:\n      - name: shape\n        run: echo ok\n",
            "job 'deployment-files' does not run scripts/verify/verify-deployment-shape.py",
        ),
        "inverted-dispatch-condition": (
            "jobs:\n  validate:\n    steps:\n      - name: step\n        run: echo ok\n"
            "  real-e2e-stack:\n    if: github.event_name != 'workflow_dispatch'\n"
            "    steps:\n      - name: step\n        run: echo ${{ vars.OIDC_SOURCE_REPO }} ${{ vars.OIDC_IMAGE }}\n",
            "must stay workflow_dispatch-only",
        ),
        "advisory-vulnerability-gate": (
            "jobs:\n  validate:\n    steps:\n      - name: step\n        run: echo ok\n"
            "  vuln-scan-go:\n    steps:\n      - name: govulncheck\n"
            "        run: bash scripts/verify/verify-vulnerability-gates.sh govulncheck\n"
            "        continue-on-error: true\n",
            "makes verify-vulnerability-gates.sh advisory",
        ),
        "expression-continue-on-error": (
            "jobs:\n  validate:\n    steps:\n      - name: gosec\n        run: gosec ./...\n"
            "        continue-on-error: ${{ true }}\n",
            "must not be warning-only",
        ),
        "missing-gosec-step": (
            "jobs:\n  go-hub-static:\n    steps:\n      - name: step\n        run: echo ok\n"
            "  go-edge-static:\n    steps:\n      - name: step\n        run: echo ok\n",
            "missing required step 'Security scan (gosec)'",
        ),
        "gosec-disabled-by-condition": (
            "jobs:\n  go-hub-static:\n    steps:\n      - name: Security scan (gosec)\n"
            "        if: ${{ false }}\n        run: gosec ./...\n",
            "is disabled by its condition",
        ),
        "gosec-neutralized": (
            "jobs:\n  go-hub-static:\n    steps:\n      - name: Security scan (gosec)\n"
            "        run: bash ../scripts/verify/verify-gosec-gates.sh || true\n",
            "discards verify-gosec-gates.sh failures",
        ),
        "commented-verifier-not-wired": (
            "jobs:\n  validate:\n    steps:\n      - name: step\n"
            "        run: '# python scripts/verify/verify-doc-ssot.py'\n",
            "does not run scripts/verify/verify-doc-ssot.py",
        ),
        "neutralized-contract-verifier": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: python scripts/verify/verify-openapi-contract.py || true\n",
            "discards scripts/verify/verify-openapi-contract.py failures",
        ),
        "neutralized-with-comment": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: python scripts/verify/verify-openapi-contract.py || true # best effort\n",
            "discards scripts/verify/verify-openapi-contract.py failures",
        ),
        "cat-verifier-not-wired": (
            "jobs:\n  validate:\n    steps:\n      - name: inspect\n"
            "        run: cat scripts/verify/verify-openapi-contract.py\n",
            "does not run scripts/verify/verify-openapi-contract.py",
        ),
        "job-script-warning-only": (
            "jobs:\n  validate:\n    steps:\n      - name: docs\n"
            "        run: python scripts/verify/verify-doc-ssot.py\n"
            "        continue-on-error: true\n",
            "makes scripts/verify/verify-doc-ssot.py advisory",
        ),
        "disabled-verifier-job": (
            "jobs:\n  vuln-scan-go:\n    if: false\n    steps:\n      - name: vuln\n"
            "        run: bash scripts/verify/verify-vulnerability-gates.sh govulncheck\n",
            "job 'vuln-scan-go' is disabled by its condition",
        ),
        "disabled-verifier-step": (
            "jobs:\n  vuln-scan-go:\n    steps:\n      - name: vuln\n        if: ${{ false }}\n"
            "        run: bash scripts/verify/verify-vulnerability-gates.sh govulncheck\n",
            "disables verify-vulnerability-gates.sh",
        ),
        "dispatch-or-true": (
            "jobs:\n  real-e2e-stack:\n    if: github.event_name == 'workflow_dispatch' || true\n"
            "    steps:\n      - name: step\n        run: echo ${{ vars.OIDC_SOURCE_REPO }} ${{ vars.OIDC_IMAGE }}\n",
            "must stay workflow_dispatch-only",
        ),
        "unprotected-release-environment": (
            "jobs:\n  release-gate:\n    steps:\n      - name: gate\n"
            "        run: python scripts/release/verify-release-gate.py\n",
            "must run in the protected 'release' environment",
        ),
        "external-oidc-issuer": (
            "jobs:\n  validate:\n    steps:\n      - name: step\n        run: echo ok\n"
            "  real-e2e-stack:\n    if: github.event_name == 'workflow_dispatch'\n"
            "    env:\n      AGENTHUB_TOKENDANCE_ID_ISSUER_URL: https://attacker.example.com\n"
            "    steps:\n      - name: step\n        run: echo ${{ vars.OIDC_SOURCE_REPO }} ${{ vars.OIDC_IMAGE }}\n",
            "must use a loopback TokenDance ID issuer",
        ),
        "disabled-required-job": (
            "jobs:\n  validate:\n    steps:\n      - name: step\n        run: echo ok\n"
            "  go-hub:\n    if: false\n    steps:\n      - name: step\n        run: echo ok\n",
            "job 'go-hub' is disabled by its condition",
        ),
        "disabled-contract-job": (
            "jobs:\n  validate:\n    if: false\n    steps:\n      - name: step\n"
            "        run: python scripts/verify/verify-doc-ssot.py\n",
            "job 'validate' is disabled by its condition",
        ),
        "job-level-continue-on-error": (
            "jobs:\n  validate:\n    steps:\n      - name: step\n        run: echo ok\n"
            "  vuln-scan-go:\n    continue-on-error: true\n    steps:\n      - name: vuln\n"
            "        run: bash scripts/verify/verify-vulnerability-gates.sh govulncheck\n",
            "job 'vuln-scan-go' is warning-only",
        ),
        "neutralized-exit-zero": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: python scripts/verify/verify-openapi-contract.py || exit 0\n",
            "discards scripts/verify/verify-openapi-contract.py failures",
        ),
        "neutralized-echo": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: python scripts/verify/verify-openapi-contract.py || echo ignored\n",
            "discards scripts/verify/verify-openapi-contract.py failures",
        ),
        "neutralized-backgrounded": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: python scripts/verify/verify-openapi-contract.py &\n",
            "discards scripts/verify/verify-openapi-contract.py failures",
        ),
        "neutralized-backgrounded-no-space": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: python scripts/verify/verify-openapi-contract.py&\n",
            "discards scripts/verify/verify-openapi-contract.py failures",
        ),
        "neutralized-pipeline": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: python scripts/verify/verify-openapi-contract.py | cat\n",
            "discards scripts/verify/verify-openapi-contract.py failures",
        ),
        "neutralized-if-wrapper": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: if python scripts/verify/verify-openapi-contract.py; then echo ok; fi\n",
            "uses unmodeled shell constructs",
        ),
        "neutralized-bin-true": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: python scripts/verify/verify-openapi-contract.py || /bin/true\n",
            "discards scripts/verify/verify-openapi-contract.py failures",
        ),
        "neutralized-subshell-true": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: python scripts/verify/verify-openapi-contract.py || (true)\n",
            "discards scripts/verify/verify-openapi-contract.py failures",
        ),
        "echo-argument-verifier-not-wired": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: true && echo python scripts/verify/verify-openapi-contract.py\n",
            "does not run scripts/verify/verify-openapi-contract.py",
        ),
        "required-step-echoed": (
            "jobs:\n  go-hub-static:\n    steps:\n      - name: Security scan (gosec)\n"
            "        run: echo bash ../scripts/verify/verify-gosec-gates.sh\n",
            "does not run verify-gosec-gates.sh",
        ),
        "neutralized-continuation": (
            "jobs:\n  go-hub-static:\n    steps:\n      - name: Security scan (gosec)\n"
            "        run: |\n          bash ../scripts/verify/verify-gosec-gates.sh \\\n          || true\n",
            "discards verify-gosec-gates.sh failures",
        ),
        "negated-verifier": (
            "jobs:\n  vuln-scan-go:\n    steps:\n      - name: vuln\n"
            "        run: |\n          ! bash scripts/verify/verify-vulnerability-gates.sh govulncheck\n",
            "discards verify-vulnerability-gates.sh failures",
        ),
        "disabled-by-constant-expression": (
            "jobs:\n  validate:\n    steps:\n      - name: step\n        run: echo ok\n"
            "  go-hub:\n    if: ${{ 1 == 2 }}\n    steps:\n      - name: step\n        run: echo ok\n",
            "job 'go-hub' is disabled by its condition",
        ),
        "disabled-by-textual-expression": (
            "jobs:\n  validate:\n    steps:\n      - name: step\n        run: echo ok\n"
            "  go-hub:\n    if: ${{ 'a' == 'b' }}\n    steps:\n      - name: step\n        run: echo ok\n",
            "job 'go-hub' is disabled by its condition",
        ),
        "missing-verifier-job": (
            valid,
            "job 'vuln-scan-go' is missing",
        ),
        "missing-referenced-script": (
            "jobs:\n  validate:\n    steps:\n      - name: step\n"
            "        run: python scripts/verify/does-not-exist.py\n",
            "references missing scripts/verify/does-not-exist.py",
        ),
        "dispatch-only-required-job": (
            "on:\n  pull_request: {}\n  workflow_dispatch:\njobs:\n  validate:\n"
            "    if: github.event_name == 'workflow_dispatch'\n    steps:\n"
            "      - name: step\n        run: echo ok\n",
            "job 'validate' is disabled by its condition",
        ),
        "dispatch-only-required-step": (
            "on:\n  pull_request: {}\n  workflow_dispatch:\njobs:\n  validate:\n    steps:\n"
            "      - name: Secret guard\n        if: github.event_name == 'workflow_dispatch'\n"
            "        run: bash scripts/verify/check-secrets.sh\n",
            "required step 'Secret guard' in 'validate' is disabled by its condition",
        ),
        "dead-needs-output-job": (
            "on:\n  pull_request: {}\njobs:\n  changes:\n    outputs:\n      go: ${{ steps.f.outputs.go }}\n"
            "    steps: []\n  validate:\n    if: needs.changes.outputs.docs == 'true'\n    steps:\n"
            "      - name: step\n        run: echo ok\n",
            "job 'validate' is disabled by its condition",
        ),
        "live-needs-filter": (
            "on:\n  pull_request: {}\n  workflow_dispatch:\njobs:\n  changes:\n    outputs:\n"
            "      go: ${{ steps.f.outputs.go }}\n    steps: []\n  validate:\n"
            "    if: github.event_name == 'workflow_dispatch' || needs.changes.outputs.go == 'true'\n"
            "    steps:\n      - name: step\n        run: echo ok\n",
            "!job 'validate' is disabled by its condition",
        ),
        "inline-shell-dead-branch": (
            "jobs:\n  validate:\n    steps:\n      - name: docs\n"
            "        run: bash -c 'if false; then python scripts/verify/verify-doc-ssot.py; fi'\n",
            "uses unmodeled shell constructs",
        ),
        "inline-shell-masked-status": (
            "jobs:\n  validate:\n    steps:\n      - name: docs\n"
            "        run: bash -c 'python scripts/verify/verify-doc-ssot.py; echo done'\n",
            "uses unmodeled shell constructs",
        ),
        "noop-test-wrapper": (
            "jobs:\n  validate:\n    steps:\n      - name: docs\n"
            "        run: test -f scripts/verify/verify-doc-ssot.py\n",
            "does not run scripts/verify/verify-doc-ssot.py",
        ),
        "path-filtered-required-job": (
            "on:\n  pull_request: {}\njobs:\n  changes:\n    outputs:\n      go: ${{ steps.f.outputs.go }}\n"
            "    steps: []\n  validate:\n    needs: changes\n"
            "    if: needs.changes.outputs.go == 'true'\n    steps:\n"
            "      - name: step\n        run: echo ok\n",
            "required job 'validate' is path-filtered by a needs output",
        ),
        "path-filtered-verifier-allowed": (
            "on:\n  pull_request: {}\njobs:\n  changes:\n    outputs:\n      go: ${{ steps.f.outputs.go }}\n"
            "    steps: []\n  vuln-scan-go:\n    needs: changes\n"
            "    if: needs.changes.outputs.go == 'true'\n    steps:\n"
            "      - name: vuln\n        run: bash scripts/verify/verify-vulnerability-gates.sh govulncheck\n",
            "!path-filtered by a needs output",
        ),
        "required-step-exit-zero": (
            "jobs:\n  validate:\n    steps:\n      - name: Self-test security gates\n        run: exit 0\n",
            "required step 'Self-test security gates' in 'validate' does not run verify-vulnerability-gates.Tests.sh",
        ),
        "neutralized-exit-after-gate": (
            "jobs:\n  vuln-scan-go:\n    steps:\n      - name: vuln\n"
            "        run: bash scripts/verify/verify-vulnerability-gates.sh govulncheck; exit 0\n",
            "discards verify-vulnerability-gates.sh failures",
        ),
        "path-true-verifier-not-wired": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: /bin/true python scripts/verify/verify-openapi-contract.py\n",
            "does not run scripts/verify/verify-openapi-contract.py",
        ),
        "gosec-step-disabled-by-expression": (
            "jobs:\n  go-hub-static:\n    steps:\n      - name: Security scan (gosec)\n"
            "        if: ${{ 'a' == 'b' }}\n        run: gosec ./...\n",
            "is disabled by its condition",
        ),
        "braced-true-neutralizer": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: python scripts/verify/verify-openapi-contract.py || { true; }\n",
            "discards scripts/verify/verify-openapi-contract.py failures",
        ),
        "backgrounded-no-space-wait": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: python scripts/verify/verify-openapi-contract.py &wait\n",
            "discards scripts/verify/verify-openapi-contract.py failures",
        ),
        "neutralized-quoted-true": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: python scripts/verify/verify-openapi-contract.py || \"true\"\n",
            "discards scripts/verify/verify-openapi-contract.py failures",
        ),
        "neutralized-command-true": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: python scripts/verify/verify-openapi-contract.py || command true\n",
            "discards scripts/verify/verify-openapi-contract.py failures",
        ),
        "if-false-wrapper": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: if false; then python scripts/verify/verify-openapi-contract.py; fi\n",
            "uses unmodeled shell constructs",
        ),
        "true-or-gate-not-wired": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: true || python scripts/verify/verify-openapi-contract.py\n",
            "does not run scripts/verify/verify-openapi-contract.py",
        ),
        "false-and-gate-not-wired": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: false && python scripts/verify/verify-openapi-contract.py\n",
            "does not run scripts/verify/verify-openapi-contract.py",
        ),
        "if-branch-with-gate-is-wired": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: if [ -n \"$X\" ]; then python scripts/verify/verify-openapi-contract.py; fi\n",
            "!does not run scripts/verify/verify-openapi-contract.py",
        ),
        "redirect-after-gate-not-neutralized": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: python scripts/verify/verify-openapi-contract.py &> /tmp/log\n",
            "!discards scripts/verify/verify-openapi-contract.py failures",
        ),
        "quoted-interpreter-is-wired": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: python \"scripts/verify/verify-openapi-contract.py\"\n",
            "!does not run scripts/verify/verify-openapi-contract.py",
        ),
        "neutralized-colon": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: 'python scripts/verify/verify-openapi-contract.py; :'\n",
            "discards scripts/verify/verify-openapi-contract.py failures",
        ),
        "neutralized-paren-echo": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: python scripts/verify/verify-openapi-contract.py || (echo skipped)\n",
            "discards scripts/verify/verify-openapi-contract.py failures",
        ),
        "required-step-masked": (
            "jobs:\n  validate:\n    steps:\n      - name: Self-test security gates\n"
            "        run: bash scripts/verify/tests/check-secrets.Tests.sh; exit 0\n",
            "discards check-secrets.Tests.sh failures",
        ),
        "required-step-idle": (
            "jobs:\n  validate:\n    steps:\n      - name: Self-test security gates\n        run: sleep 0\n",
            "required step 'Self-test security gates' in 'validate' does not run verify-vulnerability-gates.Tests.sh",
        ),
        "function-body-gate": (
            "jobs:\n  go-hub-static:\n    steps:\n      - name: Security scan (gosec)\n"
            "        run: |\n          gate() {\n            bash ../scripts/verify/verify-gosec-gates.sh\n          }\n",
            "uses unmodeled shell constructs",
        ),
        "case-arm-gate": (
            "jobs:\n  go-hub-static:\n    steps:\n      - name: Security scan (gosec)\n"
            "        run: |\n          case \"$X\" in\n            x) bash ../scripts/verify/verify-gosec-gates.sh ;;\n          esac\n",
            "uses unmodeled shell constructs",
        ),
        "group-suffix-gate": (
            "jobs:\n  go-hub-static:\n    steps:\n      - name: Security scan (gosec)\n"
            "        run: '{ bash ../scripts/verify/verify-gosec-gates.sh; } || true'\n",
            "uses unmodeled shell constructs",
        ),
        "errexit-disabled": (
            "jobs:\n  go-hub-static:\n    steps:\n      - name: Security scan (gosec)\n"
            "        run: |\n          set +e\n          bash ../scripts/verify/verify-gosec-gates.sh\n",
            "uses unmodeled shell constructs",
        ),
        "heredoc-odd-delimiter": (
            "jobs:\n  go-hub-static:\n    steps:\n      - name: Security scan (gosec)\n"
            "        run: |\n          cat > gate.sh <<'MY-EOF'\n          bash ../scripts/verify/verify-gosec-gates.sh\n          MY-EOF\n",
            "does not run verify-gosec-gates.sh",
        ),
        "interpreter-flag-is-wired": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: python -u scripts/verify/verify-openapi-contract.py\n",
            "!does not run scripts/verify/verify-openapi-contract.py",
        ),
        "assignment-substitution-is-wired": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: OUT=$(python -I scripts/verify/verify-openapi-contract.py)\n",
            "!does not run scripts/verify/verify-openapi-contract.py",
        ),
        "errexit-disabled-is-rejected": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: |\n          set +e\n          python scripts/verify/verify-openapi-contract.py\n",
            "uses unmodeled shell constructs",
        ),
        "failure-preserving-or-exit": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: python scripts/verify/verify-openapi-contract.py || exit 1\n",
            "!discards scripts/verify/verify-openapi-contract.py failures",
        ),
        "quoted-pipe-is-not-a-mask": (
            "jobs:\n  validate:\n    steps:\n      - name: contract\n"
            "        run: python scripts/verify/verify-openapi-contract.py --filter 'a|b'\n",
            "!discards scripts/verify/verify-openapi-contract.py failures",
        ),
        "dispatch-missing-ref": (
            "jobs:\n  validate:\n    steps:\n      - name: step\n        run: echo ok\n"
            "  real-e2e-stack:\n    if: github.event_name == 'workflow_dispatch'\n"
            "    steps:\n      - name: step\n        run: echo ok\n",
            "must read vars.OIDC_SOURCE_REPO",
        ),
        "dispatch-inputs-rejected": (
            "jobs:\n  validate:\n    steps:\n      - name: step\n        run: echo ok\n"
            "  real-e2e-stack:\n    if: github.event_name == 'workflow_dispatch'\n"
            "    steps:\n      - name: step\n"
            "        run: echo ${{ vars.OIDC_SOURCE_REPO }} ${{ vars.OIDC_IMAGE }} ${{ inputs.id_image }}\n",
            "must not accept dispatch inputs",
        ),
        "undeclared-event-disables-job": (
            "on: pull_request\njobs:\n  validate:\n    if: github.event_name == 'push'\n"
            "    steps:\n      - name: step\n        run: echo ok\n",
            "job 'validate' is disabled by its condition",
        ),
        "dispatch-only-disables-required-job": (
            "on: [pull_request, workflow_dispatch]\njobs:\n  validate:\n"
            "    if: github.event_name == 'workflow_dispatch'\n"
            "    steps:\n      - name: step\n        run: echo ok\n",
            "job 'validate' is disabled by its condition",
        ),
        "dispatch-only-disables-required-step": (
            "on: [pull_request, workflow_dispatch]\njobs:\n  validate:\n    steps:\n"
            "      - name: Secret guard\n        if: github.event_name == 'workflow_dispatch'\n"
            "        run: bash scripts/verify/check-secrets.sh --ci\n",
            "required step 'Secret guard' in 'validate' is disabled by its condition",
        ),
        "heredoc-does-not-wire-gate": (
            "jobs:\n  go-hub-static:\n    steps:\n      - name: Security scan (gosec)\n"
            "        run: |\n          cat > gate.sh <<'EOF'\n          bash ../scripts/verify/verify-gosec-gates.sh\n          EOF\n",
            "does not run verify-gosec-gates.sh",
        ),
    }
    with tempfile.TemporaryDirectory(prefix="agenthub-ci-invariants-") as fixture:
        paths = {name: os.path.join(fixture, name) for name in ("checks.yml", "release.yml", "cd-pr-check.yml")}
        for path in paths.values():
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(valid)
        for label, (content, expected) in cases.items():
            for path in paths.values():
                with open(path, "w", encoding="utf-8") as handle:
                    handle.write(content)
            errors = verify(fixture, paths["checks.yml"], paths["release.yml"], paths["cd-pr-check.yml"])
            if expected.startswith("!"):
                if any(expected[1:] in error for error in errors):
                    raise AssertionError(f"self-test case '{label}' unexpectedly reported: {expected[1:]}")
            elif not any(expected in error for error in errors):
                raise AssertionError(f"self-test case '{label}' did not report: {expected}")
    print("CI invariant self-test ok")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--checks", default=".github/workflows/checks.yml")
    parser.add_argument("--release", default=".github/workflows/release.yml")
    parser.add_argument("--cd-pr", default=".github/workflows/cd-pr-check.yml")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        run_self_test()
        return 0

    root = os.path.abspath(args.repo_root)
    errors = verify(root, os.path.join(root, args.checks), os.path.join(root, args.release), os.path.join(root, args.cd_pr))
    if errors:
        for error in errors:
            print(f"::error::{error}", file=sys.stderr)
        return 1
    print("CI invariant check ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
