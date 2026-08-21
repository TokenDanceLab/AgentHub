#!/usr/bin/env python3
"""Fixture mutation tests for verify-frontend-package-boundary.py.

Builds a synthetic app/ tree (shared + workbench) in a temp dir and asserts:

1. clean tree → exit 0
2. shared imports `@agenthub/workbench` → exit 1
3. shared reaches workbench via relative path → exit 1
4. workbench imports an app package (agenthub-desktop) → exit 1
5. workbench relative import escapes the workbench->shared boundary → exit 1
6. workbench deep import into shared (relative) stays legal → exit 0
"""

import os
import subprocess
import sys
import tempfile
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
VERIFIER_PATH = os.path.join(REPO_ROOT, "scripts", "verify", "verify-frontend-package-boundary.py")

CLEAN_SHARED = "export const sharedThing = 1;\n"
CLEAN_WORKBENCH = (
    "import { sharedThing } from '@shared/thing';\n"
    "import type { HubClient } from '@agenthub/shared/hub/hubClient';\n"
    "export const workbenchThing = sharedThing;\n"
    "void workbenchThing; void 0 as HubClient | undefined;\n"
)


def build_tree(tmp_dir: str, shared_body: str, workbench_body: str) -> str:
    app_root = os.path.join(tmp_dir, "app")
    shared_src = os.path.join(app_root, "shared", "src")
    workbench_src = os.path.join(app_root, "workbench", "src")
    os.makedirs(shared_src)
    os.makedirs(workbench_src)
    with open(os.path.join(shared_src, "thing.ts"), "w", encoding="utf-8") as handle:
        handle.write(shared_body)
    with open(os.path.join(workbench_src, "index.ts"), "w", encoding="utf-8") as handle:
        handle.write(workbench_body)
    return app_root


def run_verifier(app_root: str) -> tuple:
    result = subprocess.run(
        [sys.executable, VERIFIER_PATH, "--AppRoot", app_root],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return result.returncode, (result.stdout or "") + (result.stderr or "")


class FrontendPackageBoundaryTests(unittest.TestCase):
    def assert_gate(self, shared_body: str, workbench_body: str, expect_fail: bool, needle: str = ""):
        with tempfile.TemporaryDirectory(prefix="agenthub-pkg-boundary-") as tmp_dir:
            app_root = build_tree(tmp_dir, shared_body, workbench_body)
            code, output = run_verifier(app_root)
        if expect_fail:
            self.assertNotEqual(code, 0, f"expected failure, got 0:\n{output}")
            if needle:
                self.assertIn(needle, output)
        else:
            self.assertEqual(code, 0, f"expected pass, got {code}:\n{output}")

    def test_clean_tree_passes(self):
        self.assert_gate(CLEAN_SHARED, CLEAN_WORKBENCH, expect_fail=False)

    def test_shared_importing_workbench_package_fails(self):
        shared_body = "import { workbenchThing } from '@agenthub/workbench';\nvoid workbenchThing;\n"
        self.assert_gate(shared_body, CLEAN_WORKBENCH, expect_fail=True, needle="@agenthub/workbench")

    def test_shared_relative_escape_into_workbench_fails(self):
        shared_body = "import { workbenchThing } from '../../workbench/src/index';\nvoid workbenchThing;\n"
        self.assert_gate(shared_body, CLEAN_WORKBENCH, expect_fail=True, needle="escapes into workbench")

    def test_workbench_importing_app_package_fails(self):
        workbench_body = "import { desktopHelper } from 'agenthub-desktop/src/helper';\nvoid desktopHelper;\n"
        self.assert_gate(CLEAN_SHARED, workbench_body, expect_fail=True, needle="must not import app packages")

    def test_workbench_relative_escape_fails(self):
        workbench_body = "import { leak } from '../../desktop/src/leak';\nvoid leak;\n"
        self.assert_gate(CLEAN_SHARED, workbench_body, expect_fail=True, needle="escapes the workbench->shared")

    def test_workbench_relative_shared_import_is_legal(self):
        workbench_body = "import { sharedThing } from '../shared/src/thing';\nvoid sharedThing;\n"
        # fixture tree 里 workbench/src 与 shared/src 平级于 app/，故
        # ../../shared/src/thing 才是越界合法路径的模拟。
        with tempfile.TemporaryDirectory(prefix="agenthub-pkg-boundary-") as tmp_dir:
            app_root = os.path.join(tmp_dir, "app")
            shared_src = os.path.join(app_root, "shared", "src")
            workbench_src = os.path.join(app_root, "workbench", "src", "nested")
            os.makedirs(shared_src)
            os.makedirs(workbench_src)
            with open(os.path.join(shared_src, "thing.ts"), "w", encoding="utf-8") as handle:
                handle.write(CLEAN_SHARED)
            with open(os.path.join(workbench_src, "index.ts"), "w", encoding="utf-8") as handle:
                handle.write("import { sharedThing } from '../../../shared/src/thing';\nvoid sharedThing;\n")
            code, output = run_verifier(app_root)
        self.assertEqual(code, 0, f"expected pass, got {code}:\n{output}")


if __name__ == "__main__":
    unittest.main()
