package middleware

import (
	"bufio"
	"bytes"
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAccessLogCapturesExplicitStatusAndRequestID(t *testing.T) {
	var logs bytes.Buffer
	restore := installTestLogger(&logs)
	defer restore()

	handler := AccessLog(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
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
		t.Fatalf("remote_addr = %v, want request remote addr", entry["remote_addr"])
	}
	if entry["request_id"] != "req-test" {
		t.Fatalf("request_id = %v, want req-test", entry["request_id"])
	}
}

func TestAccessLogDefaultsStatusOKWhenHandlerWritesBody(t *testing.T) {
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
	if _, ok := entry["request_id"]; ok {
		t.Fatalf("request_id logged for request without header: %v", entry["request_id"])
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
