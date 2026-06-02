package handler

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNormalizeUUID(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
		ok    bool
	}{
		{name: "valid uuid", input: "550e8400-e29b-41d4-a716-446655440000", want: "550e8400-e29b-41d4-a716-446655440000", ok: true},
		{name: "valid uuid with spaces", input: "  550e8400-e29b-41d4-a716-446655440000  ", want: "550e8400-e29b-41d4-a716-446655440000", ok: true},
		{name: "empty string", input: "", want: "", ok: false},
		{name: "whitespace only", input: "   ", want: "", ok: false},
		{name: "invalid format", input: "not-a-uuid", want: "", ok: false},
		{name: "too short", input: "550e8400", want: "", ok: false},
		{name: "nil uuid all zeros", input: "00000000-0000-0000-0000-000000000000", want: "00000000-0000-0000-0000-000000000000", ok: true},
		{name: "uppercase uuid", input: "550E8400-E29B-41D4-A716-446655440000", want: "550e8400-e29b-41d4-a716-446655440000", ok: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := normalizeUUID(tt.input)
			assert.Equal(t, tt.ok, ok)
			assert.Equal(t, tt.want, got)
		})
	}
}
