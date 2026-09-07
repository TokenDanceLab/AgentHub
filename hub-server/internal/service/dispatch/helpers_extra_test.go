package dispatch

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/model"
)

func TestResolveEdgeHTTPURL(t *testing.T) {
	assert.Equal(t, DefaultEdgeHTTPURL, ResolveEdgeHTTPURL(""))
	assert.Equal(t, "https://edge.example.com", ResolveEdgeHTTPURL("https://edge.example.com"))
}

func TestIsInsecureNonLoopbackEdge(t *testing.T) {
	assert.False(t, IsInsecureNonLoopbackEdge("http://127.0.0.1:3210"))
	assert.False(t, IsInsecureNonLoopbackEdge("http://localhost:3210"))
	assert.False(t, IsInsecureNonLoopbackEdge("https://edge.example.com"))
	assert.True(t, IsInsecureNonLoopbackEdge("http://edge.example.com"))
	assert.True(t, IsInsecureNonLoopbackEdge("http://localhost.evil.com"))
}

func TestTaskStatusHelpers(t *testing.T) {
	assert.True(t, IsTerminalTaskStatus(model.TaskStatusDone))
	assert.True(t, IsTerminalTaskStatus(model.TaskStatusFailed))
	assert.True(t, IsTerminalTaskStatus(model.TaskStatusCancelled))
	assert.True(t, IsTerminalTaskStatus(model.TaskStatusTimeout))
	assert.False(t, IsTerminalTaskStatus(model.TaskStatusQueued))
	assert.False(t, IsTerminalTaskStatus(model.TaskStatusRunning))

	assert.True(t, IsCancelledTaskStatus(model.TaskStatusCancelled))
	assert.False(t, IsCancelledTaskStatus(model.TaskStatusDone))

	assert.True(t, CanRegenerateTaskStatus(model.TaskStatusDone))
	assert.False(t, CanRegenerateTaskStatus(model.TaskStatusDispatched))

	assert.True(t, IsRetryableTaskStatus(model.TaskStatusQueued))
	assert.True(t, IsRetryableTaskStatus(model.TaskStatusDispatched))
	// #1000: running must not be redispatchable while Edge executes.
	assert.False(t, IsRetryableTaskStatus(model.TaskStatusRunning))
	assert.False(t, IsRetryableTaskStatus(model.TaskStatusDone))
	assert.False(t, IsRetryableTaskStatus(model.TaskStatusCancelled))
	assert.False(t, IsRetryableTaskStatus(model.TaskStatusFailed))
	assert.False(t, IsRetryableTaskStatus(model.TaskStatusTimeout))
}

func TestMapMessagesChronological(t *testing.T) {
	t0 := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	t1 := t0.Add(time.Minute)
	// Input as DESC (newest first) as returned by GetMessagesBySession.
	msgs := []model.Message{
		{ContentType: model.ContentTypeText, Content: `{"text":"second"}`, SenderType: model.SenderTypeAgent, CreatedAt: t1},
		{ContentType: model.ContentTypeText, Content: `{"text":"first"}`, SenderType: model.SenderTypeUser, CreatedAt: t0},
	}
	got := MapMessagesChronological(msgs, true)
	require.Len(t, got, 2)
	assert.Equal(t, "user", got[0].Role)
	assert.Equal(t, "first", got[0].Content)
	assert.Equal(t, t0.Format(time.RFC3339), got[0].Timestamp)
	assert.Equal(t, "assistant", got[1].Role)
	assert.Equal(t, "second", got[1].Content)
}

func TestMapPinnedMessagesSkipsEmpty(t *testing.T) {
	t0 := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	msgs := []model.Message{
		{ContentType: model.ContentTypeText, Content: `{"text":""}`, SenderType: model.SenderTypeUser, CreatedAt: t0},
		{ContentType: model.ContentTypeText, Content: `{"text":"pin"}`, SenderType: model.SenderTypeUser, CreatedAt: t0},
	}
	// Empty text falls back to raw content `{"text":""}` which is non-empty — keep pin with raw.
	// True empty: non-text with empty content.
	msgs[0] = model.Message{ContentType: model.ContentTypeImage, Content: "", SenderType: model.SenderTypeUser, CreatedAt: t0}
	got := MapPinnedMessages(msgs)
	require.Len(t, got, 1)
	assert.Equal(t, "pin", got[0].Content)
}

func TestBuildEdgeRunRequest(t *testing.T) {
	schema := json.RawMessage(`{"type":"object"}`)
	payload := Payload{
		TaskID:        "task-1",
		DeliveryID:    "deliv-1",
		AgentType:     "claude-code",
		SessionID:     "conversation-1",
		Prompt:        "hello",
		SystemPrompt:  "sys",
		ModelParams:   `{"model":"selected","work_dir":"/workspace","include_partial":false,"max_thinking_tokens":0}`,
		ToolWhitelist: `["Read"]`,
		Messages:      []Message{{Role: "user", Content: "hi", Timestamp: "2026-01-01T00:00:00Z"}},
		OutputSchema:  &schema,
	}
	req := BuildEdgeRunRequest(payload)
	assert.Equal(t, LocalProjectID, req.ProjectID)
	assert.Equal(t, LocalThreadID, req.ThreadID)
	assert.Equal(t, EdgeCallbackOwner, req.CallbackOwner)
	assert.Equal(t, "claude-code", req.AgentID)
	assert.Equal(t, "selected", req.Model)
	assert.Equal(t, "hello", req.Prompt)
	assert.Equal(t, "sys", req.SystemPrompt)
	assert.Equal(t, "task-1", req.HubTaskID)
	assert.Equal(t, "deliv-1", req.DeliveryID)
	assert.Equal(t, `{"type":"object"}`, req.StructuredOutputSchema)
	assert.Equal(t, []string{"Read"}, req.AllowedTools)
	assert.Equal(t, "/workspace", req.WorkDir)
	require.NotNil(t, req.IncludePartial)
	assert.False(t, *req.IncludePartial)
	require.NotNil(t, req.MaxThinkingTokens)
	assert.Equal(t, 0, *req.MaxThinkingTokens)
	// Hub session_id is conversation identity, not the Edge runtime session.
	assert.Equal(t, "", req.SessionID)
	require.Len(t, req.Messages, 1)

	// nil / empty schema → no structured field; no hardcoded model.
	req2 := BuildEdgeRunRequest(Payload{TaskID: "t", AgentType: "codex", Prompt: "p"})
	assert.Equal(t, "", req2.StructuredOutputSchema)
	assert.Equal(t, "codex", req2.AgentID)
	assert.Equal(t, "", req2.Model)
	assert.Equal(t, EdgeCallbackOwner, req2.CallbackOwner)
}
