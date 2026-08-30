package metrics

import (
	"sync"

	"github.com/prometheus/client_golang/prometheus"
)

// JWT key rotation observability. Registered lazily via RegisterJWTRotation
// to avoid polluting the default metric set when rotation is disabled.
var (
	jwtRotationOnce sync.Once

	// JWTRotationsTotal counts successful key rotations.
	JWTRotationsTotal prometheus.Counter

	// JWTRotationFailuresTotal counts failed rotation attempts. The error
	// label carries a short category (generate_kid / generate_secret /
	// add_key / set_active) so operators can alert on specific failure modes.
	JWTRotationFailuresTotal *prometheus.CounterVec

	// JWTRotationPendingKeys tracks how many superseded keys are currently
	// within their grace period. A sustained non-zero value after expected
	// drain indicates stuck removals.
	JWTRotationPendingKeys prometheus.Gauge
)

// RegisterJWTRotation initializes and registers JWT rotation metrics. Safe
// to call multiple times; registration happens exactly once.
func RegisterJWTRotation() {
	jwtRotationOnce.Do(func() {
		JWTRotationsTotal = prometheus.NewCounter(prometheus.CounterOpts{
			Name: "jwt_rotations_total",
			Help: "Total number of successful JWT signing-key rotations.",
		})
		JWTRotationFailuresTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "jwt_rotation_failures_total",
			Help: "Total number of failed JWT rotation attempts by error category.",
		}, []string{"error"})
		JWTRotationPendingKeys = prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "jwt_rotation_pending_keys",
			Help: "Number of superseded JWT keys still within their verification grace period.",
		})

		prometheus.MustRegister(JWTRotationsTotal)
		prometheus.MustRegister(JWTRotationFailuresTotal)
		prometheus.MustRegister(JWTRotationPendingKeys)
	})
}
