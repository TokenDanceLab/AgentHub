package adapters

import "github.com/agenthub/edge-server/internal/metrics"

type edgeArtifactSurfacedAdapter struct {
	m *metrics.EdgeMetrics
}

// NewArtifactSurfacedRecorder returns an ArtifactSurfacedRecorder backed by
// the Edge Prometheus registry. Nil m produces nil (no-op).
func NewArtifactSurfacedRecorder(m *metrics.EdgeMetrics) ArtifactSurfacedRecorder {
	if m == nil {
		return nil
	}
	return &edgeArtifactSurfacedAdapter{m: m}
}

func (a *edgeArtifactSurfacedAdapter) RecordArtifactSurfaced(kind string) {
	if a == nil || a.m == nil || a.m.EdgeArtifactsSurfacedTotal == nil {
		return
	}
	a.m.EdgeArtifactsSurfacedTotal.WithLabelValues(kind).Inc()
}
