package hub

import (
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/edgehttp"
)

func TestSQLiteDeliveryJournal_PersistsAcrossOpen(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "journal.db")

	j1, err := OpenSQLiteDeliveryJournal(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	seq, err := j1.Record("task-1", "run-1", "ack", true, "", 1)
	if err != nil || seq == 0 {
		t.Fatalf("record: seq=%d err=%v", seq, err)
	}
	if err := j1.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	j2, err := OpenSQLiteDeliveryJournal(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer j2.Close()
	entries, err := j2.Snapshot(0)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if len(entries) != 1 || entries[0].TaskID != "task-1" || entries[0].Action != "ack" || !entries[0].OK {
		t.Fatalf("entries=%+v", entries)
	}
}

func TestSQLiteDeliveryJournal_HasSuccessful(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "journal.db")
	j, err := OpenSQLiteDeliveryJournal(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer j.Close()

	ok, err := j.HasSuccessful("task-1", "run-1", "ack")
	if err != nil || ok {
		t.Fatalf("before record: ok=%v err=%v", ok, err)
	}
	if _, err := j.Record("task-1", "run-1", "ack", true, "", 1); err != nil {
		t.Fatalf("record: %v", err)
	}
	ok, err = j.HasSuccessful("task-1", "run-1", "ack")
	if err != nil || !ok {
		t.Fatalf("after success: ok=%v err=%v", ok, err)
	}
	ok, err = j.HasSuccessful("task-1", "run-1", "done")
	if err != nil || ok {
		t.Fatalf("different action should miss: ok=%v err=%v", ok, err)
	}
}

func TestSQLiteDeliveryJournal_ConcurrentReadCleanupDoesNotBusy(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "journal.db")
	j, err := OpenSQLiteDeliveryJournal(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer j.Close()

	for i := 0; i < 8; i++ {
		if _, err := j.Record(fmt.Sprintf("seed-%d", i), "run", "ack", true, "", 1); err != nil {
			t.Fatalf("seed record: %v", err)
		}
	}

	start := make(chan struct{})
	errCh := make(chan error, 256)
	var wg sync.WaitGroup
	worker := func(fn func(int) error) {
		defer wg.Done()
		<-start
		for i := 0; i < 50; i++ {
			if err := fn(i); err != nil {
				errCh <- err
				return
			}
		}
	}

	wg.Add(4)
	go worker(func(_ int) error {
		_, err := j.Snapshot(0)
		return err
	})
	go worker(func(i int) error {
		_, err := j.HasSuccessful(fmt.Sprintf("seed-%d", i%8), "run", "ack")
		return err
	})
	go worker(func(_ int) error {
		_, err := j.CleanupOldJournal(time.Now().Add(-DefaultJournalRetention))
		return err
	})
	go worker(func(i int) error {
		_, err := j.Record(fmt.Sprintf("live-%d", i), "run", "stream", true, "", 1)
		return err
	})
	close(start)
	wg.Wait()
	close(errCh)
	for err := range errCh {
		t.Fatalf("concurrent journal operation returned error: %v", err)
	}
}

func TestCallbackClient_DurableSnapshotPrefersSQLite(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "journal.db")
	c := NewCallbackClient("http://example.invalid", "", edgehttp.NewClient(0), DefaultCallbackConfig())
	if err := c.EnableSQLiteJournal(path); err != nil {
		t.Fatalf("enable: %v", err)
	}
	t.Cleanup(func() {
		if c.sqliteJournal != nil {
			_ = c.sqliteJournal.Close()
		}
	})
	c.recordJournal("task-x", "run-x", "done", true, "", 1)
	entries, err := c.DurableSnapshot(0)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if len(entries) != 1 || entries[0].TaskID != "task-x" || entries[0].Action != "done" || !entries[0].OK {
		t.Fatalf("entries=%+v", entries)
	}
}

// TestCallbackClient_OfflineReplayReconciliation proves AH-SR-049 residual (#462):
// DurableSnapshot + HasSuccessful drive reconciliation after process reopen.
// Automatic redelivery worker is intentionally deferred (see risk register / analysis).
func TestCallbackClient_OfflineReplayReconciliation(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "journal.db")

	// 1. Enable SQLite journal and record a mixed offline window.
	c1 := NewCallbackClient("http://example.invalid", "", edgehttp.NewClient(0), DefaultCallbackConfig())
	if err := c1.EnableSQLiteJournal(path); err != nil {
		t.Fatalf("enable: %v", err)
	}
	c1.recordJournal("task-ack", "run-1", "ack", true, "", 1)                     // seq 1 success
	c1.recordJournal("task-fail", "run-2", "done", false, "hub unreachable", 3)   // seq 2 failure
	c1.recordJournal("task-later", "run-3", "stream", true, "", 1)                // seq 3 success
	c1.recordJournal("task-fail", "run-2", "done", false, "still unreachable", 3) // seq 4 failure again
	if c1.sqliteJournal == nil {
		t.Fatal("sqlite journal not enabled")
	}
	if err := c1.sqliteJournal.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	// 2. Reopen as a fresh CallbackClient (simulates Edge restart).
	c2 := NewCallbackClient("http://example.invalid", "", edgehttp.NewClient(0), DefaultCallbackConfig())
	if err := c2.EnableSQLiteJournal(path); err != nil {
		t.Fatalf("reopen enable: %v", err)
	}
	t.Cleanup(func() {
		if c2.sqliteJournal != nil {
			_ = c2.sqliteJournal.Close()
		}
	})

	// 3. HasSuccessful remains true for the terminal ack after reopen.
	ok, err := c2.sqliteJournal.HasSuccessful("task-ack", "run-1", "ack")
	if err != nil || !ok {
		t.Fatalf("HasSuccessful after reopen: ok=%v err=%v", ok, err)
	}
	// Failed-only task must not look successful.
	ok, err = c2.sqliteJournal.HasSuccessful("task-fail", "run-2", "done")
	if err != nil || ok {
		t.Fatalf("failed task should not be successful: ok=%v err=%v", ok, err)
	}

	// 4. DurableSnapshot(afterSeq) returns the expected cursor window.
	all, err := c2.DurableSnapshot(0)
	if err != nil {
		t.Fatalf("snapshot all: %v", err)
	}
	if len(all) != 4 {
		t.Fatalf("expected 4 durable entries, got %d: %+v", len(all), all)
	}
	afterAck, err := c2.DurableSnapshot(1)
	if err != nil {
		t.Fatalf("snapshot afterSeq=1: %v", err)
	}
	if len(afterAck) != 3 {
		t.Fatalf("afterSeq=1 want 3 entries, got %d: %+v", len(afterAck), afterAck)
	}
	if afterAck[0].TaskID != "task-fail" || afterAck[0].OK {
		t.Fatalf("first after-ack entry want failed task-fail: %+v", afterAck[0])
	}
	if afterAck[1].TaskID != "task-later" || !afterAck[1].OK {
		t.Fatalf("second after-ack entry want successful task-later: %+v", afterAck[1])
	}

	// 5. Candidate selection (helper only — no automatic worker) surfaces failed entries.
	cands := RedeliveryCandidates(all, 0)
	if len(cands) != 2 {
		t.Fatalf("redelivery candidates want 2 failed done entries, got %d: %+v", len(cands), cands)
	}
	for _, c := range cands {
		if c.OK || c.TaskID != "task-fail" || c.Action != "done" {
			t.Fatalf("unexpected candidate: %+v", c)
		}
	}
	// Cursor after first failure still yields the later failure.
	candsAfter := RedeliveryCandidates(all, 2)
	if len(candsAfter) != 1 || candsAfter[0].Seq != 4 {
		t.Fatalf("afterSeq=2 candidates=%+v", candsAfter)
	}
}
