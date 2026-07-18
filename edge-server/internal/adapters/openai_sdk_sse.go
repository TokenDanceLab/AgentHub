package adapters

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"strings"
)

// Residual pure-helper peel #1152: OpenAI SSE stream parse + event dispatch.
// Same package adapters; ParseStream continues to call parseSSEStream.

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
