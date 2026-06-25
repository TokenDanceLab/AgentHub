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
	openaiSDKAdapterID    = "openai-sdk"
	openaiDefaultModel    = "gpt-5.5"
	openaiDefaultBaseURL  = "https://api.openai.com"
	openaiHTTPTimeout     = 30 * time.Minute
	openaiMaxResponseSize = 50 * 1024 * 1024 // 50MB
	openaiMaxRetries      = 3
	openaiRetryBaseDelay  = 1 * time.Second
)

// OpenAISDKAdapter implements the AgentAdapter interface using direct HTTP
// calls to the OpenAI Responses API (or Chat Completions API for streaming).
// It does NOT spawn a CLI subprocess — instead, BuildCommand returns a
// sentinel command and ParseStream makes the actual API call, streaming SSE
// events and mapping them to Edge typed events.
//
// This adapter requires OPENAI_API_KEY to be set.
// When the key is missing, Available() returns false with a helpful message.
type OpenAISDKAdapter struct {
	apiKey     string
	baseURL    string
	model      string
	available  bool
	unavailMsg string
}

// NewOpenAISDKAdapter creates a new OpenAI SDK adapter.
// apiKey is read from the environment or passed explicitly.
// model defaults to gpt-5.5 if empty.
func NewOpenAISDKAdapter(apiKey, model string) *OpenAISDKAdapter {
	a := &OpenAISDKAdapter{
		baseURL: openaiDefaultBaseURL,
		model:   model,
	}
	if a.model == "" {
		a.model = openaiDefaultModel
	}
	// Resolve API key: explicit param, then OPENAI_API_KEY env
	if apiKey == "" {
		apiKey = os.Getenv("OPENAI_API_KEY")
	}
	a.apiKey = apiKey
	if a.apiKey == "" {
		a.unavailMsg = "OPENAI_API_KEY not set; set the environment variable or pass --openai-sdk-path with the key"
		a.available = false
	} else {
		a.available = true
	}
	// Allow base URL override for proxies / compatible endpoints.
	// Normalize: strip trailing "/v1" so the adapter can consistently
	// append "/v1/chat/completions" without creating a doubled path like
	// "/v1/v1/chat/completions" when the proxy URL already includes "/v1".
	if customURL := os.Getenv("OPENAI_BASE_URL"); customURL != "" {
		customURL = strings.TrimRight(customURL, "/")
		customURL = strings.TrimSuffix(customURL, "/v1")
		a.baseURL = strings.TrimRight(customURL, "/")
	}
	return a
}

func (a *OpenAISDKAdapter) Metadata() AdapterMetadata {
	return AdapterMetadata{
		ID:          openaiSDKAdapterID,
		Name:        "OpenAI SDK",
		Description: "OpenAI Chat Completions API via direct HTTP — 无需 CLI，直接调用 GPT API",
	}
}

func (a *OpenAISDKAdapter) Capabilities() AgentCapabilities {
	return AgentCapabilities{
		Streaming:       true,
		ToolCalls:       true,
		FileChanges:     false,
		PermissionHooks: false,
		ThinkingVisible: false,
		MultiTurn:       true,
		MCPIntegration:  false,
		SubAgentSpawn:   false,
	}
}

func (a *OpenAISDKAdapter) CapabilityHealthMetadata() map[string]any {
	healthState := "available"
	if !a.available {
		healthState = "unavailable"
	}
	return map[string]any{
		"adapterId":           openaiSDKAdapterID,
		"runtimeKind":         "sdk-http",
		"fixtureOnly":         false,
		"noSpendDefault":      false,
		"transport":           "https-sse",
		"healthState":         healthState,
		"provider":            "openai",
		"model":               a.model,
		"capabilities": map[string]bool{
			"streaming":       true,
			"toolCalls":       true,
			"fileChanges":     false,
			"permissionHooks": false,
			"thinkingVisible": false,
			"multiTurn":       true,
			"mcpIntegration":  false,
			"subAgentSpawn":   false,
		},
	}
}

// BuildCommand returns a sentinel command. The OpenAI SDK adapter does NOT
// spawn a CLI subprocess — it makes direct HTTP calls in ParseStream.
func (a *OpenAISDKAdapter) BuildCommand(ctx RunProcessContext) (string, []string, []string, string) {
	workDir := ctx.WorkDir
	if workDir == "" {
		workDir = DefaultWorkDir()
	}
	cmd, args := sdkNoopCommand()
	return cmd, args, nil, workDir
}

// PreflightCheck verifies the API key is available.
func (a *OpenAISDKAdapter) PreflightCheck() error {
	if !a.available {
		return fmt.Errorf("openai-sdk adapter unavailable: %s", a.unavailMsg)
	}
	return nil
}

func (a *OpenAISDKAdapter) NeedsStdin() bool { return false }

func (a *OpenAISDKAdapter) Available() bool { return a.available }

// ParseStream is the main entry point for the OpenAI SDK adapter.
// It ignores the stdout/stdin pipes and makes a direct HTTP call to the
// OpenAI Chat Completions API with streaming enabled.
func (a *OpenAISDKAdapter) ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) error {
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
		model = ResolveModel(openaiSDKAdapterID, runCtx.Model)
		if model == "" {
			model = runCtx.Model
		}
	}
	if model == "" {
		model = openaiDefaultModel
	}

	// Build the OpenAI Chat Completions API request body
	messages := a.buildMessages(runCtx)

	requestBody := openaiChatRequest{
		Model:    model,
		Messages: messages,
		Stream:   true,
	}

	// Reasoning effort
	if runCtx.ReasoningEffort != "" {
		effort := runCtx.ReasoningEffort
		if resolved := ResolveReasoningEffort(openaiSDKAdapterID, runCtx.ReasoningEffort); resolved != "" {
			effort = resolved
		}
		requestBody.ReasoningEffort = effort
	}

	// Structured output schema
	if runCtx.StructuredOutputSchema != "" {
		requestBody.ResponseFormat = &openaiResponseFormat{
			Type:       "json_schema",
			JSONSchema: map[string]any{"schema": json.RawMessage(runCtx.StructuredOutputSchema)},
		}
	}

	bodyBytes, err := json.Marshal(requestBody)
	if err != nil {
		return NewNonRecoverableParseError(fmt.Errorf("openai-sdk: failed to marshal request: %w", err))
	}

	// Emit session init
	emitter.Emit(BusEventSessionInit, scope, map[string]any{
		"sessionId": run.ID,
		"model":     model,
		"provider":  "openai",
	})

	// Make the streaming HTTP request with retry support
	resp, err := a.doRequestWithRetry(ctx, bodyBytes, emitter, scope)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		errMsg := fmt.Sprintf("openai-sdk: API returned status %d: %s", resp.StatusCode, string(body))
		emitter.Emit(BusEventResult, scope, map[string]any{
			"success":        false,
			"error":          errMsg,
			"terminalReason": "error",
			"provider":       "openai",
		})
		return NewNonRecoverableParseError(fmt.Errorf("%s", errMsg))
	}

	// Parse SSE stream
	return a.parseSSEStream(ctx, resp.Body, emitter, scope, model)
}

// doRequestWithRetry makes the HTTP request with automatic retry for transient
// failures (429 rate limit, 500/502/503/504 server errors). Auth errors (401/403)
// and client errors (400) are not retried.
//
// Retry behavior:
//   - Max retries: 3 (openaiMaxRetries), base delay: 1s (openaiRetryBaseDelay)
//   - Exponential backoff with jitter: 1s, 2s, 4s (±25% jitter per step)
//   - Jitter prevents thundering herd when multiple sub-agents retry
//     simultaneously after a provider-wide outage
//   - Network errors (connection refused, DNS, TLS) are retriable
//   - Context cancellation is checked between retries and aborts immediately
//   - Each retry emits a BusEventAPIRetry event to the event bus for observability
//
// Pattern matches anthropic_sdk.go doRequestWithRetry.
func (a *OpenAISDKAdapter) doRequestWithRetry(ctx context.Context, body []byte, emitter EventEmitter, scope map[string]any) (*http.Response, error) {
	var lastErr error

	for attempt := 0; attempt <= openaiMaxRetries; attempt++ {
		if attempt > 0 {
			// Exponential backoff with jitter: 1s, 2s, 4s (±25%).
			// Jitter prevents thundering herd when multiple sub-agents
			// retry simultaneously after a provider-wide outage.
			delay := openaiRetryBaseDelay * time.Duration(math.Pow(2, float64(attempt-1)))
			delay = delay + time.Duration(rand.Int63n(int64(delay/4)))
			slog.Info("openai-sdk: retrying request",
				"attempt", attempt,
				"delay", delay,
				"lastErr", lastErr,
			)
			emitter.Emit(BusEventAPIRetry, scope, map[string]any{
				"attempt":  attempt,
				"delay":    delay.String(),
				"error":    fmt.Sprintf("%v", lastErr),
				"provider": "openai",
			})
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(delay):
			}
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.baseURL+"/v1/chat/completions", bytes.NewReader(body))
		if err != nil {
			return nil, NewNonRecoverableParseError(fmt.Errorf("openai-sdk: failed to create request: %w", err))
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+a.apiKey)
		req.Header.Set("Accept", "text/event-stream")

		httpClient := &http.Client{Timeout: openaiHTTPTimeout}
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
		"error":          fmt.Sprintf("openai-sdk: request failed after %d retries: %v", openaiMaxRetries, lastErr),
		"terminalReason": "error",
		"provider":       "openai",
	})
	return nil, NewNonRecoverableParseError(fmt.Errorf("openai-sdk: request failed after %d retries: %w", openaiMaxRetries, lastErr))
}

// buildMessages converts the RunProcessContext into OpenAI message format.
func (a *OpenAISDKAdapter) buildMessages(ctx RunProcessContext) []openaiChatMessage {
	var messages []openaiChatMessage

	// System prompt
	systemParts := []string{}
	if ctx.SystemPrompt != "" {
		systemParts = append(systemParts, ctx.SystemPrompt)
	}
	if ctx.AppendSystemPrompt != "" {
		systemParts = append(systemParts, ctx.AppendSystemPrompt)
	}
	if ctx.SkillsPrompt != "" {
		systemParts = append(systemParts, ctx.SkillsPrompt)
	}
	if len(systemParts) > 0 {
		messages = append(messages, openaiChatMessage{
			Role:    "system",
			Content: strings.Join(systemParts, "\n\n"),
		})
	}

	// Add thread history messages if present
	for _, msg := range ctx.Messages {
		role := msg.Role
		if role == "system" {
			continue
		}
		// Normalize roles to OpenAI's expected values
		if role != "assistant" && role != "user" && role != "tool" {
			if role == "agent" || role == "bot" {
				role = "assistant"
			} else {
				role = "user"
			}
		}
		messages = append(messages, openaiChatMessage{
			Role:    role,
			Content: msg.Content,
		})
	}

	// Add the current prompt
	prompt := ctx.Prompt
	if prompt == "" {
		prompt = "Continue."
	}
	messages = append(messages, openaiChatMessage{
		Role:    "user",
		Content: prompt,
	})

	return messages
}

// parseSSEStream reads the Server-Sent Events stream from the OpenAI API
// and emits Edge typed events.
func (a *OpenAISDKAdapter) parseSSEStream(ctx context.Context, body io.Reader, emitter EventEmitter, scope map[string]any, model string) error {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 256*1024), openaiMaxResponseSize)

	var currentText strings.Builder
	var currentToolCalls map[int]*openaiToolCallAccumulator

	var inputTokens, outputTokens int64
	var finishReason string

	for scanner.Scan() {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		line := scanner.Text()
		if line == "" {
			continue
		}

		if !strings.HasPrefix(line, "data: ") {
			continue
		}

		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}

		var chunk openaiChatChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			slog.Debug("openai-sdk: failed to parse SSE chunk", "error", err, "data", data)
			continue
		}

		if len(chunk.Choices) == 0 {
			// Usage-only chunk (stream_options include_usage)
			if chunk.Usage != nil {
				inputTokens = chunk.Usage.PromptTokens
				outputTokens = chunk.Usage.CompletionTokens
			}
			continue
		}

		choice := chunk.Choices[0]

		if choice.Delta == nil {
			continue
		}

		// Handle text content
		if choice.Delta.Content != "" {
			emitter.Emit(BusEventTextDelta, scope, map[string]any{
				"content":  choice.Delta.Content,
				"provider": "openai",
			})
			currentText.WriteString(choice.Delta.Content)
		}

		// Handle tool calls
		if len(choice.Delta.ToolCalls) > 0 {
			for _, tc := range choice.Delta.ToolCalls {
				if currentToolCalls == nil {
					currentToolCalls = make(map[int]*openaiToolCallAccumulator)
				}
				acc, ok := currentToolCalls[tc.Index]
				if !ok {
					acc = &openaiToolCallAccumulator{
						ID:   tc.ID,
						Name: tc.Function.Name,
					}
					currentToolCalls[tc.Index] = acc
				}
				if tc.ID != "" {
					acc.ID = tc.ID
				}
				if tc.Function.Name != "" {
					acc.Name = tc.Function.Name
				}
				if tc.Function.Arguments != "" {
					acc.Arguments.WriteString(tc.Function.Arguments)
				}
			}
		}

		// Handle reasoning/thinking content (o-series models)
		if choice.Delta.ReasoningContent != "" {
			emitter.Emit(BusEventThinking, scope, map[string]any{
				"content":  choice.Delta.ReasoningContent,
				"provider": "openai",
			})
		}

		// Track finish reason
		if choice.FinishReason != "" {
			finishReason = choice.FinishReason
		}

		// Usage from streaming chunk
		if chunk.Usage != nil {
			inputTokens = chunk.Usage.PromptTokens
			outputTokens = chunk.Usage.CompletionTokens
		}
	}

	if err := scanner.Err(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return NewNonRecoverableParseError(fmt.Errorf("openai-sdk: SSE stream read error: %w", err))
	}

	// Emit text block if we accumulated text
	text := currentText.String()
	if text != "" {
		emitter.Emit(BusEventTextBlock, scope, map[string]any{
			"content":  text,
			"provider": "openai",
		})
	}

	// Emit tool calls
	for _, acc := range currentToolCalls {
		inputJSON := acc.Arguments.String()
		if inputJSON == "" {
			inputJSON = "{}"
		}
		var input any
		if err := json.Unmarshal([]byte(inputJSON), &input); err != nil {
			input = map[string]any{"raw": inputJSON}
		}
		emitter.Emit(BusEventToolCall, scope, map[string]any{
			"callId":   acc.ID,
			"toolName": acc.Name,
			"input":    input,
			"status":   "pending",
			"provider": "openai",
		})
	}

	// Emit usage
	usageMap := map[string]any{
		"inputTokens":  inputTokens,
		"outputTokens": outputTokens,
		"model":        model,
	}
	emitter.Emit(BusEventContextUsage, scope, usageMap)

	// Emit final result
	emitter.Emit(BusEventResult, scope, map[string]any{
		"success":        true,
		"terminalReason": "completed",
		"provider":       "openai",
		"model":          model,
		"usage":          usageMap,
		"finishReason":   finishReason,
	})

	return nil
}

// --- OpenAI API types ---

type openaiChatRequest struct {
	Model           string               `json:"model"`
	Messages        []openaiChatMessage  `json:"messages"`
	Stream          bool                 `json:"stream"`
	StreamOptions   *openaiStreamOptions `json:"stream_options,omitempty"`
	ResponseFormat  *openaiResponseFormat `json:"response_format,omitempty"`
	ReasoningEffort string               `json:"reasoning_effort,omitempty"`
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
	ID      string           `json:"id"`
	Object  string           `json:"object"`
	Choices []openaiChoice   `json:"choices"`
	Usage   *openaiChunkUsage `json:"usage,omitempty"`
}

type openaiChoice struct {
	Index        int            `json:"index"`
	Delta        *openaiDelta   `json:"delta,omitempty"`
	FinishReason string         `json:"finish_reason,omitempty"`
}

type openaiDelta struct {
	Role             string         `json:"role,omitempty"`
	Content          string         `json:"content,omitempty"`
	ReasoningContent string         `json:"reasoning_content,omitempty"`
	ToolCalls        []openaiToolCallDelta `json:"tool_calls,omitempty"`
}

type openaiToolCallDelta struct {
	Index    int                       `json:"index"`
	ID       string                    `json:"id,omitempty"`
	Type     string                    `json:"type,omitempty"`
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
	ID         string
	Name       string
	Arguments  strings.Builder
}
