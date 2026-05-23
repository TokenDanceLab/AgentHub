package runnerctx

import (
	"os"
	"strings"
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
