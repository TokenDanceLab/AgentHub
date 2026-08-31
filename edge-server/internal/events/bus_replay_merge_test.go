package events

import (
	"testing"
)

func env(seq int64, typ string) EventEnvelope {
	return EventEnvelope{
		Version: "v1",
		ID:      typ,
		Seq:     seq,
		Type:    typ,
		Scope:   map[string]any{},
	}
}

func TestMergeReplayWithLogDedupHistoryWins(t *testing.T) {
	history := []EventEnvelope{env(2, "history-2")}
	seen := map[int64]bool{2: true}
	logEvents := []EventEnvelope{env(2, "log-2-stale"), env(3, "log-3")}

	replay := mergeReplayWithLog(history, seen, logEvents, false, 1)

	if len(replay) != 2 {
		t.Fatalf("replay len = %d, want 2", len(replay))
	}
	if replay[0].Seq != 2 || replay[0].ID != "history-2" {
		t.Fatalf("history copy must win for seq 2: got %+v", replay[0])
	}
	if replay[1].Seq != 3 || replay[1].ID != "log-3" {
		t.Fatalf("log-only event must be appended: got %+v", replay[1])
	}
}

func TestMergeReplayWithLogInjectsGapFirst(t *testing.T) {
	replay := mergeReplayWithLog(nil, map[int64]bool{}, []EventEnvelope{env(6, "log-6")}, true, 5)

	if len(replay) != 2 {
		t.Fatalf("replay len = %d, want 2", len(replay))
	}
	if replay[0].Type != GapEventType || replay[0].Seq != 0 {
		t.Fatalf("gap event must sort first: got %+v", replay[0])
	}
	if _, ok := replay[0].Payload.(*GapPayload); !ok {
		t.Fatalf("gap payload type = %T, want *GapPayload", replay[0].Payload)
	}
	if replay[1].Seq != 6 {
		t.Fatalf("real event seq = %d, want 6", replay[1].Seq)
	}
}

func TestMergeReplayWithLogFiltersBelowCursor(t *testing.T) {
	replay := mergeReplayWithLog(nil, map[int64]bool{}, []EventEnvelope{env(3, "below"), env(5, "at"), env(7, "above")}, false, 5)

	if len(replay) != 2 {
		t.Fatalf("replay len = %d, want 2", len(replay))
	}
	if replay[0].Seq != 5 || replay[1].Seq != 7 {
		t.Fatalf("unexpected replay seqs: %d, %d", replay[0].Seq, replay[1].Seq)
	}
}
