package store

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

var _ Repository = (*FileStore)(nil)
var _ RunLifecycleStore = (*FileStore)(nil)

func TestFileStoreStartsEmptyWhenFileDoesNotExist(t *testing.T) {
	path := filepath.Join(t.TempDir(), "store.json")

	s, err := NewFile(path)
	if err != nil {
		t.Fatalf("NewFile returned error: %v", err)
	}
	if got := s.ListProjects(); len(got) != 0 {
		t.Fatalf("ListProjects = %#v, want empty", got)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("snapshot file exists before first write or stat failed: %v", err)
	}
}

func TestFileStoreRestoresProjectThreadRunItemAndOrder(t *testing.T) {
	path := filepath.Join(t.TempDir(), "store.json")

	s, err := NewFile(path)
	if err != nil {
		t.Fatalf("NewFile returned error: %v", err)
	}
	projectB := s.CreateProject("proj_b", "Project B")
	projectA := s.CreateProject("proj_a", "Project A")
	threadB, err := s.CreateThread("thread_b", projectB.ID, "Thread B")
	if err != nil {
		t.Fatalf("CreateThread thread_b returned error: %v", err)
	}
	threadA, err := s.CreateThread("thread_a", projectA.ID, "Thread A")
	if err != nil {
		t.Fatalf("CreateThread thread_a returned error: %v", err)
	}
	runB, err := s.CreateRun("run_b", projectB.ID, threadB.ID)
	if err != nil {
		t.Fatalf("CreateRun run_b returned error: %v", err)
	}
	runA, err := s.CreateRun("run_a", projectA.ID, threadA.ID)
	if err != nil {
		t.Fatalf("CreateRun run_a returned error: %v", err)
	}
	if _, ok := s.SetRunStatus(runA.ID, "started"); !ok {
		t.Fatal("SetRunStatus returned ok=false")
	}
	if _, err := s.CreateItem(Item{ID: "item_b", ProjectID: projectB.ID, ThreadID: threadB.ID, RunID: runB.ID, Type: "run", Status: "queued"}); err != nil {
		t.Fatalf("CreateItem item_b returned error: %v", err)
	}
	if _, err := s.CreateThreadMessage("item_a", threadA.ID, "assistant", "hello"); err != nil {
		t.Fatalf("CreateThreadMessage returned error: %v", err)
	}

	restored, err := NewFile(path)
	if err != nil {
		t.Fatalf("NewFile restored returned error: %v", err)
	}

	if got := restored.ListProjects(); len(got) != 2 || got[0].ID != "proj_b" || got[1].ID != "proj_a" {
		t.Fatalf("ListProjects = %#v, want proj_b then proj_a", got)
	}
	if got := restored.ListThreads(""); len(got) != 2 || got[0].ID != "thread_b" || got[1].ID != "thread_a" {
		t.Fatalf("ListThreads = %#v, want thread_b then thread_a", got)
	}
	if got := restored.ListRuns(""); len(got) != 2 || got[0].ID != "run_b" || got[1].ID != "run_a" {
		t.Fatalf("ListRuns = %#v, want run_b then run_a", got)
	}
	if got := restored.ListThreadItems(threadB.ID); len(got) != 1 || got[0].ID != "item_b" {
		t.Fatalf("ListThreadItems(thread_b) = %#v, want item_b", got)
	}
	if got := restored.ListThreadItems(threadA.ID); len(got) != 1 || got[0].ID != "item_a" {
		t.Fatalf("ListThreadItems(thread_a) = %#v, want item_a", got)
	}
	if got, ok := restored.GetRun(runA.ID); !ok || got.Status != "started" || got.StartedAt == "" {
		t.Fatalf("GetRun(run_a) = %#v, %v, want started run with StartedAt", got, ok)
	}
	if got, ok := restored.GetItem("item_a"); !ok || got.Content != "hello" || got.Role != "assistant" {
		t.Fatalf("GetItem(item_a) = %#v, %v, want restored message item", got, ok)
	}
}

func TestFileStoreRejectsBadJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "store.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o644); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}

	_, err := NewFile(path)
	if err == nil {
		t.Fatal("NewFile returned nil error for bad JSON")
	}
}

func TestFileStoreDoesNotLeaveTempFilesAfterSave(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "store.json")

	s, err := NewFile(path)
	if err != nil {
		t.Fatalf("NewFile returned error: %v", err)
	}
	s.CreateProject("proj_test", "Test Project")

	matches, err := filepath.Glob(filepath.Join(dir, "store.json.tmp-*"))
	if err != nil {
		t.Fatalf("Glob returned error: %v", err)
	}
	if len(matches) != 0 {
		t.Fatalf("temp files = %#v, want none", matches)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("snapshot file was not saved: %v", err)
	}
}

func TestSaveFileSnapshotCleansTempFileAfterReplaceFailure(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "store.json")
	if err := os.Mkdir(path, 0o755); err != nil {
		t.Fatalf("Mkdir returned error: %v", err)
	}

	err := saveFileSnapshot(path, fileSnapshot{
		Projects: map[string]Project{
			"proj_test": {ID: "proj_test", Name: "Test Project"},
		},
		ProjectOrder: []string{"proj_test"},
	})
	if err == nil {
		t.Fatal("saveFileSnapshot returned nil error for directory target")
	}

	matches, err := filepath.Glob(filepath.Join(dir, "store.json.tmp-*"))
	if err != nil {
		t.Fatalf("Glob returned error: %v", err)
	}
	if len(matches) != 0 {
		t.Fatalf("temp files = %#v, want none after failed replace", matches)
	}
	if info, err := os.Stat(path); err != nil || !info.IsDir() {
		t.Fatalf("target state changed, stat = %#v, err = %v; want original directory", info, err)
	}
}
