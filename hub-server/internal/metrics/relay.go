package metrics

import (
	"sync"

	"github.com/prometheus/client_golang/prometheus"
)

// Relay command channel observability (#2073).
//
// Registration is idempotent via sync.Once; calling RegisterRelayMetrics()
// multiple times (e.g. from tests or multiple composition roots) is safe.
// This is intentionally separate from the main Register() once-block so
// relay.go stays self-contained and the main metrics.go is not modified.
var (
	// RelayCommandsCreated counts relay commands persisted to Redis.
	RelayCommandsCreated prometheus.Counter

	// RelayPushDelivered counts relay commands whose WS push reached ≥1
	// active connection (live delivery confirmed).
	RelayPushDelivered prometheus.Counter

	// RelayPushNoConn counts relay commands whose WS push did not reach any
	// active connection (fire-and-forget; outbox retry will redeliver).
	RelayPushNoConn prometheus.Counter

	relayOnce sync.Once
)

// RegisterRelayMetrics creates and registers relay metrics. Safe to call
// multiple times; only the first call has effect.
func RegisterRelayMetrics() {
	relayOnce.Do(func() {
		RelayCommandsCreated = prometheus.NewCounter(prometheus.CounterOpts{
			Name: "relay_commands_created_total",
			Help: "Total number of relay commands persisted to Redis.",
		})
		RelayPushDelivered = prometheus.NewCounter(prometheus.CounterOpts{
			Name: "relay_push_delivered_total",
			Help: "Total number of relay commands whose WS push reached at least one active connection.",
		})
		RelayPushNoConn = prometheus.NewCounter(prometheus.CounterOpts{
			Name: "relay_push_no_conn_total",
			Help: "Total number of relay commands whose WS push did not reach any active connection.",
		})

		prometheus.MustRegister(RelayCommandsCreated)
		prometheus.MustRegister(RelayPushDelivered)
		prometheus.MustRegister(RelayPushNoConn)
	})
}
