#!/usr/bin/env python3
"""Self-tests for the shared Edge surface isolation gate (HARD GATE, #1525).

Positive: legal Hub imports (web/mobile) and Desktop Edge imports must pass.
Negative: each forbidden pattern in a Hub-only surface must fail the gate;
          a missing scan directory must fail the gate.

Self-contained (no Pester dependency): builds temporary fixtures under the
system temp dir, invokes the gate with the repo-root override, asserts exit
codes. Prefers the .py verifier and falls back to the .ps1 verifier while the
scripts/verify migration is in flight.
"""

import os
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


class VerifySharedEdgeSurfaceIsolationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.verifier = resolve_verifier("shared-edge-surface-isolation")
        cls.is_python = cls.verifier.endswith(".py")
        print("  verifier under test: %s" % cls.verifier)

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="edge-gate-fixture-")
        self.fixture = self._tmp.name

    def tearDown(self):
        self._tmp.cleanup()

    def write_file(self, relative_path, content):
        path = os.path.join(self.fixture, *relative_path.split("/"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        write_utf8(path, content)

    def new_fixture(self, files):
        for relative in files:
            self.write_file(relative, "// fixture: %s\n" % relative)

    def run_gate(self):
        if self.is_python:
            command = [sys.executable, self.verifier, "--repo-root-override", self.fixture]
        else:
            command = ["pwsh", "-NoProfile", "-File", self.verifier, "-RepoRootOverride", self.fixture]
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
        return result.returncode

    def assert_gate(self, case_name, expect_fail):
        exit_code = self.run_gate()
        if expect_fail:
            self.assertNotEqual(exit_code, 0, "%s (exit=%s, expected != 0)" % (case_name, exit_code))
        else:
            self.assertEqual(exit_code, 0, "%s (exit=%s, expected 0)" % (case_name, exit_code))

    def test_web_imports_shared_event_client_fails(self):
        self.new_fixture(["app/web/src/pages/chat.tsx", "app/mobile-rn/src/screens/chat.ts"])
        self.write_file("app/web/src/pages/chat.tsx", """\
import { EventClient } from "@shared/eventClient";
export const client = new EventClient();
""")
        self.assert_gate("negative: web imports @shared/eventClient", expect_fail=True)

    def test_mobile_imports_shared_transcript_edge_fails(self):
        self.new_fixture(["app/web/src/main.ts", "app/mobile-rn/src/screens/chat.ts"])
        self.write_file("app/mobile-rn/src/screens/chat.ts", """\
import { normalizeEdgeTranscript } from "@shared/transcript/edge";
export const t = normalizeEdgeTranscript;
""")
        self.assert_gate("negative: mobile imports @shared/transcript/edge", expect_fail=True)

    def test_web_references_edge_query_keys_fails(self):
        self.new_fixture(["app/web/src/queries.ts", "app/mobile-rn/src/screens/chat.ts"])
        self.write_file("app/web/src/queries.ts", """\
import { edgeQueryKeys } from "@agenthub/shared/stores/queryKeys";
export const keys = edgeQueryKeys;
""")
        self.assert_gate("negative: web references edgeQueryKeys", expect_fail=True)

    def test_missing_scan_directory_fails(self):
        self.new_fixture(["app/desktop/src/platform.ts"])
        self.assert_gate("negative: app/web/src missing fails gate", expect_fail=True)

    def test_legal_hub_imports_pass(self):
        self.new_fixture(["app/web/src/main.ts", "app/mobile-rn/src/screens/chat.ts"])
        self.write_file("app/web/src/main.ts", """\
import { hubClient } from "@agenthub/shared/hubClient";
import { EventEnvelope } from "@shared/events";
import type { ChatBlock } from "@shared/types";
export const c = hubClient;
""")
        self.write_file("app/mobile-rn/src/screens/chat.ts", """\
import { hubClient } from "@agenthub/shared/hubClient";
import type { ChatBlock } from "@shared/types";
export const c = hubClient;
""")
        self.assert_gate("positive: legal Hub imports pass", expect_fail=False)

    def test_desktop_edge_imports_not_scanned(self):
        self.new_fixture([
            "app/web/src/main.ts",
            "app/mobile-rn/src/screens/chat.ts",
            "app/desktop/src/platform/useDesktopEdgeEvents.ts",
        ])
        self.write_file("app/web/src/main.ts", "export const ok = true;\n")
        self.write_file("app/mobile-rn/src/screens/chat.ts", "export const ok = true;\n")
        self.write_file("app/desktop/src/platform/useDesktopEdgeEvents.ts", """\
import { EventClient } from "@shared/eventClient";
import { edgeQueryKeys } from "@agenthub/shared/stores/queryKeys";
export const c = EventClient;
""")
        self.assert_gate("positive: Desktop Edge imports not scanned", expect_fail=False)


if __name__ == "__main__":
    unittest.main(verbosity=2)
