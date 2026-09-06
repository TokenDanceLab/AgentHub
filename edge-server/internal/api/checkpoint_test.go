package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agenthub/edge-server/internal/store"
)

func seedCheckpointRun(t *testing.T, h *Handler) string {
	t.Helper()
	repo := h.Store
	if _, err := repo.CreateProject("proj-ck", "Checkpoint", ""); err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	if _, err := repo.CreateThread("thread-ck", "proj-ck", "Checkpoint", "", "", ""); err != nil {
		t.Fatalf("CreateThread: %v", err)
	}
	if _, err := repo.CreateRun("run-ck", "proj-ck", "thread-ck"); err != nil {
		t.Fatalf("CreateRun: %v", err)
	}
	_, err := repo.UpsertRunCheckpoint(store.RunCheckpoint{
		ID:      "cp-run-ck",
		RunID:   "run-ck",
		WorkDir: "/tmp/ws-ck",
		Files: []store.CheckpointFile{
			{Path: "src/a.ts", Size: 12, Hash: "h-a", Content: "export {}"},
			{Path: "bin/blob", Size: 3, Hash: "h-b"},
		},
	})
	if err != nil {
		t.Fatalf("UpsertRunCheckpoint: %v", err)
	}
	return "run-ck"
}

func TestGetRunCheckpointMetadata(t *testing.T) {
	h := newTestHandler()
	runID := seedCheckpointRun(t, h)

	req := httptest.NewRequest(http.MethodGet, "/v1/runs/"+runID+"/checkpoint", nil)
	rec := httptest.NewRecorder()
	h.GetRunCheckpoint(rec, req, runID)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var envelope struct {
		Data struct {
			RunID        string           `json:"runId"`
			CheckpointID string           `json:"checkpointId"`
			WorkDir      string           `json:"workDir"`
			FileCount    int              `json:"fileCount"`
			Files        []map[string]any `json:"files"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	data := envelope.Data
	if data.CheckpointID != "cp-run-ck" || data.WorkDir != "/tmp/ws-ck" {
		t.Fatalf("metadata = %#v", data)
	}
	if len(data.Files) != 2 {
		t.Fatalf("files = %#v", data.Files)
	}
	// Inventory must not leak file contents — contents live on the file route.
	for _, f := range data.Files {
		if _, hasContent := f["content"]; hasContent {
			t.Fatalf("metadata leaked content: %#v", f)
		}
	}
	if data.Files[0]["hasText"] != true || data.Files[1]["hasText"] != false {
		t.Fatalf("hasText flags = %#v", data.Files)
	}
}

func TestGetRunCheckpointHonestAbsence(t *testing.T) {
	h := newTestHandler()
	repo := h.Store
	repo.CreateProject("proj-no", "No Checkpoint", "")
	repo.CreateThread("thread-no", "proj-no", "No", "", "", "")
	repo.CreateRun("run-no", "proj-no", "thread-no")

	req := httptest.NewRequest(http.MethodGet, "/v1/runs/run-no/checkpoint", nil)
	rec := httptest.NewRecorder()
	h.GetRunCheckpoint(rec, req, "run-no")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 for runs without checkpoint", rec.Code)
	}
}

func TestGetRunCheckpointFile(t *testing.T) {
	h := newTestHandler()
	runID := seedCheckpointRun(t, h)

	// Known text file returns its pre-run content.
	req := httptest.NewRequest(http.MethodGet, "/v1/runs/"+runID+"/checkpoint/file?path=src/a.ts", nil)
	rec := httptest.NewRecorder()
	h.GetRunCheckpointFile(rec, req, runID)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rec.Code, rec.Body.String())
	}
	var envelope struct {
		Data struct {
			Path    string `json:"path"`
			Content string `json:"content"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if envelope.Data.Path != "src/a.ts" || envelope.Data.Content != "export {}" {
		t.Fatalf("file payload = %#v", envelope.Data)
	}

	// Path outside the checkpoint set is rejected (no traversal surface).
	req = httptest.NewRequest(http.MethodGet, "/v1/runs/"+runID+"/checkpoint/file?path=../etc/passwd", nil)
	rec = httptest.NewRecorder()
	h.GetRunCheckpointFile(rec, req, runID)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("traversal path status = %d, want 404", rec.Code)
	}

	// Missing path parameter is a bad request.
	req = httptest.NewRequest(http.MethodGet, "/v1/runs/"+runID+"/checkpoint/file", nil)
	rec = httptest.NewRecorder()
	h.GetRunCheckpointFile(rec, req, runID)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing path status = %d, want 400", rec.Code)
	}

	// Method guard.
	req = httptest.NewRequest(http.MethodPost, "/v1/runs/"+runID+"/checkpoint", nil)
	rec = httptest.NewRecorder()
	h.GetRunCheckpoint(rec, req, runID)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST status = %d, want 405", rec.Code)
	}
}

func TestCheckpointPreviewRetainsSavedEvidence(t *testing.T) {
	for _, access := range []string{"input", "result"} {
		t.Run(access, func(t *testing.T) {
			h := newTestHandler()
			runID := seedCheckpointRun(t, h)
			input, ok := h.Store.GetRunCheckpoint(runID)
			if !ok {
				t.Fatal("seeded checkpoint missing")
			}
			// Replace the checkpoint, then reuse the writer-owned file list.
			saved, err := h.Store.UpsertRunCheckpoint(input)
			if err != nil {
				t.Fatal(err)
			}
			view := input
			if access == "result" {
				view = saved
			}
			view.Files[0].Content = "changed after save"
			view.Files[0].Hash = "changed-hash"

			req := httptest.NewRequest(http.MethodGet, "/v1/runs/"+runID+"/checkpoint/file?path=src/a.ts", nil)
			rec := httptest.NewRecorder()
			h.GetRunCheckpointFile(rec, req, runID)
			if rec.Code != http.StatusOK {
				t.Fatalf("preview status = %d, body=%s", rec.Code, rec.Body.String())
			}
			var envelope struct {
				Data struct {
					Path, Hash, Content string
					SizeBytes           int
				}
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
				t.Fatalf("decode preview: %v", err)
			}
			data := envelope.Data
			if data.Path != "src/a.ts" || data.Content != "export {}" || data.Hash != "h-a" || data.SizeBytes != 12 {
				t.Fatalf("caller %s changed saved preview evidence: %#v", access, data)
			}
		})
	}
}
