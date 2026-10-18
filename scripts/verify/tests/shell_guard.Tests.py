#!/usr/bin/env python3
"""Negative fixtures for the shared shell/condition guard."""

import os
import sys
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, os.path.join(REPO_ROOT, "scripts", "verify"))

import shell_guard as guard  # noqa: E402


class ShellGuardTests(unittest.TestCase):
    def test_heredoc_body_is_not_executed(self):
        text = "cat > gate.sh <<'MY-EOF'\nbash gate.sh\nMY-EOF\necho done\n"
        self.assertEqual(guard.executed_lines(text), ["cat > gate.sh <<'MY-EOF'", "echo done"])

    def test_continuation_is_joined(self):
        self.assertEqual(guard.executed_lines("python a.py \\\n  --flag\n"), ["python a.py --flag"])

    def test_masks_failure(self):
        self.assertTrue(guard.masks_failure(" || true"))
        self.assertTrue(guard.masks_failure(" || (echo skipped)"))
        self.assertTrue(guard.masks_failure(" &"))
        self.assertTrue(guard.masks_failure("; exit 0"))
        self.assertFalse(guard.masks_failure(" || exit 1"))
        self.assertFalse(guard.masks_failure(" || exit $?"))
        self.assertFalse(guard.masks_failure(" || /bin/false"))
        self.assertTrue(guard.masks_failure(" || exit 256"))
        self.assertTrue(guard.masks_failure(" || exit 0"))
        self.assertTrue(guard.masks_failure(" || false || true"))
        self.assertFalse(guard.masks_failure(" || false || exit 1"))
        self.assertFalse(guard.masks_failure(" || /bin/false || /bin/false"))
        self.assertFalse(guard.masks_failure(" || exit 1 || true"))
        self.assertFalse(guard.masks_failure(" --pattern 'a|b'"))
        self.assertFalse(guard.masks_failure(" & wait $!"))

    def test_step_constructs(self):
        self.assertEqual(guard.step_constructs("python gate.py -RunWindowsBundle"), [])
        self.assertEqual(guard.step_constructs("OUT=$(python gate.py)"), [])
        for run in (
            "if false; then python gate.py; fi",
            "{ python gate.py; }",
            "gate() { python gate.py; }",
            "case x in x) python gate.py;; esac",
            "set +e\npython gate.py",
            "cat > x <<'EOF'\npython gate.py\nEOF",
            "bash -c 'python gate.py'",
            "sh -ec 'python gate.py'",
            "python -c \"print('gate')\"",
            "python -u -c 'print(1)'",
            "bash -eu -c 'python gate.py'",
            "python -W ignore -c 'print(1)'",
        ):
            self.assertTrue(guard.step_constructs(run), run)

    def test_statically_false(self):
        for condition in ("${{ (false) }}", "${{ ! true }}", "${{ true == false }}", "${{ false || false }}"):
            self.assertTrue(guard.statically_false(condition), condition)
        self.assertFalse(guard.statically_false("${{ github.event_name == 'pull_request' }}"))

    def test_event_condition_folding(self):
        self.assertTrue(guard.statically_false("github.event_name == 'push'", {"pull_request"}))
        self.assertFalse(guard.statically_false("github.event_name == 'pull_request'", {"pull_request"}))
        self.assertTrue(guard.statically_false("github.event_name != 'pull_request'", {"pull_request"}))
        self.assertTrue(guard.statically_false("'workflow_dispatch' == github.event_name", {"pull_request"}))
        self.assertFalse(guard.statically_false("'pull_request' == github.event_name", {"pull_request"}))
        self.assertTrue(guard.statically_false("'pull_request' != github.event_name", {"pull_request"}))

    def test_short_circuit(self):
        self.assertTrue(guard.short_circuited("true || python gate.py", 10))
        self.assertTrue(guard.short_circuited("false && python gate.py", 11))
        self.assertTrue(guard.short_circuited("echo x || python gate.py", 12))

    def test_script_execution_classifier(self):
        script = "scripts/verify/gate.py"
        for line in (
            f"python {script}",
            f"python -I {script}",
            f"bash {script}",
            f"OUT=$(python {script})",
            f"env FOO=1 python {script}",
            f"./{script}",
        ):
            self.assertIsNotNone(guard.script_execution(line, script), line)
        for line in (
            f"echo python {script}",
            f"cat {script}",
            f"test -f {script}",
            f"which {script}",
            f"type {script}",
            f"python -m py_compile {script}",
            f"python -u -m py_compile {script}",
            f"env FOO=1 python -m py_compile {script}",
            f"{script} --help || true",
            f"! python {script}",
        ):
            self.assertIsNone(guard.script_execution(line, script), line)

    def test_needs_output_folding(self):
        outputs = {"changes": {"go"}}
        self.assertTrue(
            guard.statically_false("needs.changes.outputs.docs == 'true'", {"pull_request"}, "pull_request", outputs)
        )
        self.assertFalse(
            guard.statically_false("needs.changes.outputs.go == 'true'", {"pull_request"}, "pull_request", outputs)
        )
        self.assertTrue(
            guard.statically_false(
                "needs.changes.outputs.docs == 'true' && github.event_name == 'pull_request'",
                {"pull_request"}, "pull_request", outputs,
            )
        )
        self.assertFalse(
            guard.statically_false(
                "github.event_name == 'workflow_dispatch' || needs.changes.outputs.go == 'true'",
                {"pull_request", "workflow_dispatch"}, "pull_request", outputs,
            )
        )

    def test_constant_comparisons(self):
        self.assertTrue(guard.constant_truth("'a' == 'a'"))
        self.assertFalse(guard.constant_truth("'a' == 'b'"))
        self.assertFalse(guard.constant_truth("'A' == 'b'"))
        self.assertTrue(guard.constant_truth("false != 'true'"))
        self.assertFalse(guard.constant_truth("false == 'true'"))


if __name__ == "__main__":
    unittest.main()
