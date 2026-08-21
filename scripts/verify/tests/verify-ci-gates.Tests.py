#!/usr/bin/env python3
"""Workflow text mutation tests for verify-ci-gates.py.

Each case copies the real .github/workflows/checks.yml to a temp file, applies
one surgical text mutation, and asserts the CI policy verifier exits non-zero:

1. delete the design-css job → missing job 'design-css'
2. delete the design_css trigger (changes outputs line + path filter block)
3. delete the negative self-test step
4. add continue-on-error to a hard-blocking step
5. swap pnpm test:css-syntax* for pnpm lint:css
6. delete the windows-go MATRIX_RESULT binding → aggregator no longer fail-closed
7. delete the windows-frontend non-success failure branch → aggregator always green
8. restore the go-hub job-level path filter → required check skip-able again
9. delete the go-hub no-Go-changes fallback step → job has no success path when filtered

The unmutated copy must exit 0, proving the policy test only reddens on
actual policy violations (fail-closed, no false green).
"""

import os
import re
import subprocess
import sys
import tempfile
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
WORKFLOW_PATH = os.path.join(REPO_ROOT, ".github", "workflows", "checks.yml")
VERIFIER_PATH = os.path.join(REPO_ROOT, "scripts", "verify", "verify-ci-gates.py")

DESIGN_CSS_STEP_VERIFY = "      - name: Verify design CSS syntax\n        run: pnpm test:css-syntax\n"
DESIGN_CSS_STEP_SELF_TEST = "      - name: Self-test design CSS syntax gate (negative)\n        run: pnpm test:css-syntax:self-test\n"


def read_workflow() -> str:
    with open(WORKFLOW_PATH, encoding="utf-8") as handle:
        return handle.read()


def run_verifier(workflow_text: str) -> tuple:
    with tempfile.TemporaryDirectory(prefix="agenthub-ci-gates-") as tmp_dir:
        workflow_copy = os.path.join(tmp_dir, "checks.yml")
        with open(workflow_copy, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(workflow_text)
        result = subprocess.run(
            [sys.executable, VERIFIER_PATH, "--WorkflowPath", workflow_copy],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        return result.returncode, (result.stdout or "") + (result.stderr or "")


def delete_design_css_job(text: str) -> str:
    pattern = re.compile(r"(?ms)^  design-css:\r?\n.*?(?=^  [A-Za-z0-9_-]+:\r?\n|\Z)")
    mutated, count = pattern.subn("", text)
    if count != 1:
        raise AssertionError(f"expected exactly one design-css job block, removed {count}")
    return mutated


def delete_design_css_trigger(text: str) -> str:
    outputs_pattern = re.compile(r"(?m)^\s*design_css: \${{ steps\.filter\.outputs\.design_css }}\s*\r?\n")
    text, outputs_removed = outputs_pattern.subn("", text)
    filter_pattern = re.compile(r"(?m)^\s*design_css:\s*\r?\n(?:\s+- '[^']*'\r?\n)+")
    text, filters_removed = filter_pattern.subn("", text)
    if outputs_removed != 1 or filters_removed != 1:
        raise AssertionError(
            f"expected 1 outputs line ({outputs_removed}) and 1 filter block ({filters_removed}) removed"
        )
    return text


def delete_self_test_step(text: str) -> str:
    if DESIGN_CSS_STEP_SELF_TEST not in text:
        raise AssertionError("self-test step text not found in workflow")
    return text.replace(DESIGN_CSS_STEP_SELF_TEST, "", 1)


def add_continue_on_error(text: str) -> str:
    if DESIGN_CSS_STEP_VERIFY not in text:
        raise AssertionError("verify step text not found in workflow")
    mutated = DESIGN_CSS_STEP_VERIFY.replace(
        "        run: pnpm test:css-syntax\n",
        "        continue-on-error: true\n        run: pnpm test:css-syntax\n",
    )
    return text.replace(DESIGN_CSS_STEP_VERIFY, mutated, 1)


def swap_to_lint_css(text: str) -> str:
    if "run: pnpm test:css-syntax:self-test\n" not in text or "run: pnpm test:css-syntax\n" not in text:
        raise AssertionError("design-css script lines not found in workflow")
    return text.replace(
        "run: pnpm test:css-syntax:self-test\n", "run: pnpm lint:css\n"
    ).replace("run: pnpm test:css-syntax\n", "run: pnpm lint:css\n")


def delete_windows_go_matrix_binding(text: str) -> str:
    pattern = re.compile(r'(?m)^\s*MATRIX_RESULT: \$\{\{ needs\.windows-go-test\.result \}\}\r?\n')
    mutated, count = pattern.subn("", text)
    if count != 1:
        raise AssertionError(f"expected exactly one windows-go MATRIX_RESULT binding, removed {count}")
    return mutated


def delete_windows_frontend_failure_branch(text: str) -> str:
    pattern = re.compile(r'(?ms)^\s*if \[ "\$MATRIX_RESULT" != "success" \]; then\r?\n.*?exit 1\r?\n\s*fi\r?\n')
    # Target the windows-frontend aggregator block specifically.
    frontend_block = re.compile(r"(?ms)^  windows-frontend:\r?\n(?P<body>.*?)(?=^  [A-Za-z0-9_-]+:\r?\n|\Z)")
    match = frontend_block.search(text)
    if not match:
        raise AssertionError("windows-frontend aggregator block not found")
    body = match.group("body")
    mutated_body, count = pattern.subn("", body)
    if count != 1:
        raise AssertionError(f"expected exactly one windows-frontend failure branch, removed {count}")
    return text[: match.start("body")] + mutated_body + text[match.end("body"):]


def get_go_hub_body(text: str) -> tuple:
    go_hub_block = re.compile(r"(?ms)^  go-hub:\r?\n(?P<body>.*?)(?=^  [A-Za-z0-9_-]+:\r?\n)")
    match = go_hub_block.search(text)
    if not match:
        raise AssertionError("go-hub job block not found")
    return match.start("body"), match.end("body"), match.group("body")


def restore_go_hub_job_path_filter(text: str) -> str:
    start, end, body = get_go_hub_body(text)
    always_if = "    if: ${{ !cancelled() }}"
    if always_if not in body:
        raise AssertionError("go-hub job-level always-report if not found")
    path_filter_if = (
        "    if: >-\n"
        "      github.event_name == 'workflow_dispatch' ||\n"
        "      needs.changes.outputs.go == 'true'"
    )
    return text[:start] + body.replace(always_if, path_filter_if, 1) + text[end:]


GO_HUB_FALLBACK_TEXT = (
    "      # Fallback: keep the required check reported even when the Go path\n"
    "      # filter deselects this job (skipped jobs never satisfy branch\n"
    "      # protection and permanently block frontend-only PRs).\n"
    "      - name: Report no-Go-changes skip (required check)\n"
    "        if: ${{ !cancelled() && github.event_name != 'workflow_dispatch' && needs.changes.outputs.go != 'true' }}\n"
    "        run: |\n"
    '          echo "skipped: no Go changes; reporting success for required check go-hub"\n'
    "          exit 0\n"
)


def delete_go_hub_fallback_step(text: str) -> str:
    start, end, body = get_go_hub_body(text)
    if GO_HUB_FALLBACK_TEXT not in body:
        raise AssertionError("go-hub fallback step text not found")
    return text[:start] + body.replace(GO_HUB_FALLBACK_TEXT, "", 1) + text[end:]


class VerifyCiGatesMutationTests(unittest.TestCase):
    def assert_mutation_fails(self, mutated_text: str, case_name: str) -> None:
        exit_code, output = run_verifier(mutated_text)
        self.assertEqual(
            exit_code,
            1,
            "%s must FAIL the CI policy verifier (exit 1) but got %s\n%s" % (case_name, exit_code, output),
        )

    def test_unmutated_workflow_passes(self):
        exit_code, output = run_verifier(read_workflow())
        self.assertEqual(exit_code, 0, "unmutated checks.yml must pass the CI policy verifier:\n%s" % output)

    def test_delete_design_css_job_fails(self):
        self.assert_mutation_fails(delete_design_css_job(read_workflow()), "deleted design-css job")

    def test_delete_design_css_trigger_fails(self):
        self.assert_mutation_fails(delete_design_css_trigger(read_workflow()), "deleted design_css trigger")

    def test_delete_self_test_step_fails(self):
        self.assert_mutation_fails(delete_self_test_step(read_workflow()), "deleted negative self-test step")

    def test_continue_on_error_fails(self):
        self.assert_mutation_fails(add_continue_on_error(read_workflow()), "added continue-on-error")

    def test_swap_to_lint_css_fails(self):
        self.assert_mutation_fails(swap_to_lint_css(read_workflow()), "swapped to lint:css")

    def test_delete_windows_go_matrix_binding_fails(self):
        self.assert_mutation_fails(
            delete_windows_go_matrix_binding(read_workflow()),
            "deleted windows-go MATRIX_RESULT binding",
        )

    def test_delete_windows_frontend_failure_branch_fails(self):
        self.assert_mutation_fails(
            delete_windows_frontend_failure_branch(read_workflow()),
            "deleted windows-frontend non-success failure branch",
        )

    def test_restore_go_hub_job_path_filter_fails(self):
        self.assert_mutation_fails(
            restore_go_hub_job_path_filter(read_workflow()),
            "restored go-hub job-level path filter",
        )

    def test_delete_go_hub_fallback_step_fails(self):
        self.assert_mutation_fails(
            delete_go_hub_fallback_step(read_workflow()),
            "deleted go-hub no-Go-changes fallback step",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
