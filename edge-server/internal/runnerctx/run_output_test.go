package runnerctx

import (
	"os"
	"strings"
	"sync"
	"testing"
)

func TestWriteAndReadAll(t *testing.T) {
	store, err := NewRunOutputStore("test-write-read")
	if err != nil {
		t.Fatalf("NewRunOutputStore: %v", err)
	}
	defer func() {
		if store.file != nil {
			store.Close()
		}
	}()

	n, err := store.Write("hello ")
	if err != nil {
		t.Fatalf("Write: %v", err)
	}
	if n != 6 {
		t.Fatalf("Write n = %d, want 6", n)
	}

	n, err = store.Write("world")
	if err != nil {
		t.Fatalf("Write: %v", err)
	}
	if n != 5 {
		t.Fatalf("Write n = %d, want 5", n)
	}

	got, err := store.ReadAll()
	if err != nil {
		t.Fatalf("ReadAll: %v", err)
	}
	if got != "hello world" {
		t.Fatalf("ReadAll = %q, want %q", got, "hello world")
	}
}

func TestReadAllAfterClose(t *testing.T) {
	store, err := NewRunOutputStore("test-read-after-close")
	if err != nil {
		t.Fatalf("NewRunOutputStore: %v", err)
	}
	store.Write("some data")

	if err := store.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	got, err := store.ReadAll()
	if err != nil {
		t.Fatalf("ReadAll after close: %v", err)
	}
	if got != "" {
		t.Fatalf("ReadAll after close = %q, want empty string", got)
	}
}

func TestCloseIsIdempotent(t *testing.T) {
	store, err := NewRunOutputStore("test-close-idempotent")
	if err != nil {
		t.Fatalf("NewRunOutputStore: %v", err)
	}
	store.Write("data")

	if err := store.Close(); err != nil {
		t.Fatalf("first Close: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("second Close: %v", err)
	}

	// File should be removed after close
	if _, err := os.Stat(store.Path()); !os.IsNotExist(err) {
		t.Fatalf("file still exists after Close: %v", err)
	}
}

func TestPath(t *testing.T) {
	store, err := NewRunOutputStore("test-path")
	if err != nil {
		t.Fatalf("NewRunOutputStore: %v", err)
	}
	defer store.Close()

	p := store.Path()
	if p == "" {
		t.Fatal("Path returned empty string")
	}
	if !strings.Contains(p, "agenthub-run-test-path.log") {
		t.Fatalf("Path %q does not contain expected filename pattern", p)
	}
}

func TestNewRunOutputStoreNonExistentDir(t *testing.T) {
	// Use a path with null byte to force os.Create to fail
	_, err := NewRunOutputStore("run\x00id")
	if err == nil {
		t.Fatal("expected error for runID with null byte")
	}
}

// --- ReadAll error paths ---

func TestReadAllAfterFileClosed(t *testing.T) {
	store, err := NewRunOutputStore("test-readall-sync-err")
	if err != nil {
		t.Fatalf("NewRunOutputStore: %v", err)
	}
	store.Write("data")

	// Read once to confirm works
	got, err := store.ReadAll()
	if err != nil {
		t.Fatalf("ReadAll before close: %v", err)
	}
	if got != "data" {
		t.Fatalf("ReadAll = %q, want data", got)
	}

	// Close the store properly
	if err := store.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	// ReadAll after close returns empty
	got, err = store.ReadAll()
	if err != nil {
		t.Fatalf("ReadAll after close: %v", err)
	}
	if got != "" {
		t.Fatalf("ReadAll after close = %q, want empty", got)
	}
}

// --- Concurrent Write tests ---

func TestConcurrentWrite(t *testing.T) {
	store, err := NewRunOutputStore("test-concurrent-write")
	if err != nil {
		t.Fatalf("NewRunOutputStore: %v", err)
	}
	defer store.Close()

	const goroutines = 50
	const writesPerGoroutine = 20

	var wg sync.WaitGroup
	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < writesPerGoroutine; j++ {
				store.Write("x")
			}
		}()
	}
	wg.Wait()

	got, err := store.ReadAll()
	if err != nil {
		t.Fatalf("ReadAll: %v", err)
	}
	if len(got) != goroutines*writesPerGoroutine {
		t.Fatalf("ReadAll len = %d, want %d", len(got), goroutines*writesPerGoroutine)
	}
}

func TestWriteLargeString(t *testing.T) {
	store, err := NewRunOutputStore("test-large-write")
	if err != nil {
		t.Fatalf("NewRunOutputStore: %v", err)
	}
	defer store.Close()

	// Write a 100KB string
	large := make([]byte, 102400)
	for i := range large {
		large[i] = 'A'
	}
	n, err := store.Write(string(large))
	if err != nil {
		t.Fatalf("Write large: %v", err)
	}
	if n != len(large) {
		t.Fatalf("Write large n = %d, want %d", n, len(large))
	}

	got, err := store.ReadAll()
	if err != nil {
		t.Fatalf("ReadAll large: %v", err)
	}
	if len(got) != len(large) {
		t.Fatalf("ReadAll len = %d, want %d", len(got), len(large))
	}
}

func TestMultipleReadAllCalls(t *testing.T) {
	store, err := NewRunOutputStore("test-multiple-readall")
	if err != nil {
		t.Fatalf("NewRunOutputStore: %v", err)
	}
	defer store.Close()

	store.Write("first batch ")
	got1, err := store.ReadAll()
	if err != nil {
		t.Fatalf("ReadAll #1: %v", err)
	}

	store.Write("second batch")
	got2, err := store.ReadAll()
	if err != nil {
		t.Fatalf("ReadAll #2: %v", err)
	}

	// ReadAll returns cumulative content
	if got1 != "first batch " {
		t.Fatalf("ReadAll #1 = %q, want 'first batch '", got1)
	}
	if got2 != "first batch second batch" {
		t.Fatalf("ReadAll #2 = %q, want 'first batch second batch'", got2)
	}
}

func TestRunOutputStorePathUnique(t *testing.T) {
	store1, err := NewRunOutputStore("unique-run-1")
	if err != nil {
		t.Fatalf("NewRunOutputStore #1: %v", err)
	}
	defer store1.Close()

	store2, err := NewRunOutputStore("unique-run-2")
	if err != nil {
		t.Fatalf("NewRunOutputStore #2: %v", err)
	}
	defer store2.Close()

	// Each run gets its own path
	if store1.Path() == store2.Path() {
		t.Fatal("Paths should be different for different run IDs")
	}
}
