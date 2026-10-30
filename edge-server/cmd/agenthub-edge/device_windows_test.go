package main

import (
	"path/filepath"
	"testing"

	"github.com/agenthub/edge-server/internal/device"
	"github.com/stretchr/testify/require"
)

func TestWindowsRejectsPairedFlagsAndKeepsOrdinaryEdge(t *testing.T) {
	t.Setenv("AGENTHUB_DEVICE_CREDENTIAL_FILE", "")
	t.Setenv("AGENTHUB_HUB_TOKEN", "")
	t.Setenv("AGENTHUB_HUB_REFRESH_TOKEN", "")
	path := filepath.Join(t.TempDir(), "credential.json")
	for _, args := range [][]string{{"--enroll", "--device-credential-file", path}, {"--device-credential-file", path}} {
		_, err := buildConfig(args)
		require.ErrorIs(t, err, device.ErrUnsupportedPlatform)
	}
	_, err := buildConfig(nil)
	require.NoError(t, err, "ordinary Windows Edge/Local Desktop is not the paired mode")
}
