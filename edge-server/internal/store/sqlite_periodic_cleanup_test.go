package store

import (
	"path/filepath"
	"testing"
	"testing/synctest"
	"time"
)

func TestSQLitePeriodicCleanupIsDurableBeforeClose(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		s, path := newSQLitePeriodicCleanupFixture(t, false)
		advanceSQLiteCleanupTick()
		if _, ok := s.GetRun("remove-run"); ok {
			t.Fatal("periodic cleanup did not remove the expired run from memory")
		}
		if got := sqliteCleanupFixtureRows(t, s); got != 0 {
			t.Errorf("periodic cleanup left %d durable run/evidence rows after removing them from memory", got)
		}
		stopSQLiteWithoutFinalPersist(t, s)
		assertSQLiteCleanupReopen(t, path)
	})
}

func TestSQLitePeriodicCleanupRetriesFailedCommit(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		s, path := newSQLitePeriodicCleanupFixture(t, true)
		advanceSQLiteCleanupTick()
		if _, ok := s.GetRun("remove-run"); ok {
			t.Fatal("failed persist unexpectedly retained the run in memory")
		}
		if s.LastPersistError() == nil {
			t.Fatal("periodic persist failure was not recorded")
		}
		if got := sqliteCleanupFixtureRows(t, s); got != 6 {
			t.Fatalf("failed cleanup transaction left %d rows, want all six retained", got)
		}
		if _, err := s.db.Exec("DROP TRIGGER reject_periodic_cleanup"); err != nil {
			t.Fatal(err)
		}
		// No business write or final Flush repairs the failed delete. The next
		// actual background tick must retry it despite an empty cleanup result.
		advanceSQLiteCleanupTick()
		if err := s.LastPersistError(); err != nil {
			t.Errorf("next cleanup tick did not clear recovered persist failure: %v", err)
		}
		if got := sqliteCleanupFixtureRows(t, s); got != 0 {
			t.Errorf("recovered periodic cleanup left %d durable rows", got)
		}
		stopSQLiteWithoutFinalPersist(t, s)
		assertSQLiteCleanupReopen(t, path)
	})
}

func TestSQLiteCloseFlushesPendingCleanup(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		s, path := newSQLitePeriodicCleanupFixture(t, true)
		advanceSQLiteCleanupTick()
		if s.LastPersistError() == nil {
			t.Fatal("expected the injected periodic persist failure")
		}
		if _, err := s.db.Exec("DROP TRIGGER reject_periodic_cleanup"); err != nil {
			t.Fatal(err)
		}
		// Do not advance to another tick: Close must flush pending memory after
		// its workers have stopped, then close the database.
		s.Close()
		if err := s.LastPersistError(); err != nil {
			t.Fatalf("final cleanup persist failed: %v", err)
		}
		assertSQLiteCleanupReopen(t, path)
	})
}

func TestSQLiteCloseWaitsForBackgroundWork(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		s, err := NewSQLite(filepath.Join(t.TempDir(), "close.db"))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(s.Close)
		release := make(chan struct{})
		s.backgroundWG.Go(func() { <-release })
		closed := make(chan struct{})
		go func() {
			s.Close()
			close(closed)
		}()
		synctest.Wait()
		select {
		case <-closed:
			t.Error("Close returned before owned background work finished")
		default:
		}
		if err := s.db.Ping(); err != nil {
			t.Errorf("database closed before owned background work finished: %v", err)
		}
		close(release)
		synctest.Wait()
		select {
		case <-closed:
		default:
			t.Error("Close did not finish after owned background work completed")
		}
		if err := s.db.Ping(); err == nil {
			t.Error("database remains open after Close")
		}
	})
}

// Virtual time drives the constructor's real production-cadence loops. No
// shortened production interval or wall-clock sleep is needed in these tests.
func advanceSQLiteCleanupTick() {
	synctest.Wait()
	<-time.After(sqliteBackgroundLoopInterval)
	synctest.Wait()
}

func newSQLitePeriodicCleanupFixture(t *testing.T, rejectDelete bool) (*SQLiteStore, string) {
	t.Helper()
	s, path := newSQLiteCheckpointDeltaFixture(t)
	if _, err := s.UpsertRunDiffFile(RunDiffFile{RunID: "remove-run", Path: "before.txt", Diff: "old evidence", Status: "modified"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpsertArtifact(Artifact{ID: "expired-artifact", RunID: "remove-run", Path: "before.txt"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpsertPreview(Preview{ID: "expired-preview", RunID: "remove-run", Status: "ready"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateItem(Item{ID: "expired-item", ProjectID: "project", ThreadID: "remove-thread", RunID: "remove-run", Type: "event"}); err != nil {
		t.Fatal(err)
	}
	s.store.mu.Lock()
	run := s.store.runs["remove-run"]
	run.Status = "finished"
	run.FinishedAt = time.Now().Add(-sqliteCleanupTerminalTTL - time.Hour).UTC().Format(time.RFC3339)
	s.store.runs[run.ID] = run
	s.store.mu.Unlock()
	if err := s.syncPersist(); err != nil {
		t.Fatal(err)
	}
	if got := sqliteCleanupFixtureRows(t, s); got != 6 {
		t.Fatalf("fixture durable rows = %d, want run and five evidence rows", got)
	}
	if rejectDelete {
		_, err := s.db.Exec("CREATE TRIGGER reject_periodic_cleanup BEFORE DELETE ON agenthub_store_rows " +
			"WHEN OLD.row_kind = 'run' AND OLD.row_id = 'remove-run' " +
			"BEGIN SELECT RAISE(ABORT, 'injected periodic cleanup failure'); END")
		if err != nil {
			t.Fatal(err)
		}
	}
	return s, path
}

func sqliteCleanupFixtureRows(t *testing.T, s *SQLiteStore) int {
	t.Helper()
	var count int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM agenthub_store_rows WHERE json_extract(payload, '$.runId') = ?", "remove-run").Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func stopSQLiteWithoutFinalPersist(t *testing.T, s *SQLiteStore) {
	t.Helper()
	s.closeOnce.Do(func() {
		close(s.stopCheckpoint)
		s.backgroundWG.Wait()
		if err := s.db.Close(); err != nil {
			t.Fatal(err)
		}
	})
}

func assertSQLiteCleanupReopen(t *testing.T, path string) {
	t.Helper()
	restored, err := NewSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(restored.Close)
	if got := sqliteCleanupFixtureRows(t, restored); got != 0 {
		t.Errorf("reopen restored %d expired run/evidence rows", got)
	}
	if _, ok := restored.GetRun("remove-run"); ok {
		t.Error("expired run reappeared after reopen")
	}
	if _, ok := restored.GetRunCheckpoint("remove-run"); ok {
		t.Error("expired checkpoint reappeared after reopen")
	}
	if run, ok := restored.GetRun("keep-run"); !ok || run.Status != "queued" {
		t.Error("unrelated queued run was removed or changed")
	}
	if cp, ok := restored.GetRunCheckpoint("keep-run"); !ok || len(cp.Files) != 1 || cp.Files[0].Content != "keep evidence" {
		t.Error("unrelated queued checkpoint was removed or changed")
	}
}
