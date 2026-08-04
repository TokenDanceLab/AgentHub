package reqlog

import (
	"context"
	"crypto/rand"
	"fmt"
	"net/http"
	"sync/atomic"
)

type traceIDKey struct{}
type requestIDKey struct{}

// RequestIDHeader is the header used to propagate the request id on inbound
// and outbound HTTP calls (#1595 correlation contract). Inbound middleware
// (AccessLog / AccessLogGin) reads it, outbound call sites set it from the
// caller context via SetRequestIDHeader.
const RequestIDHeader = "X-Request-ID"

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

// SetRequestIDHeader propagates the caller's request id to an outbound
// request (#1595): when ctx carries a request id, header gets X-Request-ID
// set, so the receiving side can correlate the call with the originating
// request. No-op when ctx has no request id.
func SetRequestIDHeader(ctx context.Context, header http.Header) {
	if id := GetRequestID(ctx); id != "" {
		header.Set(RequestIDHeader, id)
	}
}
