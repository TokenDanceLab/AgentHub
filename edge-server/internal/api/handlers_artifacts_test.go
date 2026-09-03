package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/agenthub/edge-server/internal/store"
)

func TestArtifactPreviewMetadataLookupRoutes(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	h.ensureDefaults()
	if _, err := h.Store.CreateRun("run_evidence", "proj_local", "thread_local"); err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}
	artifact, err := h.Store.UpsertArtifact(store.Artifact{
		ID:        "artifact_readonly",
		RunID:     "run_evidence",
		Kind:      "patch",
		Path:      "changes.diff",
		SizeBytes: 42,
	})
	if err != nil {
		t.Fatalf("UpsertArtifact returned error: %v", err)
	}
	preview, err := h.Store.UpsertPreview(store.Preview{
		ID:     "preview_readonly",
		RunID:  "run_evidence",
		URL:    "http://127.0.0.1:4173",
		Status: "ready",
	})
	if err != nil {
		t.Fatalf("UpsertPreview returned error: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/artifacts?runId=run_evidence", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/artifacts status = %d, want 200 body=%s", rec.Code, rec.Body.String())
	}
	var listBody map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&listBody); err != nil {
		t.Fatalf("failed to decode artifact list: %v", err)
	}
	listBody = unwrapSuccess(listBody)
	items, ok := listBody["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("artifact list items = %#v, want one item", listBody["items"])
	}

	req = httptest.NewRequest(http.MethodGet, "/v1/artifacts/artifact_readonly", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET artifact metadata status = %d, want 200 body=%s", rec.Code, rec.Body.String())
	}
	var artifactBody map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&artifactBody); err != nil {
		t.Fatalf("failed to decode artifact body: %v", err)
	}
	artifactBody = unwrapSuccess(artifactBody)
	if artifactBody["id"] != artifact.ID || artifactBody["runId"] != "run_evidence" || artifactBody["threadId"] != "thread_local" {
		t.Fatalf("artifact body = %#v, want stored metadata", artifactBody)
	}

	req = httptest.NewRequest(http.MethodGet, "/v1/previews/preview_readonly", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET preview metadata status = %d, want 200 body=%s", rec.Code, rec.Body.String())
	}
	var previewBody map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&previewBody); err != nil {
		t.Fatalf("failed to decode preview body: %v", err)
	}
	previewBody = unwrapSuccess(previewBody)
	if previewBody["id"] != preview.ID || previewBody["runId"] != "run_evidence" || previewBody["url"] != "http://127.0.0.1:4173" {
		t.Fatalf("preview body = %#v, want stored metadata", previewBody)
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/previews/preview_readonly:stop", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("POST preview stop status = %d, want 202 body=%s", rec.Code, rec.Body.String())
	}
	var stoppedBody map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&stoppedBody); err != nil {
		t.Fatalf("failed to decode stopped preview body: %v", err)
	}
	stoppedBody = unwrapSuccess(stoppedBody)
	if stoppedBody["id"] != preview.ID || stoppedBody["status"] != "stopped" {
		t.Fatalf("stopped preview body = %#v, want stopped metadata", stoppedBody)
	}
	if _, hasURL := stoppedBody["url"]; hasURL {
		t.Fatalf("stopped preview url = %#v, want omitted url", stoppedBody["url"])
	}
	storedPreview, ok := h.Store.GetPreview(preview.ID)
	if !ok || storedPreview.Status != "stopped" || storedPreview.URL != "" || storedPreview.CreatedAt != preview.CreatedAt || storedPreview.UpdatedAt == "" {
		t.Fatalf("stored stopped preview = %#v, want stopped transition with preserved createdAt", storedPreview)
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/previews/missing:stop", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("POST missing preview stop status = %d, want 404 body=%s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/v1/artifacts/missing", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("GET missing artifact status = %d, want 404 body=%s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/v1/artifacts/artifact_readonly/content", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("GET artifact content status = %d, want 404 while content route remains planned body=%s", rec.Code, rec.Body.String())
	}
}

func TestPostPreviewsStartsFakePreviewMetadata(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	h.ensureDefaults()
	if _, err := h.Store.CreateRun("run_preview_start", "proj_local", "thread_local"); err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/previews", strings.NewReader(`{
		"previewId": "preview_fake_start",
		"runId": "run_preview_start"
	}`))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("POST /v1/previews status = %d, want 202 body=%s", rec.Code, rec.Body.String())
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode preview body: %v", err)
	}
	body = unwrapSuccess(body)
	if body["id"] != "preview_fake_start" || body["runId"] != "run_preview_start" || body["threadId"] != "thread_local" || body["status"] != "starting" {
		t.Fatalf("preview start body = %#v, want starting metadata", body)
	}
	if _, hasURL := body["url"]; hasURL {
		t.Fatalf("starting preview url = %#v, want omitted url", body["url"])
	}
	stored, ok := h.Store.GetPreview("preview_fake_start")
	if !ok || stored.Status != "starting" || stored.URL != "" || stored.RunID != "run_preview_start" || stored.ThreadID != "thread_local" {
		t.Fatalf("stored preview = %#v ok=%v, want starting metadata", stored, ok)
	}
}

func TestPostPreviewsRejectsMissingRun(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/v1/previews", strings.NewReader(`{"previewId":"preview_missing","runId":"run_missing"}`))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("POST /v1/previews missing run status = %d, want 404 body=%s", rec.Code, rec.Body.String())
	}
}

func TestArtifactDiffPreviewReadOnlyRoutesReturnEmptySnapshots(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	h.ensureDefaults()
	if _, err := h.Store.CreateRun("run_evidence", "proj_local", "thread_local"); err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/runs/run_evidence/diff", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET run diff status = %d, want 200 body=%s", rec.Code, rec.Body.String())
	}
	var diffBody map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&diffBody); err != nil {
		t.Fatalf("decode diff body: %v", err)
	}
	diffBody = unwrapSuccess(diffBody)
	if diffBody["runId"] != "run_evidence" {
		t.Fatalf("diff runId = %#v, want run_evidence", diffBody["runId"])
	}
	files, ok := diffBody["files"].([]any)
	if !ok || len(files) != 0 {
		t.Fatalf("diff files = %#v, want empty array", diffBody["files"])
	}

	for _, path := range []string{"/v1/artifacts", "/v1/previews"} {
		req = httptest.NewRequest(http.MethodGet, path, nil)
		rec = httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s status = %d, want 200 body=%s", path, rec.Code, rec.Body.String())
		}
		var listBody map[string]any
		if err := json.NewDecoder(rec.Body).Decode(&listBody); err != nil {
			t.Fatalf("decode %s body: %v", path, err)
		}
		listBody = unwrapSuccess(listBody)
		items, ok := listBody["items"].([]any)
		if !ok || len(items) != 0 {
			t.Fatalf("%s items = %#v, want empty array", path, listBody["items"])
		}
		page, ok := listBody["page"].(map[string]any)
		if !ok || page["hasMore"] != false {
			t.Fatalf("%s page = %#v, want hasMore=false", path, listBody["page"])
		}
	}
}
