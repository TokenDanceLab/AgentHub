package sdk

// Residual pure-helper peel #1142: Anthropic Messages API request/SSE types.
// Grouped into package sdk (#1760); public Adapter surface unchanged.

// --- Anthropic API types ---

type anthropicRequest struct {
	Model     string             `json:"model"`
	MaxTokens int                `json:"max_tokens"`
	Messages  []anthropicMessage `json:"messages"`
	System    string             `json:"system,omitempty"`
	Stream    bool               `json:"stream"`
	Thinking  *anthropicThinking `json:"thinking,omitempty"`
	Tools     []anthropicTool    `json:"tools,omitempty"`
}

type anthropicMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type anthropicThinking struct {
	Type         string `json:"type"`
	BudgetTokens int    `json:"budget_tokens"`
}

type anthropicTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"input_schema"`
}

type anthropicSSEEvent struct {
	Type         string                    `json:"type"`
	Index        int                       `json:"index,omitempty"`
	Message      *anthropicSSEMessage      `json:"message,omitempty"`
	ContentBlock *anthropicSSEContentBlock `json:"content_block,omitempty"`
	Delta        *anthropicSSEDelta        `json:"delta,omitempty"`
	Usage        anthropicSSEUsage         `json:"usage,omitempty"`
	Error        *anthropicSSEError        `json:"error,omitempty"`
}

type anthropicSSEMessage struct {
	ID      string            `json:"id"`
	Type    string            `json:"type"`
	Role    string            `json:"role"`
	Content []any             `json:"content"`
	Model   string            `json:"model"`
	Usage   anthropicSSEUsage `json:"usage"`
}

type anthropicSSEUsage struct {
	InputTokens  int64 `json:"input_tokens"`
	OutputTokens int64 `json:"output_tokens"`
}

type anthropicSSEContentBlock struct {
	Type        string `json:"type"`
	Text        string `json:"text,omitempty"`
	ID          string `json:"id,omitempty"`
	Name        string `json:"name,omitempty"`
	PartialJSON string `json:"partial_json,omitempty"`
}

type anthropicSSEDelta struct {
	Type        string `json:"type"`
	Text        string `json:"text,omitempty"`
	Thinking    string `json:"thinking,omitempty"`
	PartialJSON string `json:"partial_json,omitempty"`
	StopReason  string `json:"stop_reason,omitempty"`
}

type anthropicSSEError struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}
