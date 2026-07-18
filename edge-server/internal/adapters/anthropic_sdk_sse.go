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

// Residual pure-helper peel #1142: Anthropic SSE stream parse + event dispatch.
// Same package adapters; ParseStream continues to call parseSSEStream.

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
