package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/agenthub/edge-server/internal/runners"
	"github.com/agenthub/edge-server/internal/store"
)

// failingSettingsRepository forces UpsertSettings persist failures while
// delegating everything else to a real in-memory store.
type failingSettingsRepository struct {
	store.Repository
}

func (r *failingSettingsRepository) UpsertSettings(patch map[string]string) (store.UserSettings, error) {
	return store.UserSettings{}, errors.New("forced settings persist failure")
}

func TestPatchSettingsSuccess(t *testing.T) {
	h := newTestHandler()

	req := httptest.NewRequest(http.MethodPatch, "/v1/settings", strings.NewReader(`{"theme":"dark"}`))
	rec := httptest.NewRecorder()
	h.PatchSettings(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("PatchSettings status = %d, want 200; body = %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"theme"`) {
		t.Fatalf("PatchSettings body missing patched key: %s", rec.Body.String())
	}
}

// TestPatchSettingsPersistFailureReturns500 pins the honest error path: a
// settings write whose persistence failed must not be answered with 200 OK.
func TestPatchSettingsPersistFailureReturns500(t *testing.T) {
	h := newTestHandler()
	h.Store = &failingSettingsRepository{Repository: store.New()}

	req := httptest.NewRequest(http.MethodPatch, "/v1/settings", strings.NewReader(`{"theme":"dark"}`))
	rec := httptest.NewRecorder()
	h.PatchSettings(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("PatchSettings status = %d, want 500; body = %s", rec.Code, rec.Body.String())
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
	body = unwrapSuccess(body)

	if body["status"] != "ok" {
		t.Errorf("expected status=ok, got %v", body["status"])
	}
	if body["version"] != "v1" {
		t.Errorf("expected version=v1, got %v", body["version"])
	}
	if body["edgeId"] != "local" {
		t.Errorf("expected edgeId=local, got %v", body["edgeId"])
	}
	checks, ok := body["checks"].(map[string]any)
	if !ok {
		t.Fatalf("checks = %T, want object", body["checks"])
	}
	runnerCheck, ok := checks["runners"].(map[string]any)
	if !ok {
		t.Fatalf("runner check = %T, want object", checks["runners"])
	}
	if runnerCheck["status"] != "ok" {
		t.Fatalf("runner check status = %v, want ok", runnerCheck["status"])
	}
	if runnerCheck["total"] != float64(1) || runnerCheck["available"] != float64(1) || runnerCheck["unavailable"] != float64(0) {
		t.Fatalf("runner counts = %#v, want total=1 available=1 unavailable=0", runnerCheck)
	}
	statuses, ok := runnerCheck["statuses"].(map[string]any)
	if !ok {
		t.Fatalf("runner statuses = %T, want object", runnerCheck["statuses"])
	}
	if statuses["online"] != float64(1) {
		t.Fatalf("online runner count = %#v, want 1", statuses["online"])
	}
	items, ok := runnerCheck["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("runner items = %#v, want one item", runnerCheck["items"])
	}

	contentType := rec.Header().Get("Content-Type")
	if !strings.Contains(contentType, "application/json") {
		t.Errorf("expected JSON content-type, got %q", contentType)
	}
}

func TestGetHealthDegradesWhenNoRunnerAvailable(t *testing.T) {
	h := newTestHandler()
	// Reset registry to only contain an offline runner for this test.
	h.Registry = runners.NewRegistry()
	h.Registry.Upsert(runners.RunnerInfo{
		ID:           "runner_local_1",
		Name:         "Mock Runner (local)",
		Status:       "offline",
		Capabilities: []string{"mock"},
	})
	req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	rec := httptest.NewRecorder()

	h.GetHealth(rec, req)

	// Degraded health now returns 503 (was 200) so load balancers and
	// operators can distinguish a partially-broken edge from a healthy one.
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status 503 for degraded health, got %d", rec.Code)
	}
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	body = unwrapSuccess(body)
	if body["status"] != "degraded" {
		t.Fatalf("overall status = %v, want degraded", body["status"])
	}
	if body["http_status"] != float64(http.StatusServiceUnavailable) {
		t.Fatalf("http_status = %v, want 503", body["http_status"])
	}
	checks := body["checks"].(map[string]any)
	runnerCheck := checks["runners"].(map[string]any)
	if runnerCheck["status"] != "degraded" {
		t.Fatalf("runner check status = %v, want degraded", runnerCheck["status"])
	}
	if runnerCheck["detail"] != "no available runners" {
		t.Fatalf("runner detail = %v, want no available runners", runnerCheck["detail"])
	}
	if runnerCheck["available"] != float64(0) || runnerCheck["unavailable"] != float64(1) {
		t.Fatalf("runner counts = %#v, want available=0 unavailable=1", runnerCheck)
	}
	statuses := runnerCheck["statuses"].(map[string]any)
	if statuses["offline"] != float64(1) {
		t.Fatalf("offline runner count = %#v, want 1", statuses["offline"])
	}
}

func TestGetHealthDegradesWhenRunnerRegistryMissing(t *testing.T) {
	h := newTestHandler()
	h.Registry = nil
	req := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	rec := httptest.NewRecorder()

	h.GetHealth(rec, req)

	// Degraded health now returns 503 (was 200) so load balancers and
	// operators can distinguish a partially-broken edge from a healthy one.
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status 503 for degraded health, got %d", rec.Code)
	}
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	body = unwrapSuccess(body)
	if body["status"] != "degraded" {
		t.Fatalf("overall status = %v, want degraded", body["status"])
	}
	if body["http_status"] != float64(http.StatusServiceUnavailable) {
		t.Fatalf("http_status = %v, want 503", body["http_status"])
	}
	checks := body["checks"].(map[string]any)
	runnerCheck := checks["runners"].(map[string]any)
	if runnerCheck["detail"] != "no runner registry configured" {
		t.Fatalf("runner detail = %v, want missing registry detail", runnerCheck["detail"])
	}
	if runnerCheck["total"] != float64(0) || runnerCheck["available"] != float64(0) {
		t.Fatalf("runner counts = %#v, want zero counts", runnerCheck)
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
	body = unwrapSuccess(body)

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
	if errObj["code"] != "method_not_allowed" {
		t.Errorf("expected method_not_allowed, got %v", errObj["code"])
	}
}

func TestGenIDPrefix(t *testing.T) {
	id := genID("test_")
	if !strings.HasPrefix(id, "test_") {
		t.Fatalf("genID = %q, want test_ prefix", id)
	}
	if len(id) <= len("test_") {
		t.Fatalf("genID = %q, expected hex suffix after prefix", id)
	}
}

func TestWriteJSONEncodingError(t *testing.T) {
	// writeJSON with an unencodable value should not panic.
	// We use a channel which cannot be JSON-encoded.
	rec := httptest.NewRecorder()
	writeJSON(rec, http.StatusOK, make(chan int))
	// Should still have set the status even if encoding fails
	if rec.Code != http.StatusOK {
		t.Fatalf("writeJSON status = %d, want 200", rec.Code)
	}
}
