#!/usr/bin/env python3
"""Behavior-level self-tests for Agent/doc entrypoint ownership (#1577 / #1582).

All mutations happen in an isolated detached Git worktree. The caller worktree
status is snapshotted before and after the suite.

Targets scripts/verify/verify-doc-ssot.py (the ps1-era verifier was already
migrated to python). The verifier and all whitelist entry files are copied into
the fixture worktree so its repo-root discovery resolves to the fixture,
mirroring the original ps1 test. Negative behaviors proven here (#1719):

- sibling escape link (DOC-OUT-OF-REPO-LINK)
- README one-sided maturity change (DOC-README-PARITY)
- AGENTS.md over the 300-line budget (DOC-MAX-LINES)
- verifier-map owner pointer missing from AGENTS.md (DOC-VERIFIER-MAP-OWNER)
- drift-prone AGENTS section-number reference (DOC-AGENTS-NUMBERED-REF)
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
        shutil.copyfile(os.path.join(REPO_ROOT, "README_EN.md"), os.path.join(self.fixture, "README_EN.md"))
        shutil.copyfile(
            os.path.join(REPO_ROOT, "docs", "README.md"),
            os.path.join(self.fixture, "docs", "README.md"),
        )
        # Overlay all tracked Markdown from the caller so behavior tests exercise
        # the exact documentation surface under review, including unstaged edits.
        markdown_files = subprocess.run(
            ["git", "-C", REPO_ROOT, "ls-files", "*.md"],
            capture_output=True, text=True, encoding="utf-8", errors="replace", check=True,
        ).stdout.splitlines()
        for rel in markdown_files:
            source = os.path.join(REPO_ROOT, rel)
            target = os.path.join(self.fixture, rel)
            if not os.path.isfile(source):
                continue
            os.makedirs(os.path.dirname(target) or self.fixture, exist_ok=True)
            shutil.copyfile(source, target)

        # Mirror the caller's doc-slimming state: docs/analysis, docs/plan,
        # docs/progress and docs/roadmap.md were removed on master but still
        # exist in fixture HEAD — drop them so the verifier sees the same shape.
        for rel in ("docs/analysis", "docs/plan", "docs/progress", "docs/roadmap.md"):
            target = os.path.join(self.fixture, rel)
            if os.path.isdir(target):
                shutil.rmtree(target)
            elif os.path.exists(target):
                os.remove(target)

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

    def restore_bytes(self, path, original_bytes):
        with open(path, "wb") as handle:
            handle.write(original_bytes)

    def assert_sibling_escape_link(self):
        readme_path = os.path.join(self.fixture, "README.md")
        with open(readme_path, "rb") as handle:
            original_bytes = handle.read()
        escape_line = "\n跨产品边界见 [sibling docs](../docs/identity/identity-auth.md)。\n"
        try:
            with open(readme_path, "a", encoding="utf-8", newline="\n") as handle:
                handle.write(escape_line)
            self.assert_failure_code("DOC-OUT-OF-REPO-LINK", "README with sibling escape link")
        finally:
            self.restore_bytes(readme_path, original_bytes)

    def assert_readme_maturity_parity(self):
        readme_path = os.path.join(self.fixture, "README.md")
        with open(readme_path, "rb") as handle:
            original_bytes = handle.read()
        original_text = original_bytes.decode("utf-8")
        if "Mobile 是装配中的" not in original_text:
            self.fail("README fixture precondition missing zh maturity marker")
        try:
            mutated = original_text.replace("Mobile 是装配中的", "Mobile 是已就绪的", 1)
            with open(readme_path, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(mutated)
            self.assert_failure_code("DOC-README-PARITY", "README zh-only maturity change")
        finally:
            self.restore_bytes(readme_path, original_bytes)

    def assert_agents_numbered_reference(self):
        readme_path = os.path.join(self.fixture, "README.md")
        with open(readme_path, "rb") as handle:
            original_bytes = handle.read()
        try:
            with open(readme_path, "a", encoding="utf-8", newline="\n") as handle:
                handle.write("\n分支规则见 `AGENTS.md` §6。\n")
            self.assert_failure_code(
                "DOC-AGENTS-NUMBERED-REF",
                "README with drift-prone AGENTS section-number reference",
            )
        finally:
            self.restore_bytes(readme_path, original_bytes)

    def assert_agents_line_budget(self):
        agents_path = os.path.join(self.fixture, "AGENTS.md")
        with open(agents_path, "rb") as handle:
            original_bytes = handle.read()
        original_text = original_bytes.decode("utf-8")
        current_lines = original_text.count("\n")
        padding_lines = max(0, 320 - current_lines)
        try:
            with open(agents_path, "a", encoding="utf-8", newline="\n") as handle:
                handle.write("# line-budget padding\n" * padding_lines)
            self.assert_failure_code("DOC-MAX-LINES", "AGENTS.md over 300-line budget")
        finally:
            self.restore_bytes(agents_path, original_bytes)

    def assert_orphan_selftest(self):
        """A self-test nobody executes must fail the gate (#2275)."""
        rel = "scripts/verify/tests/verify-orphan-demo.Tests.py"
        try:
            self.write_fixture_file(rel, "# temporary negative fixture for #2275\n")
            self.assert_failure_code("DOC-ORPHAN-SELFTEST", "orphan self-test under scripts/verify/tests/")
        finally:
            os.remove(os.path.join(self.fixture, *rel.split("/")))

    def assert_verifier_map_owner(self):
        agents_path = os.path.join(self.fixture, "AGENTS.md")
        with open(agents_path, "rb") as handle:
            original_bytes = handle.read()
        original_text = original_bytes.decode("utf-8")
        if "docs/governance/verifier-map.md" not in original_text:
            self.fail("AGENTS fixture precondition missing verifier-map pointer")
        try:
            mutated = original_text.replace(
                "`docs/governance/verifier-map.md`",
                "`docs/governance/governance-execution.md`",
                1,
            )
            with open(agents_path, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(mutated)
            self.assert_failure_code("DOC-VERIFIER-MAP-OWNER", "AGENTS.md without verifier-map owner pointer")
        finally:
            self.restore_bytes(agents_path, original_bytes)

    def test_doc_entrypoint_behavior_suite(self):
        self.create_fixture()
        try:
            exit_code, output = self.run_verifier()
            self.assertEqual(exit_code, 0, "positive isolated fixture failed:\n%s" % output)

            self.assert_forbidden_root_file("PROGRESS.md")
            self.assert_forbidden_root_file("CODEX.md")
            self.assert_forbidden_stale_path("docs/analysis/project-overview.md")
            self.assert_readme_owner_link_required()
            self.assert_sibling_escape_link()
            self.assert_readme_maturity_parity()
            self.assert_agents_numbered_reference()
            self.assert_agents_line_budget()
            self.assert_verifier_map_owner()
            self.assert_orphan_selftest()

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
