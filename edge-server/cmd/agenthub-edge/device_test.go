//go:build !windows

package main

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/device"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestEnrolledConfigAndAdapterIsolation(t *testing.T) {
	for _, name := range []string{"AGENTHUB_HUB_URL", "AGENTHUB_HUB_TOKEN", "AGENTHUB_HUB_REFRESH_TOKEN", "AGENTHUB_HUB_JWT_SECRET", "AGENTHUB_DEV", "AGENTHUB_REMOTE_MODE", "AGENTHUB_DEVICE_CREDENTIAL_FILE", "AGENTHUB_HUB_MCP_SYNC_URL"} {
		t.Setenv(name, "")
	}
	t.Setenv("OPENAI_API_KEY", "fixture-dedicated-key")
	workspace := t.TempDir()
	state := t.TempDir()
	credential := device.Credential{HubURL: "https://hub.example", DeviceID: "device-1", TargetID: "target-1", Secret: "fixture-device-key", ExpiresAt: time.Now().Add(time.Hour), RuntimeID: "openai-sdk", WorkspaceRoot: workspace}
	path := filepath.Join(state, "credential.json")
	require.NoError(t, device.SaveCredential(path, credential))
	args := []string{"--device-credential-file", path, "--workspace-allowlist", workspace, "--store-backend", "sqlite", "--store-db", filepath.Join(state, "store.sqlite"), "--device-journal-db", filepath.Join(state, "journal.sqlite"), "--event-log-path", filepath.Join(state, "events.jsonl")}
	cfg, err := buildConfig(args)
	require.NoError(t, err)
	require.Equal(t, credential.Secret, cfg.HubToken)
	require.Equal(t, credential.DeviceID, cfg.EdgeDeviceID)
	require.Equal(t, "openai-sdk", cfg.AgentDefault)
	reg := buildAdapterRegistry(cfg)
	require.Len(t, reg.List(), 1)
	a, ok := reg.Get("openai-sdk")
	require.True(t, ok)
	require.True(t, a.Available())
	require.False(t, a.Capabilities().ToolCalls)
	for _, extra := range [][]string{{"--hub-token", "product-token"}, {"--hub-refresh-token", "product-refresh"}, {"--dev"}, {"--remote"}, {"--agent-default", "codex-acp"}, {"--runner-command", "arbitrary"}, {"--anthropic-sdk-path", "env"}, {"--openai-sdk-path", "not-an-env-key"}, {"--hub-url", "https://other.example"}, {"--store-backend", "memory"}} {
		t.Run(extra[0], func(t *testing.T) {
			_, err := buildConfig(append(append([]string(nil), args...), extra...))
			require.Error(t, err)
		})
	}
	t.Setenv("OPENAI_API_KEY", "")
	_, err = buildConfig(args)
	require.ErrorContains(t, err, "dedicated OPENAI_API_KEY")
}

func TestEnrollmentValidatesScopeWithoutModelCredentials(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "")
	workspace := t.TempDir()
	args := []string{"--enroll", "--hub-url", "https://hub.example", "--enrollment-name", "Fixture Edge", "--enrollment-workspace", workspace, "--workspace-allowlist", workspace, "--device-credential-file", filepath.Join(t.TempDir(), "credential.json")}
	cfg, err := buildConfig(args)
	require.NoError(t, err)
	require.True(t, cfg.Enroll)
	require.Nil(t, cfg.DeviceCredential)
	deviceID := uuid.NewString()
	renewal, err := buildConfig(append(append([]string(nil), args...), "--edge-device-id", deviceID))
	require.NoError(t, err)
	require.Equal(t, deviceID, renewal.EdgeDeviceID)
	_, err = buildConfig(append(append([]string(nil), args...), "--edge-device-id", "invalid"))
	require.Error(t, err)
	_, err = buildConfig(append(args, "--enrollment-workspace", t.TempDir()))
	require.Error(t, err)
}
