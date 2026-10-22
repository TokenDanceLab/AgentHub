#!/usr/bin/env python3
"""Negative-fixture tests for verify-real-e2e-lane-manifest.py private-name scan.

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

The generator tests source the lane script and feed it a synthetic
chat-real-only report, pinning evidence_level=backend-api, real_tested=false
and status=passed without needing a live stack.
"""

import copy
import json
import os
import shutil
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
    "commit": "0123456789abcdef0123456789abcdef01234567",
    "scope": "app/web/real-oidc-login.spec.ts",
    "evidence_level": "observed-local",
    "real_tested": True,
    "claim": "真实全栈 OIDC 登录",
    "status": "passed",
    "skipped_evidence_levels": ["fixture-unit", "playwright-ui"],
    "planned_evidence_levels": ["observed-local"],
    "stack": {
        "account": {"base_url": "http://127.0.0.1:3000", "state": "up", "login": "real-browser-oidc-authorization-code-pkce"},
        "hub": {"base_url": "http://localhost:8080", "state": "up"},
        "edge": {"base_url": "http://127.0.0.1:3210", "state": "up"},
        "web": {"base_url": "http://127.0.0.1:5174", "state": "up"},
        "backend_services": ["postgres:16", "redis:7"],
    },
    "secret_handling": {
        "account_mode": "operator-supplied external identities (provision-real-e2e-stack.sh)",
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

    def test_backend_api_only_passed_passes(self):
        m = copy.deepcopy(GOOD)
        m["evidence_level"] = "backend-api"
        m["real_tested"] = False
        m["claim"] = "API 流程通过，不计为 OIDC 登录证据"
        m["skipped_evidence_levels"] = ["fixture-unit", "playwright-ui"]
        m["planned_evidence_levels"] = ["backend-api"]
        m["rows"][0]["evidence_level"] = "backend-api"
        m["rows"][0]["real_tested"] = False
        m["rows"][0]["claim"] = "API 流程通过"
        self.assert_passes(m, "backend-api-only passed manifest")

    def test_ipv6_loopback_url_passes(self):
        m = copy.deepcopy(GOOD)
        m["stack"]["web"]["base_url"] = "http://[::1]:5174"
        self.assert_passes(m, "IPv6 loopback URL")

    def test_unc_path_fails(self):
        m = copy.deepcopy(GOOD)
        backslash = chr(92)
        m["rows"][0]["evidence"] = backslash * 2 + "fileserver" + backslash + "share" + backslash + "secret.log"
        self.assert_fails(m, "UNC path")

    def test_authorization_value_fails(self):
        m = copy.deepcopy(GOOD)
        m["authorization"] = "Bearer " + "A" * 40
        self.assert_fails(m, "authorization value")

    def test_credential_shape_under_innocent_key_fails(self):
        m = copy.deepcopy(GOOD)
        m["rows"][0]["note"] = "Bearer " + "A" * 40
        self.assert_fails(m, "credential shape under a non-secret key")

    def test_secret_key_with_credential_value_fails(self):
        m = copy.deepcopy(GOOD)
        m["cookie"] = "A" * 40
        self.assert_fails(m, "cookie key with a credential-shaped value")

    def test_runtime_credential_shape_fails(self):
        m = copy.deepcopy(GOOD)
        m["rows"][0]["note"] = "cs_0123456789abcdef"
        self.assert_fails(m, "runtime credential shape")

    def test_password_value_shape_fails(self):
        m = copy.deepcopy(GOOD)
        m["rows"][0]["note"] = "password=hunter2secret"
        self.assert_fails(m, "password value shape")

    def test_passed_row_with_fixture_evidence_fails(self):
        m = copy.deepcopy(GOOD)
        m["rows"][0]["evidence_level"] = "fixture-unit"
        self.assert_fails(m, "fixture-level row cannot back status=passed")

    def test_mixed_fixture_row_fails_even_with_real_row(self):
        m = copy.deepcopy(GOOD)
        extra = copy.deepcopy(m["rows"][0])
        extra["name"] = "fixture-row"
        extra["evidence_level"] = "fixture-unit"
        m["rows"].append(extra)
        self.assert_fails(m, "fixture-level row cannot claim real_tested beside a real row")

    def test_top_level_level_must_be_backed_by_same_level_row(self):
        m = copy.deepcopy(GOOD)
        m["evidence_level"] = "approved-real"
        self.assert_fails(m, "top-level level needs a passed row at the same level")

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

    def test_missing_commit_fails(self):
        m = copy.deepcopy(GOOD)
        del m["commit"]
        self.assert_fails(m, "missing commit provenance")

    def test_empty_scope_fails(self):
        m = copy.deepcopy(GOOD)
        m["scope"] = ""
        self.assert_fails(m, "empty scope provenance")

    def test_full_scope_partial_specs_fails(self):
        m = copy.deepcopy(GOOD)
        m["scope"] = "app/e2e (playwright.real.config.ts all testMatch)"
        m["spec_files"] = ["real-oidc-login.spec.ts"]
        self.assert_fails(m, "full-scope claim backed by a single spec")

    def test_full_scope_all_specs_passes(self):
        m = copy.deepcopy(GOOD)
        m["scope"] = "app/e2e (playwright.real.config.ts all testMatch)"
        m["spec_files"] = [
            "chat-real.spec.ts",
            "golden-flows.spec.ts",
            "private-url-preview.spec.ts",
            "real-oidc-login.spec.ts",
        ]
        self.assert_passes(m, "full-scope claim backed by every testMatch spec")

    def test_full_scope_without_spec_files_fails(self):
        m = copy.deepcopy(GOOD)
        m["scope"] = "app/e2e (playwright.real.config.ts all testMatch)"
        self.assert_fails(m, "full-scope claim without spec provenance")

    def test_partial_scope_with_full_claim_fails(self):
        m = copy.deepcopy(GOOD)
        m["scope"] = "all testMatch NOT run; only app/e2e/one.spec.ts"
        m["claim"] = "全部 spec 通过"
        self.assert_fails(m, "partial scope claiming every spec")

    def test_no_evidence_with_all_rows_passed_fails(self):
        m = copy.deepcopy(GOOD)
        m["status"] = "no-evidence"
        m["real_tested"] = False
        m["claim"] = "playwright exit 0 但无通过行"
        self.assert_fails(m, "no-evidence status backed by passing rows")


LANE_SCRIPT = os.path.join(REPO_ROOT, "scripts", "e2e", "run-real-e2e-lane.sh")
# CreateProcess resolves a bare "bash" from System32 (WSL) before PATH on
# Windows; resolve the PATH entry so the test runs in Git Bash there.
BASH = shutil.which("bash") or "bash"


def bash_path(path):
    # Git Bash consumes backslashes in arguments; forward slashes work on
    # Windows and are already correct elsewhere.
    return path.replace(os.sep, "/")


class LaneManifestGeneratorTests(unittest.TestCase):
    """Exercise the lane's real manifest builder, not a re-implementation."""

    def emit_manifest(self, spec_target):
        tmp = tempfile.TemporaryDirectory(prefix="agenthub-lane-generator-")
        self.addCleanup(tmp.cleanup)
        report = {
            "suites": [{
                "specs": [{
                    "title": "chat-real",
                    "file": "app/e2e/chat-real.spec.ts",
                    "ok": True,
                    "tests": [{"results": [{"status": "passed", "duration": 1200}]}],
                }],
            }],
        }
        with open(os.path.join(tmp.name, "report-20260824-123456.json"), "w", encoding="utf-8", newline="\n") as handle:
            json.dump(report, handle)
        command = (
            'source "%s"\n'
            'ARTIFACT_DIR="%s"\n'
            'SPEC_TARGET="%s"\n'
            'SPEC_LABEL="$SPEC_TARGET"\n'
            'RUN_STARTED_AT=0\n'
            'ID_STATE=up; HUB_STATE=up; EDGE_STATE=up; WEB_STATE=up\n'
            'unset AGENTHUB_E2E_PLAYWRIGHT_EXTRA_ARGS\n'
            'emit_manifest passed\n'
        ) % (bash_path(LANE_SCRIPT), bash_path(tmp.name), spec_target)
        result = subprocess.run(
            [BASH, "-c", command],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        final_status, path = result.stdout.strip().splitlines()[-1].split("|", 1)
        with open(path, encoding="utf-8") as handle:
            return final_status, json.load(handle)

    def test_chat_real_only_is_backend_api_not_login_evidence(self):
        status, manifest = self.emit_manifest("chat-real.spec.ts")
        self.assertEqual(status, "passed")
        self.assertEqual(manifest["status"], "passed")
        self.assertEqual(manifest["evidence_level"], "backend-api")
        self.assertIs(manifest["real_tested"], False)
        self.assertEqual(manifest["rows"][0]["evidence_level"], "backend-api")
        self.assertIs(manifest["rows"][0]["real_tested"], False)
        code, output = run_verifier(manifest)
        self.assertEqual(code, 0, output)


if __name__ == "__main__":
    unittest.main(verbosity=2)
