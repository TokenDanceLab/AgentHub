package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMuxGetAgentsEmptyRegistry(t *testing.T) {
	h := newTestHandler()
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/v1/agents", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /v1/agents status = %d, want 200", rec.Code)
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
	// AdapterRegistry is nil so we expect empty list
	if len(items) != 0 {
		t.Fatalf("expected 0 agents with nil registry, got %d", len(items))
	}
}

func TestMuxGetAgentsWrongMethod(t *testing.T) {
	h := newTestHandler()
	req := httptest.NewRequest(http.MethodPost, "/v1/agents", nil)
	rec := httptest.NewRecorder()

	h.GetAgents(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST /v1/agents status = %d, want 405", rec.Code)
	}
}
