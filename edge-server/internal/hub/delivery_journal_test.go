package hub

import "testing"

func TestDeliveryJournal_RecordsAndSnapshots(t *testing.T) {
	j := NewDeliveryJournal(10)
	seq1 := j.Record("task-1", "run-1", "ack", true, "", 1)
	seq2 := j.Record("task-1", "run-1", "done", false, "boom", 3)
	if seq1 == 0 || seq2 <= seq1 {
		t.Fatalf("seq order: %d %d", seq1, seq2)
	}
	all := j.Snapshot(0)
	if len(all) != 2 {
		t.Fatalf("all=%d", len(all))
	}
	after := j.Snapshot(seq1)
	if len(after) != 1 || after[0].Action != "done" || after[0].OK {
		t.Fatalf("after=%+v", after)
	}
}
