// Package otelids provides trace ID generation for AgentHub without importing
// any OpenTelemetry SDK.
package otelids

import (
	"crypto/rand"
	"fmt"
	"sync/atomic"
)

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
