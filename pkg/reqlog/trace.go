package reqlog

import (
	"context"
	"crypto/rand"
	"fmt"
	"net/http"
	"sync/atomic"
)

type requestIDKey struct{}

// RequestIDHeader is the header used to propagate the request id on inbound
// and outbound HTTP calls (#1595 correlation contract). Inbound middleware
// (AccessLog / AccessLogGin) reads it, outbound call sites set it from the
// caller context via SetRequestIDHeader.
const RequestIDHeader = "X-Request-ID"

var requestIDFallbackSeq uint64

// NewRequestID generates a unique request ID: a real RFC 4122 UUIDv4 with
// the "req_" prefix (e.g. req_7f3c9a21-…). The version/variant bits are set
// explicitly so downstream log collectors can parse it as a UUID — before
// #1675 this was a hand-formatted pseudo-UUID with no version nibble.
//
// Role in the backend ID scheme (see hub-server/internal/uuidv7): request
// IDs are correlation keys, so uniqueness — not time ordering — is the
// requirement; UUIDv4 is the right format here. When crypto/rand fails
// (extremely rare) the fallback is a process-local monotonic counter, which
// stays unique within the process lifetime.
func NewRequestID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("req_%016x", atomic.AddUint64(&requestIDFallbackSeq, 1))
	}
	// RFC 4122 v4: version nibble and variant bits.
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("req_%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
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
