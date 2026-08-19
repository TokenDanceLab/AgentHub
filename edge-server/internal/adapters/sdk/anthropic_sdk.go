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

// Residual pure-helper peel #1142: keep AnthropicSDKAdapter surface + ParseStream
// orchestration; request/SSE/types moved to companion files. Grouped into
// package sdk (#1760).

const (
	anthropicSDKAdapterID   = "anthropic-sdk"
	anthropicDefaultModel   = "claude-sonnet-4-6"
	anthropicDefaultBaseURL = "https://api.anthropic.com"
	anthropicAPIVersion     = "2023-06-01"
	// AnthropicHTTPTimeout is the per-request timeout for the shared SDK
	// outbound client (streaming messages can idle for a long time between
	// chunks). The composition root passes it to edgehttp.NewClient (#1592).
	AnthropicHTTPTimeout     = 30 * time.Minute
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
	httpClient *http.Client
	available  bool
	unavailMsg string
}

// NewAnthropicSDKAdapter creates a new Anthropic SDK adapter.
// apiKey is read from the environment or passed explicitly.
// model defaults to claude-sonnet-4-6 if empty.
// httpClient is the shared outbound client built at the composition root
// (edgehttp.NewClient); a nil client is a wiring bug and fails fast (#1592).
func NewAnthropicSDKAdapter(apiKey, model string, httpClient *http.Client) *AnthropicSDKAdapter {
	if httpClient == nil {
		panic("adapters: NewAnthropicSDKAdapter requires a non-nil *http.Client (construct it at the composition root, e.g. edgehttp.NewClient)")
	}
	a := &AnthropicSDKAdapter{
		baseURL:    anthropicDefaultBaseURL,
		model:      model,
		maxTokens:  16384,
		httpClient: httpClient,
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
	// Empty workDir is rejected at REST/MCP gates (#854). Do not fall back to
	// UserHomeDir/DefaultWorkDir; keep empty and let the process CWD stay unset
	// if a bypass path reaches BuildCommand.
	workDir := strings.TrimSpace(ctx.WorkDir)
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
	if rc, ok := ctx.Value(adapters.CtxRunContext).(RunProcessContext); ok {
		runCtx = rc
	}

	model := a.model
	if runCtx.Model != "" {
		model = adapters.ResolveModel(anthropicSDKAdapterID, runCtx.Model)
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
					"type": "object",
					"properties": map[string]any{
						"query": map[string]any{
							"type":        "string",
							"description": "Input for tool: " + toolName,
						},
					},
				},
			})
		}
		requestBody.Tools = tools
	}

	bodyBytes, err := json.Marshal(requestBody)
	if err != nil {
		return adapters.NewNonRecoverableParseError(fmt.Errorf("anthropic-sdk: failed to marshal request: %w", err))
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
		return adapters.NewNonRecoverableParseError(fmt.Errorf("%s", errMsg))
	}

	// Parse SSE stream
	return a.parseSSEStream(ctx, resp.Body, emitter, scope, model)
}
