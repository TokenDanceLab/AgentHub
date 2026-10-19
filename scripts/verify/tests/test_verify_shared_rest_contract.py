#!/usr/bin/env python3
"""Self-tests for verify-shared-rest-contract.py: a 0-path scan must fail."""

import os
import subprocess
import sys
import tempfile
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
VERIFIER = os.path.join(REPO_ROOT, "scripts", "verify", "verify-shared-rest-contract.py")

ROUTER = """\
package router
func register(r *gin.Engine) {
\tr.GET("/client/ping", handler)
}
"""


def run_verifier(client_source):
    with tempfile.TemporaryDirectory(prefix="agenthub-shared-rest-") as tmp:
        client_dir = os.path.join(tmp, "hub")
        os.makedirs(client_dir)
        with open(os.path.join(client_dir, "hubClientFixture.ts"), "w", encoding="utf-8") as handle:
            handle.write(client_source)
        router_path = os.path.join(tmp, "router.go")
        with open(router_path, "w", encoding="utf-8") as handle:
            handle.write(ROUTER)
        result = subprocess.run(
            [sys.executable, VERIFIER, "--client-src-dir", client_dir, "--router-path", router_path],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        return result.returncode, (result.stdout or "") + (result.stderr or "")


class SharedRestContractTests(unittest.TestCase):
    def test_zero_paths_fails(self):
        code, output = run_verifier("export const label = 'not-an-api-path';\n")
        self.assertNotEqual(code, 0, f"0-path scan must fail:\n{output}")
        self.assertIn("0 normalized API paths", output)

    def test_resolving_path_passes(self):
        code, output = run_verifier("export function ping() { return '/client/ping'; }\n")
        self.assertEqual(code, 0, f"resolving path must pass:\n{output}")

    def test_unmatched_client_path_fails(self):
        code, output = run_verifier("export function ghost() { return '/client/ghost';\n")
        self.assertNotEqual(code, 0, f"unmatched client path must fail:\n{output}")
        self.assertIn("client path has no matching hub route", output)


if __name__ == "__main__":
    unittest.main()
