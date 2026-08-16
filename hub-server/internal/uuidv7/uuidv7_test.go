package uuidv7

import (
	"strings"
	"sync"
	"testing"
)

func TestNewReturnsUUID(t *testing.T) {
	id, err := New()
	if err != nil {
		t.Fatalf("New() returned error: %v", err)
	}
	if id == "" {
		t.Fatal("expected non-empty UUID string")
	}
	// UUID v7 format: xxxxxxxx-xxxx-7xxx-xxxx-xxxxxxxxxxxx
	parts := strings.Split(id, "-")
	if len(parts) != 5 {
		t.Fatalf("expected UUID format with 5 dash-separated parts, got %q", id)
	}
	if len(parts[0]) != 8 || len(parts[1]) != 4 || len(parts[2]) != 4 || len(parts[3]) != 4 || len(parts[4]) != 12 {
		t.Fatalf("expected UUID segment lengths 8-4-4-4-12, got %q", id)
	}
	// Version 7 = 4th nibble of 3rd segment must be '7'
	if parts[2][0] != '7' {
		t.Fatalf("expected UUID v7 (4th nibble = 7), got 3rd segment %q in %q", parts[2], id)
	}
}

func TestMustReturnsUUID(t *testing.T) {
	id := Must()
	if id == "" {
		t.Fatal("Must() returned empty string")
	}
	parts := strings.Split(id, "-")
	if len(parts) != 5 {
		t.Fatalf("expected UUID format, got %q", id)
	}
}

func TestNewUniqueness(t *testing.T) {
	ids := make(map[string]bool)
	for range 1000 {
		id, err := New()
		if err != nil {
			t.Fatalf("New() returned error: %v", err)
		}
		if ids[id] {
			t.Fatal("duplicate UUID generated")
		}
		ids[id] = true
	}
}

func TestMustUniqueness(t *testing.T) {
	ids := make(map[string]bool)
	for range 100 {
		id := Must()
		if ids[id] {
			t.Fatal("duplicate UUID from Must()")
		}
		ids[id] = true
	}
}

func TestConcurrentNew(t *testing.T) {
	var wg sync.WaitGroup
	ids := make(chan string, 100)
	for range 50 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			id, err := New()
			if err != nil {
				t.Errorf("New() returned error: %v", err)
				return
			}
			ids <- id
		}()
	}
	wg.Wait()
	close(ids)

	seen := make(map[string]bool)
	for id := range ids {
		if seen[id] {
			t.Fatal("duplicate UUID during concurrent generation")
		}
		seen[id] = true
	}
}
