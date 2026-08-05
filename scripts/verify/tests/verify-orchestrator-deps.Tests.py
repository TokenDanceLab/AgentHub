#!/usr/bin/env python3
"""Negative self-tests for verify-orchestrator-deps (#1566).

Each case runs against an isolated minimal Go module fixture that mimics the
edge-server layout. A negative case passes only when the verifier exits
non-zero for the expected policy reason. Cases:

1. positive: intact direction (leaf without root import) -> 0
2. fixture: leaf package imports root internal/adapters -> 1
3. fixture: internal/orchestration imports internal/adapters -> 1

The verifier runs as a subprocess; prefers scripts/verify/verify-orchestrator-deps.py
and falls back to the .ps1 verifier while the migration is still in flight.
"""

import os
import shutil
import subprocess
import sys
import tempfile
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def resolve_verifier() -> str:
    for leaf in ("verify-orchestrator-deps.py", "verify-orchestrator-deps.ps1"):
        candidate = os.path.join(REPO_ROOT, "scripts", "verify", leaf)
        if os.path.isfile(candidate):
            return candidate
    raise AssertionError("verifier script not found for verify-orchestrator-deps")


def write_utf8(path, content):
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)


GO_MOD = """\
module github.com/agenthub/edge-server

go 1.25.0
"""


class VerifyOrchestratorDepsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.verifier = resolve_verifier()
        cls.is_python = cls.verifier.endswith(".py")
        print("  verifier under test: %s" % cls.verifier)

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="agenthub-orch-deps-")
        self.fixture = self._tmp.name
        write_utf8(os.path.join(self.fixture, "go.mod"), GO_MOD)
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
            command = [sys.executable, script, "--EdgeServerRoot", self.fixture]
        else:
            command = ["pwsh", "-NoProfile", "-File", script, "-EdgeServerRoot", self.fixture]
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
        return result.returncode, (result.stdout or "") + (result.stderr or "")

    def assert_fails_with(self, output_fragment, case_name):
        exit_code, output = self.run_verifier()
        self.assertNotEqual(exit_code, 0, "%s must FAIL but verifier exited 0" % case_name)
        self.assertIn(output_fragment, output, "%s failed for the wrong reason:\n%s" % (case_name, output))

    def test_positive_fixture_passes(self):
        os.makedirs(os.path.join(self.fixture, "internal", "orchestration"))
        os.makedirs(os.path.join(self.fixture, "internal", "adapters"))
        os.makedirs(os.path.join(self.fixture, "internal", "adapters", "orchestrator"))
        write_utf8(os.path.join(self.fixture, "internal", "adapters", "root.go"), "package adapters\n")
        write_utf8(os.path.join(self.fixture, "internal", "orchestration", "contract.go"), "package orchestration\n")
        write_utf8(
            os.path.join(self.fixture, "internal", "adapters", "orchestrator", "leaf.go"),
            """\
package orchestrator

import (
	"github.com/agenthub/edge-server/internal/orchestration"
)

var _ = orchestration.TaskStatus("pending")
""",
        )
        exit_code, output = self.run_verifier()
        self.assertEqual(exit_code, 0, "positive fixture unexpectedly failed:\n%s" % output)

    def test_leaf_imports_root_adapters_fails_closed(self):
        os.makedirs(os.path.join(self.fixture, "internal", "orchestration"))
        os.makedirs(os.path.join(self.fixture, "internal", "adapters", "orchestrator"))
        os.makedirs(os.path.join(self.fixture, "internal", "adapters"), exist_ok=True)
        write_utf8(os.path.join(self.fixture, "internal", "orchestration", "contract.go"), "package orchestration\n")
        write_utf8(os.path.join(self.fixture, "internal", "adapters", "root.go"), "package adapters\n")
        write_utf8(
            os.path.join(self.fixture, "internal", "adapters", "orchestrator", "leaf.go"),
            """\
package orchestrator

import (
	_ "github.com/agenthub/edge-server/internal/adapters"
)
""",
        )
        self.assert_fails_with("imports root implementation package", "leaf imports root adapters")

    def test_orchestration_imports_adapters_fails_closed(self):
        os.makedirs(os.path.join(self.fixture, "internal", "orchestration"))
        os.makedirs(os.path.join(self.fixture, "internal", "adapters"))
        os.makedirs(os.path.join(self.fixture, "internal", "adapters", "orchestrator"))
        write_utf8(os.path.join(self.fixture, "internal", "adapters", "root.go"), "package adapters\n")
        write_utf8(os.path.join(self.fixture, "internal", "adapters", "orchestrator", "leaf.go"), "package orchestrator\n")
        write_utf8(
            os.path.join(self.fixture, "internal", "orchestration", "contract.go"),
            """\
package orchestration

import (
	_ "github.com/agenthub/edge-server/internal/adapters"
)
""",
        )
        self.assert_fails_with("imports adapters", "orchestration imports adapters")


if __name__ == "__main__":
    unittest.main(verbosity=2)
