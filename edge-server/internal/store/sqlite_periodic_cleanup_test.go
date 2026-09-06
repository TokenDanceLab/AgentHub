package store

import (
	"testing"
	"time"

	"github.com/agenthub/pkg/testkit"
)

func TestSQLitePeriodicCleanupIsDurableBeforeClose(t *testing.T) {
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
	// Age only the fixture; do not wait a day or alter the retention policy.
	s.store.mu.Lock()
	run := s.store.runs["remove-run"]
	run.Status = "finished"
	run.FinishedAt = time.Now().Add(-sqliteCleanupTerminalTTL - time.Hour).UTC().Format(time.RFC3339)
	s.store.runs[run.ID] = run
	s.store.mu.Unlock()
	if err := s.syncPersist(); err != nil {
		t.Fatal(err)
	}
	countRows := func() int {
		t.Helper()
		var count int
		if err := s.db.QueryRow("SELECT COUNT(*) FROM agenthub_store_rows WHERE json_extract(payload, '$.runId') = ?", run.ID).Scan(&count); err != nil {
			t.Fatal(err)
		}
		return count
	}
	if got := countRows(); got != 6 {
		t.Fatalf("fixture durable rows = %d, want run and five evidence rows", got)
	}

	loopDone := make(chan struct{})
	go func() {
		defer close(loopDone)
		s.cleanupLoop(time.Millisecond)
	}()
	t.Cleanup(func() {
		s.Close()
		testkit.WaitFor(t, 5*time.Second, loopDone, "cleanup loop stopped")
	})
	testkit.Eventually(t, 5*time.Second, func() bool {
		_, ok := s.GetRun(run.ID)
		return !ok
	}, "periodic cleanup removed expired run from memory", nil)

	// Finish the observed tick, but bypass Close's final persist: that would
	// otherwise hide a periodic-cleanup write missing from durable storage.
	s.closeOnce.Do(func() {
		close(s.stopCheckpoint)
		testkit.WaitFor(t, 5*time.Second, loopDone, "cleanup tick completed")
		defer s.db.Close()
		if got := countRows(); got != 0 {
			t.Errorf("periodic cleanup left %d durable run/evidence rows after removing them from memory", got)
		}
	})
	restored, err := NewSQLite(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(restored.Close)
	if _, ok := restored.GetRun(run.ID); ok {
		t.Error("expired run reappeared after reopen without a final Flush/Close persist")
	}
	if _, ok := restored.GetRunCheckpoint(run.ID); ok {
		t.Error("expired checkpoint reappeared after reopen")
	}
	if _, ok := restored.GetRun("keep-run"); !ok {
		t.Error("unrelated queued run was removed")
	}
	if _, ok := restored.GetRunCheckpoint("keep-run"); !ok {
		t.Error("unrelated queued checkpoint was removed")
	}
}
