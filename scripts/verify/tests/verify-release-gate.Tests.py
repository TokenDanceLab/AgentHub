#!/usr/bin/env python3
"""Self-tests for the release gate's policy checks."""

import importlib.util
import os
import shutil
import subprocess
import tempfile
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
VERIFIER_PATH = os.path.join(REPO_ROOT, "scripts", "release", "verify-release-gate.py")


def load_verifier():
    spec = importlib.util.spec_from_file_location("agenthub_verify_release_gate", VERIFIER_PATH)
    if spec is None or spec.loader is None:
        raise AssertionError(f"could not load verifier: {VERIFIER_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = load_verifier()


def git(repo, *args):
    subprocess.run(["git", "-C", repo, *args], check=True, capture_output=True, text=True)


class ReleaseGatePolicyTests(unittest.TestCase):
    def setUp(self):
        GATE.ready.clear()
        GATE.warnings.clear()
        GATE.blockers.clear()
        self.original_root = GATE.REPO_ROOT

    def tearDown(self):
        GATE.REPO_ROOT = self.original_root

    def fixture(self, files):
        root = tempfile.mkdtemp(prefix="agenthub-release-gate-")
        self.addCleanup(shutil.rmtree, root, True)
        for relative, content in files.items():
            path = os.path.join(root, relative.replace("/", os.sep))
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(content)
        return root

    def test_workflow_policy_accepts_tag_triggered_release(self):
        GATE.REPO_ROOT = REPO_ROOT
        GATE.assert_workflow_policy(REPO_ROOT)
        self.assertEqual(GATE.blockers, [])

    def test_workflow_policy_blocks_missing_release_surface(self):
        GATE.REPO_ROOT = self.fixture({
            ".github/workflows/release-readiness.yml": "name: readiness\n",
            ".github/workflows/release.yml": "name: release\n",
        })
        GATE.assert_workflow_policy(GATE.REPO_ROOT)
        self.assertTrue(any("tag trigger" in blocker for blocker in GATE.blockers))
        self.assertTrue(any("workflow_dispatch" in blocker for blocker in GATE.blockers))

    def test_workflow_policy_ignores_commented_patterns(self):
        GATE.REPO_ROOT = self.fixture({
            ".github/workflows/release-readiness.yml": "name: readiness\n# workflow_dispatch\n# verify-tauri-package-dry.py -RunWindowsBundle -StrictToolchain\n",
            ".github/workflows/release.yml": "name: release\n# tags: ['v*']\n# softprops/action-gh-release@v3\n",
        })
        GATE.assert_workflow_policy(GATE.REPO_ROOT)
        self.assertTrue(any("tag trigger" in blocker for blocker in GATE.blockers))
        self.assertTrue(any("workflow_dispatch" in blocker for blocker in GATE.blockers))
        self.assertTrue(any("-RunWindowsBundle" in blocker for blocker in GATE.blockers))

    def test_workflow_policy_plain_scalar_apostrophe_keeps_comment_a_comment(self):
        # An apostrophe inside a plain scalar is not a quote delimiter; the
        # trailing comment must still be dropped rather than satisfy a gate.
        GATE.REPO_ROOT = self.fixture({
            ".github/workflows/release-readiness.yml": "name: Agent's Hub # workflow_dispatch\n",
            ".github/workflows/release.yml": "name: Agent's Hub # tags: ['v*']\n",
        })
        GATE.assert_workflow_policy(GATE.REPO_ROOT)
        self.assertTrue(any("workflow_dispatch" in blocker for blocker in GATE.blockers))
        self.assertTrue(any("tag trigger" in blocker for blocker in GATE.blockers))

    def test_workflow_policy_requires_real_triggers_not_run_text(self):
        # Trigger and uploader checks are structural: echoing the names inside a
        # run step must not satisfy them.
        GATE.REPO_ROOT = self.fixture({
            ".github/workflows/release-readiness.yml": (
                "name: readiness\non:\n  pull_request: {}\njobs:\n  x:\n    runs-on: ubuntu-latest\n"
                "    steps:\n      - run: echo workflow_dispatch run_windows_package_dry\n"
            ),
            ".github/workflows/release.yml": (
                "name: release\non:\n  pull_request: {}\njobs:\n  x:\n    runs-on: ubuntu-latest\n"
                "    steps:\n      - run: |\n          echo \"tags: ['v*'] softprops/action-gh-release@v3\"\n"
            ),
        })
        GATE.assert_workflow_policy(GATE.REPO_ROOT)
        self.assertTrue(any("lacks workflow_dispatch" in blocker for blocker in GATE.blockers))
        self.assertTrue(any("tag trigger" in blocker for blocker in GATE.blockers))
        self.assertTrue(any("GitHub Release uploader is missing" in blocker for blocker in GATE.blockers))

    def test_workflow_policy_rejects_inert_or_disabled_dry_gates(self):
        GATE.REPO_ROOT = self.fixture({
            ".github/workflows/release-readiness.yml": 'name: readiness\non:\n  workflow_dispatch:\n    inputs:\n      run_windows_package_dry: {}\n      run_macos_unsigned_dry_policy: {}\n      run_macos_package_dry: {}\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true python scripts/release/verify-tauri-package-dry.py -RunWindowsBundle -StrictToolchain\n      - run: python scripts/release/verify-tauri-package-dry.py -RunMacosBundle\n        if: ${{ 1 == 2 }}\n      - uses: actions/upload-artifact@v7\n',
            ".github/workflows/release.yml": "name: release\non:\n  push:\n    tags: ['v*']\njobs:\n  x:\n    steps:\n      - uses: softprops/action-gh-release@v3\n        with:\n          prerelease: ${{ !contains(github.ref_name, '-') }}\n",
        })
        GATE.assert_workflow_policy(GATE.REPO_ROOT)
        self.assertTrue(any("-RunWindowsBundle" in blocker for blocker in GATE.blockers))
        self.assertTrue(any("-RunMacosBundle" in blocker for blocker in GATE.blockers))
        self.assertTrue(any("prerelease" in blocker for blocker in GATE.blockers))

    def test_workflow_policy_rejects_extra_release_triggers(self):
        GATE.REPO_ROOT = self.fixture({
            ".github/workflows/release-readiness.yml": "name: readiness\n",
            ".github/workflows/release.yml": "name: release\non:\n  push:\n    branches: [master]\n    tags: ['v*']\njobs:\n  x:\n    steps:\n      - uses: softprops/action-gh-release@v3\n        with:\n          prerelease: ${{ contains(github.ref_name, '-') }}\n",
        })
        GATE.assert_workflow_policy(GATE.REPO_ROOT)
        self.assertTrue(any("tag trigger" in blocker for blocker in GATE.blockers))

    def test_workflow_policy_detects_prefixed_signing_commands(self):
        GATE.REPO_ROOT = self.fixture({
            ".github/workflows/release-readiness.yml": 'name: readiness\non:\n  workflow_dispatch: {}\njobs:\n  x:\n    steps:\n      - run: sudo xcrun notarytool submit app.zip\n',
            ".github/workflows/release.yml": "name: release\n",
        })
        GATE.assert_workflow_policy(GATE.REPO_ROOT)
        self.assertTrue(any("execution surface" in blocker for blocker in GATE.blockers))

    def test_workflow_policy_requires_every_dry_gate_flag(self):
        GATE.REPO_ROOT = self.fixture({
            ".github/workflows/release-readiness.yml": 'name: readiness\non:\n  workflow_dispatch:\n    inputs:\n      run_windows_package_dry: {}\n      run_macos_unsigned_dry_policy: {}\n      run_macos_package_dry: {}\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: python scripts/release/verify-tauri-package-dry.py -RunWindowsBundle\n      - run: python scripts/release/verify-tauri-package-dry.py -RunMacosBundle\n      - uses: actions/upload-artifact@v7\n',
            ".github/workflows/release.yml": "name: release\n",
        })
        GATE.assert_workflow_policy(GATE.REPO_ROOT)
        self.assertTrue(any("-StrictToolchain" in blocker for blocker in GATE.blockers))

    def test_workflow_policy_blocks_empty_workflow_file(self):
        GATE.REPO_ROOT = self.fixture({
            ".github/workflows/release-readiness.yml": "",
            ".github/workflows/release.yml": "name: release\n",
        })
        GATE.assert_workflow_policy(GATE.REPO_ROOT)
        self.assertTrue(any("is empty" in blocker for blocker in GATE.blockers))

    def test_workflow_policy_rejects_conditionally_wrapped_dry_gate(self):
        GATE.REPO_ROOT = self.fixture({
            ".github/workflows/release-readiness.yml": "name: readiness\non:\n  workflow_dispatch:\n    inputs:\n      run_windows_package_dry: {}\n      run_macos_unsigned_dry_policy: {}\n      run_macos_package_dry: {}\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: 'if false; then python scripts/release/verify-tauri-package-dry.py -RunWindowsBundle -StrictToolchain; fi'\n      - run: python scripts/release/verify-tauri-package-dry.py -RunMacosBundle\n      - uses: actions/upload-artifact@v7\n",
            ".github/workflows/release.yml": "name: release\n",
        })
        GATE.assert_workflow_policy(GATE.REPO_ROOT)
        self.assertTrue(any("-RunWindowsBundle" in blocker for blocker in GATE.blockers))

    def test_workflow_policy_skips_disabled_or_advisory_jobs(self):
        for readiness in ('name: readiness\non:\n  workflow_dispatch:\n    inputs:\n      run_windows_package_dry: {}\n      run_macos_unsigned_dry_policy: {}\n      run_macos_package_dry: {}\njobs:\n  x:\n    if: ${{ 1 == 2 }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: python scripts/release/verify-tauri-package-dry.py -RunWindowsBundle -StrictToolchain\n      - run: python scripts/release/verify-tauri-package-dry.py -RunMacosBundle\n      - uses: actions/upload-artifact@v7\n', 'name: readiness\non:\n  workflow_dispatch:\n    inputs:\n      run_windows_package_dry: {}\n      run_macos_unsigned_dry_policy: {}\n      run_macos_package_dry: {}\njobs:\n  x:\n    continue-on-error: true\n    runs-on: ubuntu-latest\n    steps:\n      - run: python scripts/release/verify-tauri-package-dry.py -RunWindowsBundle -StrictToolchain\n      - run: python scripts/release/verify-tauri-package-dry.py -RunMacosBundle\n      - uses: actions/upload-artifact@v7\n'):
            GATE.REPO_ROOT = self.fixture({
                ".github/workflows/release-readiness.yml": readiness,
                ".github/workflows/release.yml": "name: release\n",
            })
            GATE.blockers.clear()
            GATE.assert_workflow_policy(GATE.REPO_ROOT)
            self.assertTrue(any("-RunWindowsBundle" in b for b in GATE.blockers))

    def test_workflow_policy_ignores_heredoc_bodies(self):
        GATE.REPO_ROOT = self.fixture({
            ".github/workflows/release-readiness.yml": "name: readiness\non:\n  workflow_dispatch:\n    inputs:\n      run_windows_package_dry: {}\n      run_macos_unsigned_dry_policy: {}\n      run_macos_package_dry: {}\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          cat > gate.sh <<'EOF'\n          python scripts/release/verify-tauri-package-dry.py -RunWindowsBundle -StrictToolchain\n          EOF\n      - run: python scripts/release/verify-tauri-package-dry.py -RunMacosBundle\n      - uses: actions/upload-artifact@v7\n",
            ".github/workflows/release.yml": "name: release\n",
        })
        GATE.assert_workflow_policy(GATE.REPO_ROOT)
        self.assertTrue(any("-RunWindowsBundle" in b for b in GATE.blockers))

    def test_workflow_policy_detects_wrapped_signing_command(self):
        GATE.REPO_ROOT = self.fixture({
            ".github/workflows/release-readiness.yml": 'name: readiness\non:\n  workflow_dispatch:\n    inputs:\n      run_windows_package_dry: {}\n      run_macos_unsigned_dry_policy: {}\n      run_macos_package_dry: {}\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: sudo bash -c "xcrun notarytool submit app.zip"\n      - run: python scripts/release/verify-tauri-package-dry.py -RunWindowsBundle -StrictToolchain\n      - run: python scripts/release/verify-tauri-package-dry.py -RunMacosBundle\n      - uses: actions/upload-artifact@v7\n',
            ".github/workflows/release.yml": "name: release\n",
        })
        GATE.assert_workflow_policy(GATE.REPO_ROOT)
        self.assertTrue(any("execution surface" in b for b in GATE.blockers))

    def test_workflow_policy_detects_operator_prefixed_signing_commands(self):
        for command in (
            "echo packaging && xcrun notarytool submit app.zip",
            "sudo -E xcrun notarytool submit app.zip",
            "/bin/bash -c 'xcrun notarytool submit app.zip'",
            "env FOO=bar bash -c 'gh release create v1.2.3'",
        ):
            GATE.REPO_ROOT = self.fixture({
                ".github/workflows/release-readiness.yml": (
                    "name: readiness\non:\n  workflow_dispatch: {}\njobs:\n  x:\n"
                    "    steps:\n      - run: " + command + "\n"
                ),
                ".github/workflows/release.yml": "name: release\n",
            })
            GATE.blockers.clear()
            GATE.assert_workflow_policy(GATE.REPO_ROOT)
            self.assertTrue(any("execution surface" in b for b in GATE.blockers), command)

    def test_workflow_policy_detects_signing_environment(self):
        for scope in ("env:\n  TAURI_SIGNING_PRIVATE_KEY: x\n",
                      "jobs:\n  x:\n    env:\n      APPLE_ID: x\n    steps:\n      - run: echo hi\n"):
            GATE.REPO_ROOT = self.fixture({
                ".github/workflows/release-readiness.yml": (
                    "name: readiness\non:\n  workflow_dispatch: {}\n" + scope
                ),
                ".github/workflows/release.yml": "name: release\n",
            })
            GATE.blockers.clear()
            GATE.assert_workflow_policy(GATE.REPO_ROOT)
            self.assertTrue(any("execution surface" in b for b in GATE.blockers), scope)

    def test_workflow_policy_rejects_block_scalar_dead_branches(self):
        gate = "python scripts/release/verify-tauri-package-dry.py -RunWindowsBundle -StrictToolchain"
        head = (
            "name: readiness\non:\n  workflow_dispatch:\n    inputs:\n"
            "      run_windows_package_dry: {}\n"
            "      run_macos_unsigned_dry_policy: {}\n"
            "      run_macos_package_dry: {}\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n"
        )
        for windows_step in (
            "      - run: |\n          if false; then\n            " + gate + "\n          fi\n",
            "      - run: while false; do " + gate + "; done\n",
            "      - run: for i in; do " + gate + "; done\n",
        ):
            GATE.REPO_ROOT = self.fixture({
                ".github/workflows/release-readiness.yml": (
                    head + windows_step
                    + "      - run: python scripts/release/verify-tauri-package-dry.py -RunMacosBundle\n"
                    + "      - uses: actions/upload-artifact@v7\n"
                ),
                ".github/workflows/release.yml": "name: release\n",
            })
            GATE.blockers.clear()
            GATE.assert_workflow_policy(GATE.REPO_ROOT)
            self.assertTrue(any("-RunWindowsBundle" in b for b in GATE.blockers), windows_step)

    def test_workflow_policy_requires_macos_runner(self):
        GATE.REPO_ROOT = self.fixture({
            ".github/workflows/release-readiness.yml": 'name: readiness\non:\n  workflow_dispatch:\n    inputs:\n      run_windows_package_dry: {}\n      run_macos_unsigned_dry_policy: {}\n      run_macos_package_dry: {}\njobs:\n  windows:\n    runs-on: ubuntu-latest\n    steps:\n      - run: python scripts/release/verify-tauri-package-dry.py -RunWindowsBundle -StrictToolchain\n  macos:\n    runs-on: ubuntu-latest\n    steps:\n      - run: python scripts/release/verify-tauri-package-dry.py -RunMacosBundle\n      - uses: actions/upload-artifact@v7\n',
            ".github/workflows/release.yml": "name: release\n",
        })
        GATE.assert_workflow_policy(GATE.REPO_ROOT)
        self.assertTrue(any("-RunMacosBundle" in b for b in GATE.blockers))

    def test_workflow_policy_ties_prerelease_to_uploader(self):
        GATE.REPO_ROOT = self.fixture({
            ".github/workflows/release-readiness.yml": "name: readiness\n",
            ".github/workflows/release.yml": "name: release\non:\n  push:\n    tags: ['v*']\njobs:\n  x:\n    steps:\n      - uses: softprops/action-gh-release@v3\n        with:\n          tag_name: ${{ github.ref_name }}\n      - run: echo decoy\n        with:\n          prerelease: ${{ contains(github.ref_name, '-') }}\n",
        })
        GATE.assert_workflow_policy(GATE.REPO_ROOT)
        self.assertTrue(any("prerelease" in b for b in GATE.blockers))

    def test_workflow_policy_rejects_step_disabled_macos_gate(self):
        head = (
            "name: readiness\non:\n  workflow_dispatch:\n    inputs:\n"
            "      run_windows_package_dry: {}\n"
            "      run_macos_unsigned_dry_policy: {}\n"
            "      run_macos_package_dry: {}\njobs:\n  macos:\n    runs-on: macos-latest\n    steps:\n"
        )
        for guard in ("        if: ${{ 1 == 2 }}\n", "        continue-on-error: true\n"):
            GATE.REPO_ROOT = self.fixture({
                ".github/workflows/release-readiness.yml": (
                    head + "      - run: python scripts/release/verify-tauri-package-dry.py -RunMacosBundle\n"
                    + guard
                    + "      - run: python scripts/release/verify-tauri-package-dry.py -RunWindowsBundle -StrictToolchain\n"
                    + "      - uses: actions/upload-artifact@v7\n"
                ),
                ".github/workflows/release.yml": "name: release\n",
            })
            GATE.blockers.clear()
            GATE.assert_workflow_policy(GATE.REPO_ROOT)
            self.assertTrue(any("-RunMacosBundle" in b for b in GATE.blockers), guard)

    def test_workflow_policy_detects_signing_uses_and_step_env(self):
        head = "name: readiness\non:\n  workflow_dispatch: {}\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n"
        for step in (
            "      - uses: softprops/action-gh-release@v3\n",
            "      - run: echo hi\n        env:\n          TAURI_SIGNING_PRIVATE_KEY: x\n",
        ):
            GATE.REPO_ROOT = self.fixture({
                ".github/workflows/release-readiness.yml": head + step,
                ".github/workflows/release.yml": "name: release\n",
            })
            GATE.blockers.clear()
            GATE.assert_workflow_policy(GATE.REPO_ROOT)
            self.assertTrue(any("execution surface" in b for b in GATE.blockers), step)

    def test_workflow_policy_blocks_invalid_yaml(self):
        GATE.REPO_ROOT = self.fixture({
            ".github/workflows/release-readiness.yml": "name: readiness\njobs:\n  x:\n    steps:\n      - run: [\n",
            ".github/workflows/release.yml": "name: release\n",
        })
        GATE.blockers.clear()
        GATE.assert_workflow_policy(GATE.REPO_ROOT)
        self.assertTrue(any("is not valid YAML" in b for b in GATE.blockers))

    def test_workflow_policy_requires_args_on_the_invocation(self):
        head = (
            "name: readiness\non:\n  workflow_dispatch:\n    inputs:\n"
            "      run_windows_package_dry: {}\n"
            "      run_macos_unsigned_dry_policy: {}\n"
            "      run_macos_package_dry: {}\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n"
        )
        GATE.REPO_ROOT = self.fixture({
            ".github/workflows/release-readiness.yml": (
                head + "      - run: |\n"
                '          echo "-RunWindowsBundle -StrictToolchain"\n'
                "          python scripts/release/verify-tauri-package-dry.py -RunWindowsBundle\n"
                + "      - run: python scripts/release/verify-tauri-package-dry.py -RunMacosBundle\n"
                + "      - uses: actions/upload-artifact@v7\n"
            ),
            ".github/workflows/release.yml": "name: release\n",
        })
        GATE.blockers.clear()
        GATE.assert_workflow_policy(GATE.REPO_ROOT)
        self.assertTrue(any("-RunWindowsBundle" in b for b in GATE.blockers))

    def test_workflow_policy_detects_heredoc_and_quoted_signing(self):
        head = "name: readiness\non:\n  workflow_dispatch: {}\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n"
        for command in (
            "bash <<'EOF'\n          xcrun notarytool submit app.zip\n          EOF",
            "timeout 60 gh release create v1",
            '"gh" release create v1',
            "g''h release create v1",
            "gh \\\n          release create v1",
        ):
            GATE.REPO_ROOT = self.fixture({
                ".github/workflows/release-readiness.yml": head + "      - run: |\n          " + command + "\n",
                ".github/workflows/release.yml": "name: release\n",
            })
            GATE.blockers.clear()
            GATE.assert_workflow_policy(GATE.REPO_ROOT)
            self.assertTrue(any("execution surface" in b for b in GATE.blockers), command)

    def test_workflow_policy_rejects_errexit_disabled_dry_gate(self):
        head = (
            "name: readiness\non:\n  workflow_dispatch:\n    inputs:\n"
            "      run_windows_package_dry: {}\n"
            "      run_macos_unsigned_dry_policy: {}\n"
            "      run_macos_package_dry: {}\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n"
        )
        GATE.REPO_ROOT = self.fixture({
            ".github/workflows/release-readiness.yml": (
                head + "      - run: |\n          set +e\n"
                "          python scripts/release/verify-tauri-package-dry.py -RunWindowsBundle -StrictToolchain\n"
                "          echo done\n"
                + "      - run: python scripts/release/verify-tauri-package-dry.py -RunMacosBundle\n"
                + "      - uses: actions/upload-artifact@v7\n"
            ),
            ".github/workflows/release.yml": "name: release\n",
        })
        GATE.blockers.clear()
        GATE.assert_workflow_policy(GATE.REPO_ROOT)
        self.assertTrue(any("-RunWindowsBundle" in b for b in GATE.blockers))

    def test_workflow_policy_requires_an_active_artifact_upload(self):
        for readiness in ('name: readiness\non:\n  workflow_dispatch:\n    inputs:\n      run_windows_package_dry: {}\n      run_macos_unsigned_dry_policy: {}\n      run_macos_package_dry: {}\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: python scripts/release/verify-tauri-package-dry.py -RunWindowsBundle -StrictToolchain\n      - run: python scripts/release/verify-tauri-package-dry.py -RunMacosBundle\n      - uses: actions/upload-artifact@v7\n        if: ${{ 1 == 2 }}\n', 'name: readiness\non:\n  workflow_dispatch:\n    inputs:\n      run_windows_package_dry: {}\n      run_macos_unsigned_dry_policy: {}\n      run_macos_package_dry: {}\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: python scripts/release/verify-tauri-package-dry.py -RunWindowsBundle -StrictToolchain\n      - run: python scripts/release/verify-tauri-package-dry.py -RunMacosBundle\n      - uses: actions/upload-artifact@v7\n        continue-on-error: true\n'):
            GATE.REPO_ROOT = self.fixture({
                ".github/workflows/release-readiness.yml": readiness,
                ".github/workflows/release.yml": "name: release\n",
            })
            GATE.blockers.clear()
            GATE.assert_workflow_policy(GATE.REPO_ROOT)
            self.assertTrue(any("does not upload dry evidence" in b for b in GATE.blockers))

    def test_workflow_policy_rejects_masked_dry_gate(self):
        head = (
            "name: readiness\non:\n  workflow_dispatch:\n    inputs:\n"
            "      run_windows_package_dry: {}\n"
            "      run_macos_unsigned_dry_policy: {}\n"
            "      run_macos_package_dry: {}\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n"
        )
        gate = "python scripts/release/verify-tauri-package-dry.py -RunWindowsBundle -StrictToolchain"
        for suffix in (" || true", " || exit 0", "; true", " &", " | cat", "; exit 0 # done"):
            GATE.REPO_ROOT = self.fixture({
                ".github/workflows/release-readiness.yml": (
                    head + "      - run: " + gate + suffix + "\n"
                    + "      - run: python scripts/release/verify-tauri-package-dry.py -RunMacosBundle\n"
                    + "      - uses: actions/upload-artifact@v7\n"
                ),
                ".github/workflows/release.yml": "name: release\n",
            })
            GATE.blockers.clear()
            GATE.assert_workflow_policy(GATE.REPO_ROOT)
            self.assertTrue(any("-RunWindowsBundle" in b for b in GATE.blockers), suffix)

    def test_workflow_policy_rejects_short_circuited_dry_gate(self):
        head = (
            "name: readiness\non:\n  workflow_dispatch:\n    inputs:\n"
            "      run_windows_package_dry: {}\n"
            "      run_macos_unsigned_dry_policy: {}\n"
            "      run_macos_package_dry: {}\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n"
        )
        GATE.REPO_ROOT = self.fixture({
            ".github/workflows/release-readiness.yml": (
                head + "      - run: true || python scripts/release/verify-tauri-package-dry.py "
                "-RunWindowsBundle -StrictToolchain\n"
                + "      - run: python scripts/release/verify-tauri-package-dry.py -RunMacosBundle\n"
                + "      - uses: actions/upload-artifact@v7\n"
            ),
            ".github/workflows/release.yml": "name: release\n",
        })
        GATE.blockers.clear()
        GATE.assert_workflow_policy(GATE.REPO_ROOT)
        self.assertTrue(any("-RunWindowsBundle" in b for b in GATE.blockers))

    def test_workflow_policy_rejects_decoy_dry_gate_args(self):
        head = (
            "name: readiness\non:\n  workflow_dispatch:\n    inputs:\n"
            "      run_windows_package_dry: {}\n"
            "      run_macos_unsigned_dry_policy: {}\n"
            "      run_macos_package_dry: {}\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n"
        )
        GATE.REPO_ROOT = self.fixture({
            ".github/workflows/release-readiness.yml": (
                head + "      - run: echo -RunWindowsBundle -StrictToolchain && "
                "python scripts/release/verify-tauri-package-dry.py\n"
                + "      - run: python scripts/release/verify-tauri-package-dry.py -RunMacosBundle\n"
                + "      - uses: actions/upload-artifact@v7\n"
            ),
            ".github/workflows/release.yml": "name: release\n",
        })
        GATE.blockers.clear()
        GATE.assert_workflow_policy(GATE.REPO_ROOT)
        self.assertTrue(any("-RunWindowsBundle" in b for b in GATE.blockers))

    def test_workflow_policy_rejects_disabled_uploader_step(self):
        for guard in ("        if: ${{ false }}\n", "        continue-on-error: true\n"):
            GATE.REPO_ROOT = self.fixture({
                ".github/workflows/release-readiness.yml": "name: readiness\n",
                ".github/workflows/release.yml": (
                    "name: release\non:\n  push:\n    tags: ['v*']\njobs:\n  x:\n    steps:\n"
                    "      - uses: softprops/action-gh-release@v3\n"
                    + guard
                    + "        with:\n          prerelease: ${{ contains(github.ref_name, '-') }}\n"
                ),
            })
            GATE.blockers.clear()
            GATE.assert_workflow_policy(GATE.REPO_ROOT)
            self.assertTrue(any("GitHub Release uploader is missing" in b for b in GATE.blockers), guard)

    def test_workflow_policy_requires_upload_in_the_dry_gate_job(self):
        head = (
            "name: readiness\non:\n  workflow_dispatch:\n    inputs:\n"
            "      run_windows_package_dry: {}\n"
            "      run_macos_unsigned_dry_policy: {}\n"
            "      run_macos_package_dry: {}\njobs:\n"
        )
        GATE.REPO_ROOT = self.fixture({
            ".github/workflows/release-readiness.yml": (
                head + "  windows:\n    runs-on: ubuntu-latest\n    steps:\n"
                "      - run: python scripts/release/verify-tauri-package-dry.py -RunWindowsBundle -StrictToolchain\n"
                "  macos:\n    runs-on: macos-latest\n    steps:\n"
                "      - run: python scripts/release/verify-tauri-package-dry.py -RunMacosBundle\n"
                "  artifacts:\n    runs-on: ubuntu-latest\n    steps:\n"
                "      - uses: actions/upload-artifact@v7\n"
            ),
            ".github/workflows/release.yml": "name: release\n",
        })
        GATE.blockers.clear()
        GATE.assert_workflow_policy(GATE.REPO_ROOT)
        self.assertTrue(any("does not upload dry evidence" in b for b in GATE.blockers))

    def test_workflow_policy_rejects_inline_shell_dead_branch(self):
        head = (
            "name: readiness\non:\n  workflow_dispatch:\n    inputs:\n"
            "      run_windows_package_dry: {}\n"
            "      run_macos_unsigned_dry_policy: {}\n"
            "      run_macos_package_dry: {}\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n"
        )
        for payload in (
            "bash -c 'false && python scripts/release/verify-tauri-package-dry.py "
            "-RunWindowsBundle -StrictToolchain'",
            "bash -c 'python scripts/release/verify-tauri-package-dry.py "
            "-RunWindowsBundle -StrictToolchain; echo done'",
        ):
            GATE.REPO_ROOT = self.fixture({
                ".github/workflows/release-readiness.yml": (
                    head + "      - run: " + payload + "\n"
                    + "      - run: python scripts/release/verify-tauri-package-dry.py -RunMacosBundle\n"
                    + "      - uses: actions/upload-artifact@v7\n"
                ),
                ".github/workflows/release.yml": "name: release\n",
            })
            GATE.blockers.clear()
            GATE.assert_workflow_policy(GATE.REPO_ROOT)
            self.assertTrue(any("-RunWindowsBundle" in b for b in GATE.blockers), payload)

    def test_workflow_policy_folds_undeclared_needs_output_on_dispatch(self):
        head = (
            "name: readiness\non:\n  workflow_dispatch:\n    inputs:\n"
            "      run_windows_package_dry: {}\n"
            "      run_macos_unsigned_dry_policy: {}\n"
            "      run_macos_package_dry: {}\njobs:\n"
            "  changes:\n    runs-on: ubuntu-latest\n    outputs:\n"
            "      docs: ${{ steps.x.outputs.docs }}\n    steps:\n      - run: echo\n"
            "  x:\n    runs-on: ubuntu-latest\n    steps:\n"
        )
        GATE.REPO_ROOT = self.fixture({
            ".github/workflows/release-readiness.yml": (
                head + "      - run: python scripts/release/verify-tauri-package-dry.py -RunWindowsBundle -StrictToolchain\n"
                "        if: ${{ needs.changes.outputs.run == 'true' }}\n"
                + "      - run: python scripts/release/verify-tauri-package-dry.py -RunMacosBundle\n"
                + "      - uses: actions/upload-artifact@v7\n"
            ),
            ".github/workflows/release.yml": "name: release\n",
        })
        GATE.assert_workflow_policy(GATE.REPO_ROOT)
        self.assertTrue(any("-RunWindowsBundle" in b for b in GATE.blockers))

    def test_workflow_policy_folds_reversed_event_name_on_dispatch(self):
        head = (
            "name: readiness\non:\n  workflow_dispatch:\n    inputs:\n"
            "      run_windows_package_dry: {}\n"
            "      run_macos_unsigned_dry_policy: {}\n"
            "      run_macos_package_dry: {}\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n"
        )
        GATE.REPO_ROOT = self.fixture({
            ".github/workflows/release-readiness.yml": (
                head + "      - run: python scripts/release/verify-tauri-package-dry.py -RunWindowsBundle -StrictToolchain\n"
                "        if: ${{ 'push' == github.event_name }}\n"
                + "      - run: python scripts/release/verify-tauri-package-dry.py -RunMacosBundle\n"
                + "      - uses: actions/upload-artifact@v7\n"
            ),
            ".github/workflows/release.yml": "name: release\n",
        })
        GATE.assert_workflow_policy(GATE.REPO_ROOT)
        self.assertTrue(any("-RunWindowsBundle" in b for b in GATE.blockers))

    def test_workflow_policy_detects_continuation_split_signing(self):
        GATE.REPO_ROOT = self.fixture({
            ".github/workflows/release-readiness.yml": (
                "name: readiness\non:\n  workflow_dispatch: {}\njobs:\n  x:\n    steps:\n"
                "      - run: |\n          xcrun \\\n          notarytool submit app.zip\n"
            ),
            ".github/workflows/release.yml": "name: release\n",
        })
        GATE.blockers.clear()
        GATE.assert_workflow_policy(GATE.REPO_ROOT)
        self.assertTrue(any("execution surface" in b for b in GATE.blockers))

    def test_rc_tag_policy(self):
        GATE.assert_rc_tag_policy("0.6.1-rc.1")
        self.assertEqual(GATE.blockers, [])
        GATE.ready.clear()
        GATE.assert_rc_tag_policy("0.6.1")
        self.assertEqual(GATE.blockers, [])
        GATE.assert_rc_tag_policy("0.6")
        self.assertTrue(any("semver" in blocker for blocker in GATE.blockers))

    def test_risk_review_gate_requires_release_scoped_approval(self):
        os.environ.pop("RELEASE_RISK_REVIEWED", None)
        self.addCleanup(os.environ.pop, "RELEASE_RISK_REVIEWED", None)
        GATE.assert_risk_review_gate("v0.6.1")
        self.assertTrue(any("RELEASE_RISK_REVIEWED" in blocker for blocker in GATE.blockers))
        GATE.ready.clear()
        GATE.blockers.clear()
        os.environ["RELEASE_RISK_REVIEWED"] = "true"
        GATE.assert_risk_review_gate("v0.6.1")
        self.assertTrue(any("not release-scoped" in blocker for blocker in GATE.blockers))
        GATE.blockers.clear()
        os.environ["RELEASE_RISK_REVIEWED"] = "v0.6.1"
        GATE.assert_risk_review_gate("v0.6.1")
        self.assertEqual(GATE.blockers, [])

    def test_ref_divergence_blocks_behind_release_ref(self):
        with tempfile.TemporaryDirectory(prefix="agenthub-release-refs-") as repo:
            git(repo, "init", "-q")
            git(repo, "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "--allow-empty", "-m", "base")
            git(repo, "branch", "dev")
            git(repo, "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-q", "--allow-empty", "-m", "second")
            git(repo, "branch", "base")
            GATE.assert_release_refs(repo, "base", "dev", False)
        self.assertTrue(any("behind" in blocker for blocker in GATE.blockers))

    def test_ref_divergence_skip_is_explicit(self):
        GATE.assert_release_refs(tempfile.gettempdir(), "base", "dev", True)
        self.assertEqual(GATE.blockers, [])
        self.assertTrue(GATE.warnings)


if __name__ == "__main__":
    unittest.main()
