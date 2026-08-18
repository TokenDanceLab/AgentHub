package sdk

import "strings"

// Residual pure-helper peel #1152: OpenAI Chat Completions API request/SSE types.
// Grouped into package sdk (#1760); public Adapter surface unchanged.

// --- OpenAI API types ---

type openaiChatRequest struct {
	Model           string                `json:"model"`
	Messages        []openaiChatMessage   `json:"messages"`
	Stream          bool                  `json:"stream"`
	StreamOptions   *openaiStreamOptions  `json:"stream_options,omitempty"`
	ResponseFormat  *openaiResponseFormat `json:"response_format,omitempty"`
	ReasoningEffort string                `json:"reasoning_effort,omitempty"`
}

type openaiStreamOptions struct {
	IncludeUsage bool `json:"include_usage"`
}

type openaiChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openaiResponseFormat struct {
	Type       string         `json:"type"`
	JSONSchema map[string]any `json:"json_schema,omitempty"`
}

type openaiChatChunk struct {
	ID      string            `json:"id"`
	Object  string            `json:"object"`
	Choices []openaiChoice    `json:"choices"`
	Usage   *openaiChunkUsage `json:"usage,omitempty"`
}

type openaiChoice struct {
	Index        int          `json:"index"`
	Delta        *openaiDelta `json:"delta,omitempty"`
	FinishReason string       `json:"finish_reason,omitempty"`
}

type openaiDelta struct {
	Role             string                `json:"role,omitempty"`
	Content          string                `json:"content,omitempty"`
	ReasoningContent string                `json:"reasoning_content,omitempty"`
	ToolCalls        []openaiToolCallDelta `json:"tool_calls,omitempty"`
}

type openaiToolCallDelta struct {
	Index    int                         `json:"index"`
	ID       string                      `json:"id,omitempty"`
	Type     string                      `json:"type,omitempty"`
	Function openaiToolCallDeltaFunction `json:"function,omitempty"`
}

type openaiToolCallDeltaFunction struct {
	Name      string `json:"name,omitempty"`
	Arguments string `json:"arguments,omitempty"`
}

type openaiChunkUsage struct {
	PromptTokens     int64 `json:"prompt_tokens"`
	CompletionTokens int64 `json:"completion_tokens"`
	TotalTokens      int64 `json:"total_tokens"`
}

type openaiToolCallAccumulator struct {
	ID        string
	Name      string
	Arguments strings.Builder
}
