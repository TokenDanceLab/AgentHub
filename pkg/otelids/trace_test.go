package otelids

import (
	"regexp"
	"testing"
)

func TestNewTraceIDFormatAndUniqueness(t *testing.T) {
	hex32 := regexp.MustCompile(`^[0-9a-f]{32}$`)
	seen := make(map[string]struct{}, 1000)
	for i := 0; i < 1000; i++ {
		id := NewTraceID()
		if !hex32.MatchString(id) {
			t.Fatalf("trace id %q does not match 32-hex format", id)
		}
		if _, ok := seen[id]; ok {
			t.Fatalf("duplicate trace id %q on iteration %d", id, i)
		}
		seen[id] = struct{}{}
	}
}
