package metrics

import (
	"sync"

	"github.com/prometheus/client_golang/prometheus"
)

// orphanOnce guards double registration: startAdminServer (and its tests)
// can run more than once per process; MustRegister panics on re-register.
// Mirrors the sync.Once pattern of metrics.Register() (#2074 Windows CI).
var orphanOnce sync.Once

// Orphan task recovery counters (#2066). Nil until RegisterOrphanMetrics is
// called; callers must nil-guard before incrementing.
var (
	// DispatchOrphanDiscovered counts tasks found by the orphan sweeper.
	DispatchOrphanDiscovered prometheus.Counter
	// DispatchOrphanRedelivered counts tasks successfully redelivered.
	DispatchOrphanRedelivered prometheus.Counter
	// DispatchOrphanClaimRolledBack counts claims returned to queued after a
	// failed redelivery-context rebuild.
	DispatchOrphanClaimRolledBack prometheus.Counter
)

// RegisterOrphanMetrics initializes and registers orphan recovery metrics.
// Called from the app wiring after the core metrics.Register().
func RegisterOrphanMetrics() {
	orphanOnce.Do(func() {
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
		DispatchOrphanClaimRolledBack = prometheus.NewCounter(prometheus.CounterOpts{
			Namespace: "agenthub",
			Subsystem: "dispatch",
			Name:      "orphan_claim_rolled_back_total",
			Help:      "Total number of orphan claims rolled back to queued after rebuild failure.",
		})
		prometheus.MustRegister(DispatchOrphanDiscovered)
		prometheus.MustRegister(DispatchOrphanRedelivered)
		prometheus.MustRegister(DispatchOrphanClaimRolledBack)
	})
}
