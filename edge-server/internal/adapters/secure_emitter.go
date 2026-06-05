// Package adapters — SecureEmitter wraps an EventEmitter and runs security
// hooks (PreToolUse / PostToolUse) on tool_call and tool_result events emitted
// by any adapter.
//
// Before SecureEmitter, only the NDJSONStreamParser (used by Claude Code) ran
// security hooks. Codex and OpenCode adapters emitted raw events without any
// security checks. SecureEmitter provides a unified security layer at the
// ProcessExecutor level that covers all adapters equally.
package adapters

import "context"

// SecureEmitter intercepts tool_call and tool_result events before they reach
// the underlying EventEmitter, running the configured AgentHook chain for
// security validation. All other event types pass through unchanged.
type SecureEmitter struct {
	inner EventEmitter
	hooks HookChain
	ctx   context.Context
}

// NewSecureEmitter creates a SecureEmitter that runs the given hook chain on
// tool_call and tool_result events before forwarding to the inner emitter.
func NewSecureEmitter(ctx context.Context, inner EventEmitter, hooks HookChain) *SecureEmitter {
	return &SecureEmitter{inner: inner, hooks: hooks, ctx: ctx}
}

// Emit implements EventEmitter. For tool_call events it runs PreToolUse and
// marks the payload as blocked if the hook chain blocks the call. For
// tool_result events it runs PostToolUse so hooks can modify the output. All
// other event types pass through unchanged.
func (s *SecureEmitter) Emit(eventType string, scope map[string]any, payload any) {
	if len(s.hooks) == 0 {
		s.inner.Emit(eventType, scope, payload)
		return
	}

	p, ok := payload.(map[string]any)
	if !ok {
		s.inner.Emit(eventType, scope, payload)
		return
	}

	switch eventType {
	case BusEventToolCall:
		s.emitWithPreToolUse(eventType, scope, p)
	case BusEventToolResult:
		s.emitWithPostToolUse(eventType, scope, p)
	default:
		s.inner.Emit(eventType, scope, p)
	}
}

// emitWithPreToolUse runs the hook chain's PreToolUse for tool_call events.
// If the chain blocks, the payload is updated with blocked status and reason
// before emission.
func (s *SecureEmitter) emitWithPreToolUse(eventType string, scope, payload map[string]any) {
	toolName, _ := payload["toolName"].(string)
	if toolName == "" {
		s.inner.Emit(eventType, scope, payload)
		return
	}
	input, _ := payload["input"].(map[string]any)
	modified, blocked, reason := s.hooks.RunPreToolUse(s.ctx, toolName, input)
	if blocked {
		payload["input"] = modified
		payload["status"] = "blocked"
		payload["blockReason"] = reason
	} else if modified != nil {
		payload["input"] = modified
	}
	s.inner.Emit(eventType, scope, payload)
}

// emitWithPostToolUse runs the hook chain's PostToolUse for tool_result events.
// The output key varies by adapter:
//   - NDJSON parser (Claude Code): "content"
//   - Codex / OpenCode:            "output"
//
// PostToolUse is only applied when the output value is a string, matching the
// AgentHook.PostToolUse signature (string -> string).
func (s *SecureEmitter) emitWithPostToolUse(eventType string, scope, payload map[string]any) {
	toolName, _ := payload["toolName"].(string)
	if toolName == "" {
		s.inner.Emit(eventType, scope, payload)
		return
	}
	if output, ok := payload["content"].(string); ok {
		payload["content"] = s.hooks.RunPostToolUse(s.ctx, toolName, output)
	} else if output, ok := payload["output"].(string); ok {
		payload["output"] = s.hooks.RunPostToolUse(s.ctx, toolName, output)
	}
	s.inner.Emit(eventType, scope, payload)
}
