package agentevent

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// Agent run event retention metrics. Lives in a separate file from the
// global metrics.go to avoid conflicting with Wave6 lane's ownership of
// hub-server/internal/metrics/metrics.go. These are self-registering via
// promauto so callers don't need to wire Register().
var (
	// AgentRunEventRetentionRuns counts how many retention passes executed.
	AgentRunEventRetentionRuns = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "agenthub",
		Subsystem: "agent_run_events",
		Name:      "retention_runs_total",
		Help:      "Total number of agent_run_events retention passes executed.",
	})

	// AgentRunEventRetentionDeletedRows counts rows purged by retention.
	AgentRunEventRetentionDeletedRows = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "agenthub",
		Subsystem: "agent_run_events",
		Name:      "retention_deleted_rows_total",
		Help:      "Total agent_run_events rows deleted by retention policy.",
	})

	// AgentRunEventRetentionFailures counts failed retention passes.
	AgentRunEventRetentionFailures = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "agenthub",
		Subsystem: "agent_run_events",
		Name:      "retention_failures_total",
		Help:      "Total failed agent_run_events retention passes.",
	})
)
