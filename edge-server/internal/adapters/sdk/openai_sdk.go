package sdk

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/store"
)

// Residual pure-helper peel #1152: keep OpenAISDKAdapter surface + ParseStream
// orchestration; request/SSE/types moved to companion files. Grouped into
// package sdk (#1760).

const (
	openaiSDKAdapterID   = "openai-sdk"
	openaiDefaultModel   = "gpt-5.5"
	openaiDefaultBaseURL = "https://api.openai.com"
	// OpenAIHTTPTimeout is the per-request timeout for the shared SDK outbound
	// client (streaming chat completions can idle for a long time between
	// chunks). The composition root passes it to edgehttp.NewClient (#1592).
	OpenAIHTTPTimeout     = 30 * time.Minute
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
	httpClient *http.Client
	available  bool
	unavailMsg string
}

// NewOpenAISDKAdapter creates a new OpenAI SDK adapter.
// apiKey is read from the environment or passed explicitly.
// model defaults to gpt-5.5 if empty.
// httpClient is the shared outbound client built at the composition root
// (edgehttp.NewClient); a nil client is a wiring bug and fails fast (#1592).
func NewOpenAISDKAdapter(apiKey, model string, httpClient *http.Client) *OpenAISDKAdapter {
	if httpClient == nil {
		panic("adapters: NewOpenAISDKAdapter requires a non-nil *http.Client (construct it at the composition root, e.g. edgehttp.NewClient)")
	}
	a := &OpenAISDKAdapter{
		baseURL:    openaiDefaultBaseURL,
		model:      model,
		httpClient: httpClient,
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
		"adapterId":      openaiSDKAdapterID,
		"runtimeKind":    "sdk-http",
		"fixtureOnly":    false,
		"noSpendDefault": false,
		"transport":      "https-sse",
		"healthState":    healthState,
		"provider":       "openai",
		"model":          a.model,
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
	// Empty workDir is rejected at REST/MCP gates (#854). Do not fall back to
	// UserHomeDir/DefaultWorkDir; keep empty and let the process CWD stay unset
	// if a bypass path reaches BuildCommand.
	workDir := strings.TrimSpace(ctx.WorkDir)
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
	if rc, ok := ctx.Value(adapters.CtxRunContext).(RunProcessContext); ok {
		runCtx = rc
	}

	model := a.model
	if runCtx.Model != "" {
		model = adapters.ResolveModel(openaiSDKAdapterID, runCtx.Model)
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
		if resolved := adapters.ResolveReasoningEffort(openaiSDKAdapterID, runCtx.ReasoningEffort); resolved != "" {
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
		return adapters.NewNonRecoverableParseError(fmt.Errorf("openai-sdk: failed to marshal request: %w", err))
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
		return adapters.NewNonRecoverableParseError(fmt.Errorf("%s", errMsg))
	}

	// Parse SSE stream
	return a.parseSSEStream(ctx, resp.Body, emitter, scope, model)
}
