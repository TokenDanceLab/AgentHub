#!/usr/bin/env python3
"""Negative self-tests for the outbound client hygiene gate (#1549 + #1564).

Cases:
1. positive: clean fixture (body-limited read, no env, no clients) -> 0
2. bare &http.Client{ in scope -> 1
3. service-layer os.Getenv (request-path env read) -> 1
4. anonymous allowlist entry (no issue) -> 1
5. unbounded io.ReadAll(resp.Body) (no body limit) -> 1
6. unbudgeted retry loop in an HTTP-carrying file -> 1
7. allowlisted bare client with issue + reason -> 0 (format is the gate)

The verifier runs as a subprocess against an isolated fixture with explicit
--scopes/--client-allowlist/--no-default-allowlist equivalents so the repo
residual allowlist is never evaluated. Prefers the .py verifier and falls back
to the .ps1 verifier while the scripts/verify migration is in flight.
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


CLEAN_GO = """\
package service

import "io"

// fixture: the only sanctioned unbounded-read form is a body-limited read.
var _ = io.ReadAll(io.LimitReader(nil, 1024))
"""

BARE_CLIENT_GO = """\
package service

import "net/http"

var c = &http.Client{Timeout: 1}
"""

ENV_READ_GO = """\
package service

import "os"

var url = os.Getenv("AGENTHUB_EDGE_URL")
"""

NO_BODY_LIMIT_GO = """\
package service

import "io"

func readAll(respBody interface{ Close() (int64, error) }) {
	_ = io.ReadAll(respBody)
}
"""

UNBUDGETED_RETRY_GO = """\
package service

import "net/http"

func post() error {
	client := &http.Client{Timeout: 1}
	for attempt := 0; attempt < 3; attempt++ {
		_, err := client.Do(nil)
		if err == nil {
			return nil
		}
	}
	return nil
}
"""


class VerifyOutboundClientHygieneTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.verifier = resolve_verifier("outbound-client-hygiene")
        cls.is_python = cls.verifier.endswith(".py")
        print("  verifier under test: %s" % cls.verifier)

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="agenthub-outbound-hygiene-")
        self.fixture = self._tmp.name
        self.service_dir = os.path.join(self.fixture, "hub-server", "internal", "service")
        os.makedirs(self.service_dir, exist_ok=True)
        verifier_rel = os.path.join("scripts", "verify", os.path.basename(self.verifier))
        verifier_dest = os.path.join(self.fixture, verifier_rel)
        os.makedirs(os.path.dirname(verifier_dest), exist_ok=True)
        shutil.copyfile(self.verifier, verifier_dest)
        self.verifier_rel = verifier_rel

    def tearDown(self):
        self._tmp.cleanup()

    def write_go_file(self, name, content):
        write_utf8(os.path.join(self.service_dir, name), content)

    def run_verifier(self, allowlist_entry=None):
        script = os.path.join(self.fixture, self.verifier_rel)
        if self.is_python:
            command = [sys.executable, script, "--scopes", "hub-server/internal/service", "--no-default-allowlist"]
            if allowlist_entry is not None:
                command += ["--client-allowlist", allowlist_entry]
        else:
            command = ["pwsh", "-NoProfile", "-File", script, "-Scopes", "hub-server/internal/service", "-NoDefaultAllowlist"]
            if allowlist_entry is not None:
                command += ["-ClientAllowlist", allowlist_entry]
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
        return result.returncode, (result.stdout or "") + (result.stderr or "")

    def assert_fails_with(self, output_fragment, case_name, allowlist_entry=None):
        exit_code, output = self.run_verifier(allowlist_entry)
        self.assertNotEqual(exit_code, 0, "%s must FAIL but verifier exited 0" % case_name)
        self.assertIn(output_fragment, output, "%s failed for the wrong reason:\n%s" % (case_name, output))

    def test_positive_clean_fixture_passes(self):
        self.write_go_file("clean_fixture.go", CLEAN_GO)
        exit_code, output = self.run_verifier()
        self.assertEqual(exit_code, 0, "positive fixture unexpectedly failed:\n%s" % output)

    def test_bare_http_client_fails_closed(self):
        self.write_go_file("bare_client_fixture.go", BARE_CLIENT_GO)
        self.assert_fails_with("bare &http.Client", "bare &http.Client{")

    def test_service_layer_env_read_fails_closed(self):
        self.write_go_file("env_fixture.go", ENV_READ_GO)
        self.assert_fails_with("os.Getenv", "service-layer os.Getenv")

    def test_anonymous_allowlist_entry_fails_closed(self):
        self.write_go_file("allowlisted_bare_fixture.go", BARE_CLIENT_GO)
        self.assert_fails_with(
            "anonymous allowlist",
            "anonymous allowlist entry",
            allowlist_entry="hub-server/internal/service/allowlisted_bare_fixture.go|no-issue|bare client exception",
        )

    def test_unbounded_response_read_fails_closed(self):
        self.write_go_file("nobodylimit_fixture.go", NO_BODY_LIMIT_GO)
        self.assert_fails_with("unbounded response read", "unbounded io.ReadAll")

    def test_unbudgeted_retry_loop_fails_closed(self):
        self.write_go_file("unbudgeted_retry_fixture.go", UNBUDGETED_RETRY_GO)
        self.assert_fails_with("retry loop without a retry budget", "unbudgeted retry loop")

    def test_allowlisted_client_with_issue_and_reason_passes(self):
        self.write_go_file("allowlisted_bare_fixture.go", BARE_CLIENT_GO)
        exit_code, output = self.run_verifier(
            allowlist_entry="hub-server/internal/service/allowlisted_bare_fixture.go|#1564|fixture: tracked exception"
        )
        self.assertEqual(exit_code, 0, "allowlisted entry with issue + reason unexpectedly failed:\n%s" % output)


if __name__ == "__main__":
    unittest.main(verbosity=2)
