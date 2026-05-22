package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/runners"
	"github.com/agenthub/edge-server/internal/store"
)

func newTestHandler() *Handler {
	return &Handler{
		Bus:      events.NewBus(1000),
		Registry: runners.NewRegistry(),
		Store:    store.New(),
	}
}

func TestGetHealth(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	rec := httptest.NewRecorder()

	h.GetHealth(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}

	if body["status"] != "ok" {
		t.Errorf("expected status=ok, got %v", body["status"])
	}
	if body["version"] != "v1" {
		t.Errorf("expected version=v1, got %v", body["version"])
	}
	if body["edgeId"] != "local" {
		t.Errorf("expected edgeId=local, got %v", body["edgeId"])
	}

	contentType := rec.Header().Get("Content-Type")
	if !strings.Contains(contentType, "application/json") {
		t.Errorf("expected JSON content-type, got %q", contentType)
	}
}

func TestGetRunners(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodGet, "/v1/runners", nil)
	rec := httptest.NewRecorder()

	h.GetRunners(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}

	items, ok := body["items"].([]any)
	if !ok {
		t.Fatalf("expected items array, got %T", body["items"])
	}
	if len(items) == 0 {
		t.Error("expected at least 1 runner (mock runner)")
	}

	page, ok := body["page"].(map[string]any)
	if !ok {
		t.Fatalf("expected page object, got %T", body["page"])
	}
	if hasMore, ok := page["hasMore"].(bool); !ok || hasMore {
		t.Errorf("expected hasMore=false, got %v", page["hasMore"])
	}
}

func TestGetRuns(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodGet, "/v1/runs", nil)
	rec := httptest.NewRecorder()

	h.GetRuns(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", rec.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}

	items, ok := body["items"].([]any)
	if !ok {
		t.Fatalf("expected items array, got %T", body["items"])
	}
	if len(items) != 0 {
		t.Errorf("expected empty items, got %d items", len(items))
	}
}

func TestProjectThreadRoutes(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/v1/projects", strings.NewReader(`{"projectId":"proj_test","name":"Test Project"}`))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /v1/projects status = %d, want 201", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/threads", strings.NewReader(`{"threadId":"thread_test","projectId":"proj_test","title":"Test Thread"}`))
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("POST /v1/threads status = %d, want 201", rec.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/v1/threads?projectId=proj_test", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/threads status = %d, want 200", rec.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	items := body["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("expected one thread, got %d", len(items))
	}
	thread := items[0].(map[string]any)
	if thread["threadId"] != "thread_test" || thread["projectId"] != "proj_test" {
		t.Fatalf("unexpected thread response: %#v", thread)
	}
}

func TestPostRuns(t *testing.T) {
	h := newTestHandler()

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", nil)
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d", rec.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}

	runID, ok := body["runId"].(string)
	if !ok || !strings.HasPrefix(runID, "run_") {
		t.Errorf("expected runId starting with run_, got %v", body["runId"])
	}
	if body["status"] != "queued" {
		t.Errorf("expected status=queued, got %v", body["status"])
	}
	if body["projectId"] != "proj_local" {
		t.Errorf("expected default projectId=proj_local, got %v", body["projectId"])
	}
	if body["threadId"] != "thread_local" {
		t.Errorf("expected default threadId=thread_local, got %v", body["threadId"])
	}
}

func TestPostRunsBindsProjectAndThread(t *testing.T) {
	h := newTestHandler()
	h.ensureDefaults()
	_, err := h.Store.CreateThread("thread_bound", "proj_local", "Bound Thread")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(`{"projectId":"proj_local","threadId":"thread_bound"}`))
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d", rec.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	if body["projectId"] != "proj_local" || body["threadId"] != "thread_bound" {
		t.Fatalf("run binding response = %#v, want proj_local/thread_bound", body)
	}

	runID := body["runId"].(string)
	run, ok := h.Store.GetRun(runID)
	if !ok {
		t.Fatalf("run %q was not stored", runID)
	}
	if run.ProjectID != "proj_local" || run.ThreadID != "thread_bound" {
		t.Fatalf("stored run = %#v, want proj_local/thread_bound", run)
	}
}

func TestPostRunsRejectsUnknownThreadBinding(t *testing.T) {
	h := newTestHandler()
	h.ensureDefaults()

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(`{"projectId":"proj_local","threadId":"thread_missing"}`))
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d", rec.Code)
	}
}

func TestGetRunAndThreadItemsAfterPostRun(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("POST /v1/runs status = %d, want 202", rec.Code)
	}
	var runBody map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&runBody); err != nil {
		t.Fatalf("failed to decode run body: %v", err)
	}
	runID := runBody["runId"].(string)

	req = httptest.NewRequest(http.MethodGet, "/v1/runs/"+runID, nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/runs/{id} status = %d, want 200", rec.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/v1/threads/thread_local/items", nil)
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/threads/thread_local/items status = %d, want 200", rec.Code)
	}
	var itemBody map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&itemBody); err != nil {
		t.Fatalf("failed to decode item body: %v", err)
	}
	items := itemBody["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("expected one run item, got %d", len(items))
	}
}

func TestPostRunsMethodNotAllowed(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodGet, "/v1/runs", nil)
	rec := httptest.NewRecorder()

	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/runs should return 200, got %d", rec.Code)
	}
}

func TestPostCancelRun(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodPost, "/v1/runs/run_test123:cancel", nil)
	rec := httptest.NewRecorder()

	h.PostCancelRun(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected status 202, got %d", rec.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}

	if body["runId"] != "run_test123" {
		t.Errorf("expected runId=run_test123, got %v", body["runId"])
	}
}

func TestErrorResponseFormat(t *testing.T) {
	errResp := errorResponse("TEST_ERROR", "something went wrong")
	data, _ := json.Marshal(errResp)

	var body map[string]any
	if err := json.Unmarshal(data, &body); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	errObj, ok := body["error"].(map[string]any)
	if !ok {
		t.Fatalf("expected error object, got %T", body["error"])
	}
	if errObj["code"] != "TEST_ERROR" {
		t.Errorf("expected code=TEST_ERROR, got %v", errObj["code"])
	}
	if errObj["message"] != "something went wrong" {
		t.Errorf("expected message, got %v", errObj["message"])
	}
}

func TestListResponseFormat(t *testing.T) {
	listResp := listResponse([]string{"a", "b"})
	data, _ := json.Marshal(listResp)

	var body map[string]any
	if err := json.Unmarshal(data, &body); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	items, ok := body["items"].([]any)
	if !ok || len(items) != 2 {
		t.Error("expected items array with 2 elements")
	}
}

func TestExtractRunID(t *testing.T) {
	tests := []struct {
		path     string
		suffix   string
		expected string
	}{
		{"/v1/runs/run_abc:cancel", ":cancel", "run_abc"},
		{"/v1/runs/run_xyz123:cancel", ":cancel", "run_xyz123"},
	}

	for _, tt := range tests {
		result := extractRunID(tt.path, tt.suffix)
		if result != tt.expected {
			t.Errorf("extractRunID(%q, %q) = %q, want %q", tt.path, tt.suffix, result, tt.expected)
		}
	}
}

// ── Route integration tests (through RegisterRoutes) ──

func TestMuxHealthRoute(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestMuxRunnersRoute(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/v1/runners", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestMuxPostRunsRoute(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", rec.Code)
	}
}

func TestMuxGetRunsRoute(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/v1/runs", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

func TestMuxCancelRunRoute(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/v1/runs/run_abc:cancel", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", rec.Code)
	}
}

func TestMuxCancelRunWrongMethod(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/v1/runs/run_abc:cancel", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestMuxUnknownPath(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/v1/nonexistent", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestMuxRunsSubPathUnknown(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	// /v1/runs/something (not a cancel action) should 404
	req := httptest.NewRequest(http.MethodGet, "/v1/runs/run_abc", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for unknown subpath, got %d", rec.Code)
	}
}

// ── WebSocket upgrade test ──

func TestWebSocketUpgrade(t *testing.T) {
	h := newTestHandler()

	req := httptest.NewRequest(http.MethodGet, "/v1/events", nil)
	req.Header.Set("Connection", "upgrade")
	req.Header.Set("Upgrade", "websocket")
	req.Header.Set("Sec-WebSocket-Version", "13")
	req.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")

	rec := httptest.NewRecorder()
	h.GetEvents(rec, req)

	// httptest doesn't support hijacking, so the upgrade will fail.
	// The handler calls upgrader.Upgrade which returns an error in test.
	// We just verify it doesn't panic and logs the error.
	if rec.Code != http.StatusOK {
		// Expected: upgrade fails in test server, handler returns early.
		// The 200 is because httptest doesn't switch protocols.
		t.Logf("WS upgrade in test returned %d (expected in httptest)", rec.Code)
	}
}

func TestWebSocketOriginPolicy(t *testing.T) {
	tests := []struct {
		name   string
		origin string
		want   bool
	}{
		{"no origin", "", true},
		{"desktop dev", "http://localhost:5199", true},
		{"tauri dev", "http://localhost:5173", true},
		{"loopback", "http://127.0.0.1:5199", true},
		{"untrusted remote", "https://example.com", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/v1/events", nil)
			if tt.origin != "" {
				req.Header.Set("Origin", tt.origin)
			}
			got := upgrader.CheckOrigin(req)
			if got != tt.want {
				t.Fatalf("CheckOrigin(%q) = %v, want %v", tt.origin, got, tt.want)
			}
		})
	}
}

// ── Error path tests ──

func TestGetHealthWrongMethod(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodPost, "/v1/health", nil)
	rec := httptest.NewRecorder()

	h.GetHealth(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", rec.Code)
	}

	var body map[string]any
	json.NewDecoder(rec.Body).Decode(&body)
	errObj := body["error"].(map[string]any)
	if errObj["code"] != "METHOD_NOT_ALLOWED" {
		t.Errorf("expected METHOD_NOT_ALLOWED, got %v", errObj["code"])
	}
}

func TestPostRunsWrongMethodDirect(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodGet, "/v1/runs", nil)
	rec := httptest.NewRecorder()

	h.PostRuns(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 for direct GET on PostRuns, got %d", rec.Code)
	}
}

func TestPostCancelRunWrongMethod(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodGet, "/v1/runs/run_x:cancel", nil)
	rec := httptest.NewRecorder()

	h.PostCancelRun(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", rec.Code)
	}
}

// ── Event bus integration ──

func TestPostRunsGeneratesEvents(t *testing.T) {
	h := newTestHandler()
	_, ch, _ := h.Bus.Subscribe(0)

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", nil)
	rec := httptest.NewRecorder()
	h.PostRuns(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", rec.Code)
	}

	// First event: run.queued (published synchronously in PostRuns)
	select {
	case evt := <-ch:
		if evt.Type != "run.queued" {
			t.Errorf("first event should be run.queued, got %s", evt.Type)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timed out waiting for run.queued event")
	}

	// Second event: run.started (after 100ms delay in mockRunFlow)
	select {
	case evt := <-ch:
		if evt.Type != "run.started" {
			t.Errorf("second event should be run.started, got %s", evt.Type)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("timed out waiting for run.started event")
	}
}

func TestAcceptedResponseFormat(t *testing.T) {
	data := acceptedResponse(map[string]any{"runId": "run_1", "status": "queued"})
	if data["runId"] != "run_1" {
		t.Errorf("runId = %v, want run_1", data["runId"])
	}
}
