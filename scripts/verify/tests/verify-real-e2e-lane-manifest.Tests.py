#!/usr/bin/env python3
"""Negative-fixture tests for verify-real-e2e-lane-manifest.py private-name scan (#1873).

Builds a synthetic, loopback-only real-e2e lane manifest that must pass the
verifier unchanged, then applies one surgical leak per case and asserts the
verifier exits non-zero:

1. http(s):// URL with a non-loopback host (internal.example.com)
2. http(s):// URL with a single-label internal host (internalhost)
3. http(s):// URL with a non-loopback IPv4 host (10.0.0.5)
4. bare non-loopback IPv4 inside a free-text field
5. absolute Windows filesystem path (D:\\secret\\x)
6. absolute Unix filesystem path (/home/ci-runner/app/web)
7. internal-suffix hostname (db.internal)

Also proves loopback variants (127.0.0.1 / localhost / [::1]) pass.
"""

import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
VERIFIER_PATH = os.path.join(REPO_ROOT, "scripts", "verify", "verify-real-e2e-lane-manifest.py")

GOOD = {
    "schema": "agenthub-real-e2e-lane-v1",
    "kind": "real-e2e-lane",
    "generated_at": "2026-08-24T12:34:56Z",
    "evidence_level": "observed-local",
    "real_tested": True,
    "claim": "真实全栈 OIDC 登录",
    "status": "passed",
    "skipped_evidence_levels": ["fixture-unit", "playwright-ui"],
    "planned_evidence_levels": ["observed-local"],
    "stack": {
        "id": {"base_url": "http://127.0.0.1:3000", "state": "up", "login": "real-browser-oidc-authorization-code-pkce"},
        "hub": {"base_url": "http://localhost:8080", "state": "up"},
        "edge": {"base_url": "http://127.0.0.1:3210", "state": "up"},
        "web": {"base_url": "http://127.0.0.1:5174", "state": "up"},
        "backend_services": ["postgres:16", "redis:7"],
    },
    "secret_handling": {
        "account_mode": "runtime-random-test-identities (provision-real-e2e-stack.sh)",
        "credentials_path": "tests/artifacts/real-e2e-account.env (chmod 600, gitignored)",
        "manifest_secrets": "none",
    },
    "playwright_exit_code": 0,
    "artifacts": {
        "report": "report-20260824-123456.json",
        "html_report_dir": "html-20260824-123456",
        "trace_zip_count": 1,
        "account_env_written": True,
    },
    "rows": [
        {
            "name": "real-oidc-login",
            "area": "web",
            "evidence_level": "observed-local",
            "real_tested": True,
            "claim": "真实 OIDC 登录",
            "status": "passed",
            "exit_code": 0,
            "duration_ms": 1000,
            "command": "playwright test --config playwright.real.config.ts",
            "working_directory": "app/web",
            "evidence": "report-20260824-123456.json",
        }
    ],
}


def run_verifier(manifest):
    with tempfile.TemporaryDirectory(prefix="agenthub-lane-manifest-") as tmp_dir:
        manifest_path = os.path.join(tmp_dir, "manifest.json")
        with open(manifest_path, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(manifest, handle, indent=2, ensure_ascii=False)
        result = subprocess.run(
            [sys.executable, VERIFIER_PATH, manifest_path],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        return result.returncode, (result.stdout or "") + (result.stderr or "")


class LaneManifestPrivateNameTests(unittest.TestCase):
    def assert_passes(self, manifest, label):
        code, output = run_verifier(manifest)
        self.assertEqual(code, 0, f"{label} must pass but exited {code}:\n{output}")

    def assert_fails(self, manifest, label):
        code, output = run_verifier(manifest)
        self.assertNotEqual(code, 0, f"{label} must fail but exited 0:\n{output}")

    def test_loopback_only_passes(self):
        self.assert_passes(GOOD, "loopback-only manifest")

    def test_ipv6_loopback_url_passes(self):
        m = copy.deepcopy(GOOD)
        m["stack"]["web"]["base_url"] = "http://[::1]:5174"
        self.assert_passes(m, "IPv6 loopback URL")

    def test_non_loopback_url_host_fails(self):
        m = copy.deepcopy(GOOD)
        m["stack"]["web"]["base_url"] = "http://internal.example.com"
        self.assert_fails(m, "non-loopback URL host")

    def test_single_label_internal_url_host_fails(self):
        m = copy.deepcopy(GOOD)
        m["stack"]["hub"]["base_url"] = "http://internalhost:8080"
        self.assert_fails(m, "single-label synthetic URL host")

    def test_non_loopback_ip_url_fails(self):
        m = copy.deepcopy(GOOD)
        m["stack"]["web"]["base_url"] = "http://10.0.0.5:5174"
        self.assert_fails(m, "non-loopback IPv4 URL host")

    def test_bare_non_loopback_ip_fails(self):
        m = copy.deepcopy(GOOD)
        m["rows"][0]["evidence"] = "probed 10.0.0.5 ok"
        self.assert_fails(m, "bare non-loopback IPv4")

    def test_windows_absolute_path_fails(self):
        m = copy.deepcopy(GOOD)
        m["rows"][0]["working_directory"] = "D:\\secret\\x"
        self.assert_fails(m, "absolute Windows path")

    def test_unix_absolute_path_fails(self):
        m = copy.deepcopy(GOOD)
        m["rows"][0]["working_directory"] = "/home/ci-runner/app/web"
        self.assert_fails(m, "absolute Unix path")

    def test_internal_suffix_hostname_fails(self):
        m = copy.deepcopy(GOOD)
        m["rows"][0]["evidence"] = "backend db.internal reachable"
        self.assert_fails(m, "internal-suffix hostname")


if __name__ == "__main__":
    unittest.main(verbosity=2)
