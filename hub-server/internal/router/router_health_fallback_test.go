package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The tests below pin the health contract of the `healthHandler == nil` fallback
// branch in SetupRoutes (router.go). newMethodRoutingEngine builds the real
// production router with every optional handler left nil, so these requests are
// served by that fallback — not by a stubbed handler.
//
// Why the readiness fallback must not claim ready: an orchestrator or load
// balancer that probes /health/ready decides from the answer whether to route
// traffic to this process. When no HealthHandler is wired there is no dependency
// probe behind the endpoint at all, so answering 200/ready:true asserts a fact
// nobody verified. Liveness is different: the process demonstrably answered the
// request, so /health/live stays 200/live:true.

func decodeHealthFallbackData(t *testing.T, w *httptest.ResponseRecorder) map[string]interface{} {
	t.Helper()

	var body struct {
		Code string                 `json:"code"`
		Data map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("health envelope is not valid JSON: %v; body=%q", err, w.Body.String())
	}
	if body.Code != "ok" {
		t.Fatalf("envelope code = %q, want %q; body=%q", body.Code, "ok", w.Body.String())
	}
	if body.Data == nil {
		t.Fatalf("envelope carries no data object; body=%q", w.Body.String())
	}
	return body.Data
}

func TestHealthFallbackWithoutHandlerReportsReadyUnavailable(t *testing.T) {
	r := newMethodRoutingEngine(t)

	req := httptest.NewRequest(http.MethodGet, "/health/ready", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("GET /health/ready status = %d, want %d; body=%q",
			w.Code, http.StatusServiceUnavailable, w.Body.String())
	}

	data := decodeHealthFallbackData(t, w)
	if got := data["ready"]; got != false {
		t.Errorf("ready = %#v, want false; body=%q", got, w.Body.String())
	}
	if got := data["status"]; got != "unavailable" {
		t.Errorf("status = %#v, want %q; body=%q", got, "unavailable", w.Body.String())
	}
}

func TestHealthFallbackWithoutHandlerKeepsLiveTrue(t *testing.T) {
	r := newMethodRoutingEngine(t)

	req := httptest.NewRequest(http.MethodGet, "/health/live", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("GET /health/live status = %d, want %d; body=%q",
			w.Code, http.StatusOK, w.Body.String())
	}

	data := decodeHealthFallbackData(t, w)
	if got := data["live"]; got != true {
		t.Errorf("live = %#v, want true; body=%q", got, w.Body.String())
	}
	if got := data["status"]; got != "ok" {
		t.Errorf("status = %#v, want %q; body=%q", got, "ok", w.Body.String())
	}
}

// TestHealthFallbackWithoutHandlerKeepsAggregateShape guards the pinned decision
// that only /health/ready changes: the aggregate /health fallback keeps its
// existing 200 payload shape (compose healthchecks `wget -qO- .../health`).
func TestHealthFallbackWithoutHandlerKeepsAggregateShape(t *testing.T) {
	r := newMethodRoutingEngine(t)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("GET /health status = %d, want %d; body=%q",
			w.Code, http.StatusOK, w.Body.String())
	}

	data := decodeHealthFallbackData(t, w)
	if got := data["status"]; got != "ok" {
		t.Errorf("status = %#v, want %q; body=%q", got, "ok", w.Body.String())
	}
	if got := data["live"]; got != true {
		t.Errorf("live = %#v, want true; body=%q", got, w.Body.String())
	}
	if got := data["ready"]; got != true {
		t.Errorf("ready = %#v, want true (aggregate fallback shape is unchanged); body=%q",
			got, w.Body.String())
	}
}
