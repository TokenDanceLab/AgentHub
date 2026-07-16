package agentevent

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

func TestValidateRunEventType(t *testing.T) {
	tests := []struct {
		name      string
		eventType string
		wantErr   bool
	}{
		{name: "valid dot notation", eventType: "run.agent.result", wantErr: false},
		{name: "valid with underscore", eventType: "run_agent_result", wantErr: false},
		{name: "valid with dash", eventType: "run-agent-result", wantErr: false},
		{name: "valid alphanumeric", eventType: "run1", wantErr: false},
		{name: "empty", eventType: "", wantErr: true},
		{name: "invalid chars", eventType: "run agent!", wantErr: true},
		{name: "spaces only", eventType: "   ", wantErr: true},
		{name: "slash", eventType: "run/agent", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateRunEventType(tt.eventType)
			if tt.wantErr {
				assert.ErrorIs(t, err, errcode.ErrBadRequest)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestInferRunEventType(t *testing.T) {
	tests := []struct {
		name    string
		payload string
		want    string
	}{
		{name: "event_type field", payload: `{"event_type":"run.agent.result"}`, want: "run.agent.result"},
		{name: "type field", payload: `{"type":"run.agent.permission_requested"}`, want: "run.agent.permission_requested"},
		{name: "event_type takes precedence", payload: `{"event_type":"run.agent.result","type":"other"}`, want: "run.agent.result"},
		{name: "no matching fields", payload: `{"data":"hello"}`, want: ""},
		{name: "invalid json", payload: `not-json`, want: ""},
		{name: "empty string", payload: "", want: ""},
		{name: "empty object", payload: `{}`, want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, InferRunEventType(tt.payload))
		})
	}
}

func TestNormalizeRunEventInput(t *testing.T) {
	t.Run("explicit type with payload", func(t *testing.T) {
		eventType, payload, content, err := NormalizeRunEventInput(model.AgentRunEventInput{
			EventType: "run.agent.tool_call",
			Payload:   json.RawMessage(`{"toolName":"bash"}`),
		})
		require.NoError(t, err)
		assert.Equal(t, "run.agent.tool_call", eventType)
		assert.Equal(t, `{"toolName":"bash"}`, payload)
		assert.Equal(t, `{"toolName":"bash"}`, content)
	})

	t.Run("infers type from payload", func(t *testing.T) {
		eventType, payload, _, err := NormalizeRunEventInput(model.AgentRunEventInput{
			Payload: json.RawMessage(`{"event_type":"run.agent.result","ok":true}`),
		})
		require.NoError(t, err)
		assert.Equal(t, "run.agent.result", eventType)
		assert.Contains(t, payload, `"ok":true`)
	})

	t.Run("defaults missing type to output batch", func(t *testing.T) {
		eventType, _, _, err := NormalizeRunEventInput(model.AgentRunEventInput{
			Content: `{"text":"hello"}`,
		})
		require.NoError(t, err)
		assert.Equal(t, model.RunEventTypeOutputBatch, eventType)
	})

	t.Run("wraps plain content", func(t *testing.T) {
		eventType, payload, messageContent, err := NormalizeRunEventInput(model.AgentRunEventInput{
			Content: "plain text",
		})
		require.NoError(t, err)
		assert.Equal(t, model.RunEventTypeOutputBatch, eventType)
		assert.Equal(t, `{"content":"plain text"}`, payload)
		assert.Equal(t, `{"content":"plain text"}`, messageContent)
	})

	t.Run("rejects empty input", func(t *testing.T) {
		_, _, _, err := NormalizeRunEventInput(model.AgentRunEventInput{})
		assert.ErrorIs(t, err, errcode.ErrBadRequest)
	})

	t.Run("rejects invalid payload json", func(t *testing.T) {
		_, _, _, err := NormalizeRunEventInput(model.AgentRunEventInput{
			Payload: json.RawMessage(`{bad`),
		})
		assert.ErrorIs(t, err, errcode.ErrBadRequest)
	})

	t.Run("rejects oversized payload", func(t *testing.T) {
		big := strings.Repeat("a", model.RunEventPayloadMaxBytes+1)
		_, _, _, err := NormalizeRunEventInput(model.AgentRunEventInput{
			Content: big,
		})
		assert.ErrorIs(t, err, errcode.ErrBadRequest)
	})

	t.Run("rejects invalid type chars", func(t *testing.T) {
		_, _, _, err := NormalizeRunEventInput(model.AgentRunEventInput{
			EventType: "run agent!",
			Payload:   json.RawMessage(`{"ok":true}`),
		})
		assert.ErrorIs(t, err, errcode.ErrBadRequest)
	})
}

func TestValidateAgentCallbackGuards(t *testing.T) {
	assert.NoError(t, ValidateAgentCallbackPayloadSize("small"))
	assert.ErrorIs(t, ValidateAgentCallbackPayloadSize(strings.Repeat("x", model.RunEventPayloadMaxBytes+1)), errcode.ErrBadRequest)

	assert.NoError(t, ValidateAgentCallbackEdgeRunID("run-123"))
	assert.ErrorIs(t, ValidateAgentCallbackEdgeRunID(strings.Repeat("r", model.AgentCallbackEdgeRunIDMaxLength+1)), errcode.ErrBadRequest)
}

func TestSummarizeAgentRunEvents(t *testing.T) {
	started := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	finished := started.Add(2 * time.Second)
	task := &model.PendingAgentTask{
		ID:         "task-1",
		EdgeRunID:  "edge-run-1",
		Status:     model.TaskStatusDone,
		CreatedAt:  started,
		FinishedAt: &finished,
	}
	events := []model.AgentRunEvent{
		{
			ID:        "e1",
			EventSeq:  1,
			EventType: model.RunEventTypeOutputBatch,
			Payload:   `{"content":"hello"}`,
			CreatedAt: started,
		},
		{
			ID:        "e2",
			EventSeq:  2,
			EventType: "run.agent.tool_call",
			Payload:   `{"toolName":"bash"}`,
			CreatedAt: started.Add(time.Second),
		},
		{
			ID:        "e3",
			EventSeq:  3,
			EventType: "run.agent.permission_requested",
			Payload:   `{"requestId":"req-1","status":"pending"}`,
			CreatedAt: started.Add(1500 * time.Millisecond),
		},
		{
			ID:        "e4",
			EventSeq:  4,
			EventType: "run.agent.permission_decided",
			Payload:   `{"requestId":"req-1","decision":"allow"}`,
			CreatedAt: started.Add(1800 * time.Millisecond),
		},
		{
			ID:        "e5",
			EventSeq:  5,
			EventType: "run.agent.file_change",
			Payload:   `{"path":"a.go"}`,
			CreatedAt: started.Add(1900 * time.Millisecond),
		},
		{
			ID:        "e6",
			EventSeq:  6,
			EventType: "run.agent.result",
			Payload:   `{"usage":{"input_tokens":10,"output_tokens":20}}`,
			CreatedAt: finished,
		},
	}

	summary := SummarizeAgentRunEvents(task, events)
	assert.Equal(t, "task-1", summary.TaskID)
	assert.Equal(t, "edge-run-1", summary.EdgeRunID)
	assert.Equal(t, 6, summary.TotalEvents)
	assert.Equal(t, int64(6), summary.LastEventSeq)
	assert.Equal(t, 5, summary.StepCount) // all run.agent.* except output batch type may not prefix if different
	assert.Equal(t, 1, summary.ToolCallCount)
	assert.Equal(t, 1, summary.ArtifactCount)
	assert.Equal(t, 1, summary.ApprovalCount)
	assert.Equal(t, 0, summary.PendingApprovals)
	assert.Equal(t, 1, summary.DecidedApprovals)
	assert.Equal(t, 10, summary.InputTokens)
	assert.Equal(t, 20, summary.OutputTokens)
	assert.Equal(t, len("hello"), summary.OutputBytes)
	assert.Equal(t, int64(2000), summary.ElapsedMs)
}

func TestProjectTaskApprovalsPendingAndDecided(t *testing.T) {
	task := &model.PendingAgentTask{
		ID:           "task-1",
		EdgeRunID:    "edge-1",
		TargetID:     "target-1",
		EdgeDeviceID: "device-1",
	}
	events := []model.AgentRunEvent{
		{
			ID:        "e1",
			TaskID:    "task-1",
			EdgeRunID: "edge-1",
			SessionID: "sess-1",
			EventSeq:  1,
			EventType: "run.agent.permission_requested",
			Payload:   `{"requestId":"req-1","toolUseId":"tool-1","toolName":"bash","correlation_id":"corr-1","status":"pending"}`,
			CreatedAt: time.Now().UTC(),
		},
		{
			ID:        "e2",
			TaskID:    "task-1",
			EdgeRunID: "edge-1",
			SessionID: "sess-1",
			EventSeq:  2,
			EventType: "run.agent.permission_decided",
			Payload:   `{"requestId":"req-1","decision":"allow","reason":"ok","decided_by":"user-1"}`,
			CreatedAt: time.Now().UTC(),
		},
		{
			ID:        "e3",
			TaskID:    "task-1",
			EdgeRunID: "edge-1",
			SessionID: "sess-1",
			EventSeq:  3,
			EventType: "run.agent.permission_requested",
			Payload:   `{"requestId":"req-2","toolName":"write"}`,
			CreatedAt: time.Now().UTC(),
		},
	}

	projection := ProjectTaskApprovals(task, events)
	require.Len(t, projection.Approvals, 2)
	require.Len(t, projection.Pending, 1)
	require.Len(t, projection.Decided, 1)
	assert.Equal(t, "tool-1", projection.Decided[0].ApprovalID)
	assert.Equal(t, "allow", projection.Decided[0].Status)
	assert.Equal(t, "req-2", projection.Pending[0].RequestID)
	assert.Equal(t, "pending", projection.Pending[0].Status)

	found := FindTaskApproval(projection.Approvals, "tool-1")
	require.NotNil(t, found)
	assert.Equal(t, "allow", found.Status)
}

func TestProjectTaskArtifactsFileChangeAndCreated(t *testing.T) {
	task := &model.PendingAgentTask{ID: "task-1", EdgeRunID: "edge-1"}
	events := []model.AgentRunEvent{
		{
			ID:        "e1",
			TaskID:    "task-1",
			SessionID: "sess-1",
			EventSeq:  1,
			EventType: "run.agent.file_change",
			Payload:   `{"path":"a.go","action":"modify","can_apply":true,"can_revert":true}`,
			CreatedAt: time.Now().UTC(),
		},
		{
			ID:        "e2",
			TaskID:    "task-1",
			SessionID: "sess-1",
			EventSeq:  2,
			EventType: "artifact.created",
			Payload:   `{"path":"out.bin","artifact_id":"art-1","size_bytes":42,"mime_type":"application/octet-stream"}`,
			CreatedAt: time.Now().UTC(),
		},
	}

	projection := ProjectTaskArtifacts(task, events)
	require.Len(t, projection.Artifacts, 2)
	assert.Equal(t, "a.go", projection.Artifacts[0].Path)
	require.NotNil(t, projection.Artifacts[0].CanApply)
	assert.False(t, *projection.Artifacts[0].CanApply) // hub disables apply capability
	assert.Equal(t, "out.bin", projection.Artifacts[1].Path)
	assert.Equal(t, "art-1", projection.Artifacts[1].ArtifactID)
	assert.Equal(t, int64(42), projection.Artifacts[1].SizeBytes)
}

func TestApprovalHelpers(t *testing.T) {
	assert.True(t, ValidApprovalDecision("allow"))
	assert.True(t, ValidApprovalDecision("deny"))
	assert.False(t, ValidApprovalDecision("maybe"))

	assert.True(t, PendingApprovalStatus("pending"))
	assert.True(t, PendingApprovalStatus(""))
	assert.False(t, PendingApprovalStatus("allow"))

	assert.Equal(t, "tool-1", ApprovalIDFor("req-1", "tool-1"))
	assert.Equal(t, "req-1", ApprovalIDFor("req-1", ""))
	assert.Equal(t, "b", FirstNonEmptyString("", "b", "c"))
	assert.Equal(t, "a", FirstNonEmpty("", "a"))
	assert.Equal(t, "test", FirstJSONString(map[string]any{"name": "test"}, "label", "name"))
}
