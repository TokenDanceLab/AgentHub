package sdk

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"math"
	"math/rand"
	"net/http"
	"strings"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/runnerctx"
)

// Residual pure-helper peel #1152: OpenAI SDK HTTP request + message build helpers.
// Grouped into package sdk (#1760); doRequestWithRetry / buildMessages called from ParseStream.

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
	var retryAfterHint string

	for attempt := 0; attempt <= openaiMaxRetries; attempt++ {
		if attempt > 0 {
			// Exponential backoff with jitter: 1s, 2s, 4s (±25%).
			// Jitter prevents thundering herd when multiple sub-agents
			// retry simultaneously after a provider-wide outage.
			delay := openaiRetryBaseDelay * time.Duration(math.Pow(2, float64(attempt-1)))
			// #nosec G404 -- retry backoff jitter only; randomness is not used for security
			delay += time.Duration(rand.Int63n(int64(delay / 4)))
			delay = retryDelayWithHint(delay, retryAfterHint)
			retryAfterHint = ""
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
			return nil, adapters.NewNonRecoverableParseError(fmt.Errorf("openai-sdk: failed to create request: %w", err))
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+a.apiKey)
		req.Header.Set("Accept", "text/event-stream")

		resp, err := a.httpClient.Do(req)
		if err != nil {
			lastErr = err
			continue // Network errors are retriable
		}

		// Check status code for retry eligibility
		switch {
		case resp.StatusCode == http.StatusOK:
			return resp, nil
		case resp.StatusCode == http.StatusTooManyRequests:
			// Rate limited -- always retry; carry the throttle hint.
			retryAfterHint = resp.Header.Get("Retry-After")
			_ = resp.Body.Close()
			lastErr = fmt.Errorf("rate limited (429)")
			continue
		case resp.StatusCode >= 500:
			// Server error -- retry; 503 may carry a throttle hint too.
			retryAfterHint = resp.Header.Get("Retry-After")
			_ = resp.Body.Close()
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
	return nil, adapters.NewNonRecoverableParseError(fmt.Errorf("openai-sdk: request failed after %d retries: %w", openaiMaxRetries, lastErr))
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
		sanitized, filtered := runnerctx.SanitizeMessage(msg)
		if filtered {
			slog.Warn("openai-sdk: sanitized message",
				"role", msg.Role,
				"originalLen", len(msg.Content),
			)
		}
		role := sanitized.Role
		if role == "system" {
			continue
		}
		// Normalize roles to OpenAI's expected values. SanitizeMessage
		// guarantees the role is one of user/assistant/system/tool:
		// assistant and tool pass through, anything else becomes user.
		if role != "assistant" && role != "tool" {
			role = "user"
		}
		messages = append(messages, openaiChatMessage{
			Role:    role,
			Content: sanitized.Content,
		})
	}

	// Add the current prompt
	prompt := ctx.Prompt
	if prompt == "" {
		prompt = "Continue."
	}
	sanitizedPrompt, filtered := runnerctx.SanitizeMessage(runnerctx.Message{Role: "user", Content: prompt})
	if filtered {
		slog.Warn("openai-sdk: sanitized prompt",
			"originalLen", len(prompt),
		)
	}
	messages = append(messages, openaiChatMessage{
		Role:    "user",
		Content: sanitizedPrompt.Content,
	})

	return messages
}
