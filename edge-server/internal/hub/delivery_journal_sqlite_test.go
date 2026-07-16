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
