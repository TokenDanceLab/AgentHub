// Package otelids provides trace and span ID primitives for AgentHub's
// observability slice A. It intentionally avoids importing any OpenTelemetry
// SDK so the dependency footprint stays zero; a future slice B may replace
// these helpers with real OTel span creation while keeping the same context
// keys and header names.
package otelids

import (
	"context"
	"crypto/rand"
	"fmt"
	"log/slog"
	"net/http"
	"sync/atomic"
)

// TraceIDHeader is the HTTP header used to propagate an AgentHub trace id
// across service boundaries (Hub → Edge dispatch, WS frames, callbacks).
const TraceIDHeader = "X-AgentHub-Trace-ID"

type traceIDKey struct{}

var traceIDFallbackSeq uint64

// NewTraceID generates a 32-hex-character trace id compatible with W3C
// traceparent format (lowercase hex, no prefix). crypto/rand failure falls
// back to a process-local monotonic counter that remains unique within the
// process lifetime.
func NewTraceID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%032x", atomic.AddUint64(&traceIDFallbackSeq, 1))
	}
	return fmt.Sprintf("%x", b)
}

// WithTraceID returns a child context carrying the given trace id.
func WithTraceID(ctx context.Context, traceID string) context.Context {
	return context.WithValue(ctx, traceIDKey{}, traceID)
}

// FromContext extracts the trace id from ctx, returning "" when absent.
func FromContext(ctx context.Context) string {
	if v, ok := ctx.Value(traceIDKey{}).(string); ok {
		return v
	}
	return ""
}

// SlogAttr returns a slog.Attr for the trace id using the canonical key
// "trace_id". Empty ids produce a zero-value attr so callers can pass it
// unconditionally to slog.LogAttrs without polluting output.
func SlogAttr(traceID string) slog.Attr {
	return slog.String("trace_id", traceID)
}

// SetHTTPHeader writes the trace id onto the outbound HTTP header when non-empty.
func SetHTTPHeader(h http.Header, traceID string) {
	if traceID == "" {
		return
	}
	h.Set(TraceIDHeader, traceID)
}

// FromHTTPHeader reads the trace id from an inbound HTTP request, returning
// "" when the header is missing or empty.
func FromHTTPHeader(h http.Header) string {
	return h.Get(TraceIDHeader)
}
