#!/usr/bin/env python3
"""Behavior-level self-tests for Agent/doc entrypoint ownership (#1577 / #1582).

All mutations happen in an isolated detached Git worktree. The caller worktree
status is snapshotted before and after the suite.

Targets scripts/verify/verify-doc-ssot.py (the ps1-era verifier was already
migrated to python). The verifier is copied into the fixture worktree so its
repo-root discovery resolves to the fixture, mirroring the original ps1 test.
"""

import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
VERIFIER_REL = os.path.join("scripts", "verify", "verify-doc-ssot.py")


def resolve_verifier():
    for leaf in ("verify-doc-ssot.py", "verify-doc-ssot.ps1"):
        candidate = os.path.join(REPO_ROOT, "scripts", "verify", leaf)
        if os.path.isfile(candidate):
            return candidate
    raise AssertionError("verifier script not found: verify-doc-ssot.{py,ps1}")


class VerifyDocEntrypointsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.verifier = resolve_verifier()
        print("  verifier under test: %s" % cls.verifier)

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="agenthub-doc-entrypoints-")
        self.fixture = self._tmp.name
        self.initial_status = self.caller_status()

    def tearDown(self):
        self.remove_fixture()
        self._tmp.cleanup()

    def caller_status(self):
        result = subprocess.run(
            ["git", "-C", REPO_ROOT, "status", "--porcelain=v1", "--untracked-files=all"],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        return result.stdout

    def run_git(self, *args):
        return subprocess.run(
            ["git", "-C", REPO_ROOT] + list(args),
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )

    def create_fixture(self):
        result = self.run_git("worktree", "add", "--quiet", "--detach", self.fixture, "HEAD")
        if result.returncode != 0:
            self.fail("could not create isolated worktree fixture: %s" % result.stderr)

        # Local pre-commit runs may have the #1577 changes unstaged. Overlay
        # only the entrypoint source files needed by this behavior suite.
        shutil.copyfile(self.verifier, os.path.join(self.fixture, VERIFIER_REL))
        shutil.copyfile(os.path.join(REPO_ROOT, "AGENTS.md"), os.path.join(self.fixture, "AGENTS.md"))
        shutil.copyfile(os.path.join(REPO_ROOT, "README.md"), os.path.join(self.fixture, "README.md"))

        # Mirror the caller's active analysis directory. A pre-commit caller
        # may have removed stale files that still exist in fixture HEAD.
        fixture_analysis = os.path.join(self.fixture, "docs", "analysis")
        shutil.rmtree(fixture_analysis, ignore_errors=True)
        shutil.copytree(os.path.join(REPO_ROOT, "docs", "analysis"), fixture_analysis)

        if not os.path.isfile(os.path.join(REPO_ROOT, "PROGRESS.md")):
            stale_progress = os.path.join(self.fixture, "PROGRESS.md")
            if os.path.exists(stale_progress):
                os.remove(stale_progress)

    def remove_fixture(self):
        if not os.path.isdir(self.fixture):
            return
        self.run_git("worktree", "remove", "--force", self.fixture)
        shutil.rmtree(self.fixture, ignore_errors=True)

    def run_verifier(self):
        script = os.path.join(self.fixture, VERIFIER_REL)
        result = subprocess.run(
            [sys.executable, script], cwd=self.fixture,
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        return result.returncode, (result.stdout or "") + (result.stderr or "")

    def assert_failure_code(self, expected_code, case_name):
        exit_code, output = self.run_verifier()
        self.assertNotEqual(exit_code, 0, "%s was accepted" % case_name)
        self.assertRegex(
            output, re.escape("[%s]" % expected_code),
            "%s emitted the wrong behavior code; expected %s:\n%s" % (case_name, expected_code, output),
        )

    def write_fixture_file(self, relative_path, content):
        path = os.path.join(self.fixture, *relative_path.split("/"))
        if os.path.exists(path):
            self.fail("precondition failed: fixture path already exists: %s" % relative_path)
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)

    def assert_forbidden_root_file(self, relative_path):
        try:
            self.write_fixture_file(relative_path, "temporary negative fixture\n")
            self.assert_failure_code("DOC-ROOT-ENTRYPOINT", relative_path)
        finally:
            os.remove(os.path.join(self.fixture, relative_path))

    def assert_forbidden_stale_path(self, relative_path):
        path = os.path.join(self.fixture, *relative_path.split("/"))
        if os.path.exists(path):
            self.fail("precondition failed: stale fixture path already exists: %s" % relative_path)
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8", newline="\n") as handle:
                handle.write("temporary stale-path fixture\n")
            self.assert_failure_code("DOC-STALE-PATH", relative_path)
        finally:
            os.remove(path)

    def assert_readme_owner_link_required(self):
        readme_path = os.path.join(self.fixture, "README.md")
        with open(readme_path, "rb") as handle:
            original_bytes = handle.read()
        original_text = original_bytes.decode("utf-8")
        link_pattern = re.compile(r"\[[^\]]+\]\(AGENTS\.md\)")
        if not link_pattern.search(original_text):
            self.fail("README fixture precondition missing AGENTS.md link")

        try:
            mutated = link_pattern.sub("AGENTS.md (link removed)", original_text, count=1)
            with open(readme_path, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(mutated)
            self.assert_failure_code("DOC-README-ENTRYPOINT", "README without AGENTS.md owner link")
        finally:
            with open(readme_path, "wb") as handle:
                handle.write(original_bytes)

        with open(readme_path, "rb") as handle:
            restored_bytes = handle.read()
        before_hash = hashlib.sha256(original_bytes).hexdigest()
        after_hash = hashlib.sha256(restored_bytes).hexdigest()
        self.assertEqual(before_hash, after_hash, "README fixture bytes were not restored exactly")

    def test_doc_entrypoint_behavior_suite(self):
        self.create_fixture()
        try:
            exit_code, output = self.run_verifier()
            self.assertEqual(exit_code, 0, "positive isolated fixture failed:\n%s" % output)

            self.assert_forbidden_root_file("PROGRESS.md")
            self.assert_forbidden_root_file("CODEX.md")
            self.assert_forbidden_stale_path("docs/analysis/project-overview.md")
            self.assert_readme_owner_link_required()

            exit_code, output = self.run_verifier()
            self.assertEqual(exit_code, 0, "verifier did not recover after fixture cleanup:\n%s" % output)
        finally:
            self.remove_fixture()

        self.assertEqual(
            self.caller_status(), self.initial_status,
            "caller worktree status changed during self-test",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
