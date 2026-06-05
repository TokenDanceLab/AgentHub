package debug

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHealthHandler_AllOK(t *testing.T) {
	mux := http.NewServeMux()
	RegisterEndpoints(mux, MuxConfig{
		HealthCheckers: map[string]HealthChecker{
			"db":  func(_ context.Context) error { return nil },
			"app": func(_ context.Context) error { return nil },
		},
		Version:   "v0.1.0",
		StartTime: time.Now().Add(-3600 * time.Second),
	})

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["status"] != "ok" {
		t.Errorf("status = %v, want ok", body["status"])
	}
	if body["version"] != "v0.1.0" {
		t.Errorf("version = %v, want v0.1.0", body["version"])
	}
	checks := body["checks"].(map[string]any)
	if checks["db"] != "ok" {
		t.Errorf("checks.db = %v, want ok", checks["db"])
	}
}

func TestHealthHandler_Degraded(t *testing.T) {
	mux := http.NewServeMux()
	RegisterEndpoints(mux, MuxConfig{
		HealthCheckers: map[string]HealthChecker{
			"db": func(_ context.Context) error { return errors.New("connection refused") },
		},
	})

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}

	var body map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if body["status"] != "degraded" {
		t.Errorf("status = %v, want degraded", body["status"])
	}
}

func TestReadyHandler_OK(t *testing.T) {
	mux := http.NewServeMux()
	RegisterEndpoints(mux, MuxConfig{
		HealthCheckers: map[string]HealthChecker{
			"db": func(_ context.Context) error { return nil },
		},
	})

	req := httptest.NewRequest(http.MethodGet, "/ready", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

func TestReadyHandler_NotReady(t *testing.T) {
	mux := http.NewServeMux()
	RegisterEndpoints(mux, MuxConfig{
		HealthCheckers: map[string]HealthChecker{
			"db": func(_ context.Context) error { return errors.New("down") },
		},
	})

	req := httptest.NewRequest(http.MethodGet, "/ready", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
}

func TestPprofRegistered(t *testing.T) {
	mux := http.NewServeMux()
	RegisterEndpoints(mux, MuxConfig{EnablePprof: true})

	req := httptest.NewRequest(http.MethodGet, "/debug/pprof/", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	// pprof index returns 200
	if rec.Code != http.StatusOK {
		t.Fatalf("pprof status = %d, want 200", rec.Code)
	}
}

func TestConfigHandler_WithAuth(t *testing.T) {
	mux := http.NewServeMux()
	RegisterEndpoints(mux, MuxConfig{
		Auth: BearerAuth("test-token"),
		ConfigDumper: func() map[string]any {
			return map[string]any{
				"db_host":     "localhost",
				"db_password": "supersecret",
			}
		},
	})

	// Without auth → 401
	req := httptest.NewRequest(http.MethodGet, "/debug/config", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no-auth status = %d, want 401", rec.Code)
	}

	// With auth → 200 + sanitized
	req = httptest.NewRequest(http.MethodGet, "/debug/config", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("auth status = %d, want 200", rec.Code)
	}

	var body map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if body["db_password"] != "[REDACTED]" {
		t.Errorf("db_password = %v, want [REDACTED]", body["db_password"])
	}
	if body["db_host"] != "localhost" {
		t.Errorf("db_host = %v, want localhost", body["db_host"])
	}
}

func TestBasicAuth(t *testing.T) {
	auth := BasicAuth("admin", "pass123")
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.SetBasicAuth("admin", "pass123")
	if !auth(req) {
		t.Error("basic auth should succeed with correct credentials")
	}

	req2 := httptest.NewRequest(http.MethodGet, "/", nil)
	req2.SetBasicAuth("admin", "wrong")
	if auth(req2) {
		t.Error("basic auth should fail with wrong password")
	}
}

func TestBearerAuth(t *testing.T) {
	auth := BearerAuth("my-token")
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer my-token")
	if !auth(req) {
		t.Error("bearer auth should succeed with correct token")
	}

	req2 := httptest.NewRequest(http.MethodGet, "/", nil)
	req2.Header.Set("Authorization", "Bearer wrong")
	if auth(req2) {
		t.Error("bearer auth should fail with wrong token")
	}
}

func TestSanitizeConfig(t *testing.T) {
	input := map[string]any{
		"host":     "localhost",
		"password": "secret",
		"nested": map[string]any{
			"api_key":  "sk-123",
			"database": "mydb",
		},
		"PORT": 8080,
	}
	result := SanitizeConfig(input)

	if result["password"] != "[REDACTED]" {
		t.Errorf("password = %v, want [REDACTED]", result["password"])
	}
	if result["host"] != "localhost" {
		t.Errorf("host = %v, want localhost", result["host"])
	}
	nested := result["nested"].(map[string]any)
	if nested["api_key"] != "[REDACTED]" {
		t.Errorf("nested.api_key = %v, want [REDACTED]", nested["api_key"])
	}
	if nested["database"] != "mydb" {
		t.Errorf("nested.database = %v, want mydb", nested["database"])
	}
}

func TestStateHandler(t *testing.T) {
	mux := http.NewServeMux()
	RegisterEndpoints(mux, MuxConfig{
		StateDumper: func() map[string]any {
			return map[string]any{"goroutines": 42}
		},
	})

	req := httptest.NewRequest(http.MethodGet, "/debug/state", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&body)
	if body["goroutines"] != float64(42) {
		t.Errorf("goroutines = %v, want 42", body["goroutines"])
	}
}

func TestHealthHandler_MethodNotAllowed(t *testing.T) {
	mux := http.NewServeMux()
	RegisterEndpoints(mux, MuxConfig{})

	req := httptest.NewRequest(http.MethodPost, "/health", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", rec.Code)
	}
}

func TestNoAuth_NilAuth(t *testing.T) {
	mux := http.NewServeMux()
	RegisterEndpoints(mux, MuxConfig{
		Auth: nil,
		StateDumper: func() map[string]any {
			return map[string]any{"ok": true}
		},
	})

	req := httptest.NewRequest(http.MethodGet, "/debug/state", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("nil auth status = %d, want 200", rec.Code)
	}
}

func TestWriteJSON_NilConfig(t *testing.T) {
	mux := http.NewServeMux()
	RegisterEndpoints(mux, MuxConfig{
		ConfigDumper: func() map[string]any { return nil },
	})

	req := httptest.NewRequest(http.MethodGet, "/debug/config", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("nil config status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "{}") && !strings.Contains(rec.Body.String(), "null") {
		t.Errorf("expected empty or null in body, got: %s", rec.Body.String())
	}
}
