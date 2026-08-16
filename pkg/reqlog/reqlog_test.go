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

	// The body after the prefix must be a real RFC 4122 UUIDv4: 8-4-4-4-12
	// hex layout, version nibble '4', variant in {8,9,a,b}.
	body := strings.TrimPrefix(id, "req_")
	parts := strings.Split(body, "-")
	if len(parts) != 5 {
		t.Fatalf("NewRequestID body %q is not 8-4-4-4-12", body)
	}
	for i, part := range parts {
		wantLen := []int{8, 4, 4, 4, 12}[i]
		if len(part) != wantLen {
			t.Fatalf("NewRequestID body %q segment %d has length %d, want %d", body, i, len(part), wantLen)
		}
	}
	if parts[2][0] != '4' {
		t.Fatalf("NewRequestID body %q is not UUIDv4 (version nibble %q)", body, parts[2][0])
	}
	if !strings.Contains("89ab", string(parts[3][0])) {
		t.Fatalf("NewRequestID body %q has invalid RFC 4122 variant nibble %q", body, parts[3][0])
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

func TestSetRequestIDHeader(t *testing.T) {
	t.Run("propagates request id from context", func(t *testing.T) {
		h := http.Header{}
		SetRequestIDHeader(WithRequestID(context.Background(), "req_outbound_1"), h)
		if got := h.Get(RequestIDHeader); got != "req_outbound_1" {
			t.Fatalf("X-Request-ID = %q, want req_outbound_1", got)
		}
	})

	t.Run("no-op without request id", func(t *testing.T) {
		h := http.Header{}
		SetRequestIDHeader(context.Background(), h)
		if got := h.Get(RequestIDHeader); got != "" {
			t.Fatalf("X-Request-ID = %q, want empty", got)
		}
	})
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
