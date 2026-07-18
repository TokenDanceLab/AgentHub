package mcp

// Residual pure-helper peel: MCP tool pure helpers (#1104).
// jsonSchema, marshalResult, generateID and related utilities.

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync/atomic"
)

// jsonSchema parses a JSON schema string into a json.RawMessage.
// Used at init-time for tool InputSchema definitions.
// If parsing fails, returns an empty object schema {"type": "object"} as a safe
// fallback (malformed schema strings are a compile-time bug, not a runtime error).
func jsonSchema(schema string) json.RawMessage {
	var v any
	if err := json.Unmarshal([]byte(schema), &v); err != nil {
		return json.RawMessage(`{"type":"object"}`)
	}
	result, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage(`{"type":"object"}`)
	}
	return result
}

// marshalResult converts a Go value to json.RawMessage for tool results.
// Returns an error if JSON marshalling fails (should never happen with
// well-formed result types).
func marshalResult(v any) (json.RawMessage, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal result: %w", err)
	}
	return data, nil
}

// generateID creates a unique identifier with the given prefix.
//
// Uses crypto/rand to produce 16-hex-digit collision-resistant IDs (prefix + 16 hex).
// If crypto/rand.Read fails (extremely rare — can happen in constrained
// environments), falls back to a monotonic atomic counter. The counter is
// guaranteed unique within the process lifetime and avoids the collision risk
// of timestamp-based fallbacks.
func generateID(prefix string) string {
	b := make([]byte, 8)
	if _, err := randRead(b); err != nil {
		// Fallback: monotonic counter, not timestamp-based.
		// Timestamps can collide in tight loops; an atomic counter is
		// guaranteed unique within the process lifetime.
		slog.Warn("mcp: crypto/rand.Read failed, falling back to atomic counter", "error", err)
		return prefix + fmt.Sprintf("%d", fallbackCounter.Add(1))
	}
	return prefix + hexEncode(b)
}

// fallbackCounter provides a monotonic unique counter for the rare case
// when crypto/rand.Read fails. It guarantees uniqueness within the
// process lifetime and avoids collision risks of timestamp-based IDs.
// Used only by generateID in the crypto/rand fallback path.
var fallbackCounter atomic.Int64

// randRead is crypto/rand.Read, exposed as a package variable for testing.
// Tests can override this to simulate crypto/rand failures.
var randRead = randReadImpl

func randReadImpl(b []byte) (int, error) {
	return rand.Read(b)
}

// hexEncode encodes a byte slice to a lowercase hex string.
// Uses a precomputed lookup table for performance — avoids fmt.Sprintf
// allocations in the hot path (called on every run/message/item creation).
func hexEncode(b []byte) string {
	const hextable = "0123456789abcdef"
	dst := make([]byte, len(b)*2)
	for i, v := range b {
		dst[i*2] = hextable[v>>4]
		dst[i*2+1] = hextable[v&0x0f]
	}
	return string(dst)
}
