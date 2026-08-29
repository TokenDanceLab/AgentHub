package dispatch

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewPayloadNormalizesAgentType(t *testing.T) {
	p := NewPayload(
		"task-1", "ai-1", "claude", "t1", "d1", "s1",
		"msg-1", "u1", "hello", "Bot",
	)
	assert.Equal(t, "task-1", p.TaskID)
	assert.Equal(t, "ai-1", p.AgentInstanceID)
	assert.Equal(t, "claude-code", p.AgentType)
	assert.Equal(t, "t1", p.TargetID)
	assert.Equal(t, "d1", p.EdgeDeviceID)
	assert.Equal(t, "s1", p.SessionID)
	assert.Equal(t, "msg-1", p.TriggerMessageID)
	assert.Equal(t, "u1", p.TriggerUserID)
	assert.Equal(t, "hello", p.Prompt)
	assert.Equal(t, "Bot", p.DisplayName)
}

func TestApplyCustomAgentProfileAndTeamContext(t *testing.T) {
	schema := json.RawMessage(`{"type":"object"}`)
	p := NewPayload("t", "ai", "codex", "", "", "s", "m", "u", "p", "n")

	ApplyCustomAgentProfile(&p, "ca-1", &CustomAgentFields{
		SystemPrompt:  "sys",
		ModelParams:   `{"model":"x"}`,
		ToolWhitelist: `["bash"]`,
		OutputSchema:  &schema,
	})
	assert.Equal(t, "ca-1", p.CustomAgentID)
	assert.Equal(t, "sys", p.SystemPrompt)
	assert.Equal(t, `{"model":"x"}`, p.ModelParams)
	assert.Equal(t, `["bash"]`, p.ToolWhitelist)
	require.NotNil(t, p.OutputSchema)

	MergePayloadModelParams(&p, `{"reasoning_effort":"high"}`)
	var got map[string]any
	require.NoError(t, json.Unmarshal([]byte(p.ModelParams), &got))
	assert.Equal(t, "x", got["model"])
	assert.Equal(t, "high", got["reasoning_effort"])

	ApplyTeamContext(&p, TeamContext{
		TeamID: "team", TeamRunID: "run", TeamMemberID: "mem", TeamMemberRole: "lead",
	})
	assert.Equal(t, "team", p.TeamID)
	assert.Equal(t, "run", p.TeamRunID)
	assert.Equal(t, "mem", p.TeamMemberID)
	assert.Equal(t, "lead", p.TeamMemberRole)

	// empty custom agent / nil payload are no-ops
	ApplyCustomAgentProfile(nil, "ca", &CustomAgentFields{SystemPrompt: "x"})
	ApplyCustomAgentProfile(&p, "", &CustomAgentFields{SystemPrompt: "x"})
	ApplyTeamContext(nil, TeamContext{TeamRunID: "r"})
}

func TestMarshalWithDeliveryID(t *testing.T) {
	p := NewPayload("task", "ai", "claude-code", "", "", "s", "m", "u", "prompt", "n")
	raw, err := MarshalWithDeliveryID(p, "del-1")
	require.NoError(t, err)

	var decoded Payload
	require.NoError(t, json.Unmarshal(raw, &decoded))
	assert.Equal(t, "del-1", decoded.DeliveryID)
	assert.Equal(t, "task", decoded.TaskID)

	// original value type is not mutated by MarshalWithDeliveryID
	assert.Equal(t, "", p.DeliveryID)

	AttachDeliveryID(&p, "del-2")
	assert.Equal(t, "del-2", p.DeliveryID)
	AttachDeliveryID(nil, "x")
}

func TestApplyValidatedTargetAndCustomAgentIDHelpers(t *testing.T) {
	id, typ, device := ApplyValidatedTarget(nil)
	assert.Equal(t, "", id)
	assert.Equal(t, "", typ)
	assert.Equal(t, "", device)

	id, typ, device = ApplyValidatedTarget(&TargetSnapshot{ID: "t1", TargetType: "local_edge", DeviceID: "d1"})
	assert.Equal(t, "t1", id)
	assert.Equal(t, "local_edge", typ)
	assert.Equal(t, "d1", device)

	assert.Equal(t, "", CustomAgentIDValue(nil))
	empty := ""
	assert.Equal(t, "", CustomAgentIDValue(&empty))
	ca := "ca-1"
	assert.Equal(t, "ca-1", CustomAgentIDValue(&ca))
	assert.True(t, NeedsCustomAgentPreload(&ca))
	assert.False(t, NeedsCustomAgentPreload(nil))
	assert.True(t, HasCustomAgentBinding(&ca))
	assert.False(t, HasCustomAgentBinding(nil))
}

func TestResolveCapabilityMint(t *testing.T) {
	assert.False(t, ResolveCapabilityMint(CapabilityMintInput{}).Ok)
	assert.False(t, ResolveCapabilityMint(CapabilityMintInput{JWTSecret: "sec"}).Ok)

	got := ResolveCapabilityMint(CapabilityMintInput{
		JWTSecret:       " secret ",
		PayloadDeviceID: "dev-1",
		EnvDeviceID:     "env-dev",
		TriggerUserID:   "user-1",
		TargetID:        " tgt ",
	})
	require.True(t, got.Ok)
	assert.Equal(t, "secret", got.Secret)
	assert.Equal(t, "dev-1", got.DeviceID)
	assert.Equal(t, "user-1", got.UserID)
	assert.Equal(t, LocalProjectID, got.ProjectID)
	assert.Equal(t, LocalThreadID, got.ThreadID)
	assert.Equal(t, DefaultCapabilityAction, got.Action)
	assert.Equal(t, "tgt", got.TargetID)
	assert.Equal(t, CapabilityTokenTTL, got.TTL)
	assert.Equal(t, 5*time.Minute, got.TTL)

	// env device fallback + empty trigger user
	got = ResolveCapabilityMint(CapabilityMintInput{
		JWTSecret:   "sec",
		EnvDeviceID: "env-dev",
	})
	require.True(t, got.Ok)
	assert.Equal(t, "env-dev", got.DeviceID)
	assert.Equal(t, FallbackCapabilityUserID, got.UserID)
}

func TestDeadLetterHelpers(t *testing.T) {
	err := errors.New("boom")
	assert.Equal(t, "payload unmarshal: boom", DeadLetterReason(DeadLetterKindPayloadUnmarshal, err))
	assert.Equal(t, "payload marshal: boom", DeadLetterReason(DeadLetterKindPayloadMarshal, err))
	assert.Equal(t, "task lookup: boom", DeadLetterReason(DeadLetterKindTaskLookup, err))
	assert.Equal(t, "task status is done", DeadLetterTaskStatus("done"))
	assert.Equal(t,
		"id, agent_instance_id, triggered_by_user_id, status, edge_device_id, edge_run_id, target_id",
		PendingTaskRedeliverySelect,
	)
}

func TestAssembleDispatchPayloadGeneratesTraceID(t *testing.T) {
	p := AssembleDispatchPayload(AssemblePayloadInput{
		TaskID:          "t",
		AgentInstanceID: "ai",
		AgentType:       "claude-code",
		SessionID:       "s",
		TriggerMessageID: "m",
		TriggerUserID:   "u",
		Prompt:          "p",
		DisplayName:     "n",
	})
	if p.TraceID == "" {
		t.Fatal("expected non-empty TraceID on assembled payload")
	}
	if len(p.TraceID) != 32 {
		t.Fatalf("TraceID length = %d, want 32 hex chars", len(p.TraceID))
	}
	// Second assembly must produce a distinct trace id.
	p2 := AssembleDispatchPayload(AssemblePayloadInput{
		TaskID:          "t2",
		AgentInstanceID: "ai",
		AgentType:       "claude-code",
		SessionID:       "s",
		TriggerMessageID: "m",
		TriggerUserID:   "u",
		Prompt:          "p",
		DisplayName:     "n",
	})
	if p2.TraceID == p.TraceID {
		t.Fatalf("two assemblies produced identical TraceID %q", p.TraceID)
	}
}

func TestMarshalPayloadPreservesTraceID(t *testing.T) {
	p := AssembleDispatchPayload(AssemblePayloadInput{
		TaskID:          "t",
		AgentInstanceID: "ai",
		AgentType:       "claude-code",
		SessionID:       "s",
		TriggerMessageID: "m",
		TriggerUserID:   "u",
		Prompt:          "p",
		DisplayName:     "n",
	})
	raw, err := MarshalPayload(p)
	if err != nil {
		t.Fatalf("MarshalPayload error: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}
	got, ok := decoded["trace_id"].(string)
	if !ok || got != p.TraceID {
		t.Fatalf("decoded trace_id = %v, want %q", decoded["trace_id"], p.TraceID)
	}
}
