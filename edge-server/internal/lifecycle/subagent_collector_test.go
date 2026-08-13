package lifecycle

import (
	"testing"
	"time"
)

func TestSubAgentResultCollectorAggregate(t *testing.T) {
	collector := NewSubAgentResultCollector(time.Minute)

	base := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	collector.RecordSpawn("parent_1")
	collector.Store("parent_1", SubAgentResult{
		AgentID:     "a1",
		RunID:       "run_1",
		Status:      "finished",
		CompletedAt: base.Add(30 * time.Second),
	})
	collector.Store("parent_1", SubAgentResult{
		AgentID:     "a2",
		RunID:       "run_2",
		Status:      "failed",
		CompletedAt: base,
	})
	collector.Store("parent_1", SubAgentResult{
		AgentID:     "a3",
		RunID:       "run_3",
		Status:      "cancelled",
		CompletedAt: base.Add(time.Minute),
	})

	agg := collector.Aggregate("parent_1", false)
	if agg == nil {
		t.Fatal("Aggregate returned nil")
	}
	if agg.TotalChildren != 3 || agg.Succeeded != 1 || agg.Failed != 1 || agg.Cancelled != 1 || agg.Pending != 0 {
		t.Fatalf("counts = %#v, want 3 total, 1/1/1/0", agg)
	}
	if agg.Partial {
		t.Fatal("Partial = true, want false for full aggregation")
	}
	if agg.Summary == "" {
		t.Fatal("Summary is empty")
	}
	// Results are sorted by completion time: a2 (base), a1 (+30s), a3 (+1m).
	if len(agg.Results) != 3 || agg.Results[0].AgentID != "a2" || agg.Results[1].AgentID != "a1" || agg.Results[2].AgentID != "a3" {
		t.Fatalf("result order = %#v, want [a2 a1 a3]", agg.Results)
	}
}

func TestSubAgentResultCollectorExhaust(t *testing.T) {
	collector := NewSubAgentResultCollector(time.Minute)
	collector.RecordSpawn("parent_1")

	if collector.IsExhausted("parent_1") {
		t.Fatal("IsExhausted = true before Exhaust")
	}
	collector.Exhaust("parent_1")
	if !collector.IsExhausted("parent_1") {
		t.Fatal("IsExhausted = false after Exhaust")
	}
}

func TestSubAgentResultCollectorTimeout(t *testing.T) {
	collector := NewSubAgentResultCollector(time.Minute)
	now := time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC)
	collector.now = func() time.Time { return now }
	collector.RecordSpawn("parent_1")

	if collector.HasTimedOut("parent_1") {
		t.Fatal("HasTimedOut = true immediately after spawn")
	}
	now = now.Add(time.Minute + time.Second)
	if !collector.HasTimedOut("parent_1") {
		t.Fatal("HasTimedOut = false after timeout elapsed")
	}
	if expired := collector.ExpiredParents(); len(expired) != 1 || expired[0] != "parent_1" {
		t.Fatalf("ExpiredParents = %#v, want [parent_1]", expired)
	}

	// Exhaust suppresses the timeout fallback for that parent.
	collector.Exhaust("parent_1")
	if collector.HasTimedOut("parent_1") {
		t.Fatal("HasTimedOut = true after Exhaust")
	}
	if expired := collector.ExpiredParents(); len(expired) != 0 {
		t.Fatalf("ExpiredParents = %#v after Exhaust, want empty", expired)
	}
}

func TestSubAgentResultCollectorUnknownParent(t *testing.T) {
	collector := NewSubAgentResultCollector(time.Minute)
	if collector.HasTimedOut("missing") {
		t.Fatal("HasTimedOut = true for unknown parent")
	}
	if agg := collector.Aggregate("missing", false); agg == nil || agg.TotalChildren != 0 {
		t.Fatalf("Aggregate(missing) = %#v, want empty aggregate", agg)
	}
}
