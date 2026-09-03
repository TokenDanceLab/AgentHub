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
	m := NewWithBusHooks(BusHooks{BusDepth: func() float64 { return 42 }})

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
	m := NewWithBusHooks(BusHooks{})

	// Should not panic
	m.RecordRunStart("none")
	m.RecordRunFinish("none", "finished", 1.0)

	// EventBusDepth should be zero-value (nil GaugeFunc)
	if m.EdgeEventBusDepth != nil {
		t.Fatal("EdgeEventBusDepth should be nil when busDepthFn is nil")
	}
}

func TestMetricsExposeEventBusDroppedTotal(t *testing.T) {
	m := NewWithBusHooks(BusHooks{
		BusDepth:   func() float64 { return 42 },
		BusDropped: func() float64 { return 7 },
	})

	req := httptest.NewRequest("GET", "/metrics", nil)
	rec := httptest.NewRecorder()
	m.Handler().ServeHTTP(rec, req)

	body := rec.Body.String()
	if !strings.Contains(body, "edge_event_bus_dropped_total 7") {
		t.Fatalf("metrics output missing dropped event count: %s", body)
	}
}

func TestMetricsMultipleRuns(t *testing.T) {
	m := NewWithBusHooks(BusHooks{BusDepth: func() float64 { return 100 }})

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

// TestMetricsWithoutHooksRegistersNoPullSeries pins the per-hook optionality
// that #2304 turned on: a nil hook means the series is not registered at all,
// so it is absent from the scrape rather than served as a constant zero. That
// distinction is the whole defect — three event-log series were absent from a
// live Edge's /v1/metrics while their counters and accessors existed, and an
// absent series is invisible to an alert rule in a way a zero series is not.
func TestMetricsWithoutHooksRegistersNoPullSeries(t *testing.T) {
	m := NewWithBusHooks(BusHooks{})

	for _, field := range []struct {
		name string
		nil  bool
	}{
		{"EdgeEventBusDepth", m.EdgeEventBusDepth == nil},
		{"EdgeEventBusDropped", m.EdgeEventBusDropped == nil},
		{"EdgeEventLogTruncations", m.EdgeEventLogTruncations == nil},
		{"EdgeEventLogTruncateFailures", m.EdgeEventLogTruncateFailures == nil},
		{"EdgeEventLogGaps", m.EdgeEventLogGaps == nil},
		{"EdgeEventLogTruncateDuration", m.EdgeEventLogTruncateDuration == nil},
		{"EdgeEventLogTruncateLastDuration", m.EdgeEventLogTruncateLastDuration == nil},
	} {
		if !field.nil {
			t.Errorf("%s was registered from an empty BusHooks, want nil", field.name)
		}
	}

	rec := httptest.NewRecorder()
	m.Handler().ServeHTTP(rec, httptest.NewRequest("GET", "/metrics", nil))
	body := rec.Body.String()
	for _, series := range []string{
		"edge_event_bus_depth",
		"edge_event_bus_dropped_total",
		"edge_event_log_truncations_total",
		"edge_event_log_truncate_failures_total",
		"edge_event_log_gaps_total",
		"edge_event_log_truncate_duration_seconds_total",
		"edge_event_log_truncate_last_duration_seconds",
	} {
		if strings.Contains(body, series) {
			t.Errorf("empty BusHooks still served %s, want the series absent", series)
		}
	}
}

// TestMetricsExposeEventLogSeries asserts the five event-log series are served
// with the values their hooks return, i.e. the registration blocks read the
// hooks they claim to.
func TestMetricsExposeEventLogSeries(t *testing.T) {
	m := NewWithBusHooks(BusHooks{
		EventLogTruncations:         func() float64 { return 3 },
		EventLogTruncateFailures:    func() float64 { return 1 },
		EventLogGaps:                func() float64 { return 7 },
		EventLogTruncateSeconds:     func() float64 { return 2.5 },
		EventLogTruncateLastSeconds: func() float64 { return 0.75 },
	})

	rec := httptest.NewRecorder()
	m.Handler().ServeHTTP(rec, httptest.NewRequest("GET", "/metrics", nil))
	body := rec.Body.String()

	for _, want := range []string{
		"edge_event_log_truncations_total 3",
		"edge_event_log_truncate_failures_total 1",
		"edge_event_log_gaps_total 7",
		"edge_event_log_truncate_duration_seconds_total 2.5",
		"edge_event_log_truncate_last_duration_seconds 0.75",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("metrics output missing %q", want)
		}
	}
}
