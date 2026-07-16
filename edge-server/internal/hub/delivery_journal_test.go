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

func TestRedeliveryCandidates(t *testing.T) {
	entries := []DeliveryJournalEntry{
		{Seq: 1, TaskID: "t1", RunID: "r1", Action: "ack", OK: true},
		{Seq: 2, TaskID: "t2", RunID: "r2", Action: "done", OK: false, Error: "timeout"},
		{Seq: 3, TaskID: "t3", RunID: "r3", Action: "done", OK: false, Error: "temp"},
		{Seq: 4, TaskID: "t3", RunID: "r3", Action: "done", OK: true}, // later success supersedes seq 3
		{Seq: 5, TaskID: "t2", RunID: "r2", Action: "done", OK: false, Error: "timeout2"},
	}

	cands := RedeliveryCandidates(entries, 0)
	if len(cands) != 2 {
		t.Fatalf("want 2 candidates (t2 failures only), got %d: %+v", len(cands), cands)
	}
	if cands[0].Seq != 2 || cands[1].Seq != 5 {
		t.Fatalf("candidate seqs=%d,%d", cands[0].Seq, cands[1].Seq)
	}

	// afterSeq excludes earlier failures; t3 success still suppresses its prior fail.
	cands = RedeliveryCandidates(entries, 2)
	if len(cands) != 1 || cands[0].Seq != 5 {
		t.Fatalf("afterSeq=2 candidates=%+v", cands)
	}

	// Empty / all-success inputs yield no candidates.
	if got := RedeliveryCandidates(nil, 0); got != nil {
		t.Fatalf("nil entries: %+v", got)
	}
	if got := RedeliveryCandidates(entries[:1], 0); len(got) != 0 {
		t.Fatalf("success-only: %+v", got)
	}
}
