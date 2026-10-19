package mcp

// jsonSchema, marshalResult, generateID and related utilities.

import (
	"encoding/json"
	"fmt"

	"github.com/agenthub/edge-server/internal/idgen"
)

// jsonSchema validates a compile-time JSON schema literal and returns it as
// json.RawMessage. A malformed literal is a programming error, so fail fast.
func jsonSchema(schema string) json.RawMessage {
	var v any
	if err := json.Unmarshal([]byte(schema), &v); err != nil {
		panic(fmt.Sprintf("invalid MCP tool schema: %v", err))
	}
	return json.RawMessage(schema)
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
// Delegates to idgen.New — the single edge-server implementation
// (crypto/rand with a monotonic fallback).
func generateID(prefix string) string {
	return idgen.New(prefix)
}
