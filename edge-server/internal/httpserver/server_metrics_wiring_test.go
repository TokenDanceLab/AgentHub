package httpserver

import (
	"net/http/httptest"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// metricSample extracts the value of a label-less series from Prometheus text
// output. It fails the test when the series has no sample line, which is what
// distinguishes "registered" from "served with a value".
func metricSample(t *testing.T, body, name string) float64 {
	t.Helper()
	re := regexp.MustCompile(`(?m)^` + regexp.QuoteMeta(name) + ` (.+)$`)
	match := re.FindStringSubmatch(body)
	if match == nil {
		t.Fatalf("metrics body has no sample line for %s", name)
	}
	value, err := strconv.ParseFloat(strings.TrimSpace(match[1]), 64)
	if err != nil {
		t.Fatalf("metrics sample for %s = %q, not a float", name, match[1])
	}
	return value
}

// TestBuildEventBusAndMetricsServesEventLogSeries is the regression gate for
// #2304. buildEventBusAndMetrics is the only production construction site for
// EdgeMetrics, and it used to call a constructor that took two bus callbacks
// and hard-coded nil for the three event-log ones. The counters, the Bus
// accessors, the registration blocks and the "Exposed for the
// edge_event_log_*_total Prometheus metric" comments all existed — and a live
// Edge's GET /v1/metrics still served edge_event_bus_depth and
// edge_event_bus_dropped_total with zero edge_event_log_* series (verified
// against the dev stack: 8956 bytes of metrics, 0 occurrences of
// "edge_event_log").
//
// Asserting on the production wiring rather than on a hand-built BusHooks is
// what makes the defect unrepeatable: a constructor that drops hooks cannot
// pass this test no matter how correct the metrics package looks in isolation.
// It also asserts *values*, not just registration, so a hook wired to the wrong
// accessor (e.g. gaps reading truncations) fails too.
func TestBuildEventBusAndMetricsServesEventLogSeries(t *testing.T) {
	bus, edgeMetrics := buildEventBusAndMetrics(Config{
		EventLogPath: filepath.Join(t.TempDir(), "events.jsonl"),
		// Small enough that the publishes below cross it several times, so the
		// truncation counters and their duration series must move.
		EventLogMaxSize: 1024,
	})
	t.Cleanup(func() { _ = bus.Close() })

	for i := 0; i < 80; i++ {
		bus.Publish("metrics.wiring.probe", map[string]any{"runId": "run_metrics_wiring"}, map[string]any{
			"i":       i,
			"padding": strings.Repeat("x", 64),
		})
	}

	rec := httptest.NewRecorder()
	edgeMetrics.Handler().ServeHTTP(rec, httptest.NewRequest("GET", "/metrics", nil))
	if rec.Code != 200 {
		t.Fatalf("metrics handler status = %d, want 200", rec.Code)
	}
	body := rec.Body.String()

	// Every registered series emits a HELP line, so this asserts registration
	// independently of whether the sample happens to be zero.
	for _, series := range []string{
		"edge_event_bus_depth",
		"edge_event_bus_dropped_total",
		"edge_event_log_truncations_total",
		"edge_event_log_truncate_failures_total",
		"edge_event_log_gaps_total",
		"edge_event_log_truncate_duration_seconds_total",
		"edge_event_log_truncate_last_duration_seconds",
	} {
		if !strings.Contains(body, "# HELP "+series+" ") {
			t.Errorf("production /v1/metrics is missing the %s series (#2304: registered but never wired)", series)
		}
	}
	if t.Failed() {
		t.FailNow()
	}

	// The three pre-existing counters must be readable AND consistent with the
	// bus they claim to mirror — this is the part that catches a hook wired to
	// the wrong accessor.
	if got, want := metricSample(t, body, "edge_event_log_truncations_total"), float64(bus.EventLogTruncations()); got != want {
		t.Errorf("edge_event_log_truncations_total = %v, want %v (bus.EventLogTruncations)", got, want)
	}
	if got, want := metricSample(t, body, "edge_event_log_gaps_total"), float64(bus.EventLogGaps()); got != want {
		t.Errorf("edge_event_log_gaps_total = %v, want %v (bus.EventLogGaps)", got, want)
	}
	if got, want := metricSample(t, body, "edge_event_log_truncate_failures_total"), float64(bus.EventLogTruncateFailures()); got != want {
		t.Errorf("edge_event_log_truncate_failures_total = %v, want %v (bus.EventLogTruncateFailures)", got, want)
	}
	if got := metricSample(t, body, "edge_event_log_truncations_total"); got < 1 {
		t.Fatalf("expected at least one truncation after 80 publishes over a 1024-byte cap, got %v", got)
	}

	// Truncation holds the event-log mutex, so its duration IS the bus freeze.
	// This asserts the two duration series are *served and consistent with the
	// accessors*; "the counters actually move" is asserted deterministically in
	// events.TestEventLog_TruncateDurationIsRecorded, because a > 0 magnitude
	// here would depend on how many of these 1 KiB-cap truncations took the
	// early error branch on the platform running the test (Windows denied the
	// rewrite; the Native Windows job caught exactly that over-assertion).
	total := metricSample(t, body, "edge_event_log_truncate_duration_seconds_total")
	last := metricSample(t, body, "edge_event_log_truncate_last_duration_seconds")
	if last < 0 {
		t.Errorf("edge_event_log_truncate_last_duration_seconds = %v, want >= 0", last)
	}
	if last > total {
		t.Errorf("last truncation duration %v s exceeds cumulative %v s", last, total)
	}
	if want := bus.EventLogTruncateDurationSeconds(); total != want {
		t.Errorf("edge_event_log_truncate_duration_seconds_total = %v, want %v (bus accessor)", total, want)
	}
	if want := bus.EventLogTruncateLastDurationSeconds(); last != want {
		t.Errorf("edge_event_log_truncate_last_duration_seconds = %v, want %v (bus accessor)", last, want)
	}
}
