package sdk

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"math"
	"math/rand"
	"net/http"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/runnerctx"
)

// Residual pure-helper peel #1142: Anthropic SDK HTTP request + message build helpers.
// Grouped into package sdk (#1760); doRequestWithRetry / buildMessages called from ParseStream.

// doRequestWithRetry makes the HTTP request with automatic retry for transient
// failures (429 rate limit, 500/502/503/504 server errors). Auth errors (401/403)
// and client errors (400) are not retried.
func (a *AnthropicSDKAdapter) doRequestWithRetry(ctx context.Context, body []byte, emitter EventEmitter, scope map[string]any) (*http.Response, error) {
	var lastErr error
	var retryAfterHint string

	for attempt := 0; attempt <= anthropicMaxRetries; attempt++ {
		if attempt > 0 {
			// Exponential backoff with jitter: 1s, 2s, 4s (±25%).
			// Jitter prevents thundering herd when multiple sub-agents
			// retry simultaneously after a provider-wide outage. A
			// Retry-After hint from the previous 429/5xx takes the larger
			// of hint and backoff (capped) so retries stop colliding with
			// provider throttle windows.
			delay := anthropicRetryBaseDelay * time.Duration(math.Pow(2, float64(attempt-1)))
			// #nosec G404 -- retry backoff jitter only; randomness is not used for security
			delay += time.Duration(rand.Int63n(int64(delay / 4)))
			delay = retryDelayWithHint(delay, retryAfterHint)
			retryAfterHint = ""
			slog.Info("anthropic-sdk: retrying request",
				"attempt", attempt,
				"delay", delay,
				"lastErr", lastErr,
			)
			emitter.Emit(BusEventAPIRetry, scope, map[string]any{
				"attempt":  attempt,
				"delay":    delay.String(),
				"error":    fmt.Sprintf("%v", lastErr),
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
			return nil, adapters.NewNonRecoverableParseError(fmt.Errorf("anthropic-sdk: failed to create request: %w", err))
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-api-key", a.apiKey)
		req.Header.Set("anthropic-version", anthropicAPIVersion)
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
		"error":          fmt.Sprintf("anthropic-sdk: request failed after %d retries: %v", anthropicMaxRetries, lastErr),
		"terminalReason": "error",
		"provider":       "anthropic",
	})
	return nil, adapters.NewNonRecoverableParseError(fmt.Errorf("anthropic-sdk: request failed after %d retries: %w", anthropicMaxRetries, lastErr))
}

// buildMessages converts the RunProcessContext into Anthropic message format.
func (a *AnthropicSDKAdapter) buildMessages(ctx RunProcessContext) []anthropicMessage {
	var messages []anthropicMessage

	// Add thread history messages if present
	for _, msg := range ctx.Messages {
		sanitized, filtered := runnerctx.SanitizeMessage(msg)
		if filtered {
			slog.Warn("anthropic-sdk: sanitized message",
				"role", msg.Role,
				"originalLen", len(msg.Content),
			)
		}
		role := sanitized.Role
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
		slog.Warn("anthropic-sdk: sanitized prompt",
			"originalLen", len(prompt),
		)
	}
	messages = append(messages, anthropicMessage{
		Role:    "user",
		Content: sanitizedPrompt.Content,
	})

	return messages
}
