package lifecycle

import "github.com/agenthub/edge-server/internal/metrics"

// edgeApprovalMetricsAdapter bridges metrics.EdgeMetrics to the
// ApprovalMetricsRecorder interface so DecisionLoop stays decoupled from
// the concrete Prometheus type (and tests can substitute a stub).
type edgeApprovalMetricsAdapter struct {
	m *metrics.EdgeMetrics
}

// NewApprovalMetricsRecorder returns an ApprovalMetricsRecorder backed by the
// Edge Prometheus registry. Nil m produces a no-op recorder.
func NewApprovalMetricsRecorder(m *metrics.EdgeMetrics) ApprovalMetricsRecorder {
	if m == nil {
		return nil
	}
	return &edgeApprovalMetricsAdapter{m: m}
}

func (a *edgeApprovalMetricsAdapter) RecordApprovalDecision(decision string) {
	if a == nil || a.m == nil || a.m.EdgeApprovalDecisionsTotal == nil {
		return
	}
	a.m.EdgeApprovalDecisionsTotal.WithLabelValues(decision).Inc()
}
