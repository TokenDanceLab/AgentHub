package resputil

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWriteJSONEncodesPayload(t *testing.T) {
	rec := httptest.NewRecorder()
	WriteJSON(rec, http.StatusCreated, map[string]string{"a": "b"})

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Fatalf("Content-Type = %q, want application/json; charset=utf-8", got)
	}
	if got := strings.TrimSpace(rec.Body.String()); got != `{"a":"b"}` {
		t.Fatalf("body = %q, want {\"a\":\"b\"}", got)
	}
}

func TestWriteJSONNilWritesHeadersOnly(t *testing.T) {
	rec := httptest.NewRecorder()
	WriteJSON(rec, http.StatusAccepted, nil)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", rec.Code)
	}
	if body := rec.Body.String(); body != "" {
		t.Fatalf("body = %q, want empty", body)
	}
}

func TestWriteJSONEncodingErrorKeepsStatus(t *testing.T) {
	// A channel cannot be JSON-encoded; the status must already be written
	// and the error must not panic (it is logged by the shared writer).
	rec := httptest.NewRecorder()
	WriteJSON(rec, http.StatusOK, make(chan int))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}
