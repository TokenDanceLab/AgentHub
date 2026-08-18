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

// Residual pure-helper peel #1152: OpenAI SSE stream parse + event dispatch.
// Grouped into package sdk (#1760); ParseStream continues to call parseSSEStream.

// openaiSSEState accumulates cross-chunk state while parsing an SSE stream.
type openaiSSEState struct {
	currentText      strings.Builder
	currentToolCalls map[int]*openaiToolCallAccumulator
	inputTokens      int64
	outputTokens     int64
	finishReason     string
}

// parseSSEStream reads the Server-Sent Events stream from the OpenAI API
// and emits Edge typed events.
func (a *OpenAISDKAdapter) parseSSEStream(ctx context.Context, body io.Reader, emitter EventEmitter, scope map[string]any, model string) error {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 256*1024), openaiMaxResponseSize)

	st := &openaiSSEState{}

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

		if handleOpenAIChatChunk(chunk, emitter, scope, st) {
			// Usage-only chunk or nil delta; nothing to emit.
			continue
		}
	}

	if err := scanner.Err(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return adapters.NewNonRecoverableParseError(fmt.Errorf("openai-sdk: SSE stream read error: %w", err))
	}

	emitOpenAIFinalEvents(emitter, scope, model, st)
	return nil
}

// handleOpenAIChatChunk processes one chat completion chunk and returns true
// when the chunk carries nothing emit-worthy (usage-only or nil delta).
func handleOpenAIChatChunk(chunk openaiChatChunk, emitter EventEmitter, scope map[string]any, st *openaiSSEState) bool {
	if len(chunk.Choices) == 0 {
		// Usage-only chunk (stream_options include_usage)
		if chunk.Usage != nil {
			st.inputTokens = chunk.Usage.PromptTokens
			st.outputTokens = chunk.Usage.CompletionTokens
		}
		return true
	}

	choice := chunk.Choices[0]
	if choice.Delta == nil {
		return true
	}

	// Handle text content
	if choice.Delta.Content != "" {
		emitter.Emit(BusEventTextDelta, scope, map[string]any{
			"content":  choice.Delta.Content,
			"provider": "openai",
		})
		st.currentText.WriteString(choice.Delta.Content)
	}

	// Handle tool calls
	accumulateOpenAIToolCalls(chunk, st)

	// Handle reasoning/thinking content (o-series models)
	if choice.Delta.ReasoningContent != "" {
		emitter.Emit(BusEventThinking, scope, map[string]any{
			"content":  choice.Delta.ReasoningContent,
			"provider": "openai",
		})
	}

	// Track finish reason
	if choice.FinishReason != "" {
		st.finishReason = choice.FinishReason
	}

	// Usage from streaming chunk
	if chunk.Usage != nil {
		st.inputTokens = chunk.Usage.PromptTokens
		st.outputTokens = chunk.Usage.CompletionTokens
	}

	return false
}

// accumulateOpenAIToolCalls merges streaming tool-call deltas into the
// per-index accumulators held in the stream state.
func accumulateOpenAIToolCalls(chunk openaiChatChunk, st *openaiSSEState) {
	if len(chunk.Choices) == 0 {
		return
	}
	choice := chunk.Choices[0]
	for _, tc := range choice.Delta.ToolCalls {
		if st.currentToolCalls == nil {
			st.currentToolCalls = make(map[int]*openaiToolCallAccumulator)
		}
		acc, ok := st.currentToolCalls[tc.Index]
		if !ok {
			acc = &openaiToolCallAccumulator{
				ID:   tc.ID,
				Name: tc.Function.Name,
			}
			st.currentToolCalls[tc.Index] = acc
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

// emitOpenAIFinalEvents emits the accumulated text block, tool calls, usage,
// and final result once the stream has been fully consumed.
func emitOpenAIFinalEvents(emitter EventEmitter, scope map[string]any, model string, st *openaiSSEState) {
	// Emit text block if we accumulated text
	text := st.currentText.String()
	if text != "" {
		emitter.Emit(BusEventTextBlock, scope, map[string]any{
			"content":  text,
			"provider": "openai",
		})
	}

	// Emit tool calls
	for _, acc := range st.currentToolCalls {
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
		"inputTokens":  st.inputTokens,
		"outputTokens": st.outputTokens,
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
		"finishReason":   st.finishReason,
	})
}
