package adapters

// Residual pure-helper peel #1113: Claude SDK message schemas used for NDJSON parsing.

// --- Claude SDK message schemas (subset used for parsing) ---

type claudeSDKMessage struct {
	Type    string `json:"type"`
	Subtype string `json:"subtype,omitempty"`

	// Assistant/user messages
	Message *claudeContentMessage `json:"message,omitempty"`
	Event   *claudeStreamEvent    `json:"event,omitempty"`

	// system/init fields
	Model          string   `json:"model,omitempty"`
	Tools          []string `json:"tools,omitempty"`
	MCPServers     []any    `json:"mcp_servers,omitempty"`
	PermissionMode string   `json:"permissionMode,omitempty"`
	Version        string   `json:"version,omitempty"`
	SessionID      string   `json:"session_id,omitempty"`
	UUID           string   `json:"uuid,omitempty"`
	CWD            string   `json:"cwd,omitempty"`
	Agents         []string `json:"agents,omitempty"`
	Skills         []string `json:"skills,omitempty"`
	Plugins        []any    `json:"plugins,omitempty"`
	SlashCommands  []string `json:"slash_commands,omitempty"`
	APIKeySource   string   `json:"apiKeySource,omitempty"`
	Betas          []string `json:"betas,omitempty"`
	OutputStyle    string   `json:"output_style,omitempty"`

	// result fields
	DurationMs        int64        `json:"duration_ms,omitempty"`
	DurationAPIMs     int64        `json:"duration_api_ms,omitempty"`
	NumTurns          int          `json:"num_turns,omitempty"`
	Usage             *claudeUsage `json:"usage,omitempty"`
	ModelUsage        any          `json:"modelUsage,omitempty"`
	TotalCostUSD      float64      `json:"total_cost_usd,omitempty"`
	StopReason        string       `json:"stop_reason,omitempty"`
	PermissionDenials []any        `json:"permission_denials,omitempty"`
	StructuredOutput  any          `json:"structured_output,omitempty"`
	IsError           bool         `json:"is_error,omitempty"`
	Errors            []string     `json:"errors,omitempty"`

	// tool_progress fields
	ToolUseID      string  `json:"tool_use_id,omitempty"`
	ToolName       string  `json:"tool_name,omitempty"`
	ElapsedSeconds float64 `json:"elapsed_time_seconds,omitempty"`
	TaskID         string  `json:"task_id,omitempty"`

	// tool_use_summary fields
	Summary             string   `json:"summary,omitempty"`
	PrecedingToolUseIDs []string `json:"preceding_tool_use_ids,omitempty"`

	// auth_status fields
	IsAuthenticating bool     `json:"isAuthenticating,omitempty"`
	AuthOutput       []string `json:"output,omitempty"`
	AuthErrorMessage string   `json:"error,omitempty"`

	// rate_limit_event fields
	RateLimitInfo *claudeRateLimitInfo `json:"rate_limit_info,omitempty"`

	// compact_boundary fields
	CompactTrigger   string `json:"trigger,omitempty"`
	CompactPreTokens int64  `json:"pre_tokens,omitempty"`

	// system/status fields
	StatusField string `json:"status,omitempty"`

	// api_retry fields
	RetryAttempt     int `json:"attempt,omitempty"`
	RetryMaxRetries  int `json:"max_retries,omitempty"`
	RetryDelayMs     int `json:"retry_delay_ms,omitempty"`
	RetryErrorStatus any `json:"error_status,omitempty"`

	// task_started/progress/notification fields (shared fields; no json tags to avoid
	// conflicts with result's usage/summary — these are manually extracted)
	TaskDescription string `json:"description,omitempty"`
	TaskType        string `json:"task_type,omitempty"`
	TaskStatus      string `json:"-"`
	TaskSummary     string `json:"-"`
	TaskUsage       any    `json:"-"`
	LastToolName    string `json:"last_tool_name,omitempty"`

	// session_state_changed fields
	SessionState string `json:"state,omitempty"`

	// hook_* fields
	HookID       string `json:"hook_id,omitempty"`
	HookName     string `json:"hook_name,omitempty"`
	HookEvent    string `json:"hook_event,omitempty"`
	HookStdout   string `json:"stdout,omitempty"`
	HookStderr   string `json:"stderr,omitempty"`
	HookOutcome  string `json:"outcome,omitempty"`
	HookExitCode int    `json:"exit_code,omitempty"`

	// attachment fields
	FileChanges                []attachmentFileChange `json:"file_changes,omitempty"`
	AttachmentStructuredOutput any                    `json:"attachment_structured_output,omitempty"`
	QueuedCommands             []string               `json:"queued_commands,omitempty"`
}

type attachmentFileChange struct {
	Path string `json:"path"`
	Kind string `json:"kind"`
}

type claudeRateLimitInfo struct {
	Status      string  `json:"status"`
	ResetsAt    int64   `json:"resetsAt"`
	Utilization float64 `json:"utilization"`
}

type claudeContentMessage struct {
	Role    string               `json:"role"`
	Content []claudeContentBlock `json:"content"`
}

type claudeContentBlock struct {
	Type      string `json:"type"`
	Text      string `json:"text,omitempty"`
	Thinking  string `json:"thinking,omitempty"`
	ID        string `json:"id,omitempty"`
	Name      string `json:"name,omitempty"`
	Input     any    `json:"input,omitempty"`
	ToolUseID string `json:"tool_use_id,omitempty"`
	Content   string `json:"content,omitempty"`
	IsError   bool   `json:"is_error,omitempty"`
}

type claudeStreamEvent struct {
	Type         string              `json:"type"`
	Delta        *claudeDelta        `json:"delta,omitempty"`
	ContentBlock *claudeContentBlock `json:"content_block,omitempty"`
}

type claudeDelta struct {
	Type     string `json:"type"`
	Text     string `json:"text,omitempty"`
	Thinking string `json:"thinking,omitempty"`
}

type claudeUsage struct {
	InputTokens  int64 `json:"input_tokens"`
	OutputTokens int64 `json:"output_tokens"`
}
