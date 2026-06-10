// Package adapters — ToolAllowlistHook enforces runtime tool allowlisting.
// When AllowedTools is set on the run context, any tool_call event for a tool
// not in the allowlist is blocked and a BusEventToolRejected event is emitted.
// This is a defense-in-depth mechanism complementing the CLI-side --allowedTools
// flag: even if the CLI ignores or misinterprets the flag, the Edge runtime
// enforces the policy at the event stream level.
package adapters

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strings"
)

// ToolAllowlistHook is an AgentHook that blocks tool calls not present in the
// configured allowlist. When the allowlist is empty, all tools are permitted
// (passthrough). When non-empty, only tools named in the allowlist are allowed.
// Blocked tool calls result in a BusEventToolRejected event being emitted.
type ToolAllowlistHook struct {
	// allowed is the set of permitted tool names. An empty set means "no restriction".
	allowed map[string]bool

	// emitter receives the BusEventToolRejected event when a tool is blocked.
	// May be nil — in that case rejection is only logged, not emitted.
	emitter EventEmitter

	// scope is the default event scope for rejected tool events (project/thread/run IDs).
	scope map[string]any
}

// NewToolAllowlistHook creates a ToolAllowlistHook that restricts tool calls
// to the given allowlist. If allowedTools is nil or empty, the hook is a
// no-op (all tools pass through). The emitter and scope are used to emit
// BusEventToolRejected events when a tool is blocked.
func NewToolAllowlistHook(allowedTools []string, emitter EventEmitter, scope map[string]any) *ToolAllowlistHook {
	if len(allowedTools) == 0 {
		return &ToolAllowlistHook{} // no restriction
	}
	allowed := make(map[string]bool, len(allowedTools))
	for _, name := range allowedTools {
		allowed[name] = true
	}
	return &ToolAllowlistHook{
		allowed: allowed,
		emitter: emitter,
		scope:   scope,
	}
}

// IsRestrictive returns true if this hook has a non-empty allowlist (i.e. it
// will actually check tool names). Returns false when all tools are permitted.
func (h *ToolAllowlistHook) IsRestrictive() bool {
	return len(h.allowed) > 0
}

// PreToolUse checks whether the tool is in the allowlist. If not, it blocks
// the tool call and emits a BusEventToolRejected event.
func (h *ToolAllowlistHook) PreToolUse(_ context.Context, toolName string, input map[string]any) (map[string]any, bool, string) {
	if len(h.allowed) == 0 {
		return input, false, ""
	}
	if h.allowed[toolName] {
		return input, false, ""
	}

	reason := fmt.Sprintf("tool %q rejected: not in allowlist [%s]", toolName, h.formatAllowlist())
	slog.Warn("tool_allowlist: tool rejected",
		"toolName", toolName,
		"allowlistSize", len(h.allowed),
	)

	// Emit rejection event so upstream consumers (UI, audit, Hub) are notified.
	if h.emitter != nil {
		h.emitter.Emit(BusEventToolRejected, h.scope, map[string]any{
			"toolName": toolName,
			"reason":   reason,
			"status":   "rejected",
		})
	}

	return input, true, reason
}

// PostToolUse is a no-op — allowlist enforcement is pre-execution only.
func (h *ToolAllowlistHook) PostToolUse(_ context.Context, _ string, output string) string {
	return output
}

// PermissionRequest is a no-op — allowlist is enforced at PreToolUse level.
func (h *ToolAllowlistHook) PermissionRequest(_ context.Context, toolName string, risk RiskLevel) PermDecision {
	return PermAllow
}

// OnError defaults to retry.
func (h *ToolAllowlistHook) OnError(_ context.Context, _ error) ErrorAction {
	return ErrRetry
}

// PrePrompt is a no-op.
func (h *ToolAllowlistHook) PrePrompt(_ context.Context, prompt string) string {
	return prompt
}

// PostResponse is a no-op.
func (h *ToolAllowlistHook) PostResponse(_ context.Context, response string) string {
	return response
}

// formatAllowlist returns a comma-separated sorted list of allowed tool names
// for logging/error messages. Truncated to 5 names if the list is long.
func (h *ToolAllowlistHook) formatAllowlist() string {
	if len(h.allowed) == 0 {
		return ""
	}
	names := make([]string, 0, len(h.allowed))
	for name := range h.allowed {
		names = append(names, name)
	}
	sort.Strings(names)
	if len(names) > 5 {
		return strings.Join(names[:5], ", ") + fmt.Sprintf(" + %d more", len(names)-5)
	}
	return strings.Join(names, ", ")
}

// Compile-time interface check: ToolAllowlistHook satisfies AgentHook.
var _ AgentHook = (*ToolAllowlistHook)(nil)
