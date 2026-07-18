package adapters

import (
	"encoding/json"
	"log/slog"
)

// Residual pure-helper peel #1103: text / thinking item emitters.

func (a *CodexAdapter) emitTextBlock(raw json.RawMessage, scope map[string]any, emitter EventEmitter) {
	var item struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &item); err != nil {
		slog.Debug("codex: emitTextBlock unmarshal failed", "error", err)
		return
	}
	if item.Text != "" {
		emitter.Emit(BusEventTextBlock, scope, map[string]any{
			"content": item.Text,
		})
	}
}

func (a *CodexAdapter) emitThinking(raw json.RawMessage, scope map[string]any, emitter EventEmitter) {
	var item struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &item); err != nil {
		slog.Debug("codex: emitThinking unmarshal failed", "error", err)
		return
	}
	if item.Text != "" {
		emitter.Emit(BusEventThinking, scope, map[string]any{
			"content": item.Text,
		})
	}
}
