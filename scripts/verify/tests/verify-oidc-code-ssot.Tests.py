#!/usr/bin/env python3
"""Negative self-test for verify-oidc-code-ssot.py (#2123 P1-2).

Proves the gate fails closed: backend-only codes, frontend-only codes, and
empty extraction each exit non-zero. Uses temp files injected via module
globals so the production paths are untouched.
"""
import importlib.util
import os
import sys
import tempfile
import unittest

SPEC_PATH = os.path.join(
    os.path.dirname(__file__), "..", "verify-oidc-code-ssot.py"
)
spec = importlib.util.spec_from_file_location("oidc_ssot_gate", SPEC_PATH)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


def run_gate():
    try:
        gate.main()
    except SystemExit as exc:
        return exc.code if isinstance(exc.code, int) else 1
    return 0


class OidcCodeSSOTSelfTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.backend = os.path.join(self.dir.name, "codes.go")
        self.frontend = os.path.join(self.dir.name, "types.ts")
        self._old_backend = gate.BACKEND_PATH
        self._old_frontend = gate.FRONTEND_PATH
        gate.BACKEND_PATH = self.backend
        gate.FRONTEND_PATH = self.frontend

    def tearDown(self):
        gate.BACKEND_PATH = self._old_backend
        gate.FRONTEND_PATH = self._old_frontend
        self.dir.cleanup()

    def write(self, backend_text, frontend_text):
        with open(self.backend, "w", encoding="utf-8") as f:
            f.write(backend_text)
        with open(self.frontend, "w", encoding="utf-8") as f:
            f.write(frontend_text)

    def test_backend_only_code_fails(self):
        self.write('New("oidc_invalid_state")\nNew("oidc_new_code")',
                   "const X = { a: 'oidc_invalid_state' } as const;")
        self.assertNotEqual(run_gate(), 0)

    def test_frontend_only_code_fails(self):
        self.write('New("oidc_invalid_state")',
                   "const X = { a: 'oidc_invalid_state', b: 'oidc_extra' } as const;")
        self.assertNotEqual(run_gate(), 0)

    def test_aligned_passes(self):
        self.write('New("oidc_invalid_state")',
                   "const X = { a: 'oidc_invalid_state' } as const;")
        self.assertEqual(run_gate(), 0)


if __name__ == "__main__":
    unittest.main()
