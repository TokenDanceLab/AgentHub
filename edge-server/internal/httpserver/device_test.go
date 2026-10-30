package httpserver

import (
	"context"
	"testing"

	"github.com/agenthub/edge-server/internal/device"
	"github.com/stretchr/testify/require"
)

func TestEnrolledCancellationMissingRunDoesNotClaimStopped(t *testing.T) {
	h, err := newHandlerFromConfig(Config{})
	require.NoError(t, err)
	defer h.Bus.Close()
	_, complete, err := (enrolledExecution{h}).Cancel(context.Background(), device.Control{TaskID: "task-1", RunID: "run-lost", Kind: "cancel"})
	require.Error(t, err)
	require.False(t, complete)
}
