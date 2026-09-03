package metrics

import (
	"sync"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
)

func TestRegisterSessionMetricsIdempotent(t *testing.T) {
	// Reset for test isolation: create a fresh registry and swap.
	//
	// The swap is restored on cleanup. Both globals are process-wide and every
	// other test in this package reads through them, so leaking the swap made
	// the whole binary order-dependent: under `-shuffle=on`, any order that put
	// this test first left TestRegisteredMetricsAccessible and
	// TestEventBusCounter gathering from a registry that holds nothing but the
	// two session metrics ("期望指标 ... 已注册，但在 DefaultGatherer 中未找到").
	// This test's own assertions read from reg directly, so restoring the
	// globals changes nothing here (#2246).
	savedRegisterer, savedGatherer := prometheus.DefaultRegisterer, prometheus.DefaultGatherer
	t.Cleanup(func() {
		prometheus.DefaultRegisterer = savedRegisterer
		prometheus.DefaultGatherer = savedGatherer
	})

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
