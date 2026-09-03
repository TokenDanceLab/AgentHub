// Package adapters — AgentHook 接口定义
// 基于 Claude Code (28 hooks) + OpenCode (19 hooks) 收敛为 6 核心 hooks

package adapters

import (
	"context"
	"log/slog"
	"strings"
)

// RiskLevel classifies tool call risk for permission decisions.
type RiskLevel string

const (
	RiskLow      RiskLevel = "low"      // read-only: Read, Grep, Glob
	RiskMedium   RiskLevel = "medium"   // local write: Write, Edit
	RiskHigh     RiskLevel = "high"     // network/shell: Bash, WebFetch, WebSearch
	RiskCritical RiskLevel = "critical" // never allowed: rm -rf /, sudo bash, chmod 777
)

// ApprovalMode controls the overall permission gating strategy.
// Mirrors AionUi's three-tier YOLO/Auto/Manual model.
type ApprovalMode string

const (
	// ApprovalYOLO auto-approves all tool calls except RiskCritical.
	// The PermissionRequest hook returns PermAllow even for RiskHigh tools.
	ApprovalYOLO ApprovalMode = "yolo"

	// ApprovalAuto auto-approves Low/Medium risk tools; High risk tools
	// require user confirmation. This is the default mode.
	ApprovalAuto ApprovalMode = "auto"

	// ApprovalManual requires explicit user confirmation for every tool call
	// that reaches the PermissionRequest hook (all risk levels except Blocked).
	ApprovalManual ApprovalMode = "manual"
)

// ClassifyToolRisk maps a tool name to its base risk level without scanning
// input for dangerous patterns. Use this for display/event purposes; use
// SecurityHook.ClassifyRisk for the full classification including blocked-pattern checks.
//
// Known tool taxonomy:
//
//	RiskLow     — Read, Grep, Glob (read-only filesystem)
//	RiskMedium  — Write, Edit, NotebookEdit (local writes)
//	RiskHigh    — Bash, WebFetch, WebSearch, Skill, SendMessage,
//	              TaskCreate, TaskUpdate, and mcp__* tools (network/shell/meta)
//
// Skill is always RiskHigh because it is a meta-tool that can invoke
// arbitrary sub-tools; the actual risk depends on which skill is invoked.
// Use SecurityHook.classifyRisk (which accepts tool input) for skill-aware
// classification when available.
func ClassifyToolRisk(toolName string) RiskLevel {
	switch toolName {
	case "Read", "Grep", "Glob":
		return RiskLow
	case "Write", "Edit", "NotebookEdit":
		return RiskMedium
	case "Bash", "WebFetch", "WebSearch",
		"Skill", "SendMessage",
		"TaskCreate", "TaskUpdate":
		return RiskHigh
	default:
		// MCP tools use the mcp__<server>__<tool> naming convention.
		// They execute server-side code and must be treated as high-risk.
		if strings.HasPrefix(toolName, "mcp__") {
			return RiskHigh
		}
		// Unknown tools default to RiskHigh (safe default), but operators
		// should audit these to ensure the tool catalog is complete.
		slog.Warn("ClassifyToolRisk: unknown tool, defaulting to RiskHigh — audit recommended",
			"toolName", toolName)
		return RiskHigh
	}
}

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
