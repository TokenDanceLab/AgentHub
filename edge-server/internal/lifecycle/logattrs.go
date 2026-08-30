package lifecycle

import (
	"log/slog"

	"github.com/agenthub/pkg/otelids"
)

// RunLogAttrs returns the canonical slog attributes for a run-scoped log line.
// It emits both snake_case (new contract) and camelCase (legacy dashboard compat)
// keys so existing dashboards keep working while new consumers standardize on
// snake_case. Per slice-A brief §3, we do NOT rename existing slog call sites;
// callers opt into the unified helper when writing new observability lines.
func RunLogAttrs(runID, agentID string) []slog.Attr {
	return []slog.Attr{
		slog.String("run_id", runID),
		slog.String("runId", runID),
		slog.String("agent_id", agentID),
		slog.String("agentId", agentID),
	}
}

// RunLogAttrsWithTrace extends RunLogAttrs with the trace_id attr when non-empty.
func RunLogAttrsWithTrace(runID, agentID, traceID string) []slog.Attr {
	attrs := RunLogAttrs(runID, agentID)
	if traceID != "" {
		attrs = append(attrs, otelids.SlogAttr(traceID))
	}
	return attrs
}
