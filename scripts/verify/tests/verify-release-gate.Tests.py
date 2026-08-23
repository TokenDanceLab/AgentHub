#!/usr/bin/env python3
"""Table-driven self-tests for the release security risk gate."""

import importlib.util
import os
import tempfile
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
VERIFIER_PATH = os.path.join(REPO_ROOT, "scripts", "release", "verify-release-gate.py")


def load_verifier():
    spec = importlib.util.spec_from_file_location("agenthub_verify_release_gate", VERIFIER_PATH)
    if spec is None or spec.loader is None:
        raise AssertionError(f"could not load verifier: {VERIFIER_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = load_verifier()


def security_document(*rows: str) -> str:
    return "\n".join(
        [
            "# Security Policy",
            "",
            "## 发布门禁风险状态",
            "",
            "| ID | Severity | Status | 说明 |",
            "|---|---|---|---|",
            *rows,
            "",
            "## 维护规则",
        ]
    )


class VerifyReleaseSecurityGateTests(unittest.TestCase):
    def setUp(self):
        self.reset_messages()

    def reset_messages(self):
        GATE.ready.clear()
        GATE.warnings.clear()
        GATE.blockers.clear()

    def run_gate(self, document: str, allow=False):
        self.reset_messages()
        with tempfile.TemporaryDirectory(prefix="agenthub-release-gate-") as fixture:
            with open(os.path.join(fixture, "SECURITY.md"), "w", encoding="utf-8", newline="\n") as handle:
                handle.write(document)
            risks = GATE.assert_security_release_gate(fixture, allow)
        return risks, list(GATE.ready), list(GATE.warnings), list(GATE.blockers)

    def test_known_non_blocking_statuses_pass(self):
        for status in ("Accepted", "Mitigated", "Mitigated in repo", "Closed"):
            with self.subTest(status=status):
                risks, ready, warnings, blockers = self.run_gate(
                    security_document(f"| AH-SR-100 | High | {status} | known non-blocking status |")
                )
                self.assertEqual(risks, [])
                self.assertEqual(warnings, [])
                self.assertEqual(blockers, [])
                self.assertIn("no policy-blocking Critical/High risks", "\n".join(ready))

    def test_blocking_statuses_fail(self):
        cases = (
            ("Open", "status is Open"),
            ("Mitigated in repo; rotate required", "rotate required"),
            ("Mitigated in repo; deploy verification required", "verification required"),
            ("Mitigated in repo; deploy/client verification required", "verification required"),
            ("Mitigated in repo; runtime/log verification required", "verification required"),
        )
        for status, reason in cases:
            with self.subTest(status=status):
                risks, _, _, blockers = self.run_gate(
                    security_document(f"| AH-SR-101 | Critical | {status} | release blocker |")
                )
                self.assertEqual(len(risks), 1)
                self.assertIn(reason, risks[0]["gateReason"])
                self.assertIn("policy-blocking Critical/High risks block public release", "\n".join(blockers))

    def test_blocking_status_match_is_case_and_whitespace_insensitive(self):
        risks, _, _, blockers = self.run_gate(
            security_document("| AH-SR-102 | High |  MITIGATED   IN REPO; DEPLOY VERIFICATION REQUIRED  | blocker |")
        )
        self.assertEqual(len(risks), 1)
        self.assertTrue(blockers)

    def test_legacy_override_only_bypasses_recognized_policy_blockers(self):
        risks, _, warnings, blockers = self.run_gate(
            security_document("| AH-SR-103 | High | Open | explicitly overridden blocker |"),
            allow=True,
        )
        self.assertEqual(len(risks), 1)
        self.assertEqual(blockers, [])
        self.assertIn("-AllowOpenHighRisks was set", "\n".join(warnings))

    def test_unknown_critical_high_status_fails_closed_even_with_override(self):
        for status in ("Investigating", "Open; owner assigned", "Mitigated in production"):
            with self.subTest(status=status):
                risks, _, _, blockers = self.run_gate(
                    security_document(f"| AH-SR-104 | High | {status} | unknown state |"),
                    allow=True,
                )
                self.assertEqual(risks, [])
                self.assertIn("unknown release-gate status", "\n".join(blockers))

    def test_malformed_rows_fail_closed_even_with_override(self):
        cases = (
            "| AH-SR-105 | High | Open |",
            "| AH-SR-105 | High | Open | summary | extra |",
            "AH-SR-105 | High | Open | summary",
            "| AH-SR-105 | High | | summary |",
            "| AH-SR-105 | High | Closed | |",
            "| AH-SR-X | High | Open | malformed ID |",
            "| AH-SR-105 | Severe | Open | unknown severity |",
        )
        for row in cases:
            with self.subTest(row=row):
                risks, _, _, blockers = self.run_gate(security_document(row), allow=True)
                self.assertEqual(risks, [])
                self.assertIn("security risk register integrity failure", "\n".join(blockers))

    def test_non_critical_high_rows_do_not_participate_in_release_gate(self):
        risks, ready, warnings, blockers = self.run_gate(
            security_document("| AH-SR-106 | Medium | Open | not a Critical/High release gate row |")
        )
        self.assertEqual(risks, [])
        self.assertEqual(warnings, [])
        self.assertEqual(blockers, [])
        self.assertTrue(ready)

    def test_missing_gate_section_fails_closed(self):
        risks, _, _, blockers = self.run_gate("# Security Policy\n")
        self.assertEqual(risks, [])
        self.assertIn("required section is missing", "\n".join(blockers))


if __name__ == "__main__":
    unittest.main(verbosity=2)
