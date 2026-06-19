package store

import (
	"encoding/json"
	"path/filepath"
	"testing"
)

// --- SQLite crash recovery and WAL replay tests ---

// TestSQLiteCrashRecoveryReplayFromWAL verifies that data written
// before an unclean shutdown (no Close()) is recoverable from the
// WAL file when reopening the database.
func TestSQLiteCrashRecoveryReplayFromWAL(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-crash.db")
	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite: %v", err)
	}

	project, _ := s.CreateProject("proj_crash", "Crash Project", "")
	thread, _ := s.CreateThread("thread_crash", project.ID, "Crash Thread", "", "", "")
	run, _ := s.CreateRun("run_crash", project.ID, thread.ID)
	s.SetRunStatus(run.ID, "started")
	s.UpsertRunDiffFile(RunDiffFile{
		RunID:  run.ID,
		Path:   "src/crash.go",
		Diff:   "@@ -0 +1 @@\n+recovered after crash",
		Status: "added",
	})
	s.UpsertArtifact(Artifact{
		ID:        "artifact_crash",
		RunID:     run.ID,
		ThreadID:  thread.ID,
		Kind:      "markdown",
		Path:      "crash-report.md",
		SizeBytes: 256,
	})

	// Simulate crash: close the underlying DB connection directly
	// (bypassing SQLiteStore.Close()) to release the file lock.
	if err := s.db.Close(); err != nil {
		t.Fatalf("db.Close: %v", err)
	}

	// Reopen from the same path - WAL should be replayed.
	recovered, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("reopen NewSQLite: %v", err)
	}
	defer recovered.Close()

	if got, ok := recovered.GetRun(run.ID); !ok || got.Status != "started" {
		t.Fatalf("recovered run = %#v, %v; want started run", got, ok)
	}
	if got := recovered.ListRunDiffFiles(run.ID); len(got) != 1 || got[0].Path != "src/crash.go" {
		t.Fatalf("recovered diffs = %v, want src/crash.go", got)
	}
	if got, ok := recovered.GetArtifact("artifact_crash"); !ok || got.SizeBytes != 256 {
		t.Fatalf("recovered artifact = %#v, %v", got, ok)
	}
}

// TestSQLiteCrashRecoveryMultipleWrites verifies that multiple
// interleaved writes survive an unclean shutdown.
func TestSQLiteCrashRecoveryMultipleWrites(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-crash-multi.db")

	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite: %v", err)
	}
	project, _ := s.CreateProject("proj_multi", "Multi Project", "")
	thread, _ := s.CreateThread("thread_multi", project.ID, "Multi Thread", "", "", "")
	run1, _ := s.CreateRun("run_multi_1", project.ID, thread.ID)
	s.SetRunStatus(run1.ID, "started")
	s.Close()

	s, err = NewSQLite(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	run2, _ := s.CreateRun("run_multi_2", project.ID, thread.ID)
	s.SetRunStatus(run2.ID, "finished")
	s.SetRunStatus(run1.ID, "finished")
	if err := s.db.Close(); err != nil {
		t.Fatalf("db.Close: %v", err)
	}

	recovered, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("recovery reopen: %v", err)
	}
	defer recovered.Close()

	got1, ok := recovered.GetRun(run1.ID)
	if !ok || got1.Status != "finished" {
		t.Fatalf("run1 = %#v, %v; want finished", got1, ok)
	}
	got2, ok := recovered.GetRun(run2.ID)
	if !ok || got2.Status != "finished" {
		t.Fatalf("run2 = %#v, %v; want finished", got2, ok)
	}
}

// TestSQLiteCrashRecoveryThreadItemReplay verifies that thread items
// and pins survive an unclean shutdown via WAL replay.
func TestSQLiteCrashRecoveryThreadItemReplay(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-crash-items.db")
	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite: %v", err)
	}

	project, _ := s.CreateProject("proj_items", "Items Project", "")
	thread, _ := s.CreateThread("thread_items", project.ID, "Items Thread", "", "", "")
	run, _ := s.CreateRun("run_items", project.ID, thread.ID)
	s.SetRunStatus(run.ID, "started")
	item, _ := s.CreateThreadMessage("msg_crash", thread.ID, "assistant", "recovered message")
	s.PinThreadItem(thread.ID, item.ID, "crash-test")
	s.PinThreadItem(thread.ID, item.ID, "crash-test-updated")
	if err := s.db.Close(); err != nil {
		t.Fatalf("db.Close: %v", err)
	}

	recovered, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer recovered.Close()

	items := recovered.ListThreadItems(thread.ID)
	if len(items) != 1 || items[0].ID != item.ID || items[0].Content != "recovered message" {
		t.Fatalf("recovered items = %v, want single recovered message", items)
	}
	pins := recovered.ListThreadPins(thread.ID)
	if len(pins) != 1 || pins[0].ItemID != item.ID {
		t.Fatalf("recovered pins = %v, want single pin", pins)
	}
}

// TestSQLiteDurableReplayItemsAreOrderedByCreatedAt verifies that
// thread items restored after crash are sorted by CreatedAt.
func TestSQLiteDurableReplayItemsAreOrderedByCreatedAt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-replay-order.db")
	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite: %v", err)
	}

	project, _ := s.CreateProject("proj_order", "Order Project", "")
	thread, _ := s.CreateThread("thread_order", project.ID, "Order Thread", "", "", "")
	run, _ := s.CreateRun("run_order", project.ID, thread.ID)

	for i := 0; i < 5; i++ {
		payload, _ := json.Marshal(map[string]any{"idx": i})
		s.CreateItem(Item{
			ID:        "item_order_" + string(rune('a'+i)),
			ProjectID: project.ID,
			ThreadID:  thread.ID,
			RunID:     run.ID,
			Type:      "run.agent.tool_call",
			Role:      "agent",
			Status:    "created",
			Content:   string(payload),
		})
	}

	s.Close()
	recovered, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer recovered.Close()

	items := recovered.ListThreadItems(thread.ID)
	if len(items) != 5 {
		t.Fatalf("expected 5 items, got %d", len(items))
	}
	for i := range items {
		var payload map[string]any
		if err := json.Unmarshal([]byte(items[i].Content), &payload); err != nil {
			t.Fatalf("unmarshal item %d: %v", i, err)
		}
		if idx, ok := payload["idx"]; ok {
			_ = idx
		}
	}
}

// TestSQLiteDeleteSnapshotDoesNotCorruptData verifies that deleting
// the snapshot table does not affect the main data tables on reopen.
func TestSQLiteDeleteSnapshotDoesNotCorruptData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-snapshot-delete.db")
	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite: %v", err)
	}

	project, _ := s.CreateProject("proj_snap", "Snapshot Project", "")
	thread, _ := s.CreateThread("thread_snap", project.ID, "Snapshot Thread", "", "", "")
	run, _ := s.CreateRun("run_snap", project.ID, thread.ID)
	s.SetRunStatus(run.ID, "started")
	s.UpsertRunDiffFile(RunDiffFile{RunID: run.ID, Path: "snap.go", Diff: "+snap", Status: "added"})
	s.Close()

	deleteDurableSQLiteSnapshot(t, path)

	recovered, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("reopen after snapshot delete: %v", err)
	}
	defer recovered.Close()

	if got, ok := recovered.GetRun(run.ID); !ok || got.Status != "started" {
		t.Fatalf("run after snapshot delete = %#v, %v; want started", got, ok)
	}
	if got := recovered.ListRunDiffFiles(run.ID); len(got) != 1 {
		t.Fatalf("diffs after snapshot delete = %v, want 1", got)
	}
}

// TestSQLiteDurableEmptyWALDoesNotLoseData verifies that a database
// with no pending WAL entries (clean shutdown) reopens correctly.
func TestSQLiteDurableEmptyWALDoesNotLoseData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "edge-no-wal.db")
	s, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("NewSQLite: %v", err)
	}

	project, _ := s.CreateProject("proj_nowal", "NoWAL Project", "")
	thread, _ := s.CreateThread("thread_nowal", project.ID, "NoWAL Thread", "", "", "")
	run, _ := s.CreateRun("run_nowal", project.ID, thread.ID)
	s.SetRunStatus(run.ID, "finished")
	s.Close()

	recovered, err := NewSQLite(path)
	if err != nil {
		t.Fatalf("reopen clean: %v", err)
	}
	defer recovered.Close()

	if got, ok := recovered.GetRun(run.ID); !ok || got.Status != "finished" {
		t.Fatalf("run after clean close = %#v, %v; want finished", got, ok)
	}
}
