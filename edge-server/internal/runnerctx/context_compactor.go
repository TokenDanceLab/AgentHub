// Package runnerctx provides shared types for passing run-level context
// between the API handler, lifecycle executor, and agent adapters.
//
// This file implements the three-layer context compression system:
//
//   1. CompactionNone    — no compression needed
//   2. CompactionToolFold — fold (truncate) tool outputs exceeding a byte limit
//   3. CompactionSummarize — summarize older conversation messages
//
// Reference: SeiyunSky context_compactor.py three-layer design.
package runnerctx

import (
	"fmt"
)

// ── Compaction Levels ─────────────────────────────────────────────────────

// CompactionLevel represents the urgency of context compression.
type CompactionLevel int

const (
	// CompactionNone means no compression is needed yet.
	CompactionNone CompactionLevel = iota
	// CompactionToolFold means tool outputs exceeding the byte limit should be
	// truncated to save context space.
	CompactionToolFold
	// CompactionSummarize means older messages should be summarized in addition
	// to tool folding. This is triggered when token usage is critically high.
	CompactionSummarize
)

// String returns a human-readable name for the compaction level.
func (l CompactionLevel) String() string {
	switch l {
	case CompactionNone:
		return "none"
	case CompactionToolFold:
		return "tool_fold"
	case CompactionSummarize:
		return "summarize"
	default:
		return fmt.Sprintf("unknown(%d)", l)
	}
}

// ── Compaction Policy ─────────────────────────────────────────────────────

// CompactionPolicy configures when and how context compression is applied.
// The zero value is usable and applies sensible defaults when passed to
// ShouldCompress or the compaction functions.
type CompactionPolicy struct {
	// TokenThreshold is the fraction of the context window at which
	// summarization-level compression is triggered. For example, 0.7 means
	// compress when usage reaches 70% of the window. Defaults to 0.7.
	TokenThreshold float64

	// ToolFoldThreshold is the fraction at which tool output folding begins.
	// Must be less than TokenThreshold. Defaults to 0.5.
	ToolFoldThreshold float64

	// ToolOutputMaxBytes is the maximum number of bytes to retain from each
	// tool output before truncation. Defaults to 16384 (16 KB).
	ToolOutputMaxBytes int

	// SummarizeKeepLast is the number of most-recent messages to preserve
	// intact when summarization is triggered. Older messages are compressed
	// into a single system summary. Defaults to 10.
	SummarizeKeepLast int
}

// DefaultCompactionPolicy returns a policy with recommended defaults:
//   - Tool folding at 50% usage, max 16 KB per tool output
//   - Summarization at 70% usage, keeping the last 10 messages
func DefaultCompactionPolicy() CompactionPolicy {
	return CompactionPolicy{
		TokenThreshold:    0.7,
		ToolFoldThreshold: 0.5,
		ToolOutputMaxBytes: 16 * 1024, // 16 KB
		SummarizeKeepLast: 10,
	}
}

// toolFoldThreshold returns the effective tool-fold threshold, defaulting to
// 0.5 when the policy value is zero or negative.
func (p CompactionPolicy) toolFoldThreshold() float64 {
	if p.ToolFoldThreshold <= 0 {
		return 0.5
	}
	return p.ToolFoldThreshold
}

// tokenThreshold returns the effective summarization threshold, defaulting to
// 0.7 when the policy value is zero or negative.
func (p CompactionPolicy) tokenThreshold() float64 {
	if p.TokenThreshold <= 0 {
		return 0.7
	}
	return p.TokenThreshold
}

// toolOutputMaxBytes returns the effective tool output byte limit, defaulting
// to 16 KB when the policy value is zero or negative.
func (p CompactionPolicy) toolOutputMaxBytes() int {
	if p.ToolOutputMaxBytes <= 0 {
		return 16 * 1024
	}
	return p.ToolOutputMaxBytes
}

// summarizeKeepLast returns the number of recent messages to preserve,
// defaulting to 10 when the policy value is zero or negative.
func (p CompactionPolicy) summarizeKeepLast() int {
	if p.SummarizeKeepLast <= 0 {
		return 10
	}
	return p.SummarizeKeepLast
}

// ── Compression Decision ──────────────────────────────────────────────────

// ShouldCompress determines the appropriate compaction level based on current
// token usage, the model's context window size, and the compaction policy.
//
// The decision follows a two-tier threshold model:
//   - usage >= TokenThreshold → CompactionSummarize (fold + summarize)
//   - usage >= ToolFoldThreshold → CompactionToolFold
//   - otherwise → CompactionNone
//
// Returns CompactionNone when contextWindow <= 0.
func ShouldCompress(currentTokens, contextWindow int, policy CompactionPolicy) CompactionLevel {
	if contextWindow <= 0 {
		return CompactionNone
	}

	usage := float64(currentTokens) / float64(contextWindow)

	if usage >= policy.tokenThreshold() {
		return CompactionSummarize
	}
	if usage >= policy.toolFoldThreshold() {
		return CompactionToolFold
	}
	return CompactionNone
}

// ── Tool Output Folding ───────────────────────────────────────────────────

// FoldToolOutput truncates output exceeding maxBytes and appends a summary
// line indicating how much data was omitted. If the output fits within
// maxBytes, it is returned unchanged.
//
// This is the first layer of compression and is cheap to apply (no LLM call).
func FoldToolOutput(output string, maxBytes int) string {
	if maxBytes <= 0 {
		maxBytes = 16 * 1024
	}
	if len(output) <= maxBytes {
		return output
	}

	truncated := output[:maxBytes]
	summary := fmt.Sprintf(
		"\n[... output truncated: %d bytes total, showing first %d bytes ...]\n",
		len(output), maxBytes,
	)
	return truncated + summary
}

// CompactToolOutputs applies FoldToolOutput to every tool-role message in the
// slice. Non-tool messages are left untouched. The original slice is not
// modified; a new slice is returned.
//
// This is used by the second compaction layer (CompactionToolFold) to reduce
// the context footprint of verbose tool outputs.
func CompactToolOutputs(messages []Message, maxBytes int) []Message {
	if len(messages) == 0 {
		return messages
	}
	if maxBytes <= 0 {
		maxBytes = 16 * 1024
	}

	result := make([]Message, len(messages))
	for i, m := range messages {
		if m.Role == "tool" && len(m.Content) > maxBytes {
			result[i] = Message{
				Role:      m.Role,
				Content:   FoldToolOutput(m.Content, maxBytes),
				Timestamp: m.Timestamp,
			}
		} else {
			result[i] = m
		}
	}
	return result
}

// ── Full Compaction Pipeline ───────────────────────────────────────────────

// Compact applies the full compaction pipeline based on the given level and
// policy. It returns the (possibly modified) message slice, a CompactionResult
// (non-nil only when summarization was applied), and the number of bytes saved
// by tool folding.
//
// This is the single entry point that adapters should call when ShouldCompress
// returns a level greater than CompactionNone.
func Compact(messages []Message, level CompactionLevel, policy CompactionPolicy) (
	result []Message,
	summaryResult *CompactionResult,
	bytesFolded int,
) {
	if level == CompactionNone || len(messages) == 0 {
		return messages, nil, 0
	}

	// Layer 1: fold tool outputs (applied for both ToolFold and Summarize).
	maxBytes := policy.toolOutputMaxBytes()
	folded := CompactToolOutputs(messages, maxBytes)

	// Calculate bytes saved by folding.
	for i, m := range messages {
		if m.Role == "tool" && len(m.Content) > maxBytes {
			// The folded version is maxBytes + ~80 bytes for the summary line.
			bytesFolded += len(m.Content) - len(folded[i].Content)
		}
	}

	// Layer 2: summarize old messages (only at CompactionSummarize level).
	if level >= CompactionSummarize {
		keepLast := policy.summarizeKeepLast()
		var compResult *CompactionResult
		folded, compResult = CompactHistory(folded, keepLast)
		return folded, compResult, bytesFolded
	}

	return folded, nil, bytesFolded
}
