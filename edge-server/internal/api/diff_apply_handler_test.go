package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/agenthub/edge-server/internal/store"
)

// applyTestDiff replaces line2 with line2-modified in a three-line file.
const applyTestDiff = "@@ -1,3 +1,3 @@\n line1\n-line2\n+line2-modified\n line3\n"

const applyTestOriginal = "line1\nline2\nline3\n"
const applyTestModified = "line1\nline2-modified\nline3\n"

// seedApplyRun creates project/thread/run and moves the run to status.
// status "queued" keeps the initial state. A non-empty diffPath adds a diff
// file for that path.
func seedApplyRun(t *testing.T, repo store.Repository, runID, status, diffPath, diff string) {
	t.Helper()
	if _, err := repo.CreateProject("proj-apply", "Apply", ""); err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	if _, err := repo.CreateThread("thread-apply", "proj-apply", "Apply", "", "", ""); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if _, err := repo.CreateRun(runID, "proj-apply", "thread-apply"); err != nil {
		t.Fatalf("CreateRun: %v", err)
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
			t.Fatalf("UpsertRunDiffFile: %v", err)
		}
	}
}

func doApplyRunDiff(h *Handler, runID, method, body string) *httptest.ResponseRecorder {
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, "/v1/runs/"+runID+"/apply", reader)
	rec := httptest.NewRecorder()
	h.PostApplyRunDiff(rec, req, runID)
	return rec
}

func doApplyAllRunDiffs(h *Handler, runID, method, body string) *httptest.ResponseRecorder {
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, "/v1/runs/"+runID+"/apply-all", reader)
	rec := httptest.NewRecorder()
	h.PostApplyAllRunDiffs(rec, req, runID)
	return rec
}

// decodeApplyEnvelope extracts the inner data map of the success envelope.
func decodeApplyEnvelope(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var decoded map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &decoded); err != nil {
		t.Fatalf("decode body %q: %v", rec.Body.String(), err)
	}
	return unwrapSuccess(decoded)
}

// ---------------------------------------------------------------------------
// PostApplyRunDiff behavior tests (quad-scan Q8, #2056)
// ---------------------------------------------------------------------------

func TestPostApplyRunDiffRejectsNonPostMethod(t *testing.T) {
	h := newTestHandler()
	rec := doApplyRunDiff(h, "run-x", http.MethodGet, "")
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), "method_not_allowed")
}

func TestPostApplyRunDiffRunNotFound(t *testing.T) {
	h := newTestHandler()
	rec := doApplyRunDiff(h, "run-missing", http.MethodPost, `{"file_path":"a.txt","hunk_index":0,"accepted":false}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), "not_found")
}

func TestPostApplyRunDiffRejectsUnfinishedRun(t *testing.T) {
	// Only status "finished" is accepted; other terminal states are rejected
	// too, so queued and failed both must fail closed.
	for _, status := range []string{"queued", "failed"} {
		t.Run(status, func(t *testing.T) {
			h := newTestHandler()
			seedApplyRun(t, h.Store, "run-apply", status, "a.txt", applyTestDiff)
			rec := doApplyRunDiff(h, "run-apply", http.MethodPost, `{"file_path":"a.txt","hunk_index":0,"accepted":false}`)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
			}
			assertErrorCode(t, rec.Body.String(), "bad_request")
		})
	}
}

func TestPostApplyRunDiffRejectsInvalidJSON(t *testing.T) {
	h := newTestHandler()
	seedApplyRun(t, h.Store, "run-apply", "finished", "a.txt", applyTestDiff)
	for name, body := range map[string]string{
		"malformed": `{"file_path":`,
		// decodeApplyJSON requires a body; http.NoBody is rejected as well.
		"missing body": "",
	} {
		t.Run(name, func(t *testing.T) {
			rec := doApplyRunDiff(h, "run-apply", http.MethodPost, body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
			}
			assertErrorCode(t, rec.Body.String(), "invalid_json")
		})
	}
}

func TestPostApplyRunDiffRequiresFilePath(t *testing.T) {
	h := newTestHandler()
	seedApplyRun(t, h.Store, "run-apply", "finished", "a.txt", applyTestDiff)
	rec := doApplyRunDiff(h, "run-apply", http.MethodPost, `{"hunk_index":0,"accepted":false}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), "bad_request")
}

func TestPostApplyRunDiffRejectsDisallowedWorkDir(t *testing.T) {
	t.Run("empty allowlist fails closed", func(t *testing.T) {
		h := newTestHandler() // no WorkspaceAllowlist configured
		seedApplyRun(t, h.Store, "run-apply", "finished", "a.txt", applyTestDiff)
		body := fmt.Sprintf(`{"file_path":"a.txt","hunk_index":0,"accepted":false,"workDir":%q}`, t.TempDir())
		rec := doApplyRunDiff(h, "run-apply", http.MethodPost, body)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want 403; body=%s", rec.Code, rec.Body.String())
		}
		assertErrorCode(t, rec.Body.String(), "workspace_not_allowed")
	})
	t.Run("outside allowlist", func(t *testing.T) {
		h := newTestHandler()
		h.WorkspaceAllowlist = []string{t.TempDir()} // a different root
		seedApplyRun(t, h.Store, "run-apply", "finished", "a.txt", applyTestDiff)
		body := fmt.Sprintf(`{"file_path":"a.txt","hunk_index":0,"accepted":false,"workDir":%q}`, t.TempDir())
		rec := doApplyRunDiff(h, "run-apply", http.MethodPost, body)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want 403; body=%s", rec.Code, rec.Body.String())
		}
		assertErrorCode(t, rec.Body.String(), "workspace_not_allowed")
	})
}

func TestPostApplyRunDiffAcceptAppliesHunkAndBacksUp(t *testing.T) {
	workDir := t.TempDir()
	target := filepath.Join(workDir, "a.txt")
	if err := os.WriteFile(target, []byte(applyTestOriginal), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	h := newTestHandler()
	h.WorkspaceAllowlist = []string{workDir}
	seedApplyRun(t, h.Store, "run-apply", "finished", "a.txt", applyTestDiff)

	body := fmt.Sprintf(`{"file_path":"a.txt","hunk_index":0,"accepted":true,"workDir":%q}`, workDir)
	rec := doApplyRunDiff(h, "run-apply", http.MethodPost, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	data := decodeApplyEnvelope(t, rec)
	if data["runId"] != "run-apply" || data["filePath"] != "a.txt" {
		t.Errorf("echo fields = %#v", data)
	}
	if idx, ok := data["hunkIndex"].(float64); !ok || idx != 0 {
		t.Errorf("hunkIndex = %#v, want 0", data["hunkIndex"])
	}
	if data["accepted"] != true || data["applied"] != true {
		t.Errorf("accepted/applied = %#v/%#v, want true/true", data["accepted"], data["applied"])
	}
	files, ok := data["files"].([]any)
	if !ok || len(files) != 1 {
		t.Fatalf("files = %#v, want the single seeded diff file", data["files"])
	}

	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read applied file: %v", err)
	}
	if string(got) != applyTestModified {
		t.Errorf("file content = %q, want %q", got, applyTestModified)
	}
	backup, err := os.ReadFile(target + ".bak")
	if err != nil {
		t.Fatalf("backup missing: %v", err)
	}
	if string(backup) != applyTestOriginal {
		t.Errorf("backup content = %q, want original content", backup)
	}
}

func TestPostApplyRunDiffRejectLeavesFileUntouched(t *testing.T) {
	workDir := t.TempDir()
	target := filepath.Join(workDir, "a.txt")
	if err := os.WriteFile(target, []byte(applyTestOriginal), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	h := newTestHandler()
	h.WorkspaceAllowlist = []string{workDir}
	seedApplyRun(t, h.Store, "run-apply", "finished", "a.txt", applyTestDiff)

	// Rejected hunks must not touch the filesystem (workDir may stay empty).
	rec := doApplyRunDiff(h, "run-apply", http.MethodPost, `{"file_path":"a.txt","hunk_index":0,"accepted":false}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	data := decodeApplyEnvelope(t, rec)
	if data["accepted"] != false || data["applied"] != false {
		t.Errorf("accepted/applied = %#v/%#v, want false/false", data["accepted"], data["applied"])
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatalf("read file: %v", err)
	}
	if string(got) != applyTestOriginal {
		t.Errorf("file content changed on reject: %q", got)
	}
	if _, err := os.Stat(target + ".bak"); !os.IsNotExist(err) {
		t.Errorf("reject must not create a backup (stat err = %v)", err)
	}
}

func TestPostApplyRunDiffPropagatesApplyErrors(t *testing.T) {
	h := newTestHandler()
	seedApplyRun(t, h.Store, "run-apply", "finished", "a.txt", applyTestDiff)
	for name, body := range map[string]string{
		"unknown file":            `{"file_path":"ghost.txt","hunk_index":0,"accepted":false}`,
		"hunk index out of range": `{"file_path":"a.txt","hunk_index":9,"accepted":false}`,
		// accepted=true with empty workDir passes the allowlist check but
		// fails at the filesystem step; the handler maps it to 500.
		"accept without workdir": `{"file_path":"a.txt","hunk_index":0,"accepted":true}`,
	} {
		t.Run(name, func(t *testing.T) {
			rec := doApplyRunDiff(h, "run-apply", http.MethodPost, body)
			if rec.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
			}
			assertErrorCode(t, rec.Body.String(), "internal_error")
		})
	}
}

// ---------------------------------------------------------------------------
// PostApplyAllRunDiffs behavior tests (quad-scan Q8, #2056)
// ---------------------------------------------------------------------------

func TestPostApplyAllRunDiffsRejectsNonPostMethod(t *testing.T) {
	h := newTestHandler()
	rec := doApplyAllRunDiffs(h, "run-x", http.MethodGet, "")
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), "method_not_allowed")
}

func TestPostApplyAllRunDiffsRunNotFound(t *testing.T) {
	h := newTestHandler()
	rec := doApplyAllRunDiffs(h, "run-missing", http.MethodPost, `{"decisions":[{"file_path":"a.txt","hunk_index":0,"accepted":false}]}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), "not_found")
}

func TestPostApplyAllRunDiffsRejectsUnfinishedRun(t *testing.T) {
	h := newTestHandler()
	seedApplyRun(t, h.Store, "run-apply", "queued", "a.txt", applyTestDiff)
	rec := doApplyAllRunDiffs(h, "run-apply", http.MethodPost, `{"decisions":[{"file_path":"a.txt","hunk_index":0,"accepted":false}]}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), "bad_request")
}

func TestPostApplyAllRunDiffsRejectsInvalidJSON(t *testing.T) {
	h := newTestHandler()
	seedApplyRun(t, h.Store, "run-apply", "finished", "a.txt", applyTestDiff)
	for name, body := range map[string]string{
		"malformed":    `{"decisions":[`,
		"missing body": "",
	} {
		t.Run(name, func(t *testing.T) {
			rec := doApplyAllRunDiffs(h, "run-apply", http.MethodPost, body)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
			}
			assertErrorCode(t, rec.Body.String(), "invalid_json")
		})
	}
}

func TestPostApplyAllRunDiffsRequiresDecisions(t *testing.T) {
	h := newTestHandler()
	seedApplyRun(t, h.Store, "run-apply", "finished", "a.txt", applyTestDiff)
	rec := doApplyAllRunDiffs(h, "run-apply", http.MethodPost, `{"decisions":[]}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), "bad_request")
}

func TestPostApplyAllRunDiffsRequiresFilePathPerDecision(t *testing.T) {
	h := newTestHandler()
	seedApplyRun(t, h.Store, "run-apply", "finished", "a.txt", applyTestDiff)
	rec := doApplyAllRunDiffs(h, "run-apply", http.MethodPost, `{"decisions":[{"hunk_index":0,"accepted":false}]}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), "bad_request")
}

func TestPostApplyAllRunDiffsRejectsDisallowedWorkDir(t *testing.T) {
	h := newTestHandler()
	h.WorkspaceAllowlist = []string{t.TempDir()} // a different root
	seedApplyRun(t, h.Store, "run-apply", "finished", "a.txt", applyTestDiff)
	body := fmt.Sprintf(`{"decisions":[{"file_path":"a.txt","hunk_index":0,"accepted":false}],"workDir":%q}`, t.TempDir())
	rec := doApplyAllRunDiffs(h, "run-apply", http.MethodPost, body)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), "workspace_not_allowed")
}

func TestPostApplyAllRunDiffsAppliesMixedDecisions(t *testing.T) {
	workDir := t.TempDir()
	fileA := filepath.Join(workDir, "a.txt")
	fileB := filepath.Join(workDir, "b.txt")
	for _, p := range []string{fileA, fileB} {
		if err := os.WriteFile(p, []byte(applyTestOriginal), 0o600); err != nil {
			t.Fatalf("write fixture: %v", err)
		}
	}
	h := newTestHandler()
	h.WorkspaceAllowlist = []string{workDir}
	seedApplyRun(t, h.Store, "run-apply", "finished", "a.txt", applyTestDiff)
	if _, err := h.Store.UpsertRunDiffFile(store.RunDiffFile{
		RunID:  "run-apply",
		Path:   "b.txt",
		Diff:   applyTestDiff,
		Status: "pending",
	}); err != nil {
		t.Fatalf("UpsertRunDiffFile(b.txt): %v", err)
	}

	body := fmt.Sprintf(`{"decisions":[{"file_path":"a.txt","hunk_index":0,"accepted":true},{"file_path":"b.txt","hunk_index":0,"accepted":false}],"workDir":%q}`, workDir)
	rec := doApplyAllRunDiffs(h, "run-apply", http.MethodPost, body)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	data := decodeApplyEnvelope(t, rec)
	if data["runId"] != "run-apply" {
		t.Errorf("runId = %#v", data["runId"])
	}
	if applied, ok := data["applied"].(float64); !ok || applied != 2 {
		t.Errorf("applied = %#v, want 2", data["applied"])
	}
	results, ok := data["results"].([]any)
	if !ok || len(results) != 2 {
		t.Fatalf("results = %#v, want 2 entries", data["results"])
	}
	first, _ := results[0].(map[string]any)
	second, _ := results[1].(map[string]any)
	if first["accepted"] != true || second["accepted"] != false {
		t.Errorf("results accepted flags = %#v/%#v, want true/false", first["accepted"], second["accepted"])
	}

	gotA, err := os.ReadFile(fileA)
	if err != nil {
		t.Fatalf("read a.txt: %v", err)
	}
	if string(gotA) != applyTestModified {
		t.Errorf("a.txt content = %q, want accepted hunk applied", gotA)
	}
	gotB, err := os.ReadFile(fileB)
	if err != nil {
		t.Fatalf("read b.txt: %v", err)
	}
	if string(gotB) != applyTestOriginal {
		t.Errorf("b.txt content changed on reject: %q", gotB)
	}
}

func TestPostApplyAllRunDiffsAbortsOnError(t *testing.T) {
	workDir := t.TempDir()
	fileA := filepath.Join(workDir, "a.txt")
	if err := os.WriteFile(fileA, []byte(applyTestOriginal), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	h := newTestHandler()
	h.WorkspaceAllowlist = []string{workDir}
	seedApplyRun(t, h.Store, "run-apply", "finished", "a.txt", applyTestDiff)

	// The first decision applies, the second targets an unknown diff file and
	// aborts the batch with 500. Batch apply is intentionally non-transactional:
	// the first decision's filesystem change remains visible.
	body := fmt.Sprintf(`{"decisions":[{"file_path":"a.txt","hunk_index":0,"accepted":true},{"file_path":"ghost.txt","hunk_index":0,"accepted":false}],"workDir":%q}`, workDir)
	rec := doApplyAllRunDiffs(h, "run-apply", http.MethodPost, body)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body.String(), "internal_error")

	gotA, err := os.ReadFile(fileA)
	if err != nil {
		t.Fatalf("read a.txt: %v", err)
	}
	if string(gotA) != applyTestModified {
		t.Errorf("a.txt content = %q, want first decision applied before abort", gotA)
	}
}
