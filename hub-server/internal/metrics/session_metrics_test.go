package metrics

import (
	"sync"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
)

func TestRegisterSessionMetricsIdempotent(t *testing.T) {
	// Reset for test isolation: create a fresh registry and swap.
	reg := prometheus.NewRegistry()
	prometheus.DefaultRegisterer = reg
	prometheus.DefaultGatherer = reg
	sessionMetricsOnce = sync.Once{}
	SessionMetricsTokensTotal = nil
	SessionMetricsCostUSDTotal = nil

	RegisterSessionMetrics()
	RegisterSessionMetrics() // second call must not panic

	if SessionMetricsTokensTotal == nil || SessionMetricsCostUSDTotal == nil {
		t.Fatal("metrics not initialized after RegisterSessionMetrics")
	}

	SessionMetricsTokensTotal.WithLabelValues("input", "claude-3").Add(100)
	SessionMetricsTokensTotal.WithLabelValues("output", "claude-3").Add(50)
	SessionMetricsCostUSDTotal.WithLabelValues("claude-3").Add(0.05)

	mfs, err := reg.Gather()
	if err != nil {
		t.Fatalf("gather error: %v", err)
	}
	foundTokens, foundCost := false, false
	for _, mf := range mfs {
		switch mf.GetName() {
		case "agent_session_tokens_total":
			foundTokens = true
			var sum float64
			for _, m := range mf.GetMetric() {
				sum += m.GetCounter().GetValue()
			}
			if sum != 150 {
				t.Fatalf("tokens sum = %f, want 150", sum)
			}
		case "agent_session_cost_usd_total":
			foundCost = true
			for _, m := range mf.GetMetric() {
				if v := m.GetCounter().GetValue(); v != 0.05 {
					t.Fatalf("cost = %f, want 0.05", v)
				}
			}
		}
	}
	if !foundTokens {
		t.Fatal("agent_session_tokens_total not registered")
	}
	if !foundCost {
		t.Fatal("agent_session_cost_usd_total not registered")
	}
	_ = dto.Metric{} // keep import
}
