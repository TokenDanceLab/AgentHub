// Package runnerctx provides shared types for passing run-level context
// between the API handler, lifecycle executor, and agent adapters.
package runnerctx

// ContextBudget tracks token consumption during a run to detect when
// the context window is approaching exhaustion. It is in-memory only
// and lives for the duration of a single run.
type ContextBudget struct {
	MaxTokens      int // Maximum context window size (model-dependent)
	UsedTokens     int // Tokens consumed so far (cumulative)
	ReservedTokens int // Tokens reserved for output generation and overhead
}

// NewContextBudget creates a budget with sensible defaults.
// maxTokens is the model's context window; 0 or negative means use the
// default of 200,000 tokens. Reserved is set to 10,000 tokens by default.
func NewContextBudget(maxTokens int) *ContextBudget {
	if maxTokens <= 0 {
		maxTokens = 200_000
	}
	return &ContextBudget{
		MaxTokens:      maxTokens,
		ReservedTokens: 10_000,
	}
}

// IsExhausted returns true when used tokens meet or exceed the usable
// budget (max minus reserved overhead).
func (b *ContextBudget) IsExhausted() bool {
	return b.UsedTokens >= b.MaxTokens-b.ReservedTokens
}

// Remaining returns the number of tokens left before exhaustion.
// Never returns a negative value.
func (b *ContextBudget) Remaining() int {
	remaining := b.MaxTokens - b.ReservedTokens - b.UsedTokens
	if remaining < 0 {
		return 0
	}
	return remaining
}

// Track increments the used token count. This is safe to call from
// multiple goroutines for fire-and-forget accounting (no mutex).
func (b *ContextBudget) Track(tokens int) {
	b.UsedTokens += tokens
}
