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

// ---------------------------------------------------------------------------
// P1-1 — symlink containment on the write path
// ---------------------------------------------------------------------------

// assertNotWrittenOutside fails when the workspace-external file was touched.
func assertNotWrittenOutside(t *testing.T, path, want string) {
	t.Helper()
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if string(got) != want {
		t.Fatalf("ESCAPE: %s outside the workspace allowlist was rewritten to %q", path, got)
	}
	if _, err := os.Lstat(path + ".bak"); !os.IsNotExist(err) {
		t.Fatalf("ESCAPE: backup %s.bak was created outside the workspace allowlist (stat err = %v)", path, err)
	}
}

// applyRejectedAssert pins the current mapping for a containment refusal: the
// handler surfaces applyHunkToFile errors as 500 internal_error, exactly like
// the pre-existing "file path escapes workdir" error
// (TestPostApplyRunDiffPropagatesApplyErrors).
func applyRejectedAssert(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	if rec.Code == http.StatusOK {
		t.Fatalf("status = 200, want refusal; body=%s", rec.Body.String())
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 for a containment refusal; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), "internal_error")
}

// TestPostApplyRunDiffRejectsSymlinkedParentDirectory is the report's scenario:
// a git repository may legally carry a symlink, so "docs" inside the allowlisted
// workdir points at a directory outside it. The lexical isPathWithin check
// passes "docs/authorized_keys", and os.WriteFile follows the symlink.
func TestPostApplyRunDiffRejectsSymlinkedParentDirectory(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)

	outside := t.TempDir() // never added to the allowlist
	vault := filepath.Join(outside, "vault")
	if err := os.MkdirAll(vault, 0o700); err != nil {
		t.Fatalf("mkdir vault: %v", err)
	}
	victim := filepath.Join(vault, "authorized_keys")
	if err := os.WriteFile(victim, []byte(applyTestOriginal), 0o600); err != nil {
		t.Fatalf("write victim: %v", err)
	}
	if err := os.Symlink(vault, filepath.Join(workDir, "docs")); err != nil {
		t.Fatalf("symlink docs: %v", err)
	}

	seedOwnedApplyRun(t, h.Store, "symdir", "run-symdir", "", "finished", "docs/authorized_keys", applyTestDiff)
	body := fmt.Sprintf(`{"file_path":"docs/authorized_keys","hunk_index":0,"accepted":true,"workDir":%q}`, workDir)
	rec := doApplyRunDiff(h, "run-symdir", http.MethodPost, body)

	assertNotWrittenOutside(t, victim, applyTestOriginal)
	applyRejectedAssert(t, rec)
}

// TestPostApplyRunDiffRejectsSymlinkedTargetFile covers the case a
// "resolve the parent directory only" fix would miss: the final path component
// itself is a symlink leaving the workspace.
func TestPostApplyRunDiffRejectsSymlinkedTargetFile(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)

	outside := t.TempDir()
	victim := filepath.Join(outside, "host_env")
	if err := os.WriteFile(victim, []byte(applyTestOriginal), 0o600); err != nil {
		t.Fatalf("write victim: %v", err)
	}
	if err := os.Symlink(victim, filepath.Join(workDir, "link.txt")); err != nil {
		t.Fatalf("symlink link.txt: %v", err)
	}

	seedOwnedApplyRun(t, h.Store, "symfile", "run-symfile", "", "finished", "link.txt", applyTestDiff)
	body := fmt.Sprintf(`{"file_path":"link.txt","hunk_index":0,"accepted":true,"workDir":%q}`, workDir)
	rec := doApplyRunDiff(h, "run-symfile", http.MethodPost, body)

	assertNotWrittenOutside(t, victim, applyTestOriginal)
	applyRejectedAssert(t, rec)
}

// TestPostApplyRunDiffRejectsDanglingSymlinkCreation covers the new-file branch:
// a dangling symlink makes os.ReadFile report IsNotExist, so
// createNewFileFromHunk creates the symlink's target — anywhere on the host.
func TestPostApplyRunDiffRejectsDanglingSymlinkCreation(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)

	outside := t.TempDir()
	created := filepath.Join(outside, "pwned.service") // must never appear
	if err := os.Symlink(created, filepath.Join(workDir, "ghost.txt")); err != nil {
		t.Fatalf("symlink ghost.txt: %v", err)
	}

	seedOwnedApplyRun(t, h.Store, "symdangling", "run-symdangling", "", "finished", "ghost.txt", applyTestDiff)
	body := fmt.Sprintf(`{"file_path":"ghost.txt","hunk_index":0,"accepted":true,"workDir":%q}`, workDir)
	rec := doApplyRunDiff(h, "run-symdangling", http.MethodPost, body)

	if _, err := os.Lstat(created); !os.IsNotExist(err) {
		t.Fatalf("ESCAPE: %s was created outside the workspace allowlist (stat err = %v)", created, err)
	}
	applyRejectedAssert(t, rec)
}

// TestPostApplyAllRunDiffsRejectsSymlinkEscape pins that the batch entry point
// shares the same containment as the single-hunk endpoint.
func TestPostApplyAllRunDiffsRejectsSymlinkEscape(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)

	outside := t.TempDir()
	vault := filepath.Join(outside, "vault")
	if err := os.MkdirAll(vault, 0o700); err != nil {
		t.Fatalf("mkdir vault: %v", err)
	}
	victim := filepath.Join(vault, "authorized_keys")
	if err := os.WriteFile(victim, []byte(applyTestOriginal), 0o600); err != nil {
		t.Fatalf("write victim: %v", err)
	}
	if err := os.Symlink(vault, filepath.Join(workDir, "docs")); err != nil {
		t.Fatalf("symlink docs: %v", err)
	}

	seedOwnedApplyRun(t, h.Store, "symall", "run-symall", "", "finished", "docs/authorized_keys", applyTestDiff)
	body := fmt.Sprintf(`{"decisions":[{"file_path":"docs/authorized_keys","hunk_index":0,"accepted":true}],"workDir":%q}`, workDir)
	rec := doApplyAllRunDiffs(h, "run-symall", http.MethodPost, body)

	assertNotWrittenOutside(t, victim, applyTestOriginal)
	applyRejectedAssert(t, rec)
}

// TestPostApplyRunDiffStillAppliesRegularNestedFile is the positive control for
// the containment check: an ordinary nested file inside the workdir still
// applies, and its backup stays inside the workdir.
func TestPostApplyRunDiffStillAppliesRegularNestedFile(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	nested := filepath.Join(workDir, "src", "pkg")
	if err := os.MkdirAll(nested, 0o750); err != nil {
		t.Fatalf("mkdir nested: %v", err)
	}
	target := filepath.Join(nested, "a.txt")
	if err := os.WriteFile(target, []byte(applyTestOriginal), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	seedOwnedApplyRun(t, h.Store, "nested", "run-nested", "", "finished", "src/pkg/a.txt", applyTestDiff)

	body := fmt.Sprintf(`{"file_path":"src/pkg/a.txt","hunk_index":0,"accepted":true,"workDir":%q}`, workDir)
	rec := doApplyRunDiff(h, "run-nested", http.MethodPost, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 for a regular nested file; body=%s", rec.Code, rec.Body.String())
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read target: %v", err)
	}
	if string(got) != applyTestModified {
		t.Errorf("nested file content = %q, want %q", got, applyTestModified)
	}
	if _, err := os.Lstat(target + ".bak"); err != nil {
		t.Errorf("backup missing inside workdir: %v", err)
	}
}

// TestPostApplyRunDiffStillCreatesMissingNestedFile is the positive control for
// the new-file branch: trailing path components that do not exist yet must stay
// creatable, otherwise the containment check would break "accept" on any added
// file in a new directory.
func TestPostApplyRunDiffStillCreatesMissingNestedFile(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	seedOwnedApplyRun(t, h.Store, "newnested", "run-newnested", "", "finished", "src/new/deep.txt", applyTestDiff)

	body := fmt.Sprintf(`{"file_path":"src/new/deep.txt","hunk_index":0,"accepted":true,"workDir":%q}`, workDir)
	rec := doApplyRunDiff(h, "run-newnested", http.MethodPost, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 when creating a new nested file; body=%s", rec.Code, rec.Body.String())
	}
	target := filepath.Join(workDir, "src", "new", "deep.txt")
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read created file: %v", err)
	}
	if string(got) != "line2-modified\n" {
		t.Errorf("created file content = %q", got)
	}
}

// ---------------------------------------------------------------------------
// P2-7 — apply-all amplification: decision cap, one diff snapshot, ctx cancel
// ---------------------------------------------------------------------------

// diffListCountingRepository counts ListRunDiffFiles calls so a batch's store
// amplification is observable.
type diffListCountingRepository struct {
	store.Repository
	listCalls int
}

func (r *diffListCountingRepository) ListRunDiffFiles(runID string) []store.RunDiffFile {
	r.listCalls++
	return r.Repository.ListRunDiffFiles(runID)
}

// decisionsBody builds an apply-all body with n reject decisions for one path.
func decisionsBody(n int, filePath, workDir string) string {
	var sb strings.Builder
	sb.WriteString(`{"decisions":[`)
	for i := 0; i < n; i++ {
		if i > 0 {
			sb.WriteByte(',')
		}
		fmt.Fprintf(&sb, `{"file_path":%q,"hunk_index":0,"accepted":false}`, filePath)
	}
	fmt.Fprintf(&sb, `],"workDir":%q}`, workDir)
	return sb.String()
}

// TestPostApplyAllRunDiffsRejectsTooManyDecisions pins the explicit batch cap:
// the 1 MiB body limit in decodeApplyJSON admits ~17k minimal decisions, and
// every decision used to cost a hunk parse plus a `files` array in the
// response, so one request could amplify without bound.
func TestPostApplyAllRunDiffsRejectsTooManyDecisions(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	seedOwnedApplyRun(t, h.Store, "cap", "run-cap", "", "finished", "a.txt", applyTestDiff)

	rec := doApplyAllRunDiffs(h, "run-cap", http.MethodPost, decisionsBody(maxApplyDecisions+1, "a.txt", workDir))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for %d decisions; body=%.200s", rec.Code, maxApplyDecisions+1, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), "bad_request")
	if !strings.Contains(rec.Body.String(), fmt.Sprint(maxApplyDecisions)) {
		t.Errorf("400 body does not state the cap (%d): %s", maxApplyDecisions, rec.Body.String())
	}
}

// TestPostApplyAllRunDiffsAcceptsDecisionCapBoundary guards the cap from being
// tightened below the documented limit: exactly maxApplyDecisions is served.
func TestPostApplyAllRunDiffsAcceptsDecisionCapBoundary(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	seedOwnedApplyRun(t, h.Store, "capedge", "run-capedge", "", "finished", "a.txt", applyTestDiff)

	rec := doApplyAllRunDiffs(h, "run-capedge", http.MethodPost, decisionsBody(maxApplyDecisions, "a.txt", workDir))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 at the cap boundary; body=%.200s", rec.Code, rec.Body.String())
	}
	data := decodeApplyEnvelope(t, rec)
	if applied, ok := data["applied"].(float64); !ok || int(applied) != maxApplyDecisions {
		t.Errorf("applied = %#v, want %d", data["applied"], maxApplyDecisions)
	}
}

// TestPostApplyAllRunDiffsReadsRunDiffFilesOnce pins the hoisted diff snapshot:
// applySingleHunk used to call ListRunDiffFiles twice per decision, so an
// N-decision batch materialised the run's full diff text 2N times.
func TestPostApplyAllRunDiffsReadsRunDiffFilesOnce(t *testing.T) {
	h := newTestHandler()
	counting := &diffListCountingRepository{Repository: h.Store}
	h.Store = counting
	workDir := allowTestWorkspace(t, h)
	seedOwnedApplyRun(t, h.Store, "scan", "run-scan", "", "finished", "a.txt", applyTestDiff)
	counting.listCalls = 0 // ignore seeding

	rec := doApplyAllRunDiffs(h, "run-scan", http.MethodPost, decisionsBody(3, "a.txt", workDir))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%.200s", rec.Code, rec.Body.String())
	}
	if counting.listCalls != 1 {
		t.Fatalf("ListRunDiffFiles calls for a 3-decision batch = %d, want 1", counting.listCalls)
	}
}

// TestPostApplyRunDiffReadsRunDiffFilesOnce is the single-hunk counterpart: one
// request, one snapshot.
func TestPostApplyRunDiffReadsRunDiffFilesOnce(t *testing.T) {
	h := newTestHandler()
	counting := &diffListCountingRepository{Repository: h.Store}
	h.Store = counting
	workDir := allowTestWorkspace(t, h)
	seedOwnedApplyRun(t, h.Store, "scan1", "run-scan1", "", "finished", "a.txt", applyTestDiff)
	counting.listCalls = 0

	rec := doApplyRunDiff(h, "run-scan1", http.MethodPost, fmt.Sprintf(`{"file_path":"a.txt","hunk_index":0,"accepted":false,"workDir":%q}`, workDir))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%.200s", rec.Code, rec.Body.String())
	}
	if counting.listCalls != 1 {
		t.Fatalf("ListRunDiffFiles calls for one apply = %d, want 1", counting.listCalls)
	}
}

// TestPostApplyAllRunDiffsStopsOnCanceledContext pins that the batch loop
// respects the request context. restTimeoutMiddleware wraps REST routes in
// http.TimeoutHandler with a 30s budget; when it fires (or the client
// disconnects) the context is canceled and the loop must stop instead of
// continuing to parse hunks and write files nobody will hear about.
func TestPostApplyAllRunDiffsStopsOnCanceledContext(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	target := filepath.Join(workDir, "a.txt")
	if err := os.WriteFile(target, []byte(applyTestOriginal), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	seedOwnedApplyRun(t, h.Store, "canceled", "run-canceled", "", "finished", "a.txt", applyTestDiff)

	body := fmt.Sprintf(`{"decisions":[{"file_path":"a.txt","hunk_index":0,"accepted":true},{"file_path":"a.txt","hunk_index":0,"accepted":true},{"file_path":"a.txt","hunk_index":0,"accepted":true}],"workDir":%q}`, workDir)
	req := httptest.NewRequest(http.MethodPost, "/v1/runs/run-canceled/apply-all", strings.NewReader(body))
	ctx, cancel := context.WithCancel(req.Context())
	cancel() // deadline already blown when the loop starts
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	h.PostApplyAllRunDiffs(rec, req, "run-canceled")

	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read target: %v", err)
	}
	if string(got) != applyTestOriginal {
		t.Fatalf("canceled request still wrote the workdir: %q", got)
	}
	// The batch is aborted mid-flight, so the handler must not report success.
	// It surfaces through the existing generic failure mapping (500
	// internal_error); on the real server http.TimeoutHandler has already
	// answered the client with 503 by then.
	if rec.Code == http.StatusOK {
		t.Fatalf("status = 200 for a canceled batch; body=%.200s", rec.Body.String())
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 for an aborted batch; body=%.200s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), "internal_error")
}

// ---------------------------------------------------------------------------
// P3-14 — file modes on the write path
// ---------------------------------------------------------------------------

// TestPostApplyRunDiffCreatesNewFileWith0600 checks the brief's premise for
// P3-14 ("a newly created file does not get 0600"). createNewFileFromHunk
// already writes with 0o600, so this passed before the slice landed: the
// observable defect is the `0` mode literal on the *overwrite* path, not on
// file creation.
func TestPostApplyRunDiffCreatesNewFileWith0600(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	seedOwnedApplyRun(t, h.Store, "modenew", "run-modenew", "", "finished", "fresh.txt", applyTestDiff)

	body := fmt.Sprintf(`{"file_path":"fresh.txt","hunk_index":0,"accepted":true,"workDir":%q}`, workDir)
	rec := doApplyRunDiff(h, "run-modenew", http.MethodPost, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%.200s", rec.Code, rec.Body.String())
	}
	info, err := os.Stat(filepath.Join(workDir, "fresh.txt"))
	if err != nil {
		t.Fatalf("stat created file: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("created file mode = %o, want 600", perm)
	}
}

// TestPostApplyRunDiffOverwriteKeepsExistingMode documents why the `0` mode
// literal on the overwrite path is latent rather than exploitable: os.WriteFile
// only applies its perm argument when it creates the file, so an existing
// file's mode survives the rewrite. The literal is still wrong — any future
// branch that reaches it with a missing file would create a 0000 file.
func TestPostApplyRunDiffOverwriteKeepsExistingMode(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	target := filepath.Join(workDir, "a.txt")
	if err := os.WriteFile(target, []byte(applyTestOriginal), 0o640); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	seedOwnedApplyRun(t, h.Store, "modekeep", "run-modekeep", "", "finished", "a.txt", applyTestDiff)

	rec := doApplyRunDiff(h, "run-modekeep", http.MethodPost, applyBodyWithWorkDir(workDir))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%.200s", rec.Code, rec.Body.String())
	}
	info, err := os.Stat(target)
	if err != nil {
		t.Fatalf("stat target: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o640 {
		t.Fatalf("overwritten file mode = %o, want the pre-existing 640", perm)
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read target: %v", err)
	}
	if string(got) != applyTestModified {
		t.Errorf("content = %q, want the hunk applied", got)
	}
}

// TestCreateBackupWritesBackupWith0600 pins the rollback copy's mode: backups
// can contain source or credentials, so they must not be world-readable.
func TestCreateBackupWritesBackupWith0600(t *testing.T) {
	h := newTestHandler()
	workDir := allowTestWorkspace(t, h)
	target := filepath.Join(workDir, "a.txt")
	if err := os.WriteFile(target, []byte(applyTestOriginal), 0o640); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	seedOwnedApplyRun(t, h.Store, "modebak", "run-modebak", "", "finished", "a.txt", applyTestDiff)

	rec := doApplyRunDiff(h, "run-modebak", http.MethodPost, applyBodyWithWorkDir(workDir))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%.200s", rec.Code, rec.Body.String())
	}
	info, err := os.Stat(target + ".bak")
	if err != nil {
		t.Fatalf("stat backup: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("backup mode = %o, want 600", perm)
	}
}

// TestCreateBackupAcceptsAliasWorkDirRoot reproduces on any platform the
// Windows failure CI caught (job "Native Windows Go (edge-server)"): the caller
// hands createBackup a workdir spelling that EvalSymlinks resolves to a
// different string — on the runner it was the 8.3 short name
// C:\Users\RUNNER~1\... vs the long name C:\Users\runneradmin\... Comparing a
// resolved path against an unresolved root rejected every legitimate backup, so
// both sides of the defense-in-depth containment check are resolved now.
func TestCreateBackupAcceptsAliasWorkDirRoot(t *testing.T) {
	realDir := t.TempDir()
	aliasParent := t.TempDir()
	alias := filepath.Join(aliasParent, "workdir-alias")
	if err := os.Symlink(realDir, alias); err != nil {
		t.Skipf("symlink creation unavailable in this environment: %v", err)
	}
	content := []byte("package main\n")
	target := filepath.Join(alias, "file.go") // spelled through the alias root
	if err := os.WriteFile(target, content, 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	if err := createBackup(alias, target, content); err != nil {
		t.Fatalf("createBackup with an aliased workdir root: %v", err)
	}
	if _, err := os.Lstat(filepath.Join(realDir, "file.go.bak")); err != nil {
		t.Fatalf("backup did not land inside the resolved workdir: %v", err)
	}
}
