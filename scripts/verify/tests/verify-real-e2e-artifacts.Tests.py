#!/usr/bin/env python3
"""Negative-fixture tests for verify-real-e2e-artifacts.py (#1873 Slice D).

Builds a synthetic loopback-only artifacts tree that must pass the scanner, then
applies one surgical leak per case and asserts the scanner exits non-zero:

1. non-loopback URL host (endpoint)
2. test account email
3. OIDC callback param (code/state)
4. JWT token
5. Set-Cookie header (storage)
6. absolute Windows filesystem path
7. password value in request body
8. trace.zip with a leaked trace.network member (zip extraction path)

Also proves loopback variants (127.0.0.1 / localhost) pass.
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
VERIFIER_PATH = os.path.join(REPO_ROOT, "scripts", "verify", "verify-real-e2e-artifacts.py")

GOOD_REPORT = {
    "status": "passed",
    "baseURL": "http://127.0.0.1:5174",
    "test": "real-oidc-login",
    "workingDirectory": "app/web",
    "attachments": [],
}
GOOD_HTML = "<!doctype html>\n<html><body><h1>Playwright report</h1><p>loopback only http://localhost:5174</p></body></html>\n"


def run_scanner(artifacts_dir):
    result = subprocess.run(
        [sys.executable, VERIFIER_PATH, artifacts_dir],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return result.returncode, (result.stdout or "") + (result.stderr or "")


def write_report(directory, content, name="report-20260824-123456.json"):
    path = os.path.join(directory, name)
    os.makedirs(os.path.dirname(path), exist_ok=True) if os.path.dirname(path) != directory else None
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        if isinstance(content, (dict, list)):
            json.dump(content, handle, indent=2, ensure_ascii=False)
        else:
            handle.write(content)


class ArtifactSanitizeTests(unittest.TestCase):
    def assert_passes(self, directory, label):
        code, output = run_scanner(directory)
        self.assertEqual(code, 0, f"{label} must pass but exited {code}:\n{output}")

    def assert_fails(self, directory, label):
        code, output = run_scanner(directory)
        self.assertNotEqual(code, 0, f"{label} must fail but exited 0:\n{output}")

    def _good_dir(self, tmp):
        # report + html + manifest (skipped) + account env (skipped), all loopback-only
        write_report(tmp, GOOD_REPORT)
        write_report(tmp, GOOD_HTML, name="html-20260824-123456/index.html")
        write_report(tmp, json.dumps(GOOD_REPORT), name="manifest-20260824-123456.json")
        write_report(tmp, "AGENTHUB_E2E_ACCOUNT=should-be-ignored\n", name="real-e2e-account.env")

    def test_loopback_only_passes(self):
        with tempfile.TemporaryDirectory(prefix="agenthub-artifacts-") as tmp:
            self._good_dir(tmp)
            self.assert_passes(tmp, "loopback-only artifacts tree")

    def test_manifest_and_account_env_skipped(self):
        # manifest 与凭据文件即使含会被 flag 的形态也不该被本门禁扫描
        with tempfile.TemporaryDirectory(prefix="agenthub-artifacts-") as tmp:
            self._good_dir(tmp)
            write_report(tmp, '{"baseURL":"http://internal.example.com"}', name="manifest-20260824-123456.json")
            write_report(tmp, "password=super-secret-value\n", name="real-e2e-account.env")
            self.assert_passes(tmp, "manifest/account-env must be skipped by artifact scanner")

    def test_non_loopback_url_host_fails(self):
        with tempfile.TemporaryDirectory(prefix="agenthub-artifacts-") as tmp:
            self._good_dir(tmp)
            write_report(tmp, {"baseURL": "https://internal.example.com/api"})
            self.assert_fails(tmp, "non-loopback URL host")

    def test_account_email_fails(self):
        with tempfile.TemporaryDirectory(prefix="agenthub-artifacts-") as tmp:
            self._good_dir(tmp)
            write_report(tmp, {"error": "login failed for e2e-user@agenthub.test"})
            self.assert_fails(tmp, "test account email")

    def test_oidc_callback_param_fails(self):
        with tempfile.TemporaryDirectory(prefix="agenthub-artifacts-") as tmp:
            self._good_dir(tmp)
            write_report(tmp, {"url": "http://127.0.0.1:8080/client/auth/oidc/callback?code=abc123def456&state=xyz789abc"})
            self.assert_fails(tmp, "OIDC callback param")

    def test_jwt_token_fails(self):
        with tempfile.TemporaryDirectory(prefix="agenthub-artifacts-") as tmp:
            self._good_dir(tmp)
            write_report(tmp, {"token": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"})
            self.assert_fails(tmp, "JWT token")

    def test_set_cookie_fails(self):
        with tempfile.TemporaryDirectory(prefix="agenthub-artifacts-") as tmp:
            self._good_dir(tmp)
            write_report(tmp, {"headers": ["Set-Cookie: agenthub_session=abc123def456"]})
            self.assert_fails(tmp, "Set-Cookie header")

    def test_absolute_unix_path_fails(self):
        with tempfile.TemporaryDirectory(prefix="agenthub-artifacts-") as tmp:
            self._good_dir(tmp)
            write_report(tmp, {"cwd": "/home/runner/work/AgentHub/app/web"})
            self.assert_fails(tmp, "absolute Unix path")

    def test_absolute_windows_path_fails(self):
        with tempfile.TemporaryDirectory(prefix="agenthub-artifacts-") as tmp:
            self._good_dir(tmp)
            write_report(tmp, {"cwd": "D:\\secret\\workspace"})
            self.assert_fails(tmp, "absolute Windows path")

    def test_password_in_body_fails(self):
        with tempfile.TemporaryDirectory(prefix="agenthub-artifacts-") as tmp:
            self._good_dir(tmp)
            write_report(tmp, {"body": "client_id=abc&password=hunter2secret"})
            self.assert_fails(tmp, "password in request body")

    def test_trace_zip_leak_fails(self):
        with tempfile.TemporaryDirectory(prefix="agenthub-artifacts-") as tmp:
            self._good_dir(tmp)
            trace_dir = os.path.join(tmp, "test-results", "real-oidc-login-real-oidc-login")
            os.makedirs(trace_dir, exist_ok=True)
            trace_zip = os.path.join(trace_dir, "trace.zip")
            with zipfile.ZipFile(trace_zip, "w") as zf:
                zf.writestr("trace.network", '{"url":"http://127.0.0.1:8080/client/auth/oidc/callback?code=abc123def456"}\n')
            self.assert_fails(tmp, "trace.zip with leaked trace.network")


if __name__ == "__main__":
    unittest.main(verbosity=2)
