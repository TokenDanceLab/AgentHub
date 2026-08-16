#!/usr/bin/env python3
"""Workflow text mutation tests for verify-ci-gates.py (#1720 design-css gate).

Each case copies the real .github/workflows/checks.yml to a temp file, applies
one surgical text mutation, and asserts the CI policy verifier exits non-zero:

1. delete the design-css job → missing job 'design-css'
2. delete the design_css trigger (changes outputs line + path filter block)
3. delete the negative self-test step
4. add continue-on-error to a hard-blocking step
5. swap pnpm test:css-syntax* for pnpm lint:css

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


if __name__ == "__main__":
    unittest.main(verbosity=2)
