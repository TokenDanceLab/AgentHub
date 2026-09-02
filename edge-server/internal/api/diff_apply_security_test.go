package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/agenthub/edge-server/internal/edgeidentity"
	"github.com/agenthub/edge-server/internal/store"
)

// Security slice for the diff-apply endpoints (#2154 安全面探索批 2):
//
//	P2-6 → run ownership gate on POST /v1/runs/{runId}/apply and /apply-all
//	P1-1 → symlink containment on the write path (workspace allowlist escape)
//	P2-7 → apply-all decision cap, one ListRunDiffFiles per request, ctx cancel
//	P3-14 → file mode literals on the write path
//
// The ownership gate is asserted against the paradigm already used by
// GetRunDiff (handlers_projects.go): 404 for both "missing" and "not yours",
// so a non-owner cannot use the endpoint as a runId existence oracle.

// seedOwnedApplyRun creates project/thread/run with an explicit project owner
// and optionally one diff file, then moves the run to status. IDs are keyed so
// several cases can share one store.
func seedOwnedApplyRun(t *testing.T, repo store.Repository, key, runID, ownerID, status, diffPath, diff string) {
	t.Helper()
	projectID := "proj-sec-" + key
	threadID := "thread-sec-" + key
	if _, err := repo.CreateProject(projectID, "Sec "+key, ownerID); err != nil {
		t.Fatalf("CreateProject(%s): %v", projectID, err)
	}
	if _, err := repo.CreateThread(threadID, projectID, "Sec "+key, "", "", ""); err != nil {
		t.Fatalf("CreateThread(%s): %v", threadID, err)
	}
	if _, err := repo.CreateRun(runID, projectID, threadID); err != nil {
		t.Fatalf("CreateRun(%s): %v", runID, err)
	}
	if status != "queued" {
		if _, ok := repo.SetRunStatus(runID, status); !ok {
			t.Fatalf("SetRunStatus(%s) failed", status)
		}
	}
	if diffPath != "" {
		if _, err := repo.UpsertRunDiffFile(store.RunDiffFile{
			RunID:  runID,
			Path:   diffPath,
			Diff:   diff,
			Status: "pending",
		}); err != nil {
			t.Fatalf("UpsertRunDiffFile(%s): %v", diffPath, err)
		}
	}
}

// withHubUser injects the Hub identity that localAuthMiddleware normally puts
// on the request context. An empty userID models "authenticated by the Edge
// local token only" (no Hub identity).
func withHubUser(ctx context.Context, userID string) context.Context {
	if userID == "" {
		return ctx
	}
	return context.WithValue(ctx, edgeidentity.HubUserIDKey, userID)
}

func doApplyRunDiffAsUser(h *Handler, runID, userID, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/v1/runs/"+runID+"/apply", strings.NewReader(body))
	req = req.WithContext(withHubUser(req.Context(), userID))
	rec := httptest.NewRecorder()
	h.PostApplyRunDiff(rec, req, runID)
	return rec
}

func doApplyAllRunDiffsAsUser(h *Handler, runID, userID, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/v1/runs/"+runID+"/apply-all", strings.NewReader(body))
	req = req.WithContext(withHubUser(req.Context(), userID))
	rec := httptest.NewRecorder()
	h.PostApplyAllRunDiffs(rec, req, runID)
	return rec
}

// ---------------------------------------------------------------------------
// P2-6 — run ownership gate
// ---------------------------------------------------------------------------

// applyBodyWithWorkDir builds a single-hunk apply body for a.txt.
func applyBodyWithWorkDir(workDir string) string {
	return fmt.Sprintf(`{"file_path":"a.txt","hunk_index":0,"accepted":true,"workDir":%q}`, workDir)
}

func applyAllBodyWithWorkDir(workDir string) string {
	return fmt.Sprintf(`{"decisions":[{"file_path":"a.txt","hunk_index":0,"accepted":true}],"workDir":%q}`, workDir)
}

// TestPostApplyRunDiffRejectsNonOwnerRun is the privilege-escalation red test:
// user-b must not be able to apply a hunk of user-a's run, and must not
// text in the response.
func TestPostApplyRunDiffRejectsNonOwnerRun(t *testing.T) {
	h := newTestHandler()
	h.HubJWTSecret = "test-secret" // multi-user mode
	workDir := allowTestWorkspace(t, h)
	target := filepath.Join(workDir, "a.txt")
	if err := os.WriteFile(target, []byte(applyTestOriginal), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	seedOwnedApplyRun(t, h.Store, "owner", "run-owned", "user-a", "finished", "a.txt", applyTestDiff)

	rec := doApplyRunDiffAsUser(h, "run-owned", "user-b", applyBodyWithWorkDir(workDir))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("non-owner apply status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), "not_found")
	if strings.Contains(rec.Body.String(), "line2-modified") {
		t.Errorf("non-owner response leaked the run's diff text: %s", rec.Body.String())
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read target: %v", err)
	}
	if string(got) != applyTestOriginal {
		t.Errorf("ESCAPE: non-owner apply rewrote %s to %q", target, got)
	}
}

// TestPostApplyAllRunDiffsRejectsNonOwnerRun is the batch-side ownership gate.
func TestPostApplyAllRunDiffsRejectsNonOwnerRun(t *testing.T) {
	h := newTestHandler()
	h.HubJWTSecret = "test-secret"
	workDir := allowTestWorkspace(t, h)
	target := filepath.Join(workDir, "a.txt")
	if err := os.WriteFile(target, []byte(applyTestOriginal), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	seedOwnedApplyRun(t, h.Store, "ownerall", "run-owned-all", "user-a", "finished", "a.txt", applyTestDiff)

	rec := doApplyAllRunDiffsAsUser(h, "run-owned-all", "user-b", applyAllBodyWithWorkDir(workDir))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("non-owner apply-all status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), "not_found")
	if strings.Contains(rec.Body.String(), "line2-modified") {
		t.Errorf("non-owner response leaked the run's diff text: %s", rec.Body.String())
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read target: %v", err)
	}
	if string(got) != applyTestOriginal {
		t.Errorf("ESCAPE: non-owner apply-all rewrote %s to %q", target, got)
	}
}

// TestPostApplyRunDiffNonOwnerIsNotAnExistenceOracle pins that "not your run"
// and "no such run" are indistinguishable: same status, same error code, same
// message. Only the traceId may differ.
func TestPostApplyRunDiffNonOwnerIsNotAnExistenceOracle(t *testing.T) {
	h := newTestHandler()
	h.HubJWTSecret = "test-secret"
	workDir := allowTestWorkspace(t, h)
	seedOwnedApplyRun(t, h.Store, "oracle", "run-oracle", "user-a", "finished", "a.txt", applyTestDiff)

	notOwned := doApplyRunDiffAsUser(h, "run-oracle", "user-b", applyBodyWithWorkDir(workDir))
	missing := doApplyRunDiffAsUser(h, "run-does-not-exist", "user-b", applyBodyWithWorkDir(workDir))

	if notOwned.Code != missing.Code {
		t.Fatalf("status differs: not-owned=%d missing=%d (existence oracle)", notOwned.Code, missing.Code)
	}
	if stripTraceID(notOwned.Body.String()) != stripTraceID(missing.Body.String()) {
		t.Fatalf("body differs:\n not-owned=%s\n missing  =%s", notOwned.Body.String(), missing.Body.String())
	}
}

// stripTraceID removes the per-request traceId so two error envelopes can be
// compared byte-for-byte.
func stripTraceID(body string) string {
	if idx := strings.Index(body, `"traceId"`); idx >= 0 {
		return body[:idx]
	}
	return body
}

// TestPostApplyRunDiffFailsClosedWithoutHubIdentity mirrors the AH-SR-045
// fail-closed rule already pinned for previews: in multi-user mode a request
// without a Hub identity has an empty ownership principal and must not reach
// anybody's run.
func TestPostApplyRunDiffFailsClosedWithoutHubIdentity(t *testing.T) {
	h := newTestHandler()
	h.HubJWTSecret = "test-secret"
	workDir := allowTestWorkspace(t, h)
	seedOwnedApplyRun(t, h.Store, "noid", "run-noid", "user-a", "finished", "a.txt", applyTestDiff)

	rec := doApplyRunDiffAsUser(h, "run-noid", "", applyBodyWithWorkDir(workDir))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 without Hub identity; body=%s", rec.Code, rec.Body.String())
	}
}

// TestPostApplyRunDiffOwnerCanStillApply is the positive control: the owner is
// unaffected by the gate.
func TestPostApplyRunDiffOwnerCanStillApply(t *testing.T) {
	h := newTestHandler()
	h.HubJWTSecret = "test-secret"
	workDir := allowTestWorkspace(t, h)
	target := filepath.Join(workDir, "a.txt")
	if err := os.WriteFile(target, []byte(applyTestOriginal), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	seedOwnedApplyRun(t, h.Store, "mine", "run-mine", "user-a", "finished", "a.txt", applyTestDiff)

	rec := doApplyRunDiffAsUser(h, "run-mine", "user-a", applyBodyWithWorkDir(workDir))
	if rec.Code != http.StatusOK {
		t.Fatalf("owner apply status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read target: %v", err)
	}
	if string(got) != applyTestModified {
		t.Errorf("owner apply did not write the hunk: %q", got)
	}
}

// TestPostApplyRunDiffLocalSingleTenantUnaffected guards the documented local
// single-tenant bypass (no HubJWTSecret → no ownership enforcement), so the
// gate cannot break local/dev Edge usage.
func TestPostApplyRunDiffLocalSingleTenantUnaffected(t *testing.T) {
	h := newTestHandler() // HubJWTSecret empty → local single-tenant mode
	workDir := allowTestWorkspace(t, h)
	target := filepath.Join(workDir, "a.txt")
	if err := os.WriteFile(target, []byte(applyTestOriginal), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	seedOwnedApplyRun(t, h.Store, "local", "run-local", "user-a", "finished", "a.txt", applyTestDiff)

	rec := doApplyRunDiff(h, "run-local", http.MethodPost, applyBodyWithWorkDir(workDir))
	if rec.Code != http.StatusOK {
		t.Fatalf("local single-tenant apply status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
}
