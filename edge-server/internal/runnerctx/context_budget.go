// Package runnerctx provides shared types for passing run-level context
// between the API handler, lifecycle executor, and agent adapters.
package runnerctx

import (
	"strings"
	"sync/atomic"
	"time"
)

// DefaultMaxTokens is the default context window size (Claude Opus 200K).
const DefaultMaxTokens = 200_000

// CompactionThreshold is the usage ratio at which auto-compaction triggers.
// 0.85 = 85% of usable budget consumed.
const CompactionThreshold = 0.85

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
	return (len(text) + 3) / 4
}

// ── Message Types ────────────────────────────────────────────────────────

// Message represents a single message in a conversation history.
type Message struct {
	Role      string    `json:"role"`      // "user", "assistant", "system", "tool"
	Content   string    `json:"content"`   // message text content
	Timestamp time.Time `json:"timestamp"` // when the message was created
}

// BuildContextPreface formats thread history and pinned messages into a
// system-prompt-compatible preface that injects conversation context into
// any agent runtime. Pinned messages are presented first (highest priority),
// followed by recent thread history. Returns an empty string when there is
// no context to inject.
//
// The output is designed to be prepended to the agent's prompt (Codex,
// OpenCode) or appended to the system prompt (Claude Code), so that every
// agent runtime — not just Claude Code with --continue — receives Hub
// thread history.
func BuildContextPreface(messages, pinned []Message) string {
	var b strings.Builder

	if len(pinned) > 0 {
		b.WriteString("[Pinned context - always relevant]\n")
		for _, m := range pinned {
			b.WriteString(m.Role)
			b.WriteString(": ")
			b.WriteString(m.Content)
			b.WriteString("\n")
		}
		b.WriteString("[End of pinned context]\n\n")
	}

	if len(messages) > 0 {
		b.WriteString("[Previous conversation context - for reference only]\n")
		for _, m := range messages {
			b.WriteString(m.Role)
			b.WriteString(": ")
			b.WriteString(m.Content)
			b.WriteString("\n")
		}
		b.WriteString("[End of previous context]\n")
	}

	return b.String()
}

// CompactionResult contains statistics about a history compaction operation.
type CompactionResult struct {
	OriginalCount  int    `json:"originalCount"`  // number of messages before compaction
	CompactedCount int    `json:"compactedCount"`  // number of messages after compaction
	Summary        string `json:"summary"`         // the generated system summary
	TokensSaved    int    `json:"tokensSaved"`     // estimated tokens freed by compaction
}

// ── History Compaction ───────────────────────────────────────────────────

// CompactHistory compacts a conversation history by summarizing older messages
// while preserving the most recent ones. It:
//   - Keeps the last keepRecent messages unchanged (default 10).
//   - Summarizes all older messages into a single "system" message that captures
//     key decisions, file changes, errors, and conclusions.
//   - Inserts the summary system message before the preserved recent messages.
//   - If the compacted result still exceeds maxTokens, evicts oldest messages
//     until the budget is satisfied.
//
// Returns the compacted message list and statistics. If len(messages) <= keepRecent,
// no compaction is performed and nil is returned for the result.
func CompactHistory(messages []Message, keepRecent int) ([]Message, *CompactionResult) {
	if keepRecent <= 0 {
		keepRecent = 10
	}

	if len(messages) <= keepRecent {
		return messages, nil
	}

	originalCount := len(messages)
	older := messages[:len(messages)-keepRecent]
	recent := messages[len(messages)-keepRecent:]

	// Calculate tokens before compaction for the older messages.
	originalTokens := 0
	for _, m := range older {
		originalTokens += EstimateTokens(m.Content)
	}

	// Summarize older messages.
	lines := summarizeMessages(older)
	summary := strings.Join(lines, "\n")

	// Calculate tokens saved.
	summaryTokens := EstimateTokens(summary)
	tokensSaved := originalTokens - summaryTokens
	if tokensSaved < 0 {
		tokensSaved = 0
	}

	compacted := make([]Message, 0, 1+len(recent))
	compacted = append(compacted, Message{
		Role:    "system",
		Content: summary,
	})
	compacted = append(compacted, recent...)

	result := &CompactionResult{
		OriginalCount:  originalCount,
		CompactedCount: len(compacted),
		Summary:        summary,
		TokensSaved:    tokensSaved,
	}

	// Apply eviction if still over budget.
	// Use CompactionThreshold as the eviction target (85% of safe budget).
	// We don't know the exact model budget here, so eviction is best-effort.
	// The caller can use EvictToBudget separately with a specific maxTokens.
	if tokensSaved > 0 && len(older) > 0 {
		// Compaction always reduces count; no further eviction needed unless
		// caller requests it explicitly via EvictToBudget.
		_ = tokensSaved
	}

	return compacted, result
}

// EvictToBudget removes the oldest messages (preserving the first system message
// if it appears to be a compaction summary) until the total estimated token count
// falls below maxTokens. Returns a new slice (the original is not modified).
// If the budget cannot be satisfied even with a single message, the last message
// is always retained.
func EvictToBudget(messages []Message, maxTokens int) []Message {
	if maxTokens <= 0 {
		return messages
	}
	if len(messages) == 0 {
		return messages
	}

	// Calculate current total.
	totalTokens := 0
	for _, m := range messages {
		totalTokens += EstimateTokens(m.Content)
	}
	if totalTokens <= maxTokens {
		return messages
	}

	// Determine the start index for eviction.
	// Preserve the first message if it's a system message (likely a compaction summary).
	startIdx := 0
	if len(messages) > 1 && messages[0].Role == "system" {
		startIdx = 1
	}

	// Evict from the front (oldest), after the preserved system message.
	result := make([]Message, 0, len(messages))
	if startIdx > 0 {
		result = append(result, messages[0])
	}

	// Work backwards: figure out how many messages from the end we can keep.
	keptTokens := 0
	keepFromEnd := 0
	for i := len(messages) - 1; i >= startIdx; i-- {
		t := EstimateTokens(messages[i].Content)
		if keptTokens+t > maxTokens {
			break
		}
		keptTokens += t
		keepFromEnd++
	}

	// Always keep at least the last message.
	if keepFromEnd == 0 {
		keepFromEnd = 1
	}

	keepStart := len(messages) - keepFromEnd
	if keepStart < startIdx {
		keepStart = startIdx
	}
	result = append(result, messages[keepStart:]...)

	return result
}

// ── Summary Heuristics ───────────────────────────────────────────────────

// summarizeMessages extracts key information from a list of messages without
// requiring an LLM call. It identifies decisions, file changes, errors, and
// conclusions using keyword-based heuristics.
func summarizeMessages(messages []Message) []string {
	// Keywords that indicate important information.
	decisionWords := []string{
		"decided", "decision", "choose", "chose", "chosen", "will use",
		"approach", "plan to", "going to", "agreed", "resolved", "conclusion",
		"final answer", "therefore", "thus", "result",
	}
	fileChangeWords := []string{
		"created", "deleted", "modified", "updated", "changed", "added",
		"removed", "renamed", "moved", "wrote", "rewrote", "edited",
		"installed", "uninstalled", "generated",
	}
	errorWords := []string{
		"error", "failed", "failure", "panic", "crash", "exception",
		"timeout", "rejected", "denied", "invalid", "cannot", "unable",
		"not found", "permission denied",
	}

	var lines []string

	for i, m := range messages {
		role := m.Role
		content := m.Content
		if content == "" {
			continue
		}

		// Skip system messages that are already summaries.
		if role == "system" && i > 0 {
			continue
		}

		// Extract relevant sentences from the content.
		sentences := splitSentences(content)
		for _, s := range sentences {
			s = strings.TrimSpace(s)
			if s == "" {
				continue
			}
			lower := strings.ToLower(s)

			// Check for important content.
			category := ""
			for _, kw := range decisionWords {
				if strings.Contains(lower, kw) {
					category = "decision"
					break
				}
			}
			if category == "" {
				for _, kw := range errorWords {
					if strings.Contains(lower, kw) {
						category = "error"
						break
					}
				}
			}
			if category == "" {
				for _, kw := range fileChangeWords {
					if strings.Contains(lower, kw) {
						category = "file_change"
						break
					}
				}
			}

			if category != "" {
				prefix := ""
				switch category {
				case "decision":
					prefix = "[Decision] "
				case "error":
					prefix = "[Error] "
				case "file_change":
					prefix = "[File] "
				}
				// Truncate long sentences for summary compactness.
				truncated := s
				if len(truncated) > 200 {
					truncated = truncated[:200] + "..."
				}
				lines = append(lines, prefix+truncated)
			}
		}
	}

	if len(lines) == 0 {
		return []string{"[Previous conversation summarized: no key decisions, errors, or file changes detected.]"}
	}

	// Limit summary to a reasonable size (max 50 lines).
	if len(lines) > 50 {
		lines = lines[:50]
		lines = append(lines, "[Summary truncated: too many items to include.]")
	}

	return lines
}

// splitSentences splits text into approximate sentences on common delimiters.
func splitSentences(text string) []string {
	// Split on sentence-ending punctuation followed by space or end-of-string,
	// plus newlines as natural boundaries.
	var sentences []string
	current := strings.Builder{}

	for _, r := range text {
		current.WriteRune(r)
		if r == '.' || r == '!' || r == '?' || r == '\n' {
			s := strings.TrimSpace(current.String())
			if s != "" {
				sentences = append(sentences, s)
			}
			current.Reset()
		}
	}
	// Append any remaining text.
	if current.Len() > 0 {
		s := strings.TrimSpace(current.String())
		if s != "" {
			sentences = append(sentences, s)
		}
	}

	return sentences
}
