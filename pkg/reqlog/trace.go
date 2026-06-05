package reqlog

import (
	"context"
	"crypto/rand"
	"fmt"
	"sync/atomic"
)

type traceIDKey struct{}
type requestIDKey struct{}

var traceSeq uint64

// NewRequestID generates a unique request ID (UUIDv4-based).
func NewRequestID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("req_%016x", atomic.AddUint64(&traceSeq, 1))
	}
	return fmt.Sprintf("req_%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

// NewTraceID generates a short, ordered trace ID for error responses.
func NewTraceID() string {
	n := atomic.AddUint64(&traceSeq, 1)
	return fmt.Sprintf("trace_%06d", n)
}

// GetRequestID extracts the request ID from context.
func GetRequestID(ctx context.Context) string {
	if v, ok := ctx.Value(requestIDKey{}).(string); ok {
		return v
	}
	return ""
}

// WithRequestID injects the request ID into context.
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey{}, id)
}
