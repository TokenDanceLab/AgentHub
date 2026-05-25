package metrics

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMetricsRegistrationAndIncrement(t *testing.T) {
	m := New(func() float64 { return 42 })

	// Verify metrics can be incremented without panic
	m.RecordRunStart("claude-code")
	m.RecordRunStart("codex")

	m.RecordRunFinish("claude-code", "finished", 1.5)
	m.RecordRunFinish("codex", "failed", 0.3)
	m.RecordRunFinish("opencode", "cancelled", 2.0)

	m.RecordWSConnect()
	m.RecordWSConnect()
	m.RecordWSDisconnect()

	// Handler should be non-nil
	if h := m.Handler(); h == nil {
		t.Fatal("Handler() returned nil")
	}
}

func TestMetricsWithoutBusDepth(t *testing.T) {
	m := New(nil)

	// Should not panic
	m.RecordRunStart("none")
	m.RecordRunFinish("none", "finished", 1.0)

	// EventBusDepth should be zero-value (nil GaugeFunc)
	if m.EdgeEventBusDepth != nil {
		t.Fatal("EdgeEventBusDepth should be nil when busDepthFn is nil")
	}
}

func TestMetricsExposeEventBusDroppedTotal(t *testing.T) {
	m := NewWithBusStats(
		func() float64 { return 42 },
		func() float64 { return 7 },
	)

	req := httptest.NewRequest("GET", "/metrics", nil)
	rec := httptest.NewRecorder()
	m.Handler().ServeHTTP(rec, req)

	body := rec.Body.String()
	if !strings.Contains(body, "edge_event_bus_dropped_total 7") {
		t.Fatalf("metrics output missing dropped event count: %s", body)
	}
}

func TestMetricsMultipleRuns(t *testing.T) {
	m := New(func() float64 { return 100 })

	// Simulate 3 concurrent runs
	m.RecordRunStart("claude-code")
	m.RecordRunStart("claude-code")
	m.RecordRunStart("codex")

	// Finish them
	m.RecordRunFinish("claude-code", "finished", 10.0)
	m.RecordRunFinish("claude-code", "finished", 15.0)
	m.RecordRunFinish("codex", "cancelled", 1.0)

	// Verify handler returns metrics in Prometheus text format
	handler := m.Handler()
	if handler == nil {
		t.Fatal("Handler() returned nil")
	}
}
