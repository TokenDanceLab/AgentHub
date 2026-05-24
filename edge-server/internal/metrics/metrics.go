// Package metrics provides Prometheus instrumentation for the Edge server.
// All metrics are auto-registered via promauto in an isolated registry so tests
// never collide with the default registry.
package metrics

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
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
}

// New creates and auto-registers all Edge Prometheus metrics in an isolated
// registry. busDepthFn is a callback that returns the current event bus
// history depth; it may be nil, in which case edge_event_bus_depth is skipped.
func New(busDepthFn func() float64) *EdgeMetrics {
	return NewWithBusStats(busDepthFn, nil)
}

// NewWithBusStats creates metrics with optional event bus callbacks.
func NewWithBusStats(busDepthFn func() float64, busDroppedFn func() float64) *EdgeMetrics {
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

	return m
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
