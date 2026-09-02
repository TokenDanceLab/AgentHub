package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/agenthub/edge-server/internal/store"
)

// TestPatchSettingsRejectsOversizedBody pins the shared 1MB body limit on
// PATCH /v1/settings (#2154 security scan): a body beyond the limit is
// truncated and rejected instead of decoded into memory.
func TestPatchSettingsRejectsOversizedBody(t *testing.T) {
	h := newTestHandler()
	big := strings.Repeat("x", 1<<20+1024)
	body := `{"key":"` + big + `"}`
	req := httptest.NewRequest(http.MethodPatch, "/v1/settings", strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.PatchSettings(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for oversized body", rec.Code)
	}
}

// TestPostPreviewFailsClosedWithoutHubIdentity pins the preview ownership
// gate: under multi-user mode a request without a Hub identity must not be
// able to start a preview for any run.
func TestPostPreviewFailsClosedWithoutHubIdentity(t *testing.T) {
	h := newTestHandler()
	h.HubJWTSecret = "test-secret" // multi-user mode
	seedDeployRun(t, h.Store, "run-preview")
	req := httptest.NewRequest(http.MethodPost, "/v1/previews", strings.NewReader(`{"runId":"run-preview"}`))
	rec := httptest.NewRecorder()
	h.PostPreview(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (no Hub identity must not start previews); body=%s", rec.Code, rec.Body.String())
	}
}

// TestPostPreviewStopFailsClosedWithoutHubIdentity is the stop-side gate.
func TestPostPreviewStopFailsClosedWithoutHubIdentity(t *testing.T) {
	h := newTestHandler()
	h.HubJWTSecret = "test-secret" // multi-user mode
	seedDeployRun(t, h.Store, "run-stop")
	if _, err := h.Store.UpsertPreview(store.Preview{
		ID:     "preview-stop",
		RunID:  "run-stop",
		Status: "ready",
	}); err != nil {
		t.Fatalf("UpsertPreview: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/previews/preview-stop/stop", nil)
	rec := httptest.NewRecorder()
	h.PostPreviewStop(rec, req, "preview-stop")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (no Hub identity must not stop previews); body=%s", rec.Code, rec.Body.String())
	}
}
