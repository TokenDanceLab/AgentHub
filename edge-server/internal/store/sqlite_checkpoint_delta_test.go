package store

import (
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func TestSQLiteCheckpointDeltaSkipsUnchangedRows(t *testing.T) {
	s, path := newSQLiteCheckpointDeltaFixture(t)
	// Observe real row updates, not an implementation helper or mock. A
	// legitimate checkpoint edit below verifies the audit trigger's sensitivity.
	if _, err := s.db.Exec(
		"CREATE TABLE checkpoint_updates (run_id TEXT NOT NULL); " +
			"CREATE TRIGGER audit_checkpoint_update AFTER UPDATE ON agenthub_store_rows " +
			"WHEN NEW.row_kind = 'checkpoint' BEGIN " +
			"INSERT INTO checkpoint_updates(run_id) VALUES (NEW.row_id); END;"); err != nil {
		t.Fatal(err)
	}
	updates := func() int {
		t.Helper()
		var count int
		if err := s.db.QueryRow("SELECT COUNT(*) FROM checkpoint_updates").Scan(&count); err != nil {
			t.Fatal(err)
		}
		return count
	}
	if _, ok := s.SetRunRetryCount("remove-run", 1); !ok {
		t.Fatalf("unrelated run mutation failed: %v", s.LastPersistError())
	}
	if got := updates(); got != 0 {
		t.Errorf("unrelated run mutation rewrote %d unchanged checkpoints", got)
	}

	cp, ok := s.GetRunCheckpoint("keep-run")
	if !ok {
		t.Fatal("keep checkpoint missing")
	}
	cp.Files[0].Content = "revised evidence"
	before := updates()
	if _, err := s.UpsertRunCheckpoint(cp); err != nil {
		t.Fatal(err)
	}
	if got := updates() - before; got != 1 {
		t.Errorf("legitimate checkpoint edit updated %d rows, want only its own row", got)
	}
	// Read back without a preceding Close/Flush that could repair a missed write.
	restored, err := NewSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(restored.Close)
	got, ok := restored.GetRunCheckpoint(cp.RunID)
	if !ok || !reflect.DeepEqual(got, cp) {
		t.Errorf("checkpoint edit was not durable: got=%#v ok=%v", got, ok)
	}
}

func TestSQLiteCheckpointDeltaRemovesRunEvidence(t *testing.T) {
	for _, removal := range []string{"terminal-cleanup", "delete-thread"} {
		t.Run(removal, func(t *testing.T) {
			s, path := newSQLiteCheckpointDeltaFixture(t)
			keep, ok := s.GetRunCheckpoint("keep-run")
			if !ok {
				t.Fatal("retained checkpoint missing before removal")
			}
			switch removal {
			case "terminal-cleanup":
				if _, ok := s.SetRunStatus("remove-run", "finished"); !ok {
					t.Fatal("complete run")
				}
				result := s.CleanupRuns(RunCleanupOptions{
					Now: time.Now().Add(2 * time.Hour), TerminalTTL: time.Hour,
				})
				if result.RemovedRuns != 1 {
					t.Fatalf("removed runs = %d, want 1", result.RemovedRuns)
				}
			case "delete-thread":
				if !s.DeleteThread("remove-thread") {
					t.Fatal("delete thread")
				}
			}
			if err := s.LastPersistError(); err != nil {
				t.Fatal(err)
			}
			if _, ok := s.GetRun("remove-run"); ok {
				t.Fatal("run remains after removal")
			}
			if _, ok := s.GetRunCheckpoint("remove-run"); ok {
				t.Error("removed run's checkpoint remains in memory")
			}
			var count int
			if err := s.db.QueryRow("SELECT COUNT(*) FROM agenthub_store_rows WHERE row_kind = ? AND row_id = ?",
				sqliteRowKindCheckpoint, "remove-run").Scan(&count); err != nil {
				t.Fatal(err)
			}
			if count != 0 {
				t.Errorf("removed run still has %d durable checkpoint rows", count)
			}
			// A new handle uses the actual load path before the original Close.
			restored, err := NewSQLite(path)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(restored.Close)
			if _, ok := restored.GetRunCheckpoint("remove-run"); ok {
				t.Error("removed run's checkpoint reappears after reopen")
			}
			if _, ok := restored.GetRun("keep-run"); !ok {
				t.Error("unrelated queued run was removed")
			}
			got, ok := restored.GetRunCheckpoint("keep-run")
			if !ok || !reflect.DeepEqual(got, keep) {
				t.Errorf("unrelated checkpoint changed: got=%#v ok=%v", got, ok)
			}
		})
	}
}

func newSQLiteCheckpointDeltaFixture(t *testing.T) (*SQLiteStore, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "checkpoint-delta.db")
	s, err := NewSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	if _, err := s.CreateProject("project", "Checkpoints", ""); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"keep", "remove"} {
		threadID, runID := name+"-thread", name+"-run"
		if _, err := s.CreateThread(threadID, "project", "Checkpoint", "", "", ""); err != nil {
			t.Fatal(err)
		}
		if _, err := s.CreateRun(runID, "project", threadID); err != nil {
			t.Fatal(err)
		}
		if _, err := s.UpsertRunCheckpoint(RunCheckpoint{
			ID: name + "-checkpoint", RunID: runID, WorkDir: "fixture", FileCount: 1,
			Files: []CheckpointFile{{Path: "input.txt", Content: name + " evidence"}},
		}); err != nil {
			t.Fatal(err)
		}
	}
	return s, path
}
