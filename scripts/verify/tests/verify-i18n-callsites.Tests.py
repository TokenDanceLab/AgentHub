#!/usr/bin/env python3
"""Negative self-tests for the per-file i18n callsite ratchet."""

import os
import shutil
import subprocess
import sys
import tempfile
import unittest

REPO_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)
VERIFIER_REL = os.path.join("scripts", "verify", "verify-i18n-callsites.py")
POLICY_CODE = "I18N-CALLSITE-RATCHET"


class I18nCallsiteRatchetTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="agenthub-i18n-ratchet-")
        self.root = self.tmp.name
        verifier_dst = os.path.join(self.root, VERIFIER_REL)
        os.makedirs(os.path.dirname(verifier_dst), exist_ok=True)
        shutil.copyfile(os.path.join(REPO_ROOT, VERIFIER_REL), verifier_dst)
        os.makedirs(os.path.join(self.root, "app", "shared", "src"), exist_ok=True)
        os.makedirs(os.path.join(self.root, "app", "workbench", "src"), exist_ok=True)

    def tearDown(self):
        self.tmp.cleanup()

    def write_source(self, rel, text):
        path = os.path.join(self.root, *rel.split("/"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)

    def run_gate(self, *args):
        return subprocess.run(
            [sys.executable, os.path.join(self.root, VERIFIER_REL), *args],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

    def update(self):
        result = self.run_gate("--update")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def assert_policy_fail(self, result):
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(f"[{POLICY_CODE}]", result.stdout + result.stderr)

    def test_positive_fixture_passes(self):
        self.write_source("app/shared/src/a.ts", "export const label = '中文';\n")
        self.update()
        result = self.run_gate()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_use_translation_import_does_not_exempt_hardcoded_copy(self):
        self.write_source(
            "app/shared/src/a.tsx",
            "import { useTranslation } from 'react-i18next';\n"
            "export const label = '中文';\n",
        )
        self.update()
        self.write_source(
            "app/shared/src/a.tsx",
            "import { useTranslation } from 'react-i18next';\n"
            "export const label = '中文';\n"
            "export const second = '新增';\n",
        )
        self.assert_policy_fail(self.run_gate())

    def test_one_file_cannot_spend_debt_repaid_by_another(self):
        self.write_source(
            "app/shared/src/a.ts",
            "export const a = '甲';\nexport const b = '乙';\n",
        )
        self.write_source("app/shared/src/b.ts", "export const c = '丙';\n")
        self.update()
        self.write_source(
            "app/shared/src/a.ts",
            "export const a = '甲';\n"
            "export const b = '乙';\n"
            "export const c = '新增';\n",
        )
        self.write_source("app/shared/src/b.ts", "export const c = 'english';\n")
        self.assert_policy_fail(self.run_gate())

    def test_new_violating_file_has_zero_budget(self):
        self.update()
        self.write_source("app/workbench/src/new.ts", "export const label = '新增';\n")
        self.assert_policy_fail(self.run_gate())

    def test_comment_only_cjk_does_not_count(self):
        self.update()
        self.write_source(
            "app/shared/src/comment.ts",
            "// '中文说明'\n"
            "/* \"另一段说明\" */\n"
            "export const label = 'english';\n",
        )
        result = self.run_gate()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
