package reqlog

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNewRequestID(t *testing.T) {
	id := NewRequestID()
	if !strings.HasPrefix(id, "req_") {
		t.Fatalf("NewRequestID = %q, want req_ prefix", id)
	}
	id2 := NewRequestID()
	if id == id2 {
		t.Fatal("NewRequestID returned duplicate IDs")
	}
}

func TestNewTraceID(t *testing.T) {
	id := NewTraceID()
	if !strings.HasPrefix(id, "trace_") {
		t.Fatalf("NewTraceID = %q, want trace_ prefix", id)
	}
	id2 := NewTraceID()
	if id == id2 {
		t.Fatal("NewTraceID returned duplicate IDs")
	}
}

func TestWithGetRequestID(t *testing.T) {
	ctx := WithRequestID(context.Background(), "req_test123")
	if got := GetRequestID(ctx); got != "req_test123" {
		t.Fatalf("GetRequestID = %q, want req_test123", got)
	}
	if got := GetRequestID(context.Background()); got != "" {
		t.Fatalf("GetRequestID(nil) = %q, want empty", got)
	}
}

func TestNetHTTPAccessLogPropagatesRequestID(t *testing.T) {
	var capturedID string
	handler := AccessLog(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedID = GetRequestID(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("X-Request-ID", "req_existing")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if capturedID != "req_existing" {
		t.Fatalf("captured request ID = %q, want req_existing", capturedID)
	}
	if got := rec.Header().Get("X-Request-ID"); got != "req_existing" {
		t.Fatalf("response X-Request-ID = %q, want req_existing", got)
	}
}

func TestNetHTTPAccessLogGeneratesRequestID(t *testing.T) {
	var capturedID string
	handler := AccessLog(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedID = GetRequestID(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/test", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if !strings.HasPrefix(capturedID, "req_") {
		t.Fatalf("generated request ID = %q, want req_ prefix", capturedID)
	}
	if got := rec.Header().Get("X-Request-ID"); got != capturedID {
		t.Fatalf("response X-Request-ID = %q, want %q", got, capturedID)
	}
}

func TestNetHTTPAccessLogCapturesStatus(t *testing.T) {
	handler := AccessLog(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))

	req := httptest.NewRequest("GET", "/missing", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}
