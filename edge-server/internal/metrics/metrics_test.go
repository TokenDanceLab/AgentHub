package metrics

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/pkg/safego"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestMetricsRegistrationAndIncrement(t *testing.T) {
	m := NewWithBusStats(func() float64 { return 42 }, nil)

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
	m := NewWithBusStats(nil, nil)

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
	m := NewWithBusStats(func() float64 { return 100 }, nil)

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

// TestInstallPanicObserver_CountsRecoveredGoroutinePanics proves the wiring
// that makes an Edge goroutine panic observable: after InstallPanicObserver a
// recovered panic increments edge_goroutine_panic_recoveries_total under the
// launcher's label. Without it the panic is a log line and nothing else, which
// is exactly the hole the lifecycle's private launcher copy left.
func TestInstallPanicObserver_CountsRecoveredGoroutinePanics(t *testing.T) {
	// Not parallel: SetPanicObserver mutates a process-global hook.
	m := NewTestEdgeMetrics()
	m.InstallPanicObserver()
	t.Cleanup(func() { safego.SetPanicObserver(nil) })

	safego.SafeGo("metrics.testPanic", func() {
		panic("induced panic for observer test")
	})

	// The observer runs in SafeGo's *own* deferred recover, i.e. after any defer
	// inside fn — so a signal from fn would be read before the counter moved.
	// Poll instead: the increment lands within microseconds, and the deadline
	// turns "never wired" into a failure rather than a hang.
	counter := m.EdgeGoroutinePanicRecoveries.WithLabelValues("metrics.testPanic")
	deadline := time.After(2 * time.Second)
	var got float64
	for {
		got = testutil.ToFloat64(counter)
		if got == 1 {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("edge_goroutine_panic_recoveries_total{goroutine=metrics.testPanic} = %v after 2s, want 1: InstallPanicObserver did not wire the counter", got)
		case <-time.After(time.Millisecond):
		}
	}
	if other := testutil.ToFloat64(m.EdgeGoroutinePanicRecoveries.WithLabelValues("run")); other != 0 {
		t.Fatalf("an unrelated label moved to %v, want 0: the observer must attribute by launcher name", other)
	}
}

// TestInstallPanicObserver_NilSafe keeps the installer callable on builds that
// never registered metrics, so wiring order cannot turn into a nil dereference.
func TestInstallPanicObserver_NilSafe(t *testing.T) {
	var nilMetrics *EdgeMetrics
	nilMetrics.InstallPanicObserver() // must not panic

	bare := &EdgeMetrics{}
	bare.InstallPanicObserver() // counter never built: must not panic
}
