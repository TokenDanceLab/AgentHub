package dispatch

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/errcode"
)

func TestResolveCapabilityDeviceID(t *testing.T) {
	assert.Equal(t, "dev-1", ResolveCapabilityDeviceID("dev-1", "env-dev"))
	assert.Equal(t, "env-dev", ResolveCapabilityDeviceID("", "env-dev"))
	assert.Equal(t, "env-dev", ResolveCapabilityDeviceID("  ", "env-dev"))
	assert.Equal(t, "", ResolveCapabilityDeviceID("", ""))
}

func TestResolveCapabilityUserID(t *testing.T) {
	assert.Equal(t, "user-1", ResolveCapabilityUserID("user-1"))
	assert.Equal(t, FallbackCapabilityUserID, ResolveCapabilityUserID(""))
	assert.Equal(t, FallbackCapabilityUserID, ResolveCapabilityUserID("  "))
}

func TestEdgeAuthBearerToken(t *testing.T) {
	assert.Equal(t, "tok", EdgeAuthBearerToken(" tok "))
	assert.Equal(t, "", EdgeAuthBearerToken(""))
}

func TestMatchTeamContext(t *testing.T) {
	profile := "ca-1"
	members := []TeamMemberRef{
		{ID: "m-other", Role: "worker", AgentProfileID: strPtr("other")},
		{ID: "m-1", Role: "lead", AgentProfileID: &profile},
	}
	got := MatchTeamContext("team-1", "run-1", "ca-1", members)
	assert.Equal(t, "team-1", got.TeamID)
	assert.Equal(t, "run-1", got.TeamRunID)
	assert.Equal(t, "m-1", got.TeamMemberID)
	assert.Equal(t, "lead", got.TeamMemberRole)

	// No member match → team+run only
	got = MatchTeamContext("team-1", "run-1", "missing", members)
	assert.Equal(t, "team-1", got.TeamID)
	assert.Equal(t, "run-1", got.TeamRunID)
	assert.Equal(t, "", got.TeamMemberID)

	// Empty custom agent / empty run → zero
	assert.Equal(t, TeamContext{}, MatchTeamContext("team-1", "run-1", "", members))
	assert.Equal(t, TeamContext{}, MatchTeamContext("team-1", "", "ca-1", members))
}

func TestTargetValidationHelpers(t *testing.T) {
	require.ErrorIs(t, ValidateTargetOwner("other", "u1"), errcode.TargetNotFound)
	require.NoError(t, ValidateTargetOwner("u1", "u1"))

	require.Error(t, ValidateTargetType("hub_relay"))
	require.NoError(t, ValidateTargetType(LocalEdgeTargetType))

	require.Error(t, ValidateTargetHealth("offline"))
	require.NoError(t, ValidateTargetHealth("online"))
	require.NoError(t, ValidateTargetHealth("healthy"))

	_, err := BoundDeviceID(nil)
	require.Error(t, err)
	empty := "  "
	_, err = BoundDeviceID(&empty)
	require.Error(t, err)
	dev := "device-1"
	got, err := BoundDeviceID(&dev)
	require.NoError(t, err)
	assert.Equal(t, "device-1", got)

	require.Error(t, ValidateTargetDevice("u1", "other", "desktop"))
	require.Error(t, ValidateTargetDevice("u1", "u1", "mobile"))
	require.NoError(t, ValidateTargetDevice("u1", "u1", "desktop"))

	snap := NewTargetSnapshot("t1", LocalEdgeTargetType, "device-1")
	require.NotNil(t, snap)
	assert.Equal(t, "t1", snap.ID)
	assert.Equal(t, LocalEdgeTargetType, snap.TargetType)
	assert.Equal(t, "device-1", snap.DeviceID)
}

func TestShouldTryHTTPRedelivery(t *testing.T) {
	assert.True(t, ShouldTryHTTPRedelivery("", ""))
	assert.False(t, ShouldTryHTTPRedelivery("t1", ""))
	assert.False(t, ShouldTryHTTPRedelivery("", "dev-1"))
}

func TestMinimalPendingTaskForHTTP(t *testing.T) {
	task := MinimalPendingTaskForHTTP(PendingTaskSnapshot{
		ID: "task-1", TargetID: "t1", EdgeDeviceID: "d1",
	})
	require.NotNil(t, task)
	assert.Equal(t, "task-1", task.ID)
	assert.Equal(t, "t1", task.TargetID)
	assert.Equal(t, "d1", task.EdgeDeviceID)
}

func TestParseEdgeRunID(t *testing.T) {
	id, err := ParseEdgeRunID([]byte(`{"success":true,"data":{"runId":"run-9"}}`))
	require.NoError(t, err)
	assert.Equal(t, "run-9", id)

	_, err = ParseEdgeRunID([]byte(`not-json`))
	require.Error(t, err)
}

func strPtr(s string) *string { return &s }
