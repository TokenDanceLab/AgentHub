package metrics

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRegisterRelayMetrics_Idempotent(t *testing.T) {
	// First call creates and registers.
	RegisterRelayMetrics()
	require.NotNil(t, RelayCommandsCreated)
	require.NotNil(t, RelayPushDelivered)
	require.NotNil(t, RelayPushNoConn)

	// Second call must not panic (sync.Once guards).
	assert.NotPanics(t, func() {
		RegisterRelayMetrics()
	}, "duplicate RegisterRelayMetrics call must be safe")

	// Metrics still functional after double registration.
	RelayCommandsCreated.Inc()
	RelayPushDelivered.Inc()
	RelayPushNoConn.Inc()
}
