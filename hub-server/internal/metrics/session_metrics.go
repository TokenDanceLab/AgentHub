package metrics

import (
	"sync"

	"github.com/prometheus/client_golang/prometheus"
)

var sessionMetricsOnce sync.Once

// SessionMetricsTokensTotal counts tokens reported by Edge session_metrics
// events. Labels: kind (input|output), model. Registered idempotently via
// RegisterSessionMetrics; nil-safe for callers that run before Register().
var SessionMetricsTokensTotal *prometheus.CounterVec

// SessionMetricsCostUSDTotal sums totalCostUsd from Edge session_metrics
// events. Labels: model.
var SessionMetricsCostUSDTotal *prometheus.CounterVec

// RegisterSessionMetrics creates and registers the slice-A session metrics.
// Safe to call multiple times; only the first call has effect.
func RegisterSessionMetrics() {
	sessionMetricsOnce.Do(func() {
		SessionMetricsTokensTotal = prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "agent_session_tokens_total",
				Help: "Cumulative tokens reported by Edge session_metrics events.",
			},
			[]string{"kind", "model"},
		)
		SessionMetricsCostUSDTotal = prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "agent_session_cost_usd_total",
				Help: "Cumulative USD cost reported by Edge session_metrics events.",
			},
			[]string{"model"},
		)
		prometheus.MustRegister(SessionMetricsTokensTotal)
		prometheus.MustRegister(SessionMetricsCostUSDTotal)
	})
}
