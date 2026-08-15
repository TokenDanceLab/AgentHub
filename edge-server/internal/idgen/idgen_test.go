package idgen

import (
	"strings"
	"testing"
)

func TestNewPrefixAndShape(t *testing.T) {
	id := New("run_")
	if !strings.HasPrefix(id, "run_") {
		t.Fatalf("New = %q, want run_ prefix", id)
	}
	if len(id) != len("run_")+16 {
		t.Fatalf("New = %q (len=%d), want prefix+16 hex", id, len(id))
	}
}

func TestHexShapeAndUniqueness(t *testing.T) {
	a := Hex()
	b := Hex()
	if len(a) != 16 || len(b) != 16 {
		t.Fatalf("Hex lengths = %d/%d, want 16", len(a), len(b))
	}
	if a == b {
		t.Fatal("Hex returned duplicate values")
	}
	for _, c := range a {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			t.Fatalf("Hex contains non-hex char %q", c)
		}
	}
}

func TestNewUniquenessAcrossCalls(t *testing.T) {
	seen := make(map[string]struct{}, 200)
	for range 200 {
		id := New("item_")
		if _, ok := seen[id]; ok {
			t.Fatalf("New returned duplicate ID %q", id)
		}
		seen[id] = struct{}{}
	}
}
