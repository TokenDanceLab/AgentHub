#!/usr/bin/env python3
"""Negative self-tests for the quality-debt ratchet (#1536).

Each case runs against an isolated minimal repository fixture. A negative case
passes only when the verifier exits non-zero for the expected policy code
(QDR-*). Mirrors the original ps1 fixture logic: baseline JSON, checks.yml,
both golangci configs, and the verifier are copied into the fixture; when the
baseline carries no golangci exclusions a self-consistent synthetic exclusion
(row + config rule + real Go source) is injected so every case can mutate the
first row.

The .ps1-era test injected the synthetic config rule with a LF-only string
replace that silently misses CRLF checkouts (core.autocrlf). This test
normalizes fixture text to LF before mutating, so it behaves the same on LF
(CI) and CRLF (Windows) checkouts. Prefers the .py verifier and falls back to
the .ps1 verifier while the scripts/verify migration is in flight.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

SYNTHETIC_EXCLUSION_PATH = r"internal/adapters/parser_ndjson\.go"
VERIFIER_NAME = "quality-debt-ratchet"
BASELINE_REL = os.path.join("scripts", "verify", "quality-debt-baseline.json")


def resolve_verifier(name):
    for leaf in ("verify-%s.py" % name, "verify-%s.ps1" % name):
        candidate = os.path.join(REPO_ROOT, "scripts", "verify", leaf)
        if os.path.isfile(candidate):
            return candidate
    raise AssertionError("verifier script not found for %s" % name)


def read_utf8(path):
    with open(path, "r", encoding="utf-8", newline=None) as handle:
        return handle.read()


def write_utf8(path, content):
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)


def write_json(path, obj):
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(obj, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


class VerifyQualityDebtRatchetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.verifier = resolve_verifier(VERIFIER_NAME)
        cls.is_python = cls.verifier.endswith(".py")
        print("  verifier under test: %s" % cls.verifier)

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="agenthub-quality-debt-")
        self.fixture = self._tmp.name
        self.baseline_path = os.path.join(self.fixture, *BASELINE_REL.split("/"))

    def tearDown(self):
        self._tmp.cleanup()

    def copy_repo_file(self, relative_path):
        source = os.path.join(REPO_ROOT, *relative_path.split("/"))
        destination = os.path.join(self.fixture, *relative_path.split("/"))
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        shutil.copyfile(source, destination)

    def new_fixture(self):
        verifier_leaf = os.path.basename(self.verifier)
        for relative in (
            ".github/workflows/checks.yml",
            "hub-server/.golangci.yml",
            "edge-server/.golangci.yml",
            os.path.join("scripts", "verify", verifier_leaf),
            BASELINE_REL,
        ):
            self.copy_repo_file(relative)

        baseline = json.loads(read_utf8(self.baseline_path))
        if not baseline.get("golangci_exclusions"):
            baseline["golangci_exclusions"] = [{
                "file": "edge-server/.golangci.yml",
                "path": SYNTHETIC_EXCLUSION_PATH,
                "linters": ["cyclop", "gocognit", "gocyclo"],
                "complexity": {"gocognit": 99, "gocyclo": 99},
                "issue": 1569,
                "owner": "test-owner",
                "introduced_at": "2026-08-04",
                "review_by": "2026-10-01",
                "reason": "synthetic fixture entry for negative self-tests; not a real repository gate",
            }]
            write_json(self.baseline_path, baseline)

            config_path = os.path.join(self.fixture, "edge-server", ".golangci.yml")
            config = read_utf8(config_path)
            config = config.replace(
                "    rules:\n",
                "    rules:\n      - linters:\n          - cyclop\n          - gocognit\n          - gocyclo\n        path: %s\n" % SYNTHETIC_EXCLUSION_PATH,
            )
            write_utf8(config_path, config)

        for entry in baseline["golangci_exclusions"]:
            module = "hub-server" if entry["file"].startswith("hub-server") else "edge-server"
            go_path = entry["path"].replace("\\.", ".")
            self.copy_repo_file(os.path.join(module, go_path))

        return self.fixture

    def load_baseline(self):
        return json.loads(read_utf8(self.baseline_path))

    def run_verifier(self, base_baseline_path=None, run_complexity=False):
        script = os.path.join(self.fixture, "scripts", "verify", os.path.basename(self.verifier))
        if self.is_python:
            command = [sys.executable, script, "--RepoRootPath", self.fixture, "--BaselinePath", self.baseline_path]
            if not run_complexity:
                command.append("--SkipComplexity")
            if base_baseline_path:
                command += ["--BaseBaselinePath", base_baseline_path]
            else:
                command.append("--SkipHistoricalRatchet")
        else:
            command = ["pwsh", "-NoProfile", "-File", script, "-RepoRootPath", self.fixture, "-BaselinePath", self.baseline_path]
            if not run_complexity:
                command.append("-SkipComplexity")
            if base_baseline_path:
                command += ["-BaseBaselinePath", base_baseline_path]
            else:
                command.append("-SkipHistoricalRatchet")
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
        return result.returncode, (result.stdout or "") + (result.stderr or "")

    def assert_negative_code(self, expected_code, case_name, base_baseline_path=None, run_complexity=False):
        exit_code, output = self.run_verifier(base_baseline_path=base_baseline_path, run_complexity=run_complexity)
        self.assertNotEqual(exit_code, 0, "%s unexpectedly passed" % case_name)
        self.assertRegex(
            output, re.escape("[%s]" % expected_code),
            "%s failed with the wrong behavior code; expected %s:\n%s" % (case_name, expected_code, output),
        )

    def test_positive_fixture_passes(self):
        self.new_fixture()
        exit_code, output = self.run_verifier()
        self.assertEqual(exit_code, 0, "positive fixture unexpectedly failed:\n%s" % output)

    def test_complexity_execution_accepts_in_budget_fixture(self):
        self.new_fixture()
        exit_code, output = self.run_verifier(run_complexity=True)
        self.assertEqual(exit_code, 0, "in-budget complexity fixture unexpectedly failed:\n%s" % output)

    def test_complexity_execution_rejects_exceeded_budget(self):
        self.new_fixture()
        baseline = self.load_baseline()
        baseline["golangci_exclusions"][0]["complexity"]["gocognit"] = 0
        write_json(self.baseline_path, baseline)
        self.assert_negative_code("QDR-COMPLEXITY", "exceeded complexity fixture", run_complexity=True)

    def test_unregistered_soft_gate(self):
        self.new_fixture()
        checks_path = os.path.join(self.fixture, ".github", "workflows", "checks.yml")
        text = read_utf8(checks_path)
        text = re.sub(r"(?m)^      - name: Build\r?\n",
                      "      - name: Build\n        continue-on-error: true\n",
                      text, count=1)
        write_utf8(checks_path, text)
        self.assert_negative_code("QDR-SOFT-GATE-UNREGISTERED", "unregistered soft gate")

    def test_directory_exclusion_widening(self):
        self.new_fixture()
        config_path = os.path.join(self.fixture, "edge-server", ".golangci.yml")
        config = read_utf8(config_path)
        config = config.replace(r"path: internal/adapters/parser_ndjson\.go", r"path: internal/adapters/.*\.go")
        write_utf8(config_path, config)
        baseline = self.load_baseline()
        baseline["golangci_exclusions"][0]["path"] = r"internal/adapters/.*\.go"
        write_json(self.baseline_path, baseline)
        self.assert_negative_code("QDR-SCHEMA", "directory exclusion widening")

    def test_linter_set_drift(self):
        self.new_fixture()
        config_path = os.path.join(self.fixture, "edge-server", ".golangci.yml")
        config = read_utf8(config_path)
        pattern = re.compile(
            r"(?ms)(      - linters:\r?\n          - cyclop\r?\n          - gocognit\r?\n          - gocyclo\r?\n)"
            r"(        path: internal/adapters/parser_ndjson\\\.go)"
        )
        config = pattern.sub(r"\1          - errcheck\n\2", config, count=1)
        write_utf8(config_path, config)
        self.assert_negative_code("QDR-LINTER-MISMATCH", "linter-set drift")

    def test_missing_introduced_at(self):
        self.new_fixture()
        baseline = self.load_baseline()
        del baseline["soft_gates"][0]["introduced_at"]
        write_json(self.baseline_path, baseline)
        self.assert_negative_code("QDR-SCHEMA", "missing introduced_at")

    def test_missing_review_by(self):
        self.new_fixture()
        baseline = self.load_baseline()
        del baseline["soft_gates"][0]["review_by"]
        write_json(self.baseline_path, baseline)
        self.assert_negative_code("QDR-SCHEMA", "missing review_by")

    def test_path_traversal_exclusion(self):
        self.new_fixture()
        config_path = os.path.join(self.fixture, "edge-server", ".golangci.yml")
        config = read_utf8(config_path)
        config = config.replace(r"path: internal/adapters/parser_ndjson\.go", r"path: ../hub-server/internal/app/events\.go")
        write_utf8(config_path, config)
        baseline = self.load_baseline()
        baseline["golangci_exclusions"][0]["path"] = r"../hub-server/internal/app/events\.go"
        write_json(self.baseline_path, baseline)
        self.assert_negative_code("QDR-SCHEMA", "path traversal exclusion")

    def test_non_numeric_issue_owner(self):
        self.new_fixture()
        baseline = self.load_baseline()
        baseline["soft_gates"][0]["issue"] = "1571"
        write_json(self.baseline_path, baseline)
        self.assert_negative_code("QDR-SCHEMA", "non-numeric issue owner")

    def test_zombie_baseline_entry(self):
        self.new_fixture()
        baseline = self.load_baseline()
        baseline["soft_gates"].append({
            "location": "fake-job: Fake step",
            "kind": "continue-on-error",
            "reason": "negative fixture",
            "issue": 1536,
            "owner": "test-owner",
            "introduced_at": "2026-08-03",
            "review_by": "2026-08-04",
        })
        write_json(self.baseline_path, baseline)
        self.assert_negative_code("QDR-SOFT-GATE-ZOMBIE", "zombie baseline entry")

    def test_runtime_dependency_mutation(self):
        self.new_fixture()
        checks_path = os.path.join(self.fixture, ".github", "workflows", "checks.yml")
        with open(checks_path, "a", encoding="utf-8", newline="\n") as handle:
            handle.write("\n  dependency-mutation-fixture:\n    runs-on: ubuntu-latest\n    steps:\n      - run: go get example.com/forbidden\n")
        self.assert_negative_code("QDR-RUNTIME-MUTATION", "runtime dependency mutation")

    def test_complexity_budget_increase(self):
        self.new_fixture()
        base_baseline_path = os.path.join(self.fixture, "base-quality-debt-baseline.json")
        shutil.copyfile(self.baseline_path, base_baseline_path)
        baseline = self.load_baseline()
        baseline["golangci_exclusions"][0]["complexity"]["gocognit"] += 1
        write_json(self.baseline_path, baseline)
        self.assert_negative_code("QDR-HISTORY-REGRESSION", "complexity budget increase", base_baseline_path=base_baseline_path)

    def test_complexity_metric_removal(self):
        self.new_fixture()
        base_baseline_path = os.path.join(self.fixture, "base-quality-debt-baseline.json")
        shutil.copyfile(self.baseline_path, base_baseline_path)
        baseline = self.load_baseline()
        del baseline["golangci_exclusions"][0]["complexity"]["gocognit"]
        write_json(self.baseline_path, baseline)
        self.assert_negative_code("QDR-SCHEMA", "complexity metric removal", base_baseline_path=base_baseline_path)

    def test_review_deadline_extension_without_reason(self):
        self.new_fixture()
        base_baseline_path = os.path.join(self.fixture, "base-quality-debt-baseline.json")
        shutil.copyfile(self.baseline_path, base_baseline_path)
        baseline = self.load_baseline()
        baseline["soft_gates"][0]["review_by"] = "2099-01-01"
        baseline["soft_gates"][0].pop("extension_reason", None)
        write_json(self.baseline_path, baseline)
        self.assert_negative_code("QDR-HISTORY-REGRESSION", "review deadline extension without reason", base_baseline_path=base_baseline_path)


if __name__ == "__main__":
    unittest.main(verbosity=2)
