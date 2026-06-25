package adapters

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/agenthub/edge-server/internal/store"
)

const (
	anthropicSDKAdapterID    = "anthropic-sdk"
	anthropicDefaultModel    = "claude-sonnet-4-6"
	anthropicDefaultBaseURL  = "https://api.anthropic.com"
	anthropicAPIVersion      = "2023-06-01"
	anthropicHTTPTimeout     = 30 * time.Minute
	anthropicMaxResponseSize = 50 * 1024 * 1024 // 50MB
	anthropicMaxRetries      = 3
	anthropicRetryBaseDelay  = 1 * time.Second
)

// AnthropicSDKAdapter implements the AgentAdapter interface using direct HTTP
// calls to the Anthropic Messages API. It does NOT spawn a CLI subprocess --
// instead, BuildCommand returns a sentinel command and ParseStream makes the
// actual API call, streaming SSE events and mapping them to Edge typed events.
//
// This adapter requires ANTHROPIC_API_KEY (or a configurable env var) to be set.
// When the key is missing, Available() returns false with a helpful message.
type AnthropicSDKAdapter struct {
	apiKey     string
	baseURL    string
	model      string
	maxTokens  int
	available  bool
	unavailMsg string
}

// NewAnthropicSDKAdapter creates a new Anthropic SDK adapter.
// apiKey is read from the environment or passed explicitly.
// model defaults to claude-sonnet-4-6 if empty.
func NewAnthropicSDKAdapter(apiKey, model string) *AnthropicSDKAdapter {
	a := &AnthropicSDKAdapter{
		baseURL:   anthropicDefaultBaseURL,
		model:     model,
		maxTokens: 16384,
	}
	if a.model == "" {
		a.model = anthropicDefaultModel
	}
	// Resolve API key: explicit param, then ANTHROPIC_API_KEY env
	if apiKey == "" {
		apiKey = os.Getenv("ANTHROPIC_API_KEY")
	}
	a.apiKey = apiKey
	if a.apiKey == "" {
		a.unavailMsg = "ANTHROPIC_API_KEY not set; set the environment variable or pass --anthropic-sdk-path with the key"
		a.available = false
	} else {
		a.available = true
	}
	// Allow base URL override for proxies / compatible endpoints.
	// Normalize: strip trailing "/v1" so the adapter can consistently
	// append "/v1/messages" without creating a doubled path like
	// "/v1/v1/messages" when the proxy URL already includes "/v1".
	if customURL := os.Getenv("ANTHROPIC_BASE_URL"); customURL != "" {
		customURL = strings.TrimRight(customURL, "/")
		customURL = strings.TrimSuffix(customURL, "/v1")
		a.baseURL = strings.TrimRight(customURL, "/")
	}
	return a
}

func (a *AnthropicSDKAdapter) Metadata() AdapterMetadata {
	return AdapterMetadata{
		ID:          anthropicSDKAdapterID,
		Name:        "Anthropic SDK",
		Description: "Anthropic Messages API via direct HTTP — 无需 CLI，直接调用 Claude API",
	}
}

func (a *AnthropicSDKAdapter) Capabilities() AgentCapabilities {
	return AgentCapabilities{
		Streaming:       true,
		ToolCalls:       true,
		FileChanges:     false,
		PermissionHooks: false,
		ThinkingVisible: true,
		MultiTurn:       true,
		MCPIntegration:  false,
		SubAgentSpawn:   false,
	}
}

func (a *AnthropicSDKAdapter) CapabilityHealthMetadata() map[string]any {
	healthState := "available"
	if !a.available {
		healthState = "unavailable"
	}
	return map[string]any{
		"adapterId":      anthropicSDKAdapterID,
		"runtimeKind":    "sdk-http",
		"fixtureOnly":    false,
		"noSpendDefault": false,
		"transport":      "https-sse",
		"healthState":    healthState,
		"provider":       "anthropic",
		"model":          a.model,
		"capabilities": map[string]bool{
			"streaming":       true,
			"toolCalls":       true,
			"fileChanges":     false,
			"permissionHooks": false,
			"thinkingVisible": true,
			"multiTurn":       true,
			"mcpIntegration":  false,
			"subAgentSpawn":   false,
		},
	}
}

// BuildCommand returns a sentinel command. The Anthropic SDK adapter does NOT
// spawn a CLI subprocess -- it makes direct HTTP calls in ParseStream. The
// executor will start this command but ParseStream ignores the stdout/stdin
// pipes and performs the real work via HTTP.
func (a *AnthropicSDKAdapter) BuildCommand(ctx RunProcessContext) (string, []string, []string, string) {
	workDir := ctx.WorkDir
	if workDir == "" {
		workDir = DefaultWorkDir()
	}
	// Return a harmless no-op command that exits immediately.
	// The real work happens in ParseStream via HTTP.
	cmd, args := sdkNoopCommand()
	return cmd, args, nil, workDir
}

// PreflightCheck verifies the API key is available.
func (a *AnthropicSDKAdapter) PreflightCheck() error {
	if !a.available {
		return fmt.Errorf("anthropic-sdk adapter unavailable: %s", a.unavailMsg)
	}
	return nil
}

func (a *AnthropicSDKAdapter) NeedsStdin() bool { return false }

func (a *AnthropicSDKAdapter) Available() bool { return a.available }

// ParseStream is the main entry point for the Anthropic SDK adapter.
// It ignores the stdout/stdin pipes (they belong to the no-op sentinel command)
// and instead makes a direct HTTP call to the Anthropic Messages API.
// SSE events from the streaming response are mapped to Edge typed events.
func (a *AnthropicSDKAdapter) ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) error {
	scope := map[string]any{
		"projectId": run.ProjectID,
		"threadId":  run.ThreadID,
		"runId":     run.ID,
	}

	// Extract RunProcessContext from the context to get the prompt and model.
	var runCtx RunProcessContext
	if rc, ok := ctx.Value(CtxRunContext).(RunProcessContext); ok {
		runCtx = rc
	}

	prompt := runCtx.Prompt
	if prompt == "" {
		prompt = "Continue."
	}

	model := a.model
	if runCtx.Model != "" {
		model = ResolveModel(anthropicSDKAdapterID, runCtx.Model)
		if model == "" {
			model = runCtx.Model
		}
	}
	if model == "" {
		model = anthropicDefaultModel
	}

	// Build the Anthropic Messages API request body
	messages := a.buildMessages(runCtx)

	requestBody := anthropicRequest{
		Model:     model,
		MaxTokens: a.maxTokens,
		Messages:  messages,
		Stream:    true,
	}

	// System prompt handling
	systemParts := []string{}
	if runCtx.SystemPrompt != "" {
		systemParts = append(systemParts, runCtx.SystemPrompt)
	}
	if runCtx.AppendSystemPrompt != "" {
		systemParts = append(systemParts, runCtx.AppendSystemPrompt)
	}
	if runCtx.SkillsPrompt != "" {
		systemParts = append(systemParts, runCtx.SkillsPrompt)
	}
	if len(systemParts) > 0 {
		requestBody.System = strings.Join(systemParts, "\n\n")
	}

	// Thinking mode
	if runCtx.ThinkingMode != "disabled" {
		budgetTokens := 10000
		if runCtx.MaxThinkingTokens > 0 {
			budgetTokens = runCtx.MaxThinkingTokens
		}
		requestBody.Thinking = &anthropicThinking{
			Type:         "enabled",
			BudgetTokens: budgetTokens,
		}
	}

	// MCP tool definitions: convert MCPConfig JSON to Anthropic tools parameter.
	// The MCPConfig field contains a JSON string of MCP server definitions.
	// When AllowedTools is set, those tools are converted to Anthropic tool schemas.
	if len(runCtx.AllowedTools) > 0 {
		tools := make([]anthropicTool, 0, len(runCtx.AllowedTools))
		for _, toolName := range runCtx.AllowedTools {
			tools = append(tools, anthropicTool{
				Name:        toolName,
				Description: "Tool: " + toolName,
				InputSchema: map[string]any{
					"type":       "object",
					"properties": map[string]any{},
				},
			})
		}
		requestBody.Tools = tools
	}

	bodyBytes, err := json.Marshal(requestBody)
	if err != nil {
		return NewNonRecoverableParseError(fmt.Errorf("anthropic-sdk: failed to marshal request: %w", err))
	}

	// Emit session init
	emitter.Emit(BusEventSessionInit, scope, map[string]any{
		"sessionId": run.ID,
		"model":     model,
		"provider":  "anthropic",
	})

	// Make the streaming HTTP request with retry support
	resp, err := a.doRequestWithRetry(ctx, bodyBytes, emitter, scope)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		errMsg := fmt.Sprintf("anthropic-sdk: API returned status %d: %s", resp.StatusCode, string(body))
		emitter.Emit(BusEventResult, scope, map[string]any{
			"success":        false,
			"error":          errMsg,
			"terminalReason": "error",
			"provider":       "anthropic",
		})
		return NewNonRecoverableParseError(fmt.Errorf("%s", errMsg))
	}

	// Parse SSE stream
	return a.parseSSEStream(ctx, resp.Body, emitter, scope, model)
}

// doRequestWithRetry makes the HTTP request with automatic retry for transient
// failures (429 rate limit, 500/502/503/504 server errors). Auth errors (401/403)
// and client errors (400) are not retried.
func (a *AnthropicSDKAdapter) doRequestWithRetry(ctx context.Context, body []byte, emitter EventEmitter, scope map[string]any) (*http.Response, error) {
	var lastErr error

	for attempt := 0; attempt <= anthropicMaxRetries; attempt++ {
		if attempt > 0 {
			// Exponential backoff with jitter: 1s, 2s, 4s (±25%).
			// Jitter prevents thundering herd when multiple sub-agents
			// retry simultaneously after a provider-wide outage.
			delay := anthropicRetryBaseDelay * time.Duration(math.Pow(2, float64(attempt-1)))
			delay = delay + time.Duration(rand.Int63n(int64(delay/4)))
			slog.Info("anthropic-sdk: retrying request",
				"attempt", attempt,
				"delay", delay,
				"lastErr", lastErr,
			)
			emitter.Emit(BusEventAPIRetry, scope, map[string]any{
				"attempt": attempt,
				"delay":   delay.String(),
				"error":   fmt.Sprintf("%v", lastErr),
				"provider": "anthropic",
			})
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(delay):
			}
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.baseURL+"/v1/messages", bytes.NewReader(body))
		if err != nil {
			return nil, NewNonRecoverableParseError(fmt.Errorf("anthropic-sdk: failed to create request: %w", err))
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-api-key", a.apiKey)
		req.Header.Set("anthropic-version", anthropicAPIVersion)
		req.Header.Set("Accept", "text/event-stream")

		httpClient := &http.Client{Timeout: anthropicHTTPTimeout}
		resp, err := httpClient.Do(req)
		if err != nil {
			lastErr = err
			continue // Network errors are retriable
		}

		// Check status code for retry eligibility
		switch {
		case resp.StatusCode == http.StatusOK:
			return resp, nil
		case resp.StatusCode == http.StatusTooManyRequests:
			// Rate limited -- always retry
			resp.Body.Close()
			lastErr = fmt.Errorf("rate limited (429)")
			continue
		case resp.StatusCode >= 500:
			// Server error -- retry
			resp.Body.Close()
			lastErr = fmt.Errorf("server error (%d)", resp.StatusCode)
			continue
		default:
			// Auth errors (401, 403), client errors (400) -- not retried
			return resp, nil
		}
	}

	// All retries exhausted
	emitter.Emit(BusEventResult, scope, map[string]any{
		"success":        false,
		"error":          fmt.Sprintf("anthropic-sdk: request failed after %d retries: %v", anthropicMaxRetries, lastErr),
		"terminalReason": "error",
		"provider":       "anthropic",
	})
	return nil, NewNonRecoverableParseError(fmt.Errorf("anthropic-sdk: request failed after %d retries: %w", anthropicMaxRetries, lastErr))
}

// buildMessages converts the RunProcessContext into Anthropic message format.
func (a *AnthropicSDKAdapter) buildMessages(ctx RunProcessContext) []anthropicMessage {
	var messages []anthropicMessage

	// Add thread history messages if present
	for _, msg := range ctx.Messages {
		role := msg.Role
		if role == "system" {
			continue // system messages go in the system field
		}
		if role == "assistant" {
			role = "assistant"
		} else {
			role = "user"
		}
		messages = append(messages, anthropicMessage{
			Role:    role,
			Content: msg.Content,
		})
	}

	// Add the current prompt
	prompt := ctx.Prompt
	if prompt == "" {
		prompt = "Continue."
	}
	messages = append(messages, anthropicMessage{
		Role:    "user",
		Content: prompt,
	})

	return messages
}

// parseSSEStream reads the Server-Sent Events stream from the Anthropic API
// and emits Edge typed events.
func (a *AnthropicSDKAdapter) parseSSEStream(ctx context.Context, body io.Reader, emitter EventEmitter, scope map[string]any, model string) error {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 256*1024), anthropicMaxResponseSize)

	var currentContentType string // "text", "thinking", or "tool_use"
	var currentText strings.Builder
	var currentToolID string
	var currentToolName string
	var currentToolInput strings.Builder
	var inputStarted bool

	var inputTokens, outputTokens int64

	for scanner.Scan() {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		line := scanner.Text()
		if line == "" {
			continue
		}

		// SSE lines start with "data: " or "event: "
		if !strings.HasPrefix(line, "data: ") {
			// "event: " lines carry the event type; we skip them and
			// extract data from the "data: " line.
			_ = strings.HasPrefix(line, "event: ")
			continue
		}

		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}

		var event anthropicSSEEvent
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			slog.Debug("anthropic-sdk: failed to parse SSE event", "error", err, "data", data)
			continue
		}

		switch event.Type {
		case "message_start":
			if event.Message != nil {
				inputTokens = event.Message.Usage.InputTokens
				emitter.Emit(BusEventStatusChange, scope, map[string]any{
					"status":   "running",
					"model":    event.Message.Model,
					"provider": "anthropic",
				})
			}

		case "content_block_start":
			if event.ContentBlock != nil {
				currentContentType = event.ContentBlock.Type
				currentText.Reset()
				currentToolInput.Reset()
				inputStarted = false

				switch event.ContentBlock.Type {
				case "thinking":
					emitter.Emit(BusEventThinking, scope, map[string]any{
						"content":  "",
						"provider": "anthropic",
						"status":   "started",
					})
				case "tool_use":
					currentToolID = event.ContentBlock.ID
					currentToolName = event.ContentBlock.Name
					if event.ContentBlock.PartialJSON != "" {
						currentToolInput.WriteString(event.ContentBlock.PartialJSON)
						inputStarted = true
					}
				}
			}

		case "content_block_delta":
			if event.Delta == nil {
				continue
			}
			switch event.Delta.Type {
			case "text_delta":
				if event.Delta.Text != "" {
					emitter.Emit(BusEventTextDelta, scope, map[string]any{
						"content":  event.Delta.Text,
						"provider": "anthropic",
					})
					currentText.WriteString(event.Delta.Text)
				}
			case "thinking_delta":
				if event.Delta.Thinking != "" {
					emitter.Emit(BusEventThinking, scope, map[string]any{
						"content":  event.Delta.Thinking,
						"provider": "anthropic",
					})
				}
			case "input_json_delta":
				if event.Delta.PartialJSON != "" {
					currentToolInput.WriteString(event.Delta.PartialJSON)
					inputStarted = true
				}
			}

		case "content_block_stop":
			switch currentContentType {
			case "text":
				text := currentText.String()
				if text != "" {
					emitter.Emit(BusEventTextBlock, scope, map[string]any{
						"content":  text,
						"provider": "anthropic",
					})
				}
			case "tool_use":
				inputJSON := currentToolInput.String()
				if !inputStarted {
					inputJSON = "{}"
				}
				var input any
				if err := json.Unmarshal([]byte(inputJSON), &input); err != nil {
					input = map[string]any{"raw": inputJSON}
				}
				emitter.Emit(BusEventToolCall, scope, map[string]any{
					"callId":   currentToolID,
					"toolName": currentToolName,
					"input":    input,
					"status":   "pending",
					"provider": "anthropic",
				})
			}
			currentContentType = ""

		case "message_delta":
			if event.Delta != nil {
				if event.Delta.StopReason != "" {
					outputTokens = event.Usage.OutputTokens
				}
			}

		case "message_stop":
			// Emit final result
			usageMap := map[string]any{
				"inputTokens":  inputTokens,
				"outputTokens": outputTokens,
				"model":        model,
			}
			emitter.Emit(BusEventContextUsage, scope, usageMap)
			emitter.Emit(BusEventResult, scope, map[string]any{
				"success":        true,
				"terminalReason": "completed",
				"provider":       "anthropic",
				"model":          model,
				"usage":          usageMap,
			})

		case "error":
			errMsg := "unknown error"
			if event.Error != nil {
				errMsg = event.Error.Message
			}
			emitter.Emit(BusEventResult, scope, map[string]any{
				"success":        false,
				"error":          errMsg,
				"terminalReason": "error",
				"provider":       "anthropic",
			})
			return NewNonRecoverableParseError(fmt.Errorf("anthropic-sdk: API error: %s", errMsg))

		default:
			slog.Debug("anthropic-sdk: unhandled SSE event type", "type", event.Type)
		}
	}

	if err := scanner.Err(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return NewNonRecoverableParseError(fmt.Errorf("anthropic-sdk: SSE stream read error: %w", err))
	}

	return nil
}

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
	Type         string                   `json:"type"`
	Index        int                      `json:"index,omitempty"`
	Message      *anthropicSSEMessage     `json:"message,omitempty"`
	ContentBlock *anthropicSSEContentBlock `json:"content_block,omitempty"`
	Delta        *anthropicSSEDelta       `json:"delta,omitempty"`
	Usage        anthropicSSEUsage        `json:"usage,omitempty"`
	Error        *anthropicSSEError       `json:"error,omitempty"`
}

type anthropicSSEMessage struct {
	ID      string              `json:"id"`
	Type    string              `json:"type"`
	Role    string              `json:"role"`
	Content []any               `json:"content"`
	Model   string              `json:"model"`
	Usage   anthropicSSEUsage   `json:"usage"`
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
