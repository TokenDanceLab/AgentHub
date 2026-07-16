package hub

import (
	"path/filepath"
	"testing"
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

func TestCallbackClient_DurableSnapshotPrefersSQLite(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "journal.db")
	c := NewCallbackClient("http://example.invalid", "")
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
