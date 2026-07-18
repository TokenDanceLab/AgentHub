package adapters

import "encoding/json"

// Residual pure-helper peel #1103: Codex exec JSONL event/item types.
// Kept unexported in package adapters; zero behavior change from codex.go.

type codexExecEvent struct {
	Type     string          `json:"type"`
	ThreadID string          `json:"thread_id,omitempty"`
	Usage    *codexUsage     `json:"usage,omitempty"`
	Item     json.RawMessage `json:"item,omitempty"`
	Message  string          `json:"message,omitempty"`
	Error    *codexError     `json:"error,omitempty"`
}

type codexError struct {
	Message string `json:"message"`
}

// codexUsage mirrors exec_events::Usage. The exec-level Usage struct only
// contains input_tokens, cached_input_tokens, and output_tokens. The
// reasoning_output_tokens and total_tokens fields are protocol-level
// TokenUsage fields included here for forward compatibility — they will be
// zero when Codex does not emit them.
type codexUsage struct {
	InputTokens           int64 `json:"input_tokens"`
	CachedInputTokens     int64 `json:"cached_input_tokens"`
	OutputTokens          int64 `json:"output_tokens"`
	ReasoningOutputTokens int64 `json:"reasoning_output_tokens,omitempty"`
	TotalTokens           int64 `json:"total_tokens,omitempty"`
}

// itemBase is used to probe the item's "type" field before decoding the full payload.
type itemBase struct {
	ID   string `json:"id"`
	Type string `json:"type"`
}

// codexItemError is the nested error in MCP tool call items.
type codexItemError struct {
	Message string `json:"message"`
}
