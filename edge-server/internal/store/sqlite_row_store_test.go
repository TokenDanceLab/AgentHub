package store

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestSQLiteStoreRestoresContractRowsWhenSnapshotIsMissing(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-store.db")
	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite returned error: %v", err)
	}

	project, err := s.CreateProject("proj_rows", "Rows Project")
	if err != nil {
		t.Fatalf("CreateProject returned error: %v", err)
	}
	thread, err := s.CreateThread("thread_rows", project.ID, "Rows Thread")
	if err != nil {
		t.Fatalf("CreateThread returned error: %v", err)
	}
	run, err := s.CreateRun("run_rows", project.ID, thread.ID)
	if err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}
	item, err := s.CreateThreadMessage("item_rows", thread.ID, "assistant", "row-first message")
	if err != nil {
		t.Fatalf("CreateThreadMessage returned error: %v", err)
	}
	if _, err := s.PinThreadItem(thread.ID, item.ID, "AgentHub"); err != nil {
		t.Fatalf("PinThreadItem returned error: %v", err)
	}
	if _, err := s.UpsertRunDiffFile(RunDiffFile{RunID: run.ID, Path: "src/main.go", Diff: "+row", Status: "created"}); err != nil {
		t.Fatalf("UpsertRunDiffFile returned error: %v", err)
	}
	if _, err := s.UpsertArtifact(Artifact{ID: "artifact_rows", RunID: run.ID, Path: "rows.log"}); err != nil {
		t.Fatalf("UpsertArtifact returned error: %v", err)
	}
	if _, err := s.UpsertPreview(Preview{ID: "preview_rows", RunID: run.ID, URL: "http://127.0.0.1:4173"}); err != nil {
		t.Fatalf("UpsertPreview returned error: %v", err)
	}
	s.Close()

	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	if _, err := db.Exec(`DELETE FROM agenthub_store_snapshots`); err != nil {
		db.Close()
		t.Fatalf("delete snapshot returned error: %v", err)
	}
	db.Close()

	restored, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite without snapshot returned error: %v", err)
	}
	defer restored.Close()

	if got := restored.ListProjects(); len(got) != 1 || got[0].ID != project.ID {
		t.Fatalf("restored projects = %#v, want %s", got, project.ID)
	}
	if got := restored.ListThreads(project.ID); len(got) != 1 || got[0].ID != thread.ID {
		t.Fatalf("restored threads = %#v, want %s", got, thread.ID)
	}
	if got := restored.ListRuns(thread.ID); len(got) != 1 || got[0].ID != run.ID {
		t.Fatalf("restored runs = %#v, want %s", got, run.ID)
	}
	if got := restored.ListThreadItems(thread.ID); len(got) != 1 || got[0].ID != item.ID || got[0].Content != "row-first message" {
		t.Fatalf("restored thread items = %#v, want %s", got, item.ID)
	}
	if got := restored.ListThreadPins(thread.ID); len(got) != 1 || got[0].ItemID != item.ID {
		t.Fatalf("restored pins = %#v, want pin for %s", got, item.ID)
	}
	if got := restored.ListRunDiffFiles(run.ID); len(got) != 1 || got[0].Path != "src/main.go" {
		t.Fatalf("restored diffs = %#v, want src/main.go", got)
	}
	if got := restored.ListArtifacts(run.ID); len(got) != 1 || got[0].ID != "artifact_rows" {
		t.Fatalf("restored artifacts = %#v, want artifact_rows", got)
	}
	if got := restored.ListPreviews(run.ID); len(got) != 1 || got[0].ID != "preview_rows" {
		t.Fatalf("restored previews = %#v, want preview_rows", got)
	}
}
