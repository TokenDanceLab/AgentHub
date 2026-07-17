package dispatch

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

func TestAssembleDispatchPayload(t *testing.T) {
	schema := json.RawMessage(`{"type":"object"}`)
	msgs := []Message{{Role: "user", Content: "hi", Timestamp: "2026-01-01T00:00:00Z"}}
	pins := []Message{{Role: "assistant", Content: "pin", Timestamp: "2026-01-01T00:01:00Z"}}

	p := AssembleDispatchPayload(AssemblePayloadInput{
		TaskID:           "task-1",
		AgentInstanceID:  "ai-1",
		AgentType:        "claude",
		TargetID:         "t1",
		EdgeDeviceID:     "d1",
		SessionID:        "s1",
		TriggerMessageID: "m1",
		TriggerUserID:    "u1",
		Prompt:           "hello",
		DisplayName:      "Bot",
		CustomAgentID:    "ca-1",
		CustomFields: &CustomAgentFields{
			SystemPrompt:  "sys",
			ModelParams:   `{"model":"x"}`,
			ToolWhitelist: `["bash"]`,
			OutputSchema:  &schema,
		},
		ModelParams:    `{"reasoning_effort":"high"}`,
		Team:           TeamContext{TeamID: "team", TeamRunID: "run", TeamMemberID: "mem", TeamMemberRole: "lead"},
		Messages:       msgs,
		PinnedMessages: pins,
	})

	assert.Equal(t, "task-1", p.TaskID)
	assert.Equal(t, "claude-code", p.AgentType)
	assert.Equal(t, "ca-1", p.CustomAgentID)
	assert.Equal(t, "sys", p.SystemPrompt)
	assert.Equal(t, `["bash"]`, p.ToolWhitelist)
	require.NotNil(t, p.OutputSchema)
	var got map[string]any
	require.NoError(t, json.Unmarshal([]byte(p.ModelParams), &got))
	assert.Equal(t, "x", got["model"])
	assert.Equal(t, "high", got["reasoning_effort"])
	assert.Equal(t, "team", p.TeamID)
	assert.Equal(t, "run", p.TeamRunID)
	assert.Equal(t, msgs, p.Messages)
	assert.Equal(t, pins, p.PinnedMessages)

	// empty custom agent id skips profile
	p2 := AssembleDispatchPayload(AssemblePayloadInput{
		TaskID: "t", AgentInstanceID: "ai", AgentType: "codex",
		SessionID: "s", TriggerMessageID: "m", TriggerUserID: "u",
		Prompt: "p", DisplayName: "n",
		CustomFields: &CustomAgentFields{SystemPrompt: "should-skip"},
	})
	assert.Equal(t, "", p2.CustomAgentID)
	assert.Equal(t, "", p2.SystemPrompt)
}

func TestFinalizeAfterDeliveryRecord(t *testing.T) {
	p := NewPayload("task", "ai", "claude-code", "", "", "s", "m", "u", "prompt", "n")
	got, body := FinalizeAfterDeliveryRecord(p, "del-1")
	assert.Equal(t, "del-1", got.DeliveryID)
	assert.Equal(t, "", p.DeliveryID)
	want, err := MarshalWithDeliveryID(p, "del-1")
	require.NoError(t, err)
	assert.JSONEq(t, string(want), string(body))
}

func TestMarshalPayload(t *testing.T) {
	p := NewPayload("task", "ai", "claude-code", "", "", "s", "m", "u", "prompt", "n")
	raw, err := MarshalPayload(p)
	require.NoError(t, err)
	var decoded Payload
	require.NoError(t, json.Unmarshal(raw, &decoded))
	assert.Equal(t, "task", decoded.TaskID)
}

func TestHistoryAndTeamGuards(t *testing.T) {
	assert.True(t, HistoryLoadIDs("s", "m"))
	assert.False(t, HistoryLoadIDs("", "m"))
	assert.False(t, HistoryLoadIDs("s", ""))
	assert.True(t, ShouldLoadPinnedMessages("s"))
	assert.False(t, ShouldLoadPinnedMessages(""))

	ca := "ca-1"
	assert.True(t, ShouldResolveTeamContext(&ca))
	assert.False(t, ShouldResolveTeamContext(nil))
	assert.True(t, TeamContextFromRun("run-1"))
	assert.False(t, TeamContextFromRun(""))
}

func TestPreDeviceTargetValidation(t *testing.T) {
	require.NoError(t, PreDeviceTargetValidation("u1", "u1", LocalEdgeTargetType, "online"))
	require.ErrorIs(t, PreDeviceTargetValidation("u2", "u1", LocalEdgeTargetType, "online"), errcode.TargetNotFound)
	require.Error(t, PreDeviceTargetValidation("u1", "u1", "hub_relay", "online"))
	require.Error(t, PreDeviceTargetValidation("u1", "u1", LocalEdgeTargetType, "offline"))

	err := DeviceMissingNotRoutable()
	require.Error(t, err)
	assert.Contains(t, err.Error(), DeviceNotRoutableErrorMessage)
	require.NoError(t, PostDeviceTargetValidation("u1", "u1", DesktopDeviceType))
	require.Error(t, PostDeviceTargetValidation("u1", "u2", DesktopDeviceType))
}

func TestRedispatchPrepFailure(t *testing.T) {
	kind, unwrap := RedispatchPrepFailure(nil)
	assert.Equal(t, "", kind)
	assert.Nil(t, unwrap)

	prep := &PayloadPrepError{Kind: DeadLetterKindPayloadMarshal, Err: errors.New("boom")}
	kind, unwrap = RedispatchPrepFailure(prep)
	assert.Equal(t, DeadLetterKindPayloadMarshal, kind)
	assert.EqualError(t, unwrap, "boom")
	assert.True(t, IsPayloadMarshalDeadLetter(kind))
	assert.False(t, IsPayloadMarshalDeadLetter(DeadLetterKindPayloadUnmarshal))

	kind, unwrap = RedispatchPrepFailure(errors.New("raw"))
	assert.Equal(t, DeadLetterKindPayloadUnmarshal, kind)
	assert.EqualError(t, unwrap, "raw")
}

func TestObserveRedeliveryConnAndOfflineKind(t *testing.T) {
	facts := ObserveRedeliveryConn(false, "u1", "u1")
	assert.False(t, facts.ConnFound)
	assert.False(t, facts.ConnUserMatch)

	facts = ObserveRedeliveryConn(true, "u1", "u1")
	assert.True(t, facts.ConnFound)
	assert.True(t, facts.ConnUserMatch)

	facts = ObserveRedeliveryConn(true, "u1", "u2")
	assert.True(t, facts.ConnFound)
	assert.False(t, facts.ConnUserMatch)

	assert.Equal(t, "offline", RedeliveryOfflineLogKind(true))
	assert.Equal(t, "fallback", RedeliveryOfflineLogKind(false))
}

func TestDeliveryMarkAndCapabilityGuards(t *testing.T) {
	assert.True(t, DeliveryMarkAfterDispatch("del-1"))
	assert.False(t, DeliveryMarkAfterDispatch(""))
	assert.True(t, IsHTTPEdgeDispatchSuccess("run-1"))
	assert.False(t, IsHTTPEdgeDispatchSuccess(""))
	assert.True(t, ShouldIssueCapabilityToken(CapabilityMintResolved{Ok: true}))
	assert.False(t, ShouldIssueCapabilityToken(CapabilityMintResolved{}))

	// smoke: queued pending task still builds
	_ = model.TaskStatusQueued
}
