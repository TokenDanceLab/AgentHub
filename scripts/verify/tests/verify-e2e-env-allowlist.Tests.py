#!/usr/bin/env python3
"""Negative-fixture tests for verify-e2e-env-allowlist.py (#1873 Slice B).

Builds a synthetic, loopback-only real-e2e-stack workflow that must pass the
verifier unchanged, then applies one surgical regression per case and asserts
the verifier exits non-zero:

1. re-added arbitrary URL input (id_base_url)
2. re-added arbitrary image input (id_image)
3. legacy id_mode input instead of opaque id_env
4. free-string id_env (choice options removed)
5. non-loopback issuer URL
6. base URL interpolated from a dispatch input
7. arbitrary image interpolated into docker run
8. allowlist image removed

Each mutation proves the fail-closed gate actually rejects the regression.
"""

import os
import subprocess
import sys
import tempfile
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
VERIFIER_PATH = os.path.join(REPO_ROOT, "scripts", "verify", "verify-e2e-env-allowlist.py")

GOOD = """\
name: checks
on:
  workflow_dispatch:
    inputs:
      id_env:
        description: opaque ID
        default: source
        type: choice
        options: [source, image, local]
jobs:
  real-e2e-stack:
    env:
      AGENTHUB_TOKENDANCE_ID_ISSUER_URL: http://127.0.0.1:3000
    steps:
      - name: Start TokenDance ID (image, allowlist)
        run: docker run -d ghcr.io/tokendancelab/tokendance-id:main
      - name: Run real-e2e lane
        env:
          AGENTHUB_E2E_ID_BASE_URL: http://127.0.0.1:3000
        run: echo ok
  validate:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
"""


def run_verifier(text):
    with tempfile.TemporaryDirectory(prefix="agenthub-e2e-env-") as tmp_dir:
        path = os.path.join(tmp_dir, "checks.yml")
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
        result = subprocess.run(
            [sys.executable, VERIFIER_PATH, "--workflow", path],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        return result.returncode, (result.stdout or "") + (result.stderr or "")


class E2eEnvAllowlistTests(unittest.TestCase):
    def assert_passes(self, text, label):
        code, output = run_verifier(text)
        self.assertEqual(code, 0, f"{label} must pass but exited {code}:\n{output}")

    def assert_fails(self, text, label):
        code, output = run_verifier(text)
        self.assertNotEqual(code, 0, f"{label} must fail but exited 0:\n{output}")

    def test_clean_workflow_passes(self):
        self.assert_passes(GOOD, "clean loopback-only workflow")

    def test_arbitrary_url_input_fails(self):
        bad = GOOD.replace(
            "      id_env:",
            "      id_base_url:\n        description: arbitrary\n        type: string\n      id_env:",
        )
        self.assert_fails(bad, "re-added id_base_url input")

    def test_arbitrary_image_input_fails(self):
        bad = GOOD.replace(
            "      id_env:",
            "      id_image:\n        description: arbitrary\n        type: string\n      id_env:",
        )
        self.assert_fails(bad, "re-added id_image input")

    def test_legacy_id_mode_input_fails(self):
        bad = GOOD.replace("id_env:", "id_mode:")
        self.assert_fails(bad, "legacy id_mode input")

    def test_free_string_env_fails(self):
        bad = GOOD.replace("        type: choice\n        options: [source, image, local]", "        type: string")
        self.assert_fails(bad, "free-string id_env")

    def test_non_loopback_issuer_fails(self):
        bad = GOOD.replace(
            "AGENTHUB_TOKENDANCE_ID_ISSUER_URL: http://127.0.0.1:3000",
            "AGENTHUB_TOKENDANCE_ID_ISSUER_URL: https://id.example.invalid",
        )
        self.assert_fails(bad, "non-loopback issuer URL")

    def test_input_interpolated_base_url_fails(self):
        bad = GOOD.replace(
            "AGENTHUB_E2E_ID_BASE_URL: http://127.0.0.1:3000",
            "AGENTHUB_E2E_ID_BASE_URL: ${{ inputs.id_base_url }}",
        )
        self.assert_fails(bad, "dispatch-input interpolated base URL")

    def test_variable_image_fails(self):
        bad = GOOD.replace(
            "ghcr.io/tokendancelab/tokendance-id:main",
            '"$ID_IMAGE"',
        )
        self.assert_fails(bad, "variable image interpolation")

    def test_allowlist_image_missing_fails(self):
        bad = GOOD.replace(
            "ghcr.io/tokendancelab/tokendance-id:main",
            "docker.io/library/ubuntu:latest",
        )
        self.assert_fails(bad, "allowlist image removed")


if __name__ == "__main__":
    unittest.main(verbosity=2)
