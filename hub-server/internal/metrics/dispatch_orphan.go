package metrics

import "github.com/prometheus/client_golang/prometheus"

// Orphan task recovery counters (#2066). Nil until RegisterOrphanMetrics is
// called; callers must nil-guard before incrementing.
var (
	// DispatchOrphanDiscovered counts tasks found by the orphan sweeper.
	DispatchOrphanDiscovered prometheus.Counter
	// DispatchOrphanRedelivered counts tasks successfully redelivered.
	DispatchOrphanRedelivered prometheus.Counter
)

// RegisterOrphanMetrics initializes and registers orphan recovery metrics.
// Called from the app wiring after the core metrics.Register().
func RegisterOrphanMetrics() {
	DispatchOrphanDiscovered = prometheus.NewCounter(prometheus.CounterOpts{
		Namespace: "agenthub",
		Subsystem: "dispatch",
		Name:      "orphan_discovered_total",
		Help:      "Total number of orphaned tasks discovered by the sweeper.",
	})
	DispatchOrphanRedelivered = prometheus.NewCounter(prometheus.CounterOpts{
		Namespace: "agenthub",
		Subsystem: "dispatch",
		Name:      "orphan_redelivered_total",
		Help:      "Total number of orphaned tasks successfully redelivered.",
	})
	prometheus.MustRegister(DispatchOrphanDiscovered)
	prometheus.MustRegister(DispatchOrphanRedelivered)
}
