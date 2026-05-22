package store

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
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

func TestFileStoreTreatsEmptySnapshotAsEmptyStore(t *testing.T) {
	tests := map[string]string{
		"zero_bytes": "",
		"whitespace": " \n\t ",
	}
	for name, content := range tests {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "store.json")
			if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
				t.Fatalf("WriteFile returned error: %v", err)
			}

			s, err := NewFile(path)
			if err != nil {
				t.Fatalf("NewFile returned error: %v", err)
			}
			if got := s.ListProjects(); len(got) != 0 {
				t.Fatalf("ListProjects = %#v, want empty", got)
			}
		})
	}
}

func TestFileStoreRestoresEmptyJSONObjectAsEmptyStore(t *testing.T) {
	path := filepath.Join(t.TempDir(), "store.json")
	if err := os.WriteFile(path, []byte("{}"), 0o644); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}

	s, err := NewFile(path)
	if err != nil {
		t.Fatalf("NewFile returned error: %v", err)
	}
	if got := s.ListProjects(); len(got) != 0 {
		t.Fatalf("ListProjects = %#v, want empty", got)
	}
}

func TestFileStoreRejectsTrailingData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "store.json")
	if err := os.WriteFile(path, []byte("{} {}"), 0o644); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}

	_, err := NewFile(path)
	if err == nil || !strings.Contains(err.Error(), "trailing data") {
		t.Fatalf("NewFile error = %v, want trailing data error", err)
	}
}

func TestFileStoreFillsMissingOrderFromSnapshotMaps(t *testing.T) {
	path := filepath.Join(t.TempDir(), "store.json")
	content := []byte(`{
  "projects": {
    "proj_a": {"projectId": "proj_a", "name": "A", "status": "active"},
    "proj_b": {"projectId": "proj_b", "name": "B", "status": "active"}
  },
  "threads": {
    "thread_a": {"threadId": "thread_a", "projectId": "proj_a", "title": "A", "status": "active"},
    "thread_b": {"threadId": "thread_b", "projectId": "proj_b", "title": "B", "status": "active"}
  },
  "runs": {
    "run_a": {"runId": "run_a", "projectId": "proj_a", "threadId": "thread_a", "status": "queued"},
    "run_b": {"runId": "run_b", "projectId": "proj_b", "threadId": "thread_b", "status": "queued"}
  },
  "items": {
    "item_a": {"itemId": "item_a", "projectId": "proj_a", "threadId": "thread_a", "type": "event", "status": "created", "createdAt": "2026-05-23T00:00:00Z"},
    "item_b": {"itemId": "item_b", "projectId": "proj_b", "threadId": "thread_b", "type": "event", "status": "created", "createdAt": "2026-05-23T00:00:00Z"}
  },
  "projectOrder": ["proj_b", "missing", "proj_b"],
  "threadOrder": ["thread_b"],
  "runOrder": ["run_b"],
  "itemOrder": ["item_b"]
}`)
	if err := os.WriteFile(path, content, 0o644); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}

	s, err := NewFile(path)
	if err != nil {
		t.Fatalf("NewFile returned error: %v", err)
	}
	if got := s.ListProjects(); len(got) != 2 || got[0].ID != "proj_b" || got[1].ID != "proj_a" {
		t.Fatalf("ListProjects = %#v, want existing valid order then sorted missing", got)
	}
	if got := s.ListThreads(""); len(got) != 2 || got[0].ID != "thread_b" || got[1].ID != "thread_a" {
		t.Fatalf("ListThreads = %#v, want existing valid order then sorted missing", got)
	}
	if got := s.ListRuns(""); len(got) != 2 || got[0].ID != "run_b" || got[1].ID != "run_a" {
		t.Fatalf("ListRuns = %#v, want existing valid order then sorted missing", got)
	}
	if got := s.ListThreadItems("thread_b"); len(got) != 1 || got[0].ID != "item_b" {
		t.Fatalf("ListThreadItems(thread_b) = %#v, want item_b", got)
	}
	if got := s.ListThreadItems("thread_a"); len(got) != 1 || got[0].ID != "item_a" {
		t.Fatalf("ListThreadItems(thread_a) = %#v, want item_a", got)
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

func TestFileStoreLastPersistErrorTracksSaveFailure(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "store.json")

	s, err := NewFile(path)
	if err != nil {
		t.Fatalf("NewFile returned error: %v", err)
	}
	if err := os.Mkdir(path, 0o755); err != nil {
		t.Fatalf("Mkdir returned error: %v", err)
	}

	s.CreateProject("proj_test", "Test Project")
	if err := s.LastPersistError(); err == nil {
		t.Fatal("LastPersistError returned nil after persist failure")
	}
}
