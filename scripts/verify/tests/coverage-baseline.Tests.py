#!/usr/bin/env python3
"""Self-tests for verify-coverage-baseline.py metadata/re-baseline safety."""

import datetime
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest import mock

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "verify-coverage-baseline.py"
SPEC = importlib.util.spec_from_file_location("verify_coverage_baseline", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


def sample_baseline():
    return {
        "$schema": "coverage-baseline.v1",
        "measuredAt": "2026-01-01",
        "masterSha": "0" * 40,
        "masterShaShort": "0" * 9,
        "packages": {
            "pkg": {
                "coverage": {"lines": 10.0, "statements": 20.0, "functions": 30.0, "branches": 40.0},
                "uncoveredFiles": 2,
                "tests": {"total": 1, "passed": 1, "failed": 0, "skipped": 0},
            }
        },
    }


def measurement(**overrides):
    value = {
        "coverage": {"lines": 11.0, "statements": 21.0, "functions": 31.0, "branches": 41.0},
        "uncoveredFiles": 1,
        "tests": {"total": 2, "passed": 2, "failed": 0, "skipped": 0},
    }
    value.update(overrides)
    return {"pkg": value}


class CoverageBaselineSafetyTests(unittest.TestCase):
    def test_repository_baseline_sha_is_reachable(self):
        baseline = MODULE.read_json(MODULE.DEFAULT_BASELINE_PATH)
        MODULE.validate_baseline_source(baseline)

    def test_production_counts_exclude_story_fixtures(self):
        # Storybook render fixtures are never executed by vitest (always 0%),
        # so they must not ride the uncovered ratchet (#1535 include contract).
        summary = {
            "total": {},
            "ui/Button.stories.tsx": {"lines": {"total": 40, "pct": 0.0}},
            "ui/emails.stories.ts": {"lines": {"total": 10, "pct": 0.0}},
            "ui/Button.tsx": {"lines": {"total": 100, "pct": 100.0}},
            "ui/ReportView.ts": {"lines": {"total": 30, "pct": 0.0}},
        }
        production, uncovered = MODULE.count_production_coverage(summary)
        self.assertEqual(production, 2)
        self.assertEqual(uncovered, 1)

    def test_covered_story_still_not_production(self):
        # Even a story that a test happens to import stays a non-production
        # fixture; the contract classifies it, not its measured pct.
        summary = {
            "total": {},
            "ui/Button.stories.tsx": {"lines": {"total": 40, "pct": 100.0}},
        }
        production, uncovered = MODULE.count_production_coverage(summary)
        self.assertEqual(production, 0)
        self.assertEqual(uncovered, 0)

    def test_write_refuses_metric_regression(self):
        baseline = sample_baseline()
        values = measurement()
        values["pkg"]["coverage"]["lines"] = 9.99
        with tempfile.TemporaryDirectory() as temp:
            path = pathlib.Path(temp) / "baseline.json"
            with self.assertRaisesRegex(RuntimeError, "refuses to lower"):
                MODULE.write_baseline(str(path), baseline, values, "a" * 40)
            self.assertFalse(path.exists())

    def test_write_refuses_uncovered_growth(self):
        baseline = sample_baseline()
        values = measurement(uncoveredFiles=3)
        with tempfile.TemporaryDirectory() as temp:
            path = pathlib.Path(temp) / "baseline.json"
            with self.assertRaisesRegex(RuntimeError, "refuses to increase"):
                MODULE.write_baseline(str(path), baseline, values, "a" * 40)
            self.assertFalse(path.exists())

    def test_write_updates_measurements_and_published_sha(self):
        baseline = sample_baseline()
        values = measurement()
        with tempfile.TemporaryDirectory() as temp:
            path = pathlib.Path(temp) / "baseline.json"
            MODULE.write_baseline(str(path), baseline, values, "a" * 40)
            written = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(written["masterSha"], "a" * 40)
        self.assertEqual(written["masterShaShort"], "a" * 9)
        self.assertEqual(written["measuredAt"], datetime.date.today().isoformat())
        self.assertEqual(written["packages"]["pkg"]["coverage"]["lines"], 11.0)
        self.assertEqual(written["packages"]["pkg"]["uncoveredFiles"], 1)
        self.assertEqual(written["packages"]["pkg"]["tests"]["total"], 2)

    def test_write_context_rejects_non_master_before_measurement(self):
        with mock.patch.object(MODULE, "git_text", return_value="feature/example"):
            with self.assertRaisesRegex(RuntimeError, "branch master"):
                MODULE.validate_write_context(None)

    def test_write_context_rejects_partial_package_selection(self):
        with self.assertRaisesRegex(RuntimeError, "all packages"):
            MODULE.validate_write_context({"agenthub-web"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
