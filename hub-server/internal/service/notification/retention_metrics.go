package notification

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// Notification retention metrics. Self-registering via promauto, mirroring
// service/agent/run_event_retention_metrics.go, so callers don't need to wire
// Register().
var (
	// RetentionRuns counts how many notification retention passes executed.
	RetentionRuns = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "agenthub",
		Subsystem: "notifications",
		Name:      "retention_runs_total",
		Help:      "Total number of notifications retention passes executed.",
	})

	// RetentionDeletedRows counts rows purged by notification retention.
	RetentionDeletedRows = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "agenthub",
		Subsystem: "notifications",
		Name:      "retention_deleted_rows_total",
		Help:      "Total notifications rows deleted by retention policy.",
	})

	// RetentionFailures counts failed notification retention passes.
	RetentionFailures = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "agenthub",
		Subsystem: "notifications",
		Name:      "retention_failures_total",
		Help:      "Total failed notifications retention passes.",
	})
)
