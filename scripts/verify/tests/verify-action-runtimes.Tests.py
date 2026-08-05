#!/usr/bin/env python3
"""Negative self-tests for the action runtime deprecation gate (#1580).

Cases:
1. positive: fixture workflow using only node24 allow-listed actions -> 0
2. re-introduce a Node-20-era major (actions/checkout@v4) -> 1
3. unregistered third-party action (potential silent Node-20) -> 1
4. unversioned action reference -> 1

The verifier runs as a subprocess against an isolated fixture; assertions cover
exit codes and the failure fragments naming the offending reference. Prefers
scripts/verify/verify-action-runtimes.py and falls back to the .ps1 verifier
while the scripts/verify migration is still in flight on master.
"""

import os
import shutil
import subprocess
import sys
import tempfile
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def resolve_verifier(name):
    for leaf in ("verify-%s.py" % name, "verify-%s.ps1" % name):
        candidate = os.path.join(REPO_ROOT, "scripts", "verify", leaf)
        if os.path.isfile(candidate):
            return candidate
    raise AssertionError("verifier script not found for %s" % name)


def write_utf8(path, content):
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)


POSITIVE_WORKFLOW = """\
name: fixture
on:
  push:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 20
          cache: pnpm
          cache-dependency-path: app/pnpm-lock.yaml
      - uses: actions/setup-go@v7
        with:
          go-version: "1.25"
      - uses: actions/upload-artifact@v7
        with:
          name: out
          path: dist/
      - uses: actions/download-artifact@v8
        with:
          name: out
          path: dist
      - uses: dorny/paths-filter@v4
        with:
          filters: |
            app:
              - 'app/**'
      - uses: pnpm/action-setup@v6
        with:
          version: 10
      - uses: golangci/golangci-lint-action@v9
      - uses: docker/build-push-action@v7
      - uses: docker/login-action@v4
      - uses: docker/metadata-action@v6
      - uses: docker/setup-buildx-action@v4
      - uses: softprops/action-gh-release@v3
      - uses: dtolnay/rust-toolchain@stable
"""


class VerifyActionRuntimesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.verifier = resolve_verifier("action-runtimes")
        cls.is_python = cls.verifier.endswith(".py")
        print("  verifier under test: %s" % cls.verifier)

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="agenthub-actions-runtime-")
        self.fixture = self._tmp.name
        self.workflows_dir = os.path.join(self.fixture, ".github", "workflows")
        os.makedirs(self.workflows_dir, exist_ok=True)
        verifier_rel = os.path.join("scripts", "verify", os.path.basename(self.verifier))
        verifier_dest = os.path.join(self.fixture, verifier_rel)
        os.makedirs(os.path.dirname(verifier_dest), exist_ok=True)
        shutil.copyfile(self.verifier, verifier_dest)
        self.verifier_rel = verifier_rel

    def tearDown(self):
        self._tmp.cleanup()

    def write_workflow(self, content):
        write_utf8(os.path.join(self.workflows_dir, "fixture.yml"), content)

    def run_verifier(self):
        script = os.path.join(self.fixture, self.verifier_rel)
        if self.is_python:
            command = [sys.executable, script, "--workflows-root", self.workflows_dir]
        else:
            command = ["pwsh", "-NoProfile", "-File", script, "-WorkflowsRoot", self.workflows_dir]
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
        return result.returncode, (result.stdout or "") + (result.stderr or "")

    def assert_fails_with(self, output_fragment, case_name):
        exit_code, output = self.run_verifier()
        self.assertNotEqual(exit_code, 0, "%s must FAIL but verifier exited 0" % case_name)
        self.assertIn(output_fragment, output, "%s failed for the wrong reason:\n%s" % (case_name, output))

    def test_positive_fixture_passes(self):
        self.write_workflow(POSITIVE_WORKFLOW)
        exit_code, output = self.run_verifier()
        self.assertEqual(exit_code, 0, "positive fixture unexpectedly failed:\n%s" % output)

    def test_node20_era_major_fails_closed(self):
        self.write_workflow("""\
name: fixture
on:
  push:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
""")
        self.assert_fails_with("actions/checkout@v4", "Node-20-era actions/checkout@v4")

    def test_unregistered_third_party_action_fails_closed(self):
        self.write_workflow("""\
name: fixture
on:
  push:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: some/unknown-action@v1
""")
        self.assert_fails_with("some/unknown-action@v1", "unregistered action")

    def test_unversioned_action_reference_fails_closed(self):
        self.write_workflow("""\
name: fixture
on:
  push:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout
""")
        self.assert_fails_with("unversioned action reference", "unversioned action")


if __name__ == "__main__":
    unittest.main(verbosity=2)
