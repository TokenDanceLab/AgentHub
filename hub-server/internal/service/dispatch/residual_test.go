package dispatch

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

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

	sp, _, _, os = ApplyCustomAgentToPayload("ca-1", nil)
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

func TestCustomAgentFieldsFromModel(t *testing.T) {
	assert.Nil(t, CustomAgentFieldsFromModel(nil))

	schema := json.RawMessage(`{"type":"object"}`)
	ca := &model.CustomAgent{
		SystemPrompt:  "sys",
		ModelParams:   `{"model":"x"}`,
		ToolWhitelist: `["bash"]`,
		OutputSchema:  &schema,
	}
	fields := CustomAgentFieldsFromModel(ca)
	require.NotNil(t, fields)
	assert.Equal(t, "sys", fields.SystemPrompt)
	assert.Equal(t, `{"model":"x"}`, fields.ModelParams)
	assert.Equal(t, `["bash"]`, fields.ToolWhitelist)
	require.NotNil(t, fields.OutputSchema)
	assert.Equal(t, schema, *fields.OutputSchema)
	// pointer identity preserved for OutputSchema
	assert.Same(t, ca.OutputSchema, fields.OutputSchema)
}

func TestTeamMemberRefsFromMembers(t *testing.T) {
	assert.Nil(t, TeamMemberRefsFromMembers(nil))
	assert.Nil(t, TeamMemberRefsFromMembers([]model.AgentTeamMember{}))

	p := "ca-1"
	members := []model.AgentTeamMember{
		{ID: "m1", Role: "lead", AgentProfileID: &p},
		{ID: "m2", Role: "worker", AgentProfileID: nil},
	}
	refs := TeamMemberRefsFromMembers(members)
	require.Len(t, refs, 2)
	assert.Equal(t, "m1", refs[0].ID)
	assert.Equal(t, "lead", refs[0].Role)
	require.NotNil(t, refs[0].AgentProfileID)
	assert.Equal(t, "ca-1", *refs[0].AgentProfileID)
	assert.Equal(t, "m2", refs[1].ID)
	assert.Nil(t, refs[1].AgentProfileID)
}

func TestPinMessageIDsFromModels(t *testing.T) {
	assert.Nil(t, PinMessageIDsFromModels(nil))
	assert.Nil(t, PinMessageIDsFromModels([]model.MessagePin{}))
	got := PinMessageIDsFromModels([]model.MessagePin{
		{MessageID: "a"},
		{MessageID: "b"},
	})
	assert.Equal(t, []string{"a", "b"}, got)
}

func TestNewQueuedPendingTask(t *testing.T) {
	expire := time.Unix(1_700_000_000, 0).UTC()
	task := NewQueuedPendingTask("ai", "u", "msg", "t1", "d1", expire)
	require.NotNil(t, task)
	assert.Equal(t, "ai", task.AgentInstanceID)
	assert.Equal(t, "u", task.TriggeredByUserID)
	assert.Equal(t, "msg", task.TriggerMessageID)
	assert.Equal(t, "t1", task.TargetID)
	assert.Equal(t, "d1", task.EdgeDeviceID)
	assert.Equal(t, model.TaskStatusQueued, task.Status)
	assert.True(t, task.ExpireAt.Equal(expire))
}

func TestClassifyPrimaryDispatchRoute(t *testing.T) {
	assert.Equal(t, RouteHTTP, ClassifyPrimaryDispatchRoute("", "", "", false))
	assert.Equal(t, RouteMissingEdge, ClassifyPrimaryDispatchRoute("t1", HubRelayTargetType, "", true))
	assert.Equal(t, RouteHubRelay, ClassifyPrimaryDispatchRoute("t1", HubRelayTargetType, "d1", true))
	assert.Equal(t, RouteTargetBound, ClassifyPrimaryDispatchRoute("t1", HubRelayTargetType, "d1", false))
	assert.Equal(t, RouteTargetBound, ClassifyPrimaryDispatchRoute("t1", "local_edge", "d1", true))

	assert.Equal(t, RouteInviterDesktop, ClassifyUnboundFallbackRoute("c1", true, nil))
	assert.Equal(t, RouteOffline, ClassifyUnboundFallbackRoute("", true, nil))
	assert.Equal(t, RouteOffline, ClassifyUnboundFallbackRoute("c1", false, nil))
	assert.Equal(t, RouteOffline, ClassifyUnboundFallbackRoute("c1", true, assert.AnError))
}

func TestPrepareRedispatchPayload(t *testing.T) {
	_, _, err := PrepareRedispatchPayload("{", "del-1")
	require.Error(t, err)
	var prep *PayloadPrepError
	require.ErrorAs(t, err, &prep)
	assert.Equal(t, DeadLetterKindPayloadUnmarshal, prep.Kind)

	p := NewPayload("task", "ai", "claude-code", "", "", "s", "m", "u", "prompt", "n")
	raw, err := json.Marshal(p)
	require.NoError(t, err)

	dp, body, err := PrepareRedispatchPayload(string(raw), "del-9")
	require.NoError(t, err)
	assert.Equal(t, "del-9", dp.DeliveryID)

	want, err := MarshalWithDeliveryID(p, "del-9")
	require.NoError(t, err)
	assert.JSONEq(t, string(want), string(body))
}

func TestEdgeHTTPHeaders(t *testing.T) {
	h := EdgeHTTPHeaders("", "")
	assert.Equal(t, "application/json", h.Get("Content-Type"))
	assert.Equal(t, "", h.Get("Authorization"))
	assert.Equal(t, "", h.Get(CapabilityTokenHeader))

	h = EdgeHTTPHeaders("secret", "cap-token")
	assert.Equal(t, "application/json", h.Get("Content-Type"))
	assert.Equal(t, "Bearer secret", h.Get("Authorization"))
	assert.Equal(t, "cap-token", h.Get(CapabilityTokenHeader))
}

func TestClassifyRedeliveryRoutes(t *testing.T) {
	assert.Equal(t, RouteHTTP, ClassifyRedeliveryPrimaryRoute("", ""))
	assert.Equal(t, RouteTargetBound, ClassifyRedeliveryPrimaryRoute("t1", "d1"))
	assert.Equal(t, RouteTargetBound, ClassifyRedeliveryPrimaryRoute("", "d1"))
	assert.Equal(t, RouteInviterDesktop, ClassifyRedeliveryPrimaryRoute("t1", ""))

	// Device-bound: available + user match → target_bound.
	assert.Equal(t, RouteTargetBound, ClassifyRedeliveryRoute(true, "c1", true, nil, true, true))
	// Device-bound: available but user mismatch / missing conn → offline.
	assert.Equal(t, RouteOffline, ClassifyRedeliveryRoute(true, "c1", true, nil, true, false))
	assert.Equal(t, RouteOffline, ClassifyRedeliveryRoute(true, "c1", true, nil, false, false))
	// Inviter path: found conn → inviter_desktop; missing → offline.
	assert.Equal(t, RouteInviterDesktop, ClassifyRedeliveryRoute(false, "c1", true, nil, true, false))
	assert.Equal(t, RouteOffline, ClassifyRedeliveryRoute(false, "c1", true, nil, false, false))
	// Route unavailable (err / empty / no mgr).
	assert.Equal(t, RouteOffline, ClassifyRedeliveryRoute(true, "", true, nil, false, false))
	assert.Equal(t, RouteOffline, ClassifyRedeliveryRoute(false, "c1", false, nil, true, true))
	assert.Equal(t, RouteOffline, ClassifyRedeliveryRoute(false, "c1", true, assert.AnError, true, true))
}

func TestTargetBoundRouteUnavailable(t *testing.T) {
	assert.True(t, TargetBoundRouteUnavailable(assert.AnError, "c1", true))
	assert.True(t, TargetBoundRouteUnavailable(nil, "", true))
	assert.True(t, TargetBoundRouteUnavailable(nil, "c1", false))
	assert.False(t, TargetBoundRouteUnavailable(nil, "c1", true))
}

func TestFinalizePayloadWithDelivery(t *testing.T) {
	p := NewPayload("task", "ai", "claude-code", "", "", "s", "m", "u", "prompt", "n")
	got, body, err := FinalizePayloadWithDelivery(p, "del-1")
	require.NoError(t, err)
	assert.Equal(t, "del-1", got.DeliveryID)
	assert.Equal(t, "", p.DeliveryID) // input not mutated
	want, err := MarshalWithDeliveryID(p, "del-1")
	require.NoError(t, err)
	assert.JSONEq(t, string(want), string(body))
}

func TestMarshalEdgeRunRequest(t *testing.T) {
	schema := json.RawMessage(`{"type":"object"}`)
	payload := Payload{
		TaskID:       "task-1",
		DeliveryID:   "del-1",
		AgentType:    "claude-code",
		Prompt:       "hi",
		SystemPrompt: "sys",
		ModelParams:  `{"model":"selected"}`,
		OutputSchema: &schema,
	}
	body, err := MarshalEdgeRunRequest(payload)
	require.NoError(t, err)
	want, err := json.Marshal(BuildEdgeRunRequest(payload))
	require.NoError(t, err)
	assert.JSONEq(t, string(want), string(body))
}
