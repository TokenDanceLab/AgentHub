// Package metrics provides Prometheus instrumentation for the Edge server.
// All metrics are auto-registered via promauto in an isolated registry so tests
// never collide with the default registry.
package metrics

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/agenthub/pkg/outboundmetrics"
	"github.com/agenthub/pkg/safego"
)

// EdgeMetrics holds all Prometheus metrics for the Edge server.
type EdgeMetrics struct {
	reg *prometheus.Registry

	EdgeRunsTotal          *prometheus.CounterVec
	EdgeRunDurationSeconds *prometheus.HistogramVec
	EdgeActiveRuns         prometheus.Gauge
	EdgeWSConnections      prometheus.Gauge
	EdgeEventBusDepth      prometheus.GaugeFunc
	EdgeEventBusDropped    prometheus.CounterFunc

	// EdgeEventPersistFailures counts events that exhausted all persist retry
	// attempts in the event bus and were dropped (edge_event_persist_failures_total).
	// Exposed as a CounterFunc so the events package owns the actual atomic
	// counter and the metrics package stays a read-only view, mirroring the
	// EdgeEventBusDropped wiring.
	EdgeEventPersistFailures prometheus.CounterFunc

	// EdgeEventLogTruncations counts event-log truncation attempts
	// (edge_event_log_truncations_total). Backed by Bus.EventLogTruncations.
	EdgeEventLogTruncations prometheus.CounterFunc
	// EdgeEventLogTruncateFailures counts event-log truncation attempts that
	// hit an error branch (edge_event_log_truncate_failures_total). Backed by
	// Bus.EventLogTruncateFailures. Previously these failures were silent.
	EdgeEventLogTruncateFailures prometheus.CounterFunc
	// EdgeEventLogGaps counts replay/fanout gap events detected
	// (edge_event_log_gaps_total): cursor predating the log or subscriber
	// channel full. Backed by Bus.EventLogGaps.
	EdgeEventLogGaps prometheus.CounterFunc

	// EdgeHTTPPanicRecoveries counts panics recovered by the Edge HTTP
	// recoveryHTTPHandler wrapping the mux. A non-zero rate signals a handler
	// bug that would otherwise crash the process (the net/http server does
	// not install a default recover for connected-request handlers).
	EdgeHTTPPanicRecoveries prometheus.Counter

	// EdgeArtifactsSurfacedTotal counts artifacts surfaced at run finish.
	// Label: kind (artifact|preview|image|deploy).
	EdgeArtifactsSurfacedTotal *prometheus.CounterVec

	// EdgeGoroutinePanicRecoveries counts panics recovered by pkg/safego inside
	// Edge's spawned goroutines, partitioned by the launcher label ("run",
	// "hubAck", "watchRunProcess", …). It is the goroutine counterpart of
	// EdgeHTTPPanicRecoveries — which only covers the request path — and mirrors
	// the Hub's goroutine_panic_recoveries, so an operator can alert on either
	// server the same way. Without it a panic in the run lifecycle was log-only:
	// visible in a journal nobody greps, absent from every dashboard.
	//
	// The label must stay a static call-site literal (pkg/safego's contract for
	// `name`); a dynamic label would make the series unbounded.
	EdgeGoroutinePanicRecoveries *prometheus.CounterVec

	// Outbound is the unified outbound HTTP metrics contract (#1595):
	// outbound_requests_total / outbound_request_duration_seconds with
	// provider/purpose/category/status labels, shared with the Hub server.
	Outbound *outboundmetrics.Recorder
}

// NewWithBusStats creates metrics with optional event bus callbacks.
func NewWithBusStats(busDepthFn func() float64, busDroppedFn func() float64) *EdgeMetrics {
	return newWithHooks(busDepthFn, busDroppedFn, nil, nil, nil)
}

func newWithHooks(
	busDepthFn, busDroppedFn,
	truncationsFn, truncateFailuresFn, gapsFn func() float64,
) *EdgeMetrics {
	reg := prometheus.NewRegistry()
	factory := promauto.With(reg)

	m := &EdgeMetrics{
		reg: reg,
		EdgeRunsTotal: factory.NewCounterVec(prometheus.CounterOpts{
			Name: "edge_runs_total",
			Help: "Total number of runs processed, partitioned by adapter and status.",
		}, []string{"adapter", "status"}),
		EdgeRunDurationSeconds: factory.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "edge_run_duration_seconds",
			Help:    "Duration of completed runs in seconds, partitioned by adapter.",
			Buckets: prometheus.DefBuckets,
		}, []string{"adapter"}),
		EdgeActiveRuns: factory.NewGauge(prometheus.GaugeOpts{
			Name: "edge_active_runs",
			Help: "Number of runs currently executing.",
		}),
		EdgeWSConnections: factory.NewGauge(prometheus.GaugeOpts{
			Name: "edge_ws_connections",
			Help: "Number of active WebSocket connections.",
		}),
	}

	if busDepthFn != nil {
		m.EdgeEventBusDepth = factory.NewGaugeFunc(prometheus.GaugeOpts{
			Name: "edge_event_bus_depth",
			Help: "Current number of events in the event bus history.",
		}, busDepthFn)
	}

	if busDroppedFn != nil {
		m.EdgeEventBusDropped = factory.NewCounterFunc(prometheus.CounterOpts{
			Name: "edge_event_bus_dropped_total",
			Help: "Total number of event bus fanout deliveries dropped because subscriber channels were full.",
		}, busDroppedFn)
	}

	if truncationsFn != nil {
		m.EdgeEventLogTruncations = factory.NewCounterFunc(prometheus.CounterOpts{
			Name: "edge_event_log_truncations_total",
			Help: "Total number of event log truncation attempts (log exceeded maxSize).",
		}, truncationsFn)
	}
	if truncateFailuresFn != nil {
		m.EdgeEventLogTruncateFailures = factory.NewCounterFunc(prometheus.CounterOpts{
			Name: "edge_event_log_truncate_failures_total",
			Help: "Total number of event log truncation attempts that hit an error branch (seek/read/truncate/rewrite failure).",
		}, truncateFailuresFn)
	}
	if gapsFn != nil {
		m.EdgeEventLogGaps = factory.NewCounterFunc(prometheus.CounterOpts{
			Name: "edge_event_log_gaps_total",
			Help: "Total number of event log replay/fanout gaps detected (cursor predating the log or subscriber channel full).",
		}, gapsFn)
	}

	// Unified outbound metrics contract (#1595) on the isolated registry.
	m.Outbound = outboundmetrics.NewRecorder(reg)

	// edge_http_panic_recoveries_total: panics recovered by the Edge HTTP
	// recoveryHTTPHandler. Mirrors the Hub http_panic_recoveries_total so
	// operators can alert on either server with the same kind/threshold.
	m.EdgeHTTPPanicRecoveries = factory.NewCounter(prometheus.CounterOpts{
		Name: "edge_http_panic_recoveries_total",
		Help: "Total number of Edge HTTP handler panics recovered by recoveryHTTPHandler.",
	})

	m.EdgeArtifactsSurfacedTotal = factory.NewCounterVec(prometheus.CounterOpts{
		Name: "edge_artifacts_surfaced_total",
		Help: "Total artifacts surfaced at run finish, partitioned by kind.",
	}, []string{"kind"})

	m.EdgeGoroutinePanicRecoveries = factory.NewCounterVec(prometheus.CounterOpts{
		Name: "edge_goroutine_panic_recoveries_total",
		Help: "Total number of Edge goroutine panics recovered by pkg/safego, partitioned by launcher label.",
	}, []string{"goroutine"})

	// Go runtime + process collectors on the isolated registry so the Edge
	// /metrics endpoint exposes go_* and process_* alongside edge_* metrics.
	// Previously only the Hub registered these on the default registry; the
	// Edge served its isolated registry without them (#9 P2).
	reg.MustRegister(collectors.NewGoCollector())
	reg.MustRegister(collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))

	return m
}

// InstallPanicObserver wires pkg/safego's process-wide panic hook to this
// instance's goroutine panic counter, so a recovered panic in an Edge goroutine
// increments edge_goroutine_panic_recoveries_total{goroutine=<label>} instead of
// only writing a log line.
//
// Call it once at startup, after the metrics are built and before the first
// safego.SafeGo launch. The hook is process-global (pkg/safego keeps exactly
// one), so a second install replaces the first; Edge builds its metrics once per
// process. A nil receiver or a nil counter is a no-op, which keeps test builds
// that never register safe.
func (m *EdgeMetrics) InstallPanicObserver() {
	if m == nil || m.EdgeGoroutinePanicRecoveries == nil {
		return
	}
	counter := m.EdgeGoroutinePanicRecoveries
	safego.SetPanicObserver(func(name string, _ any, _ string) {
		if name == "" {
			name = "unknown"
		}
		counter.WithLabelValues(name).Inc()
	})
}

// Handler returns an http.Handler that serves Prometheus text metrics from the
// isolated registry associated with this EdgeMetrics instance.
func (m *EdgeMetrics) Handler() http.Handler {
	return promhttp.HandlerFor(m.reg, promhttp.HandlerOpts{})
}

// RecordRunStart increments the active runs gauge and records a "started"
// observation in the runs_total counter for the given adapter.
func (m *EdgeMetrics) RecordRunStart(adapter string) {
	m.EdgeRunsTotal.WithLabelValues(adapter, "started").Inc()
	m.EdgeActiveRuns.Inc()
}

// RecordRunFinish decrements active runs, records the final status in the
// runs_total counter, and observes the run duration for the given adapter.
func (m *EdgeMetrics) RecordRunFinish(adapter, status string, durationSeconds float64) {
	m.EdgeRunsTotal.WithLabelValues(adapter, status).Inc()
	m.EdgeActiveRuns.Dec()
	m.EdgeRunDurationSeconds.WithLabelValues(adapter).Observe(durationSeconds)
}

// RecordWSConnect increments the WebSocket connections gauge.
func (m *EdgeMetrics) RecordWSConnect() {
	m.EdgeWSConnections.Inc()
}

// RecordWSDisconnect decrements the WebSocket connections gauge.
func (m *EdgeMetrics) RecordWSDisconnect() {
	m.EdgeWSConnections.Dec()
}

// NewTestEdgeMetrics creates an EdgeMetrics with all counters initialized for
// unit tests that need to exercise metric increment paths without wiring a
// real event bus. The registry is isolated so parallel tests don't collide.
func NewTestEdgeMetrics() *EdgeMetrics {
	return newWithHooks(nil, nil, nil, nil, nil)
}
