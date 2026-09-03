#!/usr/bin/env python3
"""Negative self-tests for verify-edge-status-ssot (#2245 stage 2).

The gate claims "no edge error response hand-copies its HTTP status", and a gate
like that fails in one direction only: it goes quiet. Every case here exists to
prove it cannot go quiet — a missing tree, an empty tree, an unreadable file, a
comment-shaped hit, a stale exemption and a blind scanner must all exit non-zero
rather than report a clean tree.

Cases:

  a. clean tree                 -> 0  (the real repo and a synthetic fixture)
  b. new ErrorBody site         -> 1  (rule 1: hand-copied status returns)
  c. new status literal only    -> 1  (rule 2: writeJSON(w, http.StatusX, map…))
  d. allow-list over count      -> 1  (exempted file gains a second ErrorBody)
  e. wrong literal in exemption -> 1  (mcp/server.go writes a non-200)
  f. pairing broken             -> 1  (activeRunExistsResponse + http.StatusConflict)
  g. Write hardcodes a status   -> 1  (rule 4: the single source itself drifts)
  h. scan root missing          -> 1  (fail-closed, not "nothing found")
  i. empty tree                 -> 1  (root exists, zero .go files)
  j. comments/strings only      -> 0  (the stripper works)
  k. stale allow-list entry     -> 1  (exempted file vanished)
  l. under-count sentinel       -> 1  (exemption says N, scan finds fewer)
  m. blind scanner              -> 1  (allow-list expects hits, scan finds none)
  n. unparseable file           -> 1  (unterminated block comment: refuse to guess)
  o. _test.go is not scanned    -> 0  (tests may pin literal wire statuses)

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
VERIFIER = os.path.join(REPO_ROOT, "scripts", "verify", "verify-edge-status-ssot.py")

CODES_REL = "edge-server/internal/errcode/codes.go"
EVENTS_REL = "edge-server/internal/api/handlers_events.go"
RUNS_REL = "edge-server/internal/api/handlers_runs.go"
MCP_REL = "edge-server/internal/mcp/server.go"

CODES_GO = '''package errcode

import (
	"net/http"

	"github.com/agenthub/edge-server/internal/resputil"
)

type Error struct {
	Code       string
	Message    string
	HTTPStatus int
}

func ErrorBody(e *Error) map[string]any {
	return map[string]any{"error": map[string]any{"code": e.Code, "message": e.Message}}
}

// Wire behavior is byte-identical to writeJSON(w, e.HTTPStatus, ErrorBody(e)):
// both shapes appear in this doc comment and neither may be counted as a hit.
func Write(w http.ResponseWriter, e *Error) {
	resputil.WriteJSON(w, e.HTTPStatus, ErrorBody(e))
}
'''

EVENTS_GO = '''package api

import (
	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/store"
)

// activeRunExistsResponse is the one allow-listed richer envelope.
func activeRunExistsResponse(run store.Run) map[string]any {
	body := errcode.ErrorBody(errcode.ErrActiveRunExists)
	body["runId"] = run.ID
	return body
}
'''

RUNS_GO = '''package api

import (
	"net/http"

	"github.com/agenthub/edge-server/internal/errcode"
)

func (h *Handler) PostRuns(w http.ResponseWriter, r *http.Request) {
	if err := h.validateCapabilityRequest(r); err != nil {
		errcode.Write(w, err)
		return
	}
	writeJSON(w, errcode.ErrActiveRunExists.HTTPStatus, activeRunExistsResponse(h.active()))
}
'''

MCP_GO = '''package mcp

import "net/http"

func (s *Server) handleResult(w http.ResponseWriter) {
	writeJSON(w, http.StatusOK, s.responses())
	writeJSON(w, http.StatusOK, s.resp())
}

func (s *Server) handleFailure(w http.ResponseWriter, id int) {
	writeJSON(w, http.StatusOK, errorResponse(id, -32601, "method not found"))
}
'''

SETTINGS_GO = '''package api

import "net/http"

// Out-of-scope shapes that must keep passing: a success envelope with a literal
// status, a health write whose status is computed rather than hand-copied, and a
// websocket write that is not an HTTP status site at all.
func (h *Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	writeSuccess(w, http.StatusOK, h.settings())
}

func (h *Handler) GetHealth(w http.ResponseWriter, r *http.Request) {
	httpStatus := http.StatusOK
	if h.degraded() {
		httpStatus = http.StatusServiceUnavailable
	}
	writeJSON(w, httpStatus, map[string]any{"status": "ok"})
}
'''

WS_GO = '''package api

func (h *Handler) streamEvents(conn *wsConn) {
	for evt := range h.events {
		if err := conn.WriteJSON(evt); err != nil {
			return
		}
	}
}
'''


def write_utf8(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)


def build_clean_fixture(root):
    """Materialize a minimal tree that satisfies the gate exactly."""
    write_utf8(os.path.join(root, CODES_REL), CODES_GO)
    write_utf8(os.path.join(root, EVENTS_REL), EVENTS_GO)
    write_utf8(os.path.join(root, RUNS_REL), RUNS_GO)
    write_utf8(os.path.join(root, MCP_REL), MCP_GO)
    write_utf8(os.path.join(root, "edge-server/internal/api/handlers_settings.go"), SETTINGS_GO)
    write_utf8(os.path.join(root, "edge-server/internal/api/handlers_events_ws.go"), WS_GO)
    write_utf8(os.path.join(root, "edge-server/internal/store/store.go"), "package store\n\ntype Run struct{ ID string }\n")


class VerifyEdgeStatusSSOTTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not os.path.isfile(VERIFIER):
            raise AssertionError("verifier not found: %s" % VERIFIER)
        print("  verifier under test: %s" % VERIFIER)

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="agenthub-edge-status-ssot-")
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

    def assert_passes(self, root, case_name):
        exit_code, output = self.run_verifier(root)
        self.assertEqual(exit_code, 0, "%s must PASS but the verifier exited %d:\n%s" % (case_name, exit_code, output))

    # ── (a) clean tree ────────────────────────────────────────────────────

    def test_real_repo_tree_passes(self):
        """(a) The tree this test ships in must already be converged."""
        self.assert_passes(REPO_ROOT, "the real repo")

    def test_clean_fixture_passes(self):
        """(a) A synthetic tree with exactly the allow-listed hits passes."""
        build_clean_fixture(self.fixture)
        self.assert_passes(self.fixture, "clean fixture")

    # ── (b) a new ErrorBody call site ────────────────────────────────────

    def test_new_errorbody_site_fails(self):
        """(b) The exact shape #2245 removed must go red."""
        build_clean_fixture(self.fixture)
        write_utf8(
            os.path.join(self.fixture, "edge-server/internal/api/deploy.go"),
            'package api\n\nimport (\n\t"net/http"\n\n\t"github.com/agenthub/edge-server/internal/errcode"\n)\n\n'
            "func (h *Handler) PostDeploy(w http.ResponseWriter, r *http.Request) {\n"
            "\twriteJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrBadRequest))\n}\n",
        )
        self.assert_fails_with(
            self.fixture,
            "edge-server/internal/api/deploy.go: 1 errcode.ErrorBody( call(s) outside the allow-list",
            "(b) new ErrorBody site",
        )

    def test_exempted_file_gaining_a_second_errorbody_fails(self):
        """(d) Over-count inside an allow-listed file is still a new hand-copy."""
        build_clean_fixture(self.fixture)
        write_utf8(
            os.path.join(self.fixture, EVENTS_REL),
            EVENTS_GO.replace(
                "\tbody[\"runId\"] = run.ID\n",
                "\tbody[\"runId\"] = run.ID\n\t_ = errcode.ErrorBody(errcode.ErrNotFound)\n",
            ),
        )
        self.assert_fails_with(
            self.fixture,
            "but the allow-list permits 1",
            "(d) allow-list over count",
        )

    # ── (c) a status literal without ErrorBody ───────────────────────────

    def test_new_status_literal_fails(self):
        """(c) A hand-written map body still hand-copies the status."""
        build_clean_fixture(self.fixture)
        write_utf8(
            os.path.join(self.fixture, "edge-server/internal/api/handlers_conflict.go"),
            'package api\n\nimport "net/http"\n\n'
            "func (h *Handler) conflict(w http.ResponseWriter) {\n"
            '\twriteJSON(w, http.StatusConflict, map[string]any{"error": "active_run_exists"})\n}\n',
        )
        self.assert_fails_with(
            self.fixture,
            "1 writeJSON(w, http.Status*, \u2026) site(s) outside the allow-list",
            "(c) new status literal",
        )

    def test_exempted_literal_must_stay_200(self):
        """(e) The JSON-RPC exemption is for transport-200 only."""
        build_clean_fixture(self.fixture)
        write_utf8(
            os.path.join(self.fixture, MCP_REL),
            MCP_GO.replace(
                "writeJSON(w, http.StatusOK, errorResponse(id, -32601, \"method not found\"))",
                "writeJSON(w, http.StatusBadRequest, errorResponse(id, -32601, \"method not found\"))",
            ),
        )
        self.assert_fails_with(
            self.fixture,
            "but the allow-list permits 3 and only http.StatusOK",
            "(e) wrong literal inside exemption",
        )

    # ── (f) pairing broken ───────────────────────────────────────────────

    def test_envelope_builder_with_literal_status_fails(self):
        """(f) The richer envelope is exempted only while its status derives."""
        build_clean_fixture(self.fixture)
        write_utf8(
            os.path.join(self.fixture, RUNS_REL),
            RUNS_GO.replace(
                "writeJSON(w, errcode.ErrActiveRunExists.HTTPStatus, activeRunExistsResponse(h.active()))",
                "writeJSON(w, http.StatusConflict, activeRunExistsResponse(h.active()))",
            ),
        )
        self.assert_fails_with(
            self.fixture,
            "calls activeRunExistsResponse() with status `http.StatusConflict`",
            "(f) pairing broken",
        )

    # ── (g) the single source itself drifts ──────────────────────────────

    def test_write_hardcoding_a_status_fails(self):
        """(g) Hardcoding 500 inside errcode.Write bypasses every other rule."""
        build_clean_fixture(self.fixture)
        write_utf8(
            os.path.join(self.fixture, CODES_REL),
            CODES_GO.replace(
                "resputil.WriteJSON(w, e.HTTPStatus, ErrorBody(e))",
                "resputil.WriteJSON(w, http.StatusInternalServerError, ErrorBody(e))",
            ),
        )
        self.assert_fails_with(
            self.fixture,
            "passes `http.StatusInternalServerError` as the status",
            "(g) Write hardcodes a status",
        )

    def test_write_shape_change_fails_closed(self):
        """(g') If Write stops matching, the check must not go quiet."""
        build_clean_fixture(self.fixture)
        write_utf8(
            os.path.join(self.fixture, CODES_REL),
            CODES_GO.replace(
                "\tresputil.WriteJSON(w, e.HTTPStatus, ErrorBody(e))\n",
                "\twriteDirect(w, e)\n",
            ),
        )
        self.assert_fails_with(
            self.fixture,
            "no `resputil.WriteJSON(w, \u2026, ErrorBody(e))` call found",
            "(g') Write shape changed",
        )

    # ── (h/i) missing and empty trees ────────────────────────────────────

    def test_missing_scan_root_fails(self):
        """(h) No edge-server/ at all must not read as "nothing to complain about"."""
        os.makedirs(os.path.join(self.fixture, "hub-server"), exist_ok=True)
        write_utf8(os.path.join(self.fixture, "hub-server/internal/handler/response.go"), "package handler\n")
        self.assert_fails_with(self.fixture, "scan root missing", "(h) missing scan root")

    def test_empty_tree_fails(self):
        """(i) edge-server/ exists but holds no .go file."""
        os.makedirs(os.path.join(self.fixture, "edge-server/internal/api"), exist_ok=True)
        self.assert_fails_with(self.fixture, "scanned 0 non-test .go files", "(i) empty tree")

    # ── (j/o) shapes that must keep passing ──────────────────────────────

    def test_hits_inside_comments_and_strings_do_not_count(self):
        """(j) The stripper must neutralise doc comments and literals."""
        build_clean_fixture(self.fixture)
        write_utf8(
            os.path.join(self.fixture, "edge-server/internal/api/doc.go"),
            'package api\n\n'
            '// Legacy shape, do not resurrect:\n'
            '//   writeJSON(w, http.StatusForbidden, errcode.ErrorBody(err))\n'
            '/* writeJSON(w, http.StatusTeapot, errcode.ErrorBody(err)) */\n'
            'var example = "writeJSON(w, http.StatusForbidden, errcode.ErrorBody(err))"\n'
            'var raw = `errcode.ErrorBody(err)`\n',
        )
        self.assert_passes(self.fixture, "(j) comments/strings only")

    def test_test_files_are_not_scanned(self):
        """(o) Tests pin literal wire statuses on purpose; that is not a hand-copy."""
        build_clean_fixture(self.fixture)
        write_utf8(
            os.path.join(self.fixture, "edge-server/internal/api/deploy_test.go"),
            'package api\n\nimport "net/http"\n\n'
            "func TestPostDeployRejectsBadSlug(t *testing.T) {\n"
            "\twriteJSON(w, http.StatusBadRequest, errcode.ErrorBody(errcode.ErrBadRequest))\n}\n",
        )
        self.assert_passes(self.fixture, "(o) _test.go")

    # ── (k/l/m) stale exemptions and blind scanner ───────────────────────

    def test_stale_allowlist_entry_fails(self):
        """(k) An exemption whose file vanished must go red, not silently pass."""
        build_clean_fixture(self.fixture)
        target = os.path.join(self.fixture, EVENTS_REL)
        shutil.move(target, target + ".deleted")
        self.assert_fails_with(self.fixture, "required file missing", "(k) stale allow-list entry")

    def test_undercount_sentinel_fails(self):
        """(l) Exemption expects 3 ErrorBody hits, the scan finds 2."""
        build_clean_fixture(self.fixture)
        write_utf8(
            os.path.join(self.fixture, EVENTS_REL),
            EVENTS_GO.replace(
                "\tbody := errcode.ErrorBody(errcode.ErrActiveRunExists)\n"
                "\tbody[\"runId\"] = run.ID\n"
                "\treturn body\n",
                "\treturn map[string]any{\"runId\": run.ID}\n",
            ),
        )
        self.assert_fails_with(self.fixture, "under-count in", "(l) under-count sentinel")

    def test_mcp_undercount_sentinel_fails(self):
        """(l') The transport-200 exemption must also be met, not merely not exceeded."""
        build_clean_fixture(self.fixture)
        write_utf8(
            os.path.join(self.fixture, MCP_REL),
            MCP_GO.replace("\twriteJSON(w, http.StatusOK, s.resp())\n", ""),
        )
        self.assert_fails_with(
            self.fixture,
            "allow-list expects 3 JSON-RPC transport-200 write(s) but the scan found 2",
            "(l') mcp under-count",
        )

    def test_blind_scanner_fails(self):
        """(m) Zero hits anywhere while the allow-list expects some => scanner is blind."""
        build_clean_fixture(self.fixture)
        write_utf8(
            os.path.join(self.fixture, CODES_REL),
            "package errcode\n\nimport \"net/http\"\n\ntype Error struct{ HTTPStatus int }\n\n"
            "func Write(w http.ResponseWriter, e *Error) { writeDirect(w, e) }\n",
        )
        write_utf8(
            os.path.join(self.fixture, EVENTS_REL),
            "package api\n\nfunc activeRunExistsResponse() map[string]any { return nil }\n",
        )
        self.assert_fails_with(self.fixture, "the scanner is blind", "(m) blind scanner sentinel")

    # ── (n) unparseable input ────────────────────────────────────────────

    def test_unterminated_block_comment_fails_closed(self):
        """(n) A file the stripper cannot parse must go red rather than be skipped."""
        build_clean_fixture(self.fixture)
        write_utf8(
            os.path.join(self.fixture, "edge-server/internal/api/broken.go"),
            "package api\n\n/* this block comment never closes\n\n"
            "func f() { writeJSON(w, http.StatusForbidden, errcode.ErrorBody(err)) }\n",
        )
        self.assert_fails_with(self.fixture, "cannot parse", "(n) unparseable file")


if __name__ == "__main__":
    unittest.main(verbosity=2)
