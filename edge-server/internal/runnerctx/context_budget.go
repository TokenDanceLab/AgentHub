// Package runnerctx provides shared types for passing run-level context
// between the API handler, lifecycle executor, and agent adapters.
//
// This file holds ContextBudget, token estimation and the preflight budget
// checks, plus compaction as a budget predicate only (ShouldCompact /
// CompactionThreshold). The residual pure-helper peel #1141 did move two groups
// out of it, both zero-behavior-change moves: the message type, sanitization
// and context-preface functions into one sibling file, and the history
// compaction/summary heuristics into another. Only the first survives — the
// compaction module was never wired to anything and was later deleted as dead
// code — so this package has one companion file today instead of the two that
// peel created. No sibling is named here on purpose: the earlier revision of
// this comment named both, and one of those two names outlived its file. The
// package directory is the only file list that stays true (#2246).
package runnerctx

import (
	"sync/atomic"
	"unicode/utf8"
)

// DefaultMaxTokens is the default context window size (Claude Opus 200K).
const DefaultMaxTokens = 200_000

// CompactionThreshold is the usage ratio at which auto-compaction triggers.
// 0.85 = 85% of usable budget consumed.
const CompactionThreshold = 0.85

// MaxMessageContentSize is the maximum allowed content length per message in bytes.
// Content exceeding this limit is truncated during sanitization to prevent
// oversized payloads from consuming excessive context budget or causing
// argument-length overflows in CLI-based adapters.
const MaxMessageContentSize = 32 * 1024 // 32KB

// ContextBudget tracks token consumption during a run to detect when
// the context window is approaching exhaustion. It is in-memory only
// and lives for the duration of a single run.
// All methods are safe for concurrent use.
type ContextBudget struct {
	MaxTokens      int64 // Maximum context window size (model-dependent)
	UsedTokens     atomic.Int64
	ReservedTokens int64 // Tokens reserved for output generation and overhead
}

// NewContextBudget creates a budget with sensible defaults.
// maxTokens is the model's context window; 0 or negative means use the
// default of 200,000 tokens. Reserved is set to 10,000 tokens by default.
func NewContextBudget(maxTokens int) *ContextBudget {
	if maxTokens <= 0 {
		maxTokens = DefaultMaxTokens
	}
	return &ContextBudget{
		MaxTokens:      int64(maxTokens),
		ReservedTokens: 10_000,
	}
}

// IsExhausted returns true when used tokens meet or exceed the usable
// budget (max minus reserved overhead).
func (b *ContextBudget) IsExhausted() bool {
	return b.UsedTokens.Load() >= b.MaxTokens-b.ReservedTokens
}

// ShouldCompact returns true when token usage exceeds CompactionThreshold (85%)
// of the usable budget, signalling that auto-compaction should be triggered soon.
func (b *ContextBudget) ShouldCompact() bool {
	usable := b.MaxTokens - b.ReservedTokens
	if usable <= 0 {
		return true
	}
	return float64(b.UsedTokens.Load())/float64(usable) >= CompactionThreshold
}

// UsagePercent returns the current usage as a percentage (0-100) of the
// usable token budget.
func (b *ContextBudget) UsagePercent() float64 {
	usable := b.MaxTokens - b.ReservedTokens
	if usable <= 0 {
		return 100
	}
	pct := float64(b.UsedTokens.Load()) / float64(usable) * 100
	if pct > 100 {
		return 100
	}
	return pct
}

// Remaining returns the number of tokens left before exhaustion.
// Never returns a negative value.
func (b *ContextBudget) Remaining() int64 {
	remaining := b.MaxTokens - b.ReservedTokens - b.UsedTokens.Load()
	if remaining < 0 {
		return 0
	}
	return remaining
}

// Track increments the used token count. Safe for concurrent use.
func (b *ContextBudget) Track(tokens int) {
	b.UsedTokens.Add(int64(tokens))
}

// AllocateChild creates a child budget with a fraction of the parent's remaining
// tokens. ratio should be between 0 and 1 (e.g., 0.4 = 40%). The child's MaxTokens
// is set to the allocated amount, and the parent's used tokens are NOT incremented
// (the child tracks its own usage independently).
// Returns nil if the parent budget is nil.
func (b *ContextBudget) AllocateChild(ratio float64) *ContextBudget {
	if b == nil {
		return nil
	}
	if ratio <= 0 {
		ratio = 0.4
	}
	if ratio > 1 {
		ratio = 1
	}
	remaining := b.Remaining()
	childMax := int(float64(remaining) * ratio)
	if childMax <= 0 {
		childMax = 10_000 // minimum budget
	}
	return &ContextBudget{
		MaxTokens:      int64(childMax),
		ReservedTokens: int64(float64(b.ReservedTokens) * ratio),
	}
}

// ── Token Estimation ─────────────────────────────────────────────────────

// EstimateTokens estimates the number of tokens in a text string using the
// chars/4 heuristic. This avoids external tokenizer dependencies while
// providing a reasonable approximation for token budget calculations.
// Uses ceiling division: (len+3)/4 so even 1-character strings count as 1 token.
func EstimateTokens(text string) int {
	if len(text) == 0 {
		return 0
	}
	// Use rune count instead of byte count for more accurate estimation,
	// especially for CJK text where each character is 3+ bytes in UTF-8
	// but tokenization averages ~1.5 tokens per character.
	return (utf8.RuneCountInString(text) + 3) / 4
}

// ── Budget Preflight Check ────────────────────────────────────────────────

// CheckTokenBudget evaluates whether the estimated token count fits safely
// within the model's context window.
//
// Levels:
//   - "ok"      (< 80% of maxTokens): safe to proceed, no action needed
//   - "warn"    (80%-95% of maxTokens): budget is tight; caller should
//     consider compaction or warn the user before proceeding
//   - "critical" (> 95% of maxTokens): budget is exhausted; caller should
//     reject the request or force compaction
//
// This is a pure check function — it does not mutate any state. The caller
// decides what action to take based on the returned level.
//
// Use EstimateTokens() to compute promptTokens before calling this function.
//
// Usage example (preflight check in ProcessExecutor.run, before BuildCommand):
//
//	promptTokens := EstimateTokens(runCtx.Prompt)
//	if runCtx.Budget != nil {
//	    totalTokens := int(runCtx.Budget.UsedTokens.Load()) + promptTokens
//	    ok, level := CheckTokenBudget(totalTokens, int(runCtx.Budget.MaxTokens))
//	    switch level {
//	    case "critical":
//	        return fmt.Errorf("context budget exhausted: %d/%d tokens used",
//	            runCtx.Budget.UsedTokens.Load(), runCtx.Budget.MaxTokens)
//	    case "warn":
//	        // Emit agent.context_warning event so the frontend can surface
//	        // a visible warning. Also trigger proactive compaction if the
//	        // adapter supports it (Claude Code via --continue compaction,
//	        // SDK adapters via history summarization).
//	    case "ok":
//	        // Budget is healthy — proceed normally.
//	    }
//	    // Track the prompt tokens now that the preflight has passed.
//	    // (Adapter-specific costs like tool results and assistant replies
//	    // are tracked later as they arrive.)
//	    runCtx.Budget.Track(promptTokens)
//	}
func CheckTokenBudget(promptTokens int, maxTokens int) (ok bool, level string) {
	if maxTokens <= 0 {
		return true, "ok"
	}
	if promptTokens < 0 {
		return false, "critical"
	}
	pct := float64(promptTokens) / float64(maxTokens) * 100
	switch {
	case pct < 80:
		return true, "ok"
	case pct <= 95:
		return true, "warn"
	default:
		return false, "critical"
	}
}
