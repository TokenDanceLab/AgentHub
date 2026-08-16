package errcode

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync/atomic"
)

// Error is the unified API error type for both Edge Server and Hub Server.
//
// Wire format (JSON):
//
//	{"error": {"code": "not_found", "message": "...", "traceId": "trace_000123"}}
//
// All API consumers should check response.error for errors.
type Error struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	HTTPStatus int    `json:"-"`
	TraceID    string `json:"traceId,omitempty"`
}

func (e *Error) Error() string {
	if e.TraceID != "" {
		return fmt.Sprintf("%s: %s (trace: %s)", e.Code, e.Message, e.TraceID)
	}
	return e.Code + ": " + e.Message
}

func (e *Error) Is(target error) bool {
	other, ok := target.(*Error)
	return ok && e.Code == other.Code
}

// WithMessage returns a copy with a custom message, preserving code/status/trace.
func (e *Error) WithMessage(msg string) *Error {
	return &Error{
		Code:       e.Code,
		Message:    msg,
		HTTPStatus: e.HTTPStatus,
		TraceID:    e.TraceID,
	}
}

// WithMessagef returns a copy with a formatted message.
func (e *Error) WithMessagef(format string, args ...any) *Error {
	return &Error{
		Code:       e.Code,
		Message:    fmt.Sprintf(format, args...),
		HTTPStatus: e.HTTPStatus,
		TraceID:    e.TraceID,
	}
}

// WithTrace returns a copy with a trace ID attached.
func (e *Error) WithTrace(traceID string) *Error {
	return &Error{
		Code:       e.Code,
		Message:    e.Message,
		HTTPStatus: e.HTTPStatus,
		TraceID:    traceID,
	}
}

// New creates a new Error with the given code, message, and HTTP status.
func New(code, message string, httpStatus int) *Error {
	return &Error{Code: code, Message: message, HTTPStatus: httpStatus}
}

// --- Trace ID generation ---

var traceCounter atomic.Uint64

// NewTraceID generates a unique, ordered trace ID for correlating an error
// response with its server-side log line. It is deliberately NOT a UUID:
// a per-process monotonic counter ("trace_000123") is ordered, cheap, and
// unambiguous in logs. UUID-shaped IDs belong to the other roles of the
// backend ID scheme (see hub-server/internal/uuidv7: Hub entities = UUIDv7,
// Edge entities = prefixed 16-hex, request correlation = UUIDv4 in
// pkg/reqlog) — do not replace this counter with a UUID.
func NewTraceID() string {
	n := traceCounter.Add(1)
	return fmt.Sprintf("trace_%06d", n)
}

// --- JSON envelope ---

type errorEnvelope struct {
	Error *Error `json:"error"`
}

// WriteError writes a standardized error response.
// If err is *Error, uses its fields. Otherwise wraps as INTERNAL_ERROR with a
// generic message — the original err text is logged (never sent to the
// client) so internal details (filesystem paths, upstream error bodies, stack
// hints) are not leaked through the API surface. Always generates and
// attaches a trace ID so operators can correlate the log line to the response.
func WriteError(w http.ResponseWriter, err error) {
	var e *Error
	if errors.As(err, &e) {
		if e.TraceID == "" {
			e = e.WithTrace(NewTraceID())
		}
		writeEnvelope(w, e.HTTPStatus, errorEnvelope{Error: e})
		return
	}
	traceID := NewTraceID()
	slog.Error("unexpected internal error",
		"traceId", traceID,
		"error", err.Error(),
	)
	e = ErrInternal.WithTrace(traceID)
	writeEnvelope(w, http.StatusInternalServerError, errorEnvelope{Error: e})
}

// WriteErrorWithTrace writes an error with an explicit trace ID (no auto-generation).
func WriteErrorWithTrace(w http.ResponseWriter, err error, traceID string) {
	var e *Error
	if errors.As(err, &e) {
		if e.TraceID == "" {
			e = e.WithTrace(traceID)
		}
		writeEnvelope(w, e.HTTPStatus, errorEnvelope{Error: e})
		return
	}
	slog.Error("unexpected internal error",
		"traceId", traceID,
		"error", err.Error(),
	)
	e = ErrInternal.WithTrace(traceID)
	writeEnvelope(w, http.StatusInternalServerError, errorEnvelope{Error: e})
}

// WriteJSON writes a successful JSON response with the given status code.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v != nil {
		json.NewEncoder(w).Encode(v)
	}
}

func writeEnvelope(w http.ResponseWriter, status int, env errorEnvelope) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(env)
}

// EnvelopeForGin returns a map suitable for gin.Context.JSON().
// Hub Server uses this to write errors through Gin while keeping the same envelope.
func EnvelopeForGin(e *Error) map[string]any {
	return map[string]any{
		"error": map[string]any{
			"code":    e.Code,
			"message": e.Message,
		},
	}
}

// EnvelopeForGinWithTrace returns a map with trace ID for Gin.
func EnvelopeForGinWithTrace(e *Error) map[string]any {
	m := map[string]any{
		"error": map[string]any{
			"code":    e.Code,
			"message": e.Message,
		},
	}
	if e.TraceID != "" {
		m["error"].(map[string]any)["traceId"] = e.TraceID
	}
	return m
}
