// Package runnerctx provides shared types for passing run-level context
// between the API handler, lifecycle executor, and agent adapters.
package runnerctx

import "sync/atomic"

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
		maxTokens = 200_000
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

// ShouldCompact returns true when token usage exceeds 85% of the usable
// budget, signalling that auto-compaction should be triggered soon.
func (b *ContextBudget) ShouldCompact() bool {
	usable := b.MaxTokens - b.ReservedTokens
	if usable <= 0 {
		return true
	}
	return float64(b.UsedTokens.Load())/float64(usable) >= 0.85
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
