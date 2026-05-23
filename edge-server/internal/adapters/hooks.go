// Package adapters — AgentHook 接口定义
// 基于 Claude Code (28 hooks) + OpenCode (19 hooks) 收敛为 6 核心 hooks
// 参考: docs/reference/02-cross-comparison/00-synthesis.md §2.2

package adapters

import "context"

// RiskLevel classifies tool call risk for permission decisions.
type RiskLevel string

const (
	RiskLow     RiskLevel = "low"     // read-only: Read, Grep, Glob
	RiskMedium  RiskLevel = "medium"  // local write: Write, Edit
	RiskHigh    RiskLevel = "high"    // network/shell: Bash, WebFetch
	RiskBlocked RiskLevel = "blocked" // never allowed: rm -rf /, curl | bash
)

// PermDecision is the result of a permission check.
type PermDecision string

const (
	PermAllow     PermDecision = "allow"
	PermDeny      PermDecision = "deny"
	PermAllowOnce PermDecision = "allow_once"
)

// ErrorAction determines how the agent should respond to an error.
type ErrorAction string

const (
	ErrRetry    ErrorAction = "retry"
	ErrAbort    ErrorAction = "abort"
	ErrFallback ErrorAction = "fallback"
)

// AgentHook defines the 6 core hooks for Agent lifecycle extension.
// Implementations can be chained (middleware pattern).
type AgentHook interface {
	// PreToolUse is called before a tool executes. Return block=true to prevent execution.
	PreToolUse(ctx context.Context, toolName string, input map[string]any) (modifiedInput map[string]any, block bool, reason string)

	// PostToolUse is called after a tool completes. Return modified result.
	PostToolUse(ctx context.Context, toolName string, output string) (modifiedOutput string)

	// PermissionRequest is called when a tool needs user approval.
	PermissionRequest(ctx context.Context, toolName string, risk RiskLevel) (decision PermDecision)

	// OnError is called when the agent encounters an error.
	OnError(ctx context.Context, err error) (action ErrorAction)

	// PrePrompt is called before a user prompt is sent to the agent.
	PrePrompt(ctx context.Context, prompt string) (modifiedPrompt string)

	// PostResponse is called after the agent produces a complete response.
	PostResponse(ctx context.Context, response string) (modifiedResponse string)
}

// HookChain executes hooks in order, stopping if any hook blocks.
type HookChain []AgentHook

// RunPreToolUse runs PreToolUse across all hooks. Stops at first block.
func (c HookChain) RunPreToolUse(ctx context.Context, toolName string, input map[string]any) (map[string]any, bool, string) {
	current := input
	for _, h := range c {
		modified, block, reason := h.PreToolUse(ctx, toolName, current)
		if block {
			return modified, true, reason
		}
		current = modified
	}
	return current, false, ""
}

// RunPostToolUse runs PostToolUse across all hooks, chaining output modifications.
func (c HookChain) RunPostToolUse(ctx context.Context, toolName string, output string) string {
	current := output
	for _, h := range c {
		current = h.PostToolUse(ctx, toolName, current)
	}
	return current
}

// RunPermissionRequest runs PermissionRequest across all hooks. First non-Allow wins.
func (c HookChain) RunPermissionRequest(ctx context.Context, toolName string, risk RiskLevel) PermDecision {
	for _, h := range c {
		decision := h.PermissionRequest(ctx, toolName, risk)
		if decision != PermAllow {
			return decision
		}
	}
	return PermAllow
}

// RunOnError runs OnError across all hooks. First non-Retry action wins.
func (c HookChain) RunOnError(ctx context.Context, err error) ErrorAction {
	for _, h := range c {
		action := h.OnError(ctx, err)
		if action != ErrRetry {
			return action
		}
	}
	return ErrRetry
}

// RunPrePrompt runs PrePrompt across all hooks, chaining prompt modifications.
func (c HookChain) RunPrePrompt(ctx context.Context, prompt string) string {
	current := prompt
	for _, h := range c {
		current = h.PrePrompt(ctx, current)
	}
	return current
}

// RunPostResponse runs PostResponse across all hooks, chaining response modifications.
func (c HookChain) RunPostResponse(ctx context.Context, response string) string {
	current := response
	for _, h := range c {
		current = h.PostResponse(ctx, current)
	}
	return current
}
