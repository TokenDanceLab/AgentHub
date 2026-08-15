package mcp

// Residual pure-helper peel: MCP tool pure helpers (#1104).
// jsonSchema, marshalResult, generateID and related utilities.

import (
	"encoding/json"
	"fmt"

	"github.com/agenthub/edge-server/internal/idgen"
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
// Delegates to idgen.New — the single edge-server implementation
// (crypto/rand with a monotonic fallback).
func generateID(prefix string) string {
	return idgen.New(prefix)
}
