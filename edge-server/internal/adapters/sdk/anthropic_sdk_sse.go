package sdk

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"strings"

	"github.com/agenthub/edge-server/internal/adapters"
)

// Residual pure-helper peel #1142: Anthropic SSE stream parse + event dispatch.
// Grouped into package sdk (#1760); ParseStream continues to call parseSSEStream.

// anthropicSSEState accumulates cross-event state while parsing an SSE stream.
type anthropicSSEState struct {
	currentContentType string
	currentText        strings.Builder
	currentToolID      string
	currentToolName    string
	currentToolInput   strings.Builder
	inputStarted       bool
	inputTokens        int64
	outputTokens       int64
}

// parseSSEStream reads the Server-Sent Events stream from the Anthropic API
// and emits Edge typed events.
func (a *AnthropicSDKAdapter) parseSSEStream(ctx context.Context, body io.Reader, emitter EventEmitter, scope map[string]any, model string) error {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 256*1024), anthropicMaxResponseSize)

	st := &anthropicSSEState{}

	for scanner.Scan() {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		line := scanner.Text()
		if line == "" {
			continue
		}

		// SSE lines start with "data: " or "event: ". "event: " lines carry
		// the event type; we skip them and extract data from the "data: " line.
		if !strings.HasPrefix(line, "data: ") {
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

		if err := handleAnthropicSSEEvent(event, emitter, scope, model, st); err != nil {
			return err
		}
	}

	if err := scanner.Err(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return adapters.NewNonRecoverableParseError(fmt.Errorf("anthropic-sdk: SSE stream read error: %w", err))
	}

	return nil
}

// handleAnthropicSSEEvent dispatches a single parsed SSE event to its
// type-specific handler.
func handleAnthropicSSEEvent(event anthropicSSEEvent, emitter EventEmitter, scope map[string]any, model string, st *anthropicSSEState) error {
	switch event.Type {
	case "message_start":
		handleAnthropicMessageStart(event, emitter, scope, st)
	case "content_block_start":
		handleAnthropicContentBlockStart(event, emitter, scope, st)
	case "content_block_delta":
		handleAnthropicContentBlockDelta(event, emitter, scope, st)
	case "content_block_stop":
		handleAnthropicContentBlockStop(emitter, scope, st)
	case "message_delta":
		handleAnthropicMessageDelta(event, st)
	case "message_stop":
		handleAnthropicMessageStop(emitter, scope, model, st)
	case "error":
		return handleAnthropicStreamError(event, emitter, scope)
	default:
		slog.Debug("anthropic-sdk: unhandled SSE event type", "type", event.Type)
	}
	return nil
}

func handleAnthropicMessageStart(event anthropicSSEEvent, emitter EventEmitter, scope map[string]any, st *anthropicSSEState) {
	if event.Message == nil {
		return
	}
	st.inputTokens = event.Message.Usage.InputTokens
	emitter.Emit(BusEventStatusChange, scope, map[string]any{
		"status":   "running",
		"model":    event.Message.Model,
		"provider": "anthropic",
	})
}

func handleAnthropicContentBlockStart(event anthropicSSEEvent, emitter EventEmitter, scope map[string]any, st *anthropicSSEState) {
	if event.ContentBlock == nil {
		return
	}
	st.currentContentType = event.ContentBlock.Type
	st.currentText.Reset()
	st.currentToolInput.Reset()
	st.inputStarted = false

	switch event.ContentBlock.Type {
	case "thinking":
		emitter.Emit(BusEventThinking, scope, map[string]any{
			"content":  "",
			"provider": "anthropic",
			"status":   "started",
		})
	case "tool_use":
		st.currentToolID = event.ContentBlock.ID
		st.currentToolName = event.ContentBlock.Name
		if event.ContentBlock.PartialJSON != "" {
			st.currentToolInput.WriteString(event.ContentBlock.PartialJSON)
			st.inputStarted = true
		}
	}
}

func handleAnthropicContentBlockDelta(event anthropicSSEEvent, emitter EventEmitter, scope map[string]any, st *anthropicSSEState) {
	if event.Delta == nil {
		return
	}
	switch event.Delta.Type {
	case "text_delta":
		if event.Delta.Text != "" {
			emitter.Emit(BusEventTextDelta, scope, map[string]any{
				"content":  event.Delta.Text,
				"provider": "anthropic",
			})
			st.currentText.WriteString(event.Delta.Text)
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
			st.currentToolInput.WriteString(event.Delta.PartialJSON)
			st.inputStarted = true
		}
	}
}

func handleAnthropicContentBlockStop(emitter EventEmitter, scope map[string]any, st *anthropicSSEState) {
	switch st.currentContentType {
	case "text":
		text := st.currentText.String()
		if text != "" {
			emitter.Emit(BusEventTextBlock, scope, map[string]any{
				"content":  text,
				"provider": "anthropic",
			})
		}
	case "tool_use":
		inputJSON := st.currentToolInput.String()
		if !st.inputStarted {
			inputJSON = "{}"
		}
		var input any
		if err := json.Unmarshal([]byte(inputJSON), &input); err != nil {
			input = map[string]any{"raw": inputJSON}
		}
		emitter.Emit(BusEventToolCall, scope, map[string]any{
			"callId":   st.currentToolID,
			"toolName": st.currentToolName,
			"input":    input,
			"status":   "pending",
			"provider": "anthropic",
		})
	}
	st.currentContentType = ""
}

func handleAnthropicMessageDelta(event anthropicSSEEvent, st *anthropicSSEState) {
	if event.Delta == nil {
		return
	}
	if event.Delta.StopReason != "" {
		st.outputTokens = event.Usage.OutputTokens
	}
}

func handleAnthropicMessageStop(emitter EventEmitter, scope map[string]any, model string, st *anthropicSSEState) {
	// Emit final result
	usageMap := map[string]any{
		"inputTokens":  st.inputTokens,
		"outputTokens": st.outputTokens,
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
}

func handleAnthropicStreamError(event anthropicSSEEvent, emitter EventEmitter, scope map[string]any) error {
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
	return adapters.NewNonRecoverableParseError(fmt.Errorf("anthropic-sdk: API error: %s", errMsg))
}
