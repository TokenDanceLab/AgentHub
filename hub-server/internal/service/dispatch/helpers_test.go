package dispatch

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

func TestNormalizeRuntimeAgentType(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "claude-code exact", input: "claude-code", want: "claude-code"},
		{name: "claude short", input: "claude", want: "claude-code"},
		{name: "claude-4-6", input: "claude-4-6", want: "claude-code"},
		{name: "codex exact", input: "codex", want: "codex"},
		{name: "codex-gpt", input: "gpt-5.1-codex", want: "codex"},
		{name: "opencode exact", input: "opencode", want: "opencode"},
		{name: "opencode variant", input: "opencode-v2", want: "opencode"},
		{name: "empty", input: "", want: ""},
		{name: "whitespace", input: "  ", want: ""},
		{name: "unknown", input: "custom-runtime", want: "custom-runtime"},
		{name: "mixed case CLAUDE", input: "CLAUDE-CODE", want: "claude-code"},
		{name: "codEX mixed", input: "CodEX", want: "codex"},
		{name: "gpt prefix", input: "gpt-4o", want: "codex"}, // gpt substring match returns codex
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, NormalizeRuntimeAgentType(tt.input))
		})
	}
}

func TestMapSenderType(t *testing.T) {
	tests := []struct {
		name   string
		input  string
		expect string
	}{
		{name: "user", input: model.SenderTypeUser, expect: "user"},
		{name: "agent", input: model.SenderTypeAgent, expect: "assistant"},
		{name: "unknown", input: "system", expect: "system"},
		{name: "empty", input: "", expect: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expect, MapSenderType(tt.input))
		})
	}
}

func TestExtractMessageText(t *testing.T) {
	t.Run("nil message", func(t *testing.T) {
		assert.Equal(t, "", ExtractMessageText(nil))
	})

	t.Run("text content", func(t *testing.T) {
		msg := &model.Message{ContentType: model.ContentTypeText, Content: `{"text":"hello world"}`}
		assert.Equal(t, "hello world", ExtractMessageText(msg))
	})

	t.Run("code content", func(t *testing.T) {
		msg := &model.Message{ContentType: model.ContentTypeCode, Content: `{"text":"fmt.Println(\"hi\")"}`}
		assert.Equal(t, `fmt.Println("hi")`, ExtractMessageText(msg))
	})

	t.Run("diff content", func(t *testing.T) {
		msg := &model.Message{ContentType: model.ContentTypeDiff, Content: `{"text":"+added line"}`}
		assert.Equal(t, "+added line", ExtractMessageText(msg))
	})

	t.Run("empty text in content", func(t *testing.T) {
		msg := &model.Message{ContentType: model.ContentTypeText, Content: `{"text":""}`}
		assert.Equal(t, `{"text":""}`, ExtractMessageText(msg))
	})

	t.Run("non-text content type", func(t *testing.T) {
		msg := &model.Message{ContentType: model.ContentTypeImage, Content: `{"url":"https://example.com/img.png"}`}
		assert.Equal(t, `{"url":"https://example.com/img.png"}`, ExtractMessageText(msg))
	})

	t.Run("unparseable content", func(t *testing.T) {
		msg := &model.Message{ContentType: model.ContentTypeText, Content: `not-json`}
		assert.Equal(t, "not-json", ExtractMessageText(msg))
	})
}

func TestIsLoopback(t *testing.T) {
	assert.True(t, IsLoopback("http://127.0.0.1:3210"))
	assert.True(t, IsLoopback("http://localhost:3210"))
	assert.True(t, IsLoopback("http://[::1]:3210"))
	assert.False(t, IsLoopback("http://localhost.evil.com"))
	assert.False(t, IsLoopback("http://edge.example.com"))
	assert.False(t, IsLoopback("not a url"))
}

func TestPromptFromMessage_TextPayload(t *testing.T) {
	msg := &model.Message{
		ContentType: model.ContentTypeText,
		Content:     `{"text":"Run real Codex against this repo"}`,
	}
	require.Equal(t, "Run real Codex against this repo", PromptFromMessage(msg))
}

func TestMergeModelParamsLetsDispatchOverrideProfileDefaults(t *testing.T) {
	merged := MergeModelParams(
		`{"model":"claude-sonnet-4-6","reasoning_effort":"medium","permission_mode":"default"}`,
		`{"reasoning_effort":"high","work_dir":"D:\\Projects\\ExampleAgentHub"}`,
	)

	var got map[string]any
	require.NoError(t, json.Unmarshal([]byte(merged), &got))
	require.Equal(t, "claude-sonnet-4-6", got["model"])
	require.Equal(t, "high", got["reasoning_effort"])
	require.Equal(t, "default", got["permission_mode"])
	require.Equal(t, `D:\Projects\ExampleAgentHub`, got["work_dir"])
}

func TestSelectAgentInstanceHonorsRequestedRuntime(t *testing.T) {
	agents := []model.AgentInstance{
		{ID: "agent-claude", AgentType: "claude-code"},
		{ID: "agent-codex", AgentType: "codex"},
		{ID: "agent-opencode", AgentType: "opencode"},
	}

	selected, err := SelectAgentInstance(agents, "", "codex", "")

	require.NoError(t, err)
	require.Equal(t, "agent-codex", selected.ID)
}

func TestSelectAgentInstanceRejectsMissingRequestedRuntime(t *testing.T) {
	agents := []model.AgentInstance{
		{ID: "agent-claude", AgentType: "claude-code"},
	}

	_, err := SelectAgentInstance(agents, "", "opencode", "")

	require.ErrorIs(t, err, errcode.AgentNotFound)
}
