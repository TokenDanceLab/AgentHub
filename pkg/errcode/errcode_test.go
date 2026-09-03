package errcode

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestErrorMethod(t *testing.T) {
	e := New("TEST_CODE", "test message", http.StatusBadRequest)
	if got := e.Error(); got != "TEST_CODE: test message" {
		t.Fatalf("Error() = %q, want %q", got, "TEST_CODE: test message")
	}
}

func TestErrorWithTrace(t *testing.T) {
	e := New("TEST_CODE", "test", http.StatusBadRequest).WithTrace("trace_000001")
	want := "TEST_CODE: test (trace: trace_000001)"
	if got := e.Error(); got != want {
		t.Fatalf("Error() = %q, want %q", got, want)
	}
}

func TestIs(t *testing.T) {
	e1 := New("not_found", "a", http.StatusNotFound)
	e2 := New("not_found", "b", http.StatusNotFound)
	e3 := New("bad_request", "c", http.StatusBadRequest)

	if !errors.Is(e1, e2) {
		t.Fatal("same code should match")
	}
	if errors.Is(e1, e3) {
		t.Fatal("different code should not match")
	}
	if errors.Is(e1, errors.New("other")) {
		t.Fatal("non-Error should not match")
	}
}

func TestWithMessage(t *testing.T) {
	orig := New("CODE", "original", http.StatusBadRequest)
	modified := orig.WithMessage("custom")

	if modified.Code != "CODE" {
		t.Fatalf("Code changed: %q", modified.Code)
	}
	if modified.Message != "custom" {
		t.Fatalf("Message = %q, want %q", modified.Message, "custom")
	}
	if modified.HTTPStatus != http.StatusBadRequest {
		t.Fatalf("HTTPStatus changed: %d", modified.HTTPStatus)
	}
	// Original should be unchanged
	if orig.Message != "original" {
		t.Fatal("WithMessage should not mutate the original")
	}
}

func TestWithMessagef(t *testing.T) {
	orig := New("CODE", "original", http.StatusBadRequest)
	modified := orig.WithMessagef("value=%d", 42)

	if modified.Message != "value=42" {
		t.Fatalf("Message = %q", modified.Message)
	}
}

func TestWithTrace(t *testing.T) {
	orig := New("CODE", "msg", http.StatusBadRequest)
	modified := orig.WithTrace("trace_123")

	if modified.TraceID != "trace_123" {
		t.Fatalf("TraceID = %q", modified.TraceID)
	}
	if orig.TraceID != "" {
		t.Fatal("WithTrace should not mutate the original")
	}
}

func TestWriteError(t *testing.T) {
	w := httptest.NewRecorder()
	WriteError(w, New("not_found", "resource gone", http.StatusNotFound))

	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d", w.Code)
	}

	var env map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
		t.Fatal(err)
	}
	errObj, _ := env["error"].(map[string]any)
	if errObj["code"] != "not_found" {
		t.Fatalf("code = %v", errObj["code"])
	}
	if errObj["message"] != "resource gone" {
		t.Fatalf("message = %v", errObj["message"])
	}
	if errObj["traceId"] == "" {
		t.Fatal("traceId should be auto-generated")
	}
}

func TestWriteErrorGeneric(t *testing.T) {
	w := httptest.NewRecorder()
	WriteError(w, errors.New("something broke"))

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d", w.Code)
	}
	var env map[string]any
	json.Unmarshal(w.Body.Bytes(), &env)
	errObj, _ := env["error"].(map[string]any)
	if errObj["code"] != "internal_error" {
		t.Fatalf("code = %v", errObj["code"])
	}
	// The raw error text must NOT leak into the response (WriteError logs it
	// via slog and surfaces only the generic internal-error message), so an
	// operator can correlate via traceId without exposing internals.
	if msg, _ := errObj["message"].(string); msg == "something broke" {
		t.Fatalf("message leaked raw error text into response: %q", msg)
	}
	if _, ok := errObj["traceId"].(string); !ok || errObj["traceId"] == "" {
		t.Fatalf("traceId = %v, want non-empty trace id for correlation", errObj["traceId"])
	}
}

func TestWriteErrorPreservesExistingTrace(t *testing.T) {
	w := httptest.NewRecorder()
	e := New("CODE", "msg", http.StatusBadRequest).WithTrace("my_trace")
	WriteError(w, e)

	var env map[string]any
	json.Unmarshal(w.Body.Bytes(), &env)
	errObj, _ := env["error"].(map[string]any)
	if errObj["traceId"] != "my_trace" {
		t.Fatalf("traceId = %v, want my_trace", errObj["traceId"])
	}
}

func TestNewNormalizesZeroHTTPStatus(t *testing.T) {
	// #2243: the invariant lives in the constructor, so no write site needs a
	// clamp. If this regresses, Fail/writeTimeout hand WriteHeader(0) to
	// net/http and the client gets a silent 200 instead of an error.
	if got := New("CODE", "msg", 0).HTTPStatus; got != http.StatusInternalServerError {
		t.Fatalf("New(..., 0).HTTPStatus = %d, want %d", got, http.StatusInternalServerError)
	}
	// An explicitly decided status must survive untouched.
	if got := New("CODE", "msg", http.StatusGatewayTimeout).HTTPStatus; got != http.StatusGatewayTimeout {
		t.Fatalf("New(..., 504).HTTPStatus = %d, want 504", got)
	}
	// Copies must preserve the normalized status.
	if got := New("CODE", "msg", 0).WithMessage("x").WithTrace("t_1").HTTPStatus; got != http.StatusInternalServerError {
		t.Fatalf("copied HTTPStatus = %d, want %d", got, http.StatusInternalServerError)
	}
}

func TestWriteErrorFailClosedForLiteralWithoutStatus(t *testing.T) {
	// &Error{} literals bypass New(), so writeEnvelope is the last line of
	// defence. Before it normalized the status, this path handed WriteHeader(0)
	// to net/http and the client was told "success" for an error (#2243).
	rec := httptest.NewRecorder()
	WriteError(rec, &Error{Code: "custom_code", Message: "boom"})

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
	if !strings.Contains(rec.Body.String(), "custom_code") {
		t.Fatalf("body = %q, want the code to survive", rec.Body.String())
	}
}

func TestNewTraceID(t *testing.T) {
	id1 := NewTraceID()
	id2 := NewTraceID()
	if id1 == id2 {
		t.Fatal("trace IDs should be unique")
	}
	if !strings.HasPrefix(id1, "trace_") {
		t.Fatalf("trace ID = %q, want trace_ prefix", id1)
	}
}

func TestEnvelopeForGinWithTrace(t *testing.T) {
	e := New("CODE", "msg", http.StatusBadRequest).WithTrace("t_1")
	env := EnvelopeForGinWithTrace(e)
	errObj, _ := env["error"].(map[string]any)
	if errObj["traceId"] != "t_1" {
		t.Fatalf("traceId = %v", errObj["traceId"])
	}
}

func TestCommonCodesHaveCorrectStatus(t *testing.T) {
	cases := []struct {
		err  *Error
		want int
	}{
		{ErrInternal, http.StatusInternalServerError},
		{ErrBadRequest, http.StatusBadRequest},
		{ErrNotFound, http.StatusNotFound},
		{ErrMethodNotAllowed, http.StatusMethodNotAllowed},
		{ErrUnauthorized, http.StatusUnauthorized},
		{ErrForbidden, http.StatusForbidden},
		{ErrTooManyRequests, http.StatusTooManyRequests},
		{ErrInvalidJSON, http.StatusBadRequest},
		{ErrConflict, http.StatusConflict},
	}
	for _, tc := range cases {
		if tc.err.HTTPStatus != tc.want {
			t.Errorf("%s.HTTPStatus = %d, want %d", tc.err.Code, tc.err.HTTPStatus, tc.want)
		}
	}
}
