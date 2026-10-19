#!/usr/bin/env python3
"""Self-tests for the release gate's structural policy checks.

The gate asserts workflow structure (triggers, manual dry gates, uploader
binding, read-only readiness). Workflow syntax and shell semantics belong to
actionlint and review, so these tests do not re-implement a shell interpreter.
"""

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

READINESS_HEAD = """name: readiness
permissions:
  contents: read
on:
  workflow_dispatch:
    inputs:
      run_windows_package_dry: {}
      run_macos_unsigned_dry_policy: {}
      run_macos_package_dry: {}
jobs:
"""

DISPATCH = "${{ github.event_name == 'workflow_dispatch' && inputs.%s == true }}"
WINDOWS_GATE = "      - run: python scripts/release/verify-tauri-package-dry.py -RepoRoot . -RunWindowsBundle -StrictToolchain\n"
MACOS_GATE = "      - run: python scripts/release/verify-tauri-package-dry.py -RepoRoot . -RunMacosBundle -StrictToolchain\n"
ARTIFACT_UPLOAD = "      - uses: actions/upload-artifact@v7\n"


def readiness(windows=None, macos=None, policy=None, head=READINESS_HEAD, extra=""):
    """A minimal readiness workflow that satisfies every structural rule."""
    return (
        head
        + "  windows-package-dry:\n    runs-on: windows-latest\n"
        + f"    if: {DISPATCH % 'run_windows_package_dry'}\n    steps:\n"
        + (windows if windows is not None else WINDOWS_GATE + ARTIFACT_UPLOAD)
        + "  macos-unsigned-dry-policy:\n    runs-on: ubuntu-latest\n"
        + f"    if: {DISPATCH % 'run_macos_unsigned_dry_policy'}\n    steps:\n"
        + (policy if policy is not None else "      - run: echo policy only\n")
        + "  macos-package-dry:\n    runs-on: macos-latest\n"
        + f"    if: {DISPATCH % 'run_macos_package_dry'}\n    steps:\n"
        + (macos if macos is not None else MACOS_GATE + ARTIFACT_UPLOAD)
        + extra
    )


RELEASE = """name: release
on:
  push:
    tags: ['v*']
jobs:
  release:
    permissions:
      contents: write
    steps:
      - uses: softprops/action-gh-release@v3
        with:
          tag_name: ${{ github.ref_name }}
          prerelease: ${{ contains(github.ref_name, '-') }}
"""


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

    def check(self, readiness_yaml, release_yaml):
        GATE.REPO_ROOT = self.fixture({
            ".github/workflows/release-readiness.yml": readiness_yaml,
            ".github/workflows/release.yml": release_yaml,
        })
        GATE.assert_workflow_policy(GATE.REPO_ROOT)
        return GATE.blockers

    def assert_blocked(self, blockers, *needles):
        text = "\n".join(blockers)
        for needle in needles:
            self.assertTrue(any(needle in blocker for blocker in blockers), f"{needle!r} not in {text!r}")

    def test_repository_passes(self):
        GATE.REPO_ROOT = REPO_ROOT
        GATE.assert_workflow_policy(REPO_ROOT)
        self.assertEqual(GATE.blockers, [])

    def test_minimal_fixture_passes(self):
        self.assertEqual(self.check(readiness(), RELEASE), [])

    def test_missing_release_surface_is_blocked(self):
        blockers = self.check("name: readiness\n", "name: release\n")
        self.assert_blocked(blockers, "workflow_dispatch", "tag trigger", "uploader is missing")

    def test_release_trigger_must_be_v_tags_only(self):
        for trigger in ("on:\n  push:\n    branches: [master]\n    tags: ['v*']\n", "on:\n  pull_request: {}\n"):
            blockers = self.check(readiness(), RELEASE.replace("on:\n  push:\n    tags: ['v*']\n", trigger))
            self.assert_blocked(blockers, "tag trigger")

    def test_dry_gate_inputs_are_required(self):
        head = READINESS_HEAD.replace("      run_macos_package_dry: {}\n", "")
        blockers = self.check(readiness(head=head), RELEASE)
        self.assert_blocked(blockers, "macOS package dry gate input is missing")

    def test_dry_gates_delegate_with_expected_flags(self):
        blockers = self.check(
            readiness(windows="      - run: python scripts/release/verify-tauri-package-dry.py -RunWindowsBundle\n"),
            RELEASE,
        )
        self.assert_blocked(blockers, "-StrictToolchain")

    def test_dry_gate_jobs_must_upload_after_the_gate(self):
        blockers = self.check(readiness(windows=WINDOWS_GATE, macos=MACOS_GATE), RELEASE)
        self.assert_blocked(blockers, "does not upload evidence after the gate")

    def test_disabled_gate_steps_do_not_count(self):
        blockers = self.check(
            readiness(windows=WINDOWS_GATE + "        if: ${{ false }}\n" + ARTIFACT_UPLOAD),
            RELEASE,
        )
        self.assert_blocked(blockers, "-RunWindowsBundle")

    def test_macos_gate_requires_macos_runner(self):
        blockers = self.check(
            readiness().replace("runs-on: macos-latest", "runs-on: ubuntu-latest"),
            RELEASE,
        )
        self.assert_blocked(blockers, "does not run on a macOS runner")

    def test_prerelease_must_bind_to_the_uploader(self):
        blockers = self.check(
            readiness(),
            RELEASE.replace(
                "          prerelease: ${{ contains(github.ref_name, '-') }}\n",
                "      - run: echo decoy\n        with:\n          prerelease: ${{ contains(github.ref_name, '-') }}\n",
            ),
        )
        self.assert_blocked(blockers, "prerelease")

    def test_readiness_cannot_upload_a_release(self):
        blockers = self.check(
            readiness(extra="  release:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: softprops/action-gh-release@v3\n"),
            RELEASE,
        )
        self.assert_blocked(blockers, "release uploader or signing material")

    def test_readiness_cannot_grant_contents_write(self):
        workflow_wide = readiness().replace("permissions:\n  contents: read\n", "permissions:\n  contents: write\n")
        self.assert_blocked(self.check(workflow_wide, RELEASE), "read-only")

        job_scoped = readiness(extra="  publisher:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: write\n    steps:\n      - run: echo hi\n")
        self.assert_blocked(self.check(job_scoped, RELEASE), "read-only")

    def test_readiness_cannot_carry_signing_material(self):
        for step in (
            "      - uses: actions/checkout@v7\n        env:\n          TAURI_SIGNING_PRIVATE_KEY: x\n",
            "      - run: echo hi\n        env:\n          APPLE_ID: x\n",
        ):
            blockers = self.check(readiness(policy="      - run: echo policy only\n" + step), RELEASE)
            self.assert_blocked(blockers, "release uploader or signing material")

    def test_empty_or_invalid_yaml_is_blocked(self):
        self.assert_blocked(self.check("", RELEASE), "is empty")
        self.assert_blocked(self.check("name: readiness\njobs:\n  x:\n    steps:\n      - run: [\n", RELEASE), "is not valid YAML")

    def test_rc_tag_policy(self):
        GATE.assert_rc_tag_policy("0.6.1-rc.1")
        self.assertEqual(GATE.blockers, [])
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
        def git(repo, *args):
            subprocess.run(["git", "-C", repo, *args], check=True, capture_output=True, text=True)

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
