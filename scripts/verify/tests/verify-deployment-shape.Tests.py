#!/usr/bin/env python3
"""Negative self-tests for verify-deployment-shape (#1527 PR1, inventory closed in PR2; ps1 迁移).

Each case runs against an isolated minimal repository fixture. A negative
case passes only when the verifier exits non-zero for the expected policy
reason. Cases:

1. positive: intact authoritative template + empty legacy dir -> 0
2. second hand-maintained production compose under deployments/production/ -> 1
3. any compose file under hub-server/deployments/ (legacy resurrection) -> 1
4. authoritative template missing required service -> 1
5. hub-server image off product SSOT -> 1

The verifier runs as a subprocess against the fixture; prefers
scripts/verify/verify-deployment-shape.py and falls back to the .ps1 verifier
while the scripts/verify migration is still in flight on master.
"""

import os
import shutil
import subprocess
import sys
import tempfile
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def resolve_verifier() -> str:
    for leaf in ("verify-deployment-shape.py", "verify-deployment-shape.ps1"):
        candidate = os.path.join(REPO_ROOT, "scripts", "verify", leaf)
        if os.path.isfile(candidate):
            return candidate
    raise AssertionError("verifier script not found for verify-deployment-shape")


def write_utf8(path, content):
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)


class VerifyDeploymentShapeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.verifier = resolve_verifier()
        cls.is_python = cls.verifier.endswith(".py")
        print("  verifier under test: %s" % cls.verifier)

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="agenthub-deploy-shape-")
        self.fixture = self._tmp.name
        production_dir = os.path.join(self.fixture, "deployments", "production")
        os.makedirs(production_dir, exist_ok=True)
        shutil.copyfile(
            os.path.join(REPO_ROOT, "deployments", "production", "docker-compose.yml"),
            os.path.join(production_dir, "docker-compose.yml"),
        )
        verifier_rel = os.path.join("scripts", "verify", os.path.basename(self.verifier))
        verifier_dest = os.path.join(self.fixture, verifier_rel)
        os.makedirs(os.path.dirname(verifier_dest), exist_ok=True)
        shutil.copyfile(self.verifier, verifier_dest)
        self.verifier_rel = verifier_rel

    def tearDown(self):
        self._tmp.cleanup()

    def run_verifier(self):
        script = os.path.join(self.fixture, self.verifier_rel)
        if self.is_python:
            command = [sys.executable, script, "--RepoRootPath", self.fixture]
        else:
            command = ["pwsh", "-NoProfile", "-File", script, "-RepoRootPath", self.fixture]
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
        return result.returncode, (result.stdout or "") + (result.stderr or "")

    def assert_fails_with(self, output_fragment, case_name):
        exit_code, output = self.run_verifier()
        self.assertNotEqual(exit_code, 0, "%s must FAIL but verifier exited 0" % case_name)
        self.assertIn(output_fragment, output, "%s failed for the wrong reason:\n%s" % (case_name, output))

    def test_positive_fixture_passes(self):
        exit_code, output = self.run_verifier()
        self.assertEqual(exit_code, 0, "positive fixture unexpectedly failed:\n%s" % output)

    def test_second_production_compose_fails_closed(self):
        write_utf8(
            os.path.join(self.fixture, "deployments", "production", "docker-compose.us2.yml"),
            """\
services:
  hub-server:
    image: ghcr.io/tokendancelab/agenthub-hub-server:latest
  redis:
    image: redis:7-alpine
""",
        )
        self.assert_fails_with("second hand-maintained production compose", "second production compose")

    def test_legacy_compose_resurrection_fails_closed(self):
        legacy_dir = os.path.join(self.fixture, "hub-server", "deployments")
        os.makedirs(legacy_dir, exist_ok=True)
        write_utf8(
            os.path.join(legacy_dir, "docker-compose.eu1.yml"),
            """\
services:
  hub-server:
    image: ghcr.io/tokendancelab/agenthub-hub-server:latest
""",
        )
        self.assert_fails_with("legacy compose inventory closed", "compose under hub-server/deployments/")

    def test_missing_required_service_fails(self):
        write_utf8(
            os.path.join(self.fixture, "deployments", "production", "docker-compose.yml"),
            """\
services:
  hub-server:
    image: ghcr.io/tokendancelab/agenthub-hub-server:latest
""",
        )
        self.assert_fails_with("missing service 'redis'", "missing redis service")

    def test_hub_server_image_off_ssot_fails(self):
        write_utf8(
            os.path.join(self.fixture, "deployments", "production", "docker-compose.yml"),
            """\
services:
  hub-server:
    image: ghcr.io/example/agenthub-hub:latest
  redis:
    image: redis:7-alpine
""",
        )
        self.assert_fails_with("off SSOT", "hub-server image off product SSOT")


if __name__ == "__main__":
    unittest.main(verbosity=2)
