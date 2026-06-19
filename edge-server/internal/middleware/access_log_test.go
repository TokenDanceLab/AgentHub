package middleware

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net"
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

func TestWithGetRequestID(t *testing.T) {
	ctx := WithRequestID(context.Background(), "req_test123")
	if got := GetRequestID(ctx); got != "req_test123" {
		t.Fatalf("GetRequestID = %q, want req_test123", got)
	}
	if got := GetRequestID(context.Background()); got != "" {
		t.Fatalf("GetRequestID(nil) = %q, want empty", got)
	}
}

func TestAccessLogGeneratesRequestIDWhenNoHeader(t *testing.T) {
	var logs bytes.Buffer
	restore := installTestLogger(&logs)
	defer restore()

	var capturedID string
	handler := AccessLog(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedID = GetRequestID(r.Context())
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodDelete, "/v1/runs/1", nil)
	req.RemoteAddr = "127.0.0.1:4567"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}

	// Request ID must be auto-generated and injected into context.
	if !strings.HasPrefix(capturedID, "req_") {
		t.Fatalf("captured request ID = %q, want req_ prefix", capturedID)
	}

	// Response must include X-Request-ID header.
	respID := rec.Header().Get("X-Request-ID")
	if respID != capturedID {
		t.Fatalf("response X-Request-ID = %q, want %q", respID, capturedID)
	}

	// Log entry must include request_id.
	entry := decodeLogEntry(t, logs.Bytes())
	if entry["msg"] != "access" {
		t.Fatalf("msg = %v, want access", entry["msg"])
	}
	if entry["request_id"] != capturedID {
		t.Fatalf("request_id = %v, want %v", entry["request_id"], capturedID)
	}
}

func TestAccessLogPropagatesRequestIDFromHeader(t *testing.T) {
	var logs bytes.Buffer
	restore := installTestLogger(&logs)
	defer restore()

	var capturedID string
	handler := AccessLog(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedID = GetRequestID(r.Context())
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("short and stout"))
	}))

	req := httptest.NewRequest(http.MethodPost, "/v1/runs", nil)
	req.RemoteAddr = "127.0.0.1:4567"
	req.Header.Set("X-Request-ID", "req-test")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusTeapot {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusTeapot)
	}

	// Context must contain the propagated request ID.
	if capturedID != "req-test" {
		t.Fatalf("captured request ID = %q, want req-test", capturedID)
	}

	// Response header must echo the incoming request ID.
	if got := rec.Header().Get("X-Request-ID"); got != "req-test" {
		t.Fatalf("response X-Request-ID = %q, want req-test", got)
	}

	entry := decodeLogEntry(t, logs.Bytes())
	if entry["msg"] != "access" {
		t.Fatalf("msg = %v, want access", entry["msg"])
	}
	if entry["method"] != http.MethodPost {
		t.Fatalf("method = %v, want %s", entry["method"], http.MethodPost)
	}
	if entry["path"] != "/v1/runs" {
		t.Fatalf("path = %v, want /v1/runs", entry["path"])
	}
	if entry["status"] != float64(http.StatusTeapot) {
		t.Fatalf("status = %v, want %d", entry["status"], http.StatusTeapot)
	}
	if entry["remote_addr"] != "127.0.0.1:4567" {
		t.Fatalf("remote_addr = %v, want 127.0.0.1:4567", entry["remote_addr"])
	}
	if entry["request_id"] != "req-test" {
		t.Fatalf("request_id = %v, want req-test", entry["request_id"])
	}
}

func TestAccessLogAlwaysIncludesRequestIDWhenNoHeader(t *testing.T) {
	var logs bytes.Buffer
	restore := installTestLogger(&logs)
	defer restore()

	handler := AccessLog(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ok"))
	}))

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	entry := decodeLogEntry(t, logs.Bytes())
	if entry["status"] != float64(http.StatusOK) {
		t.Fatalf("logged status = %v, want %d", entry["status"], http.StatusOK)
	}

	// request_id must always be present, even when no X-Request-ID header is sent.
	reqID, ok := entry["request_id"].(string)
	if !ok || reqID == "" {
		t.Fatalf("request_id missing or empty: %v", entry["request_id"])
	}
	if !strings.HasPrefix(reqID, "req_") {
		t.Fatalf("request_id = %q, want req_ prefix", reqID)
	}

	// Response header must also be set.
	if got := rec.Header().Get("X-Request-ID"); got != reqID {
		t.Fatalf("response X-Request-ID = %q, want %q", got, reqID)
	}
}

func TestResponseWriterFlushDelegatesWhenSupported(t *testing.T) {
	inner := &flushRecorder{ResponseWriter: httptest.NewRecorder()}
	wrapped := &responseWriter{ResponseWriter: inner}

	wrapped.Flush()

	if !inner.flushed {
		t.Fatal("Flush did not delegate to the inner ResponseWriter")
	}
}

func TestResponseWriterHijackDelegatesWhenSupported(t *testing.T) {
	inner := newHijackRecorder()
	wrapped := &responseWriter{ResponseWriter: inner}

	conn, rw, err := wrapped.Hijack()
	if err != nil {
		t.Fatalf("Hijack returned error: %v", err)
	}
	defer conn.Close()

	if rw == nil {
		t.Fatal("Hijack returned nil read writer")
	}
	if !inner.hijacked {
		t.Fatal("Hijack did not delegate to the inner ResponseWriter")
	}
}

func TestResponseWriterHijackReportsUnsupportedWriter(t *testing.T) {
	wrapped := &responseWriter{ResponseWriter: httptest.NewRecorder()}

	conn, rw, err := wrapped.Hijack()
	if err == nil {
		t.Fatal("Hijack returned nil error for unsupported writer")
	}
	if conn != nil {
		t.Fatal("Hijack returned a connection for unsupported writer")
	}
	if rw != nil {
		t.Fatal("Hijack returned a read writer for unsupported writer")
	}
}

func installTestLogger(w *bytes.Buffer) func() {
	old := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(w, nil)))
	return func() { slog.SetDefault(old) }
}

func decodeLogEntry(t *testing.T, data []byte) map[string]any {
	t.Helper()
	var entry map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(data), &entry); err != nil {
		t.Fatalf("failed to decode log entry: %v\n%s", err, string(data))
	}
	return entry
}

type flushRecorder struct {
	http.ResponseWriter
	flushed bool
}

func (r *flushRecorder) Flush() {
	r.flushed = true
}

type hijackRecorder struct {
	http.ResponseWriter
	conn     net.Conn
	peer     net.Conn
	rw       *bufio.ReadWriter
	hijacked bool
}

func newHijackRecorder() *hijackRecorder {
	conn, peer := net.Pipe()
	buffer := bufio.NewReadWriter(bufio.NewReader(conn), bufio.NewWriter(conn))
	return &hijackRecorder{
		ResponseWriter: httptest.NewRecorder(),
		conn:           conn,
		peer:           peer,
		rw:             buffer,
	}
}

func (r *hijackRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	r.hijacked = true
	_ = r.peer.Close()
	return r.conn, r.rw, nil
}
