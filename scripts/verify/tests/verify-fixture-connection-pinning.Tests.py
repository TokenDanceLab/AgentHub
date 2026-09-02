#!/usr/bin/env python3
"""Self-tests for verify-fixture-connection-pinning.py (#2154 F-e) — fail-closed contract.

Each case builds an isolated fixture tree in a temp dir and runs the verifier as a
subprocess with --root/--scope, so the real repo is never evaluated.

Positive (must exit 0):
 1. private ":memory:" + fan-out symbol + direct SetMaxOpenConns(1)
 2. private ":memory:" + fan-out symbol + parameterized helper form
    (`setupDSN(t, ":memory:", 1)` with `SetMaxOpenConns(maxOpenConns)` in the same file)
 3. same as 2 but the SetMaxOpenConns call lives in ANOTHER file of the same package
 4. shared-cache DSN (`file::memory:?cache=shared`) + fan-out symbol, no pin — safe by design
 5. private ":memory:" WITHOUT any fan-out symbol, no pin — out of the gate's scope
 6. `":memory:"` appearing only inside comments + fan-out symbol — comment stripping must
    prevent a false positive (the real repo has such explanatory comments)
 7. fan-out symbol with no sqlite fixture at all (sqlmock shape)

Negative (must exit non-zero):
 8. private ":memory:" + fan-out symbol + no pin — the exact regression this gate exists for
 9. private ":memory:" + fan-out symbol + SetMaxOpenConns(2) — pinned, but not to ONE connection
10. scan scope directory missing — fail-closed, never silently pass
11. scan scope exists but contains no *_test.go — fail-closed on an empty scan
"""

import os
import subprocess
import sys
import tempfile
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
VERIFIER = os.path.join(REPO_ROOT, "scripts", "verify", "verify-fixture-connection-pinning.py")

FANOUT_CALL = "\tstate, err := svc.GetTeamRunState(ctx, userID, teamID, runID)\n"


def write(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)


def go_file(body, imports=""):
    return (
        "package fixture\n\n"
        f"import (\n{imports})\n\n"
        "func buildDB(t *testing.T) *gorm.DB {\n"
        f"{body}"
        "}\n"
    )


class FixturePinningGateTests(unittest.TestCase):
    def run_gate(self, files, scope="hub-server"):
        """Materialize files under a temp root and return (exit_code, stdout)."""
        with tempfile.TemporaryDirectory() as root:
            for rel, content in files.items():
                write(os.path.join(root, rel), content)
            proc = subprocess.run(
                [sys.executable, VERIFIER, "--root", root, "--scope", scope],
                capture_output=True,
                text=True,
            )
            return proc.returncode, proc.stdout + proc.stderr

    def assert_pass(self, name, files, scope="hub-server"):
        code, out = self.run_gate(files, scope)
        self.assertEqual(0, code, f"{name}: expected exit 0, got {code}\n{out}")

    def assert_fail(self, name, files, scope="hub-server"):
        code, out = self.run_gate(files, scope)
        self.assertNotEqual(0, code, f"{name}: expected non-zero exit, got 0\n{out}")

    def test_01_direct_pin_passes(self):
        self.assert_pass(
            "direct SetMaxOpenConns(1)",
            {"hub-server/tests/teamrun/a_test.go": go_file(
                '\tdb, _ := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})\n'
                "\tsqlDB, _ := db.DB()\n"
                "\tsqlDB.SetMaxOpenConns(1)\n"
                + FANOUT_CALL
            )},
        )

    def test_02_parameterized_helper_same_file_passes(self):
        self.assert_pass(
            "helper form, SetMaxOpenConns in same file",
            {"hub-server/internal/service/agentteam/a_test.go": go_file(
                "\treturn setupDSN(t, \":memory:\", 1)\n"
                "}\n\n"
                "func setupDSN(t *testing.T, dsn string, maxOpenConns int) *gorm.DB {\n"
                "\tdb, _ := gorm.Open(sqlite.Open(dsn), &gorm.Config{})\n"
                "\tsqlDB, _ := db.DB()\n"
                "\tsqlDB.SetMaxOpenConns(maxOpenConns)\n"
                + FANOUT_CALL
            )},
        )

    def test_03_parameterized_helper_other_file_passes(self):
        self.assert_pass(
            "helper form, SetMaxOpenConns in another file of the package",
            {
                "hub-server/internal/service/agentteam/a_test.go": go_file(
                    "\treturn setupDSN(t, \":memory:\", 1)\n" + FANOUT_CALL
                ),
                "hub-server/internal/service/agentteam/helper_test.go": go_file(
                    "\tdb, _ := gorm.Open(sqlite.Open(dsn), &gorm.Config{})\n"
                    "\tsqlDB, _ := db.DB()\n"
                    "\tsqlDB.SetMaxOpenConns(maxOpenConns)\n"
                ),
            },
        )

    def test_04_shared_cache_is_exempt(self):
        self.assert_pass(
            "file::memory:?cache=shared is safe (all connections share one catalog)",
            {"hub-server/internal/repository/a_test.go": go_file(
                '\tdb, _ := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})\n'
                + FANOUT_CALL
            )},
        )

    def test_05_private_memory_without_fanout_is_out_of_scope(self):
        self.assert_pass(
            "private :memory: with no fan-out symbol",
            {"hub-server/internal/repository/a_test.go": go_file(
                '\tdb, _ := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})\n'
                "\trows, _ := repository.ListThings(db)\n"
            )},
        )

    def test_06_comment_mention_is_not_a_violation(self):
        self.assert_pass(
            'comment-only ":memory:" must not be read as a DSN',
            {"hub-server/tests/teamrun/a_test.go": go_file(
                '\t// A private ":memory:" DSN gives every new connection its own empty database,\n'
                "\t// which is why this fixture uses a shared file DSN instead.\n"
                '\tdb, _ := gorm.Open(sqlite.Open("file:/tmp/x.db"), &gorm.Config{})\n'
                + FANOUT_CALL
            )},
        )

    def test_07_no_sqlite_fixture_passes(self):
        self.assert_pass(
            "sqlmock-shaped test with the fan-out symbol",
            {"hub-server/internal/handler/a_test.go": go_file(
                "\tsqlDB, _, _ := sqlmock.New()\n"
                "\tdb, _ := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{})\n"
                + FANOUT_CALL
            )},
        )

    def test_08_unpinned_private_memory_fails(self):
        self.assert_fail(
            "private :memory: + fan-out + no pin (the regression this gate exists for)",
            {"hub-server/tests/teamrun/a_test.go": go_file(
                '\tdb, _ := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})\n'
                + FANOUT_CALL
            )},
        )

    def test_09_pinned_to_two_connections_fails(self):
        code, out = self.run_gate(
            {"hub-server/tests/teamrun/a_test.go": go_file(
                '\tdb, _ := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})\n'
                "\tsqlDB, _ := db.DB()\n"
                "\tsqlDB.SetMaxOpenConns(2)\n"
                + FANOUT_CALL
            )}
        )
        self.assertNotEqual(0, code, f"SetMaxOpenConns(2) must not count as pinned\n{out}")
        self.assertIn("not pinned to one connection", out)

    def test_10_missing_scope_fails_closed(self):
        self.assert_fail("missing scan scope", {"some-other-dir/a_test.go": go_file("\t_ = 1\n")})

    def test_11_empty_scan_fails_closed(self):
        self.assert_fail(
            "scope exists but holds no *_test.go",
            {"hub-server/internal/router/router.go": "package router\n"},
        )

    def test_12_violation_message_names_the_file_and_line(self):
        code, out = self.run_gate(
            {"hub-server/tests/teamrun/a_test.go": go_file(
                '\tdb, _ := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})\n'
                + FANOUT_CALL
            )}
        )
        self.assertNotEqual(0, code)
        self.assertIn("hub-server/tests/teamrun/a_test.go:", out, out)
        self.assertIn("no such table", out, out)


if __name__ == "__main__":
    unittest.main(verbosity=2)
