package dispatch

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

func TestApplyCustomAgentToPayload(t *testing.T) {
	schema := json.RawMessage(`{"type":"object"}`)
	fields := &CustomAgentFields{
		SystemPrompt:  "sys",
		ModelParams:   `{"model":"x"}`,
		ToolWhitelist: `["bash"]`,
		OutputSchema:  &schema,
	}
	sp, mp, tw, os := ApplyCustomAgentToPayload("ca-1", fields)
	assert.Equal(t, "sys", sp)
	assert.Equal(t, `{"model":"x"}`, mp)
	assert.Equal(t, `["bash"]`, tw)
	require.NotNil(t, os)
	assert.Equal(t, schema, *os)

	sp, mp, tw, os = ApplyCustomAgentToPayload("", fields)
	assert.Equal(t, "", sp)
	assert.Equal(t, "", mp)
	assert.Equal(t, "", tw)
	assert.Nil(t, os)

	sp, mp, tw, os = ApplyCustomAgentToPayload("ca-1", nil)
	assert.Equal(t, "", sp)
	assert.Nil(t, os)
}

func TestApplyTeamContextToPayload(t *testing.T) {
	tid, rid, mid, role := ApplyTeamContextToPayload(TeamContext{
		TeamID: "t1", TeamRunID: "r1", TeamMemberID: "m1", TeamMemberRole: "lead",
	})
	assert.Equal(t, "t1", tid)
	assert.Equal(t, "r1", rid)
	assert.Equal(t, "m1", mid)
	assert.Equal(t, "lead", role)

	tid, rid, mid, role = ApplyTeamContextToPayload(TeamContext{TeamID: "t1"})
	assert.Equal(t, "", tid)
	assert.Equal(t, "", rid)
	assert.Equal(t, "", mid)
	assert.Equal(t, "", role)
}

func TestTeamMemberRefsFromProfiles(t *testing.T) {
	p := "ca-1"
	refs := TeamMemberRefsFromProfiles(
		[]string{"m1", "m2"},
		[]string{"lead", "worker"},
		[]*string{&p, nil},
	)
	require.Len(t, refs, 2)
	assert.Equal(t, "m1", refs[0].ID)
	assert.Equal(t, "lead", refs[0].Role)
	require.NotNil(t, refs[0].AgentProfileID)
	assert.Equal(t, "ca-1", *refs[0].AgentProfileID)
	assert.Nil(t, refs[1].AgentProfileID)

	assert.Nil(t, TeamMemberRefsFromProfiles(nil, nil, nil))
}

func TestRoutingHelpers(t *testing.T) {
	assert.True(t, ShouldTryHTTPDispatch(""))
	assert.False(t, ShouldTryHTTPDispatch("t1"))

	assert.True(t, IsHubRelayRoute(HubRelayTargetType, true))
	assert.False(t, IsHubRelayRoute(HubRelayTargetType, false))
	assert.False(t, IsHubRelayRoute(LocalEdgeTargetType, true))

	assert.True(t, MissingTargetEdgeDevice("t1", ""))
	assert.False(t, MissingTargetEdgeDevice("t1", "d1"))
	assert.False(t, MissingTargetEdgeDevice("", ""))

	assert.True(t, CanPushInviterDesktop("conn-1", true, nil))
	assert.False(t, CanPushInviterDesktop("", true, nil))
	assert.False(t, CanPushInviterDesktop("conn-1", false, nil))
	assert.False(t, CanPushInviterDesktop("conn-1", true, assert.AnError))

	assert.True(t, IsMatchingTargetBoundConn("u1", DesktopDeviceType, "d1", "u1", "d1"))
	assert.False(t, IsMatchingTargetBoundConn("u1", DesktopDeviceType, "d1", "u2", "d1"))
	assert.False(t, IsMatchingTargetBoundConn("u1", "mobile", "d1", "u1", "d1"))

	assert.True(t, IsMatchingRedeliveryConn("u1", "u1"))
	assert.False(t, IsMatchingRedeliveryConn("u1", "u2"))

	assert.True(t, PreferDeviceBoundRedelivery("d1"))
	assert.False(t, PreferDeviceBoundRedelivery(""))
}

func TestTaskAccessHelpers(t *testing.T) {
	assert.True(t, IsTaskOwner("u1", "u1"))
	assert.False(t, IsTaskOwner("u1", "u2"))

	require.NoError(t, TaskNotFoundIfNotOwner("u1", "u1"))
	require.ErrorIs(t, TaskNotFoundIfNotOwner("u1", "u2"), errcode.AgentTaskNotFound)

	require.NoError(t, CancelTaskTerminalError(model.TaskStatusQueued))
	require.ErrorIs(t, CancelTaskTerminalError(model.TaskStatusCancelled), errcode.AgentTaskCancelled)
	require.ErrorIs(t, CancelTaskTerminalError(model.TaskStatusDone), errcode.AgentTaskTimeout)

	require.NoError(t, RegenerateTaskStatusError(model.TaskStatusDone))
	require.Error(t, RegenerateTaskStatusError(model.TaskStatusRunning))

	snap := NewPendingTaskSnapshot("id", "ai", "u", "queued", "d", "r", "t")
	assert.Equal(t, "id", snap.ID)
	assert.Equal(t, "ai", snap.AgentInstanceID)
	assert.Equal(t, "u", snap.TriggeredByUserID)
	assert.Equal(t, "queued", snap.Status)
	assert.Equal(t, "d", snap.EdgeDeviceID)
	assert.Equal(t, "r", snap.EdgeRunID)
	assert.Equal(t, "t", snap.TargetID)
}

func TestHTTPDispatchHelpers(t *testing.T) {
	assert.Equal(t, "http://127.0.0.1:3210/v1/runs", EdgeRunsURL(DefaultEdgeHTTPURL))
	assert.True(t, IsEdgeHTTPSuccessStatus(http.StatusOK))
	assert.True(t, IsEdgeHTTPSuccessStatus(http.StatusAccepted))
	assert.False(t, IsEdgeHTTPSuccessStatus(http.StatusBadRequest))
	assert.Equal(t, 64*1024, EdgeHTTPResponseBodyLimit)
	assert.Equal(t, CapabilityTokenHeader, "X-AgentHub-Capability-Token")
}

func TestEventPayloads(t *testing.T) {
	cancel := CancelEventPayload("t1", "ai1", "s1", "u1")
	assert.Equal(t, "t1", cancel["task_id"])
	assert.Equal(t, "ai1", cancel["agent_instance_id"])
	assert.Equal(t, "s1", cancel["session_id"])
	assert.Equal(t, "u1", cancel["triggered_by"])

	regen := RegenerateEventPayload("old", "new", "ai1", "s1", "msg1")
	assert.Equal(t, "old", regen["original_task_id"])
	assert.Equal(t, "new", regen["new_task_id"])
	assert.Equal(t, "msg1", regen["trigger_message_id"])
	assert.Equal(t, EventTypeAgentCancel, "agent.cancel")
	assert.Equal(t, EventTypeAgentRegenerate, "agent.regenerate")
}

func TestPinMessageIDs(t *testing.T) {
	assert.Nil(t, PinMessageIDs(nil))
	got := PinMessageIDs([]string{"a", "b"})
	assert.Equal(t, []string{"a", "b"}, got)
	// defensive copy
	got[0] = "x"
	src := []string{"a", "b"}
	_ = PinMessageIDs(src)
	assert.Equal(t, "a", src[0])
}
