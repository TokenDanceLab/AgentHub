package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"

	"github.com/agenthub/hub-server/internal/cache"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/middleware"
)

// newMethodRoutingEngine builds the real production router with every optional
// handler left nil, so only the always-registered routes (/health, /health/live,
// /health/ready) plus the NoRoute/NoMethod fallbacks exist. That is the smallest
// surface on which method-mismatch routing can be observed.
func newMethodRoutingEngine(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	metrics.Register()

	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	r := gin.New()
	if err := SetupRoutes(
		r,
		&config.Config{},
		middleware.NewAuthMiddleware(&config.Config{}, middleware.AuthDependencies{}, nil),
		"",
		cache.NewClient(rdb),
		nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil,
	); err != nil {
		t.Fatal(err)
	}
	return r
}

func envelopeCode(t *testing.T, body string) string {
	t.Helper()
	var parsed struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal([]byte(body), &parsed); err != nil {
		t.Fatalf("error envelope is not valid JSON: %v; body=%q", err, body)
	}
	if parsed.Error.Code == "" {
		t.Fatalf("error envelope carries no code; body=%q", body)
	}
	return parsed.Error.Code
}

// TestMethodMismatchReturns405WithAllowHeader pins the HTTP contract for a path
// that exists but not for the requested method. Before HandleMethodNotAllowed
// was enabled, gin routed these to NoRoute and answered 404 not_found, which
// made r.NoMethod dead wiring and diverged from edge-server (which answers 405
// for the same class of request). RFC 9110 requires 405 to carry Allow.
func TestMethodMismatchReturns405WithAllowHeader(t *testing.T) {
	r := newMethodRoutingEngine(t)

	for _, tt := range []struct {
		method string
		path   string
	}{
		{method: http.MethodPost, path: "/health"},
		{method: http.MethodDelete, path: "/health"},
		{method: http.MethodPut, path: "/health/live"},
		{method: http.MethodPatch, path: "/health/ready"},
	} {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			w := httptest.NewRecorder()

			r.ServeHTTP(w, req)

			if w.Code != http.StatusMethodNotAllowed {
				t.Fatalf("status = %d, want %d; body=%q", w.Code, http.StatusMethodNotAllowed, w.Body.String())
			}
			if code := envelopeCode(t, w.Body.String()); code != "method_not_allowed" {
				t.Fatalf("error code = %q, want %q", code, "method_not_allowed")
			}
			allow := w.Header().Get("Allow")
			if !strings.Contains(allow, http.MethodGet) {
				t.Fatalf("Allow header = %q, want it to list GET (the registered method)", allow)
			}
		})
	}
}

// TestUnknownPathStillReturns404 guards the other direction: enabling 405 must
// not swallow genuinely unknown paths, otherwise every scanner probe would start
// claiming the resource exists.
func TestUnknownPathStillReturns404(t *testing.T) {
	r := newMethodRoutingEngine(t)

	for _, path := range []string{"/does-not-exist", "/health/deeper/unknown", "/metrics"} {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			w := httptest.NewRecorder()

			r.ServeHTTP(w, req)

			if w.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want %d; body=%q", w.Code, http.StatusNotFound, w.Body.String())
			}
			if code := envelopeCode(t, w.Body.String()); code != "not_found" {
				t.Fatalf("error code = %q, want %q", code, "not_found")
			}
		})
	}
}

// TestCORSPreflightIsNotTurnedInto405 pins the interaction that makes enabling
// 405 safe for browsers: OPTIONS is not a registered method for /health, so a
// naive router would now answer the preflight with 405. The CORS middleware is
// part of the 405 handler chain and aborts preflight first, so the browser must
// still see a 2xx preflight.
func TestCORSPreflightIsNotTurnedInto405(t *testing.T) {
	r := newMethodRoutingEngine(t)

	req := httptest.NewRequest(http.MethodOptions, "/health", nil)
	req.Header.Set("Origin", "http://localhost:5174")
	req.Header.Set("Access-Control-Request-Method", http.MethodPost)
	w := httptest.NewRecorder()

	r.ServeHTTP(w, req)

	if w.Code == http.StatusMethodNotAllowed {
		t.Fatalf("preflight was answered with 405; CORS middleware must abort it first; body=%q", w.Body.String())
	}
	if w.Code >= 300 {
		t.Fatalf("preflight status = %d, want 2xx; body=%q", w.Code, w.Body.String())
	}
}
