// Package adapters — RefusalHook: injects selective-refusal instructions
// into every agent prompt via the PrePrompt hook.
//
// Background: Without explicit refusal instructions, LLM agents tend to
// hallucinate plausible-sounding but incorrect answers when they lack the
// necessary information. This hook injects a concise "admit uncertainty"
// directive that functions as a lightweight factuality guardrail at
// near-zero token cost (~15 tokens per prompt).
//
// Reference: Anthropic "Selective Refusal" best practices; the PrePrompt
// hook was reserved in the AgentHook interface at design time exactly for
// this purpose (see hooks.go:113-115).
package adapters

import (
	"context"
	"strings"
)

// refusalInstruction is prepended to every user prompt to encourage the
// agent to express uncertainty rather than fabricate answers.
const refusalInstruction = "[Instruction] If you are unsure about something, " +
	"say so plainly rather than guessing. If you lack the information " +
	"needed to complete a task, state what you need and stop. " +
	"Only provide answers you are confident are correct. [/Instruction]"

// RefusalHook injects a selective-refusal instruction before every user
// prompt. It is a zero-dependency hook that implements AgentHook.PrePrompt.
//
// Usage:
//
//	hook := &RefusalHook{}
//	chain := HookChain{hook}
//	modifiedPrompt := chain.RunPrePrompt(ctx, originalPrompt)
type RefusalHook struct{}

// PrePrompt prepends the refusal instruction to the prompt if it isn't
// already present (idempotent — prevents double-injection in retry loops).
func (h *RefusalHook) PrePrompt(_ context.Context, prompt string) string {
	if strings.Contains(prompt, refusalInstruction) {
		return prompt // already injected, skip
	}
	return refusalInstruction + "\n\n" + prompt
}

// PostToolUse is a no-op passthrough required by the AgentHook interface.
func (h *RefusalHook) PostToolUse(_ context.Context, _ string, output string) string {
	return output
}

// PreToolUse is a no-op passthrough required by the AgentHook interface.
func (h *RefusalHook) PreToolUse(_ context.Context, _ string, input map[string]any) (map[string]any, bool, string) {
	return input, false, ""
}

// PermissionRequest delegates to the default (auto-approve) behavior.
func (h *RefusalHook) PermissionRequest(_ context.Context, _ string, _ RiskLevel) PermDecision {
	return PermAllow
}

// OnError delegates to the default (retry) behavior.
func (h *RefusalHook) OnError(_ context.Context, _ error) ErrorAction {
	return ErrRetry
}

// PostResponse is a no-op passthrough required by the AgentHook interface.
func (h *RefusalHook) PostResponse(_ context.Context, response string) string {
	return response
}
