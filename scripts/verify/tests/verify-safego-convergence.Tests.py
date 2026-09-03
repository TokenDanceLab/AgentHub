#!/usr/bin/env python3
"""Negative self-tests for verify-safego-convergence (#2246 slice 1).

The gate claims "no bare recover() outside the allow-list", and a gate like that
fails in one direction only: it goes quiet. Every case here exists to prove it
cannot go quiet — a missing tree, an empty tree, an unreadable file and a blind
scanner must all exit non-zero rather than report a clean tree.

Cases:

  a. clean tree            -> 0   (both the real repo and a synthetic fixture)
  b. one extra recover()   -> 1   (out-of-allow-list file)
  c. allow-list over count -> 1   (allow-listed file gains a second/third hit)
  d. scan root missing     -> 1   (fail-closed, not "nothing found")
  e. one scan root missing -> 1   (partial tree must not pass)
  f. empty tree            -> 1   (roots exist, zero .go files)
  g. comments/strings only -> 0   (the stripper works; recover() in a doc
                                   comment or a string literal is not a site)
  h. unparseable file      -> 1   (unterminated block comment: refuse to guess)

The verifier runs as a subprocess against --Root fixtures so the real worktree
is never touched.
"""

import os
import shutil
import subprocess
import sys
import tempfile
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
VERIFIER = os.path.join(REPO_ROOT, "scripts", "verify", "verify-safego-convergence.py")

# The allow-list skeleton a "clean tree" must contain: path -> number of bare
# recover() sites it is permitted to have. Mirrors ALLOWLIST in the verifier;
# duplicated on purpose so that if the two ever drift, case (a) fails loudly
# instead of the fixture silently becoming a negative case.
ALLOWLIST_SKELETON = {
    "hub-server/internal/handler/ws.go": 1,
    "hub-server/internal/middleware/recovery.go": 2,
    "hub-server/internal/middleware/timeout.go": 1,
    "edge-server/internal/httpserver/server_middleware.go": 1,
    "pkg/safego/safego.go": 2,
}


def write_utf8(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)


def guard_body(index=0):
    """The exact hand-written shape #2246 removed."""
    return (
        "\tdefer func() {\n"
        "\t\tif r := recover(); r != nil {\n"
        '\t\t\tslog.Error("recovered", "panic", r)\n'
        "\t\t}\n"
        "\t}()\n"
    )


def build_clean_fixture(root):
    """Materialize a minimal tree that satisfies the gate exactly."""
    for rel, count in ALLOWLIST_SKELETON.items():
        body = "".join(guard_body(i) for i in range(count))
        write_utf8(
            os.path.join(root, rel),
            "package fixture\n\nimport \"log/slog\"\n\nfunc recovered%d() {\n%s}\n" % (count, body),
        )
    # A few clean files so the scan is not trivially tiny.
    write_utf8(os.path.join(root, "hub-server/internal/bus/bus.go"), "package bus\n\nfunc Publish() {}\n")
    write_utf8(os.path.join(root, "edge-server/internal/events/bus.go"), "package events\n\nfunc Run() {}\n")
    write_utf8(os.path.join(root, "pkg/safego/doc.go"), "package safego\n")


class VerifySafegoConvergenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not os.path.isfile(VERIFIER):
            raise AssertionError("verifier not found: %s" % VERIFIER)
        print("  verifier under test: %s" % VERIFIER)

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="agenthub-safego-convergence-")
        self.fixture = self._tmp.name

    def tearDown(self):
        self._tmp.cleanup()

    def run_verifier(self, root):
        result = subprocess.run(
            [sys.executable, VERIFIER, "--Root", root],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        return result.returncode, (result.stdout or "") + (result.stderr or "")

    def assert_fails_with(self, root, fragment, case_name):
        exit_code, output = self.run_verifier(root)
        self.assertNotEqual(exit_code, 0, "%s must FAIL but the verifier exited 0:\n%s" % (case_name, output))
        self.assertIn(fragment, output, "%s failed for the wrong reason:\n%s" % (case_name, output))

    # ── (a) clean tree ────────────────────────────────────────────────────

    def test_real_repo_tree_passes(self):
        """(a) The tree this test ships in must already be converged."""
        exit_code, output = self.run_verifier(REPO_ROOT)
        self.assertEqual(exit_code, 0, "the real repo must pass the safego convergence gate:\n%s" % output)

    def test_clean_fixture_passes(self):
        """(a) A synthetic tree with exactly the allow-listed hits passes."""
        build_clean_fixture(self.fixture)
        exit_code, output = self.run_verifier(self.fixture)
        self.assertEqual(exit_code, 0, "clean fixture unexpectedly failed:\n%s" % output)

    # ── (b) one recover() outside the allow-list ─────────────────────────

    def test_out_of_allowlist_recover_fails(self):
        """(b) A new hand-written guard in a non-allow-listed file must go red."""
        build_clean_fixture(self.fixture)
        write_utf8(
            os.path.join(self.fixture, "hub-server/internal/ws/fanout.go"),
            "package ws\n\nimport \"log/slog\"\n\nfunc PushToSession() {\n" + guard_body() + "}\n",
        )
        self.assert_fails_with(
            self.fixture,
            "hub-server/internal/ws/fanout.go: 1 bare recover() outside the allow-list",
            "(b) out-of-allow-list recover()",
        )

    def test_out_of_allowlist_recover_in_pkg_fails(self):
        """(b) pkg/ is scanned too, not just the two servers."""
        build_clean_fixture(self.fixture)
        write_utf8(
            os.path.join(self.fixture, "pkg/debug/debug.go"),
            "package debug\n\nfunc Check() {\n" + guard_body() + "}\n",
        )
        self.assert_fails_with(
            self.fixture,
            "pkg/debug/debug.go: 1 bare recover() outside the allow-list",
            "(b) out-of-allow-list recover() under pkg/",
        )

    def test_test_files_are_not_scanned(self):
        """A _test.go guard is legitimate (tests induce panics) and must not go red."""
        build_clean_fixture(self.fixture)
        write_utf8(
            os.path.join(self.fixture, "hub-server/internal/ws/fanout_test.go"),
            "package ws\n\nfunc TestPanic() {\n" + guard_body() + "}\n",
        )
        exit_code, output = self.run_verifier(self.fixture)
        self.assertEqual(exit_code, 0, "_test.go files must be out of scope:\n%s" % output)

    # ── (c) allow-listed file over its permitted count ───────────────────

    def test_allowlist_count_exceeded_fails(self):
        """(c) The allow-list is keyed by count, so an extra hit in a listed file goes red."""
        build_clean_fixture(self.fixture)
        target = os.path.join(self.fixture, "hub-server/internal/middleware/timeout.go")
        with open(target, encoding="utf-8") as handle:
            content = handle.read()
        write_utf8(target, content.replace("func recovered1() {", "func recovered1() {\n" + guard_body(), 1))
        self.assert_fails_with(
            self.fixture,
            "hub-server/internal/middleware/timeout.go: 2 bare recover() but the allow-list permits 1",
            "(c) allow-listed file over its permitted count",
        )

    def test_allowlist_count_exceeded_in_safego_fails(self):
        """(c) Even pkg/safego itself may not grow a third recover()."""
        build_clean_fixture(self.fixture)
        target = os.path.join(self.fixture, "pkg/safego/safego.go")
        with open(target, encoding="utf-8") as handle:
            content = handle.read()
        write_utf8(target, content + "\nfunc extra() {\n" + guard_body() + "}\n")
        self.assert_fails_with(
            self.fixture,
            "pkg/safego/safego.go: 3 bare recover() but the allow-list permits 2",
            "(c) pkg/safego over its permitted count",
        )

    # ── (d)/(e) missing scan roots ───────────────────────────────────────

    def test_missing_scan_root_fails_closed(self):
        """(d) A --Root that does not exist must go red, not report a clean tree."""
        missing = os.path.join(self.fixture, "does-not-exist")
        self.assert_fails_with(missing, "scan root does not exist", "(d) missing scan root")

    def test_missing_one_scan_root_fails_closed(self):
        """(e) A partial tree (pkg/ absent) must go red: 'found nothing' is not green."""
        build_clean_fixture(self.fixture)
        shutil.move(os.path.join(self.fixture, "pkg"), os.path.join(self.fixture, "pkg-moved-away"))
        self.assert_fails_with(self.fixture, "required scan root missing: pkg/", "(e) partial scan tree")

    # ── (f) empty tree ───────────────────────────────────────────────────

    def test_empty_tree_fails_closed(self):
        """(f) Roots present but zero .go files: empty input must not pass."""
        for rel in ("hub-server", "edge-server", "pkg"):
            os.makedirs(os.path.join(self.fixture, rel), exist_ok=True)
        self.assert_fails_with(self.fixture, "empty input must not pass", "(f) empty tree")

    # ── (g) the stripper: comments and literals are not sites ────────────

    def test_recover_in_comments_and_strings_does_not_count(self):
        """(g) Proves the gate reads code, not text.

        pkg/safego's own doc comment mentions recover() several times; a raw
        text grep would count them and force every doc edit to touch the
        allow-list. This fixture puts recover() in a line comment, a block
        comment, an interpreted string and a raw string, and must stay green.
        """
        build_clean_fixture(self.fixture)
        write_utf8(
            os.path.join(self.fixture, "hub-server/internal/ws/doc.go"),
            'package ws\n\n'
            '// The old code used recover() here, and recover() again.\n'
            '/* recover() recover() recover() */\n'
            'var helpText = "call recover() to stop a panic"\n'
            'var raw = `defer func() { recover() }()`\n'
            'func Doc() string { return helpText + raw }\n',
        )
        exit_code, output = self.run_verifier(self.fixture)
        self.assertEqual(exit_code, 0, "recover() inside comments/strings must not be counted:\n%s" % output)

    def test_blind_scanner_is_caught(self):
        """(g') The reverse sentinel: allow-list files with zero real hits must go red.

        If the stripper ever starts eating code, the scan finds nothing and the
        gate would report a clean tree. The allow-list expects 7 sites, so a
        tree whose listed files only mention recover() in comments must fail.
        """
        for rel in ALLOWLIST_SKELETON:
            write_utf8(
                os.path.join(self.fixture, rel),
                "package fixture\n\n// recover() only in a comment now\n",
            )
        for rel in ("hub-server/internal/bus", "edge-server/internal/events"):
            write_utf8(os.path.join(self.fixture, rel, "clean.go"), "package clean\n")
        self.assert_fails_with(self.fixture, "the scanner is blind", "(g') blind scanner sentinel")

    # ── (h) unparseable input ────────────────────────────────────────────

    def test_unterminated_block_comment_fails_closed(self):
        """(h) A file the stripper cannot parse must go red rather than be skipped."""
        build_clean_fixture(self.fixture)
        write_utf8(
            os.path.join(self.fixture, "hub-server/internal/bus/broken.go"),
            "package bus\n\n/* this block comment never closes\n\nfunc Publish() { recover() }\n",
        )
        self.assert_fails_with(self.fixture, "cannot parse", "(h) unparseable file")

    def test_stale_allowlist_entry_fails_closed(self):
        """An allow-list entry whose file vanished must go red, not silently pass."""
        build_clean_fixture(self.fixture)
        target = os.path.join(self.fixture, "hub-server/internal/middleware/timeout.go")
        shutil.move(target, target + ".deleted")
        self.assert_fails_with(
            self.fixture,
            "allow-list entry points at a missing file",
            "stale allow-list entry",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
