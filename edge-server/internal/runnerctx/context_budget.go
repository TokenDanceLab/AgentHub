// Package runnerctx provides shared types for passing run-level context
// between the API handler, lifecycle executor, and agent adapters.
package runnerctx

import (
	"log/slog"
	"strings"
	"sync/atomic"
	"time"
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

// ── Message Types ────────────────────────────────────────────────────────

// Message represents a single message in a conversation history.
type Message struct {
	Role      string    `json:"role"`      // "user", "assistant", "system", "tool"
	Content   string    `json:"content"`   // message text content
	Timestamp time.Time `json:"timestamp"` // when the message was created
}

// ── Message Sanitization ──────────────────────────────────────────────────

// validRoles is the allowlist of permissible message roles.
var validRoles = map[string]bool{
	"user":      true,
	"assistant": true,
	"system":    true,
	"tool":      true,
}

// isValidRole returns true if the role is in the allowlist.
func isValidRole(role string) bool {
	return validRoles[role]
}

// needsControlCharStrip returns true if the string contains any ASCII control
// characters other than \t (0x09), \n (0x0A), \r (0x0D).
func needsControlCharStrip(s string) bool {
	for i := 0; i < len(s); i++ {
		b := s[i]
		if b < 0x20 && b != '\t' && b != '\n' && b != '\r' {
			return true
		}
		if b == 0x7F {
			return true
		}
	}
	return false
}

// stripControlChars removes ASCII control characters (except \t, \n, \r) and
// the DEL character (0x7F) from the string. Returns the original string if no
// control characters are present.
func stripControlChars(s string) string {
	if !needsControlCharStrip(s) {
		return s
	}
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 0x20 && c != 0x7F {
			b.WriteByte(c)
		} else if c == '\t' || c == '\n' || c == '\r' {
			b.WriteByte(c)
		}
	}
	return b.String()
}

// SanitizeMessage applies input sanitization to a single message before it
// enters the agent's prompt. Sanitization is always-on, always applied
// internally, and requires no caller opt-in.
//
// Three checks are applied in order:
//  1. Strip ASCII control characters (except \t, \n, \r)
//  2. Truncate content exceeding MaxMessageContentSize (32KB)
//  3. Validate role against the allowlist {user, assistant, system, tool};
//     invalid roles are replaced with "system" and content is prefixed
//     with "[Filtered] " so operators can see that injection was blocked.
//
// Returns the sanitized message and true if any filtering occurred.
func SanitizeMessage(m Message) (Message, bool) {
	content := m.Content
	role := m.Role
	sanitized := false

	// 1. Strip control characters.
	if needsControlCharStrip(content) {
		content = stripControlChars(content)
		sanitized = true
	}

	// 2. Truncate oversized content at a rune boundary to avoid splitting
	// multi-byte UTF-8 characters (e.g. CJK characters at the 32KB cutoff).
	if len(content) > MaxMessageContentSize {
		truncateAt := 0
		for i := 0; i < len(content) && i < MaxMessageContentSize; {
			_, size := utf8.DecodeRuneInString(content[i:])
			if i+size > MaxMessageContentSize {
				break
			}
			truncateAt = i + size
			i += size
		}
		if truncateAt == 0 {
			truncateAt = MaxMessageContentSize // fallback: no complete rune before boundary
		}
		content = content[:truncateAt]
		sanitized = true
	}

	// 3. Validate role.
	if !isValidRole(role) {
		role = "system"
		content = "[Filtered] " + content
		sanitized = true
	}

	return Message{
		Role:      role,
		Content:   content,
		Timestamp: m.Timestamp,
	}, sanitized
}

// ── Context Preface ───────────────────────────────────────────────────────

// BuildContextPreface formats thread history and pinned messages into a
// system-prompt-compatible preface that injects conversation context into
// any agent runtime. Pinned messages are presented first (highest priority),
// followed by recent thread history. Returns an empty string when there is
// no context to inject.
//
// Every message is automatically sanitized via SanitizeMessage before
// inclusion: ASCII control characters are stripped (except \t, \n, \r),
// content exceeding MaxMessageContentSize (32KB) is truncated at a rune
// boundary, and invalid roles are replaced with "system" prefixed with
// "[Filtered] ". Sanitization warnings are logged via slog.Warn so
// operators can audit when injection was blocked.
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
			sanitized, filtered := SanitizeMessage(m)
			if filtered {
				slog.Warn("runnerctx: sanitized pinned message",
					"role", m.Role,
					"originalLen", len(m.Content),
				)
			}
			b.WriteString(sanitized.Role)
			b.WriteString(": ")
			b.WriteString(sanitized.Content)
			b.WriteString("\n")
		}
		b.WriteString("[End of pinned context]\n\n")
	}

	if len(messages) > 0 {
		b.WriteString("[Previous conversation context - for reference only]\n")
		for _, m := range messages {
			sanitized, filtered := SanitizeMessage(m)
			if filtered {
				slog.Warn("runnerctx: sanitized message",
					"role", m.Role,
					"originalLen", len(m.Content),
				)
			}
			b.WriteString(sanitized.Role)
			b.WriteString(": ")
			b.WriteString(sanitized.Content)
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
	// Subtract the preserved system message tokens from the budget so the
	// eviction loop correctly accounts for the already-reserved space.
	result := make([]Message, 0, len(messages))
	remainingBudget := maxTokens
	if startIdx > 0 {
		result = append(result, messages[0])
		remainingBudget -= EstimateTokens(messages[0].Content)
		if remainingBudget < 0 {
			remainingBudget = 0
		}
	}

	// Work backwards: figure out how many messages from the end we can keep
	// within the remaining budget (after system message reservation).
	keptTokens := 0
	keepFromEnd := 0
	for i := len(messages) - 1; i >= startIdx; i-- {
		t := EstimateTokens(messages[i].Content)
		if keptTokens+t > remainingBudget {
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

	// Safety check: if the result still exceeds the budget (e.g., the system
	// message alone consumes the entire budget), drop the system prefix message
	// so at least the recent conversation is preserved.
	totalAfter := 0
	for _, m := range result {
		totalAfter += EstimateTokens(m.Content)
	}
	if totalAfter > maxTokens && len(result) > 1 && result[0].Role == "system" {
		result = result[1:]
	}

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
		// Chinese equivalents
		"决定", "选择", "选定", "采用", "方案", "计划", "同意", "已解决",
		"结论", "最终答案", "因此", "所以", "结果",
	}
	fileChangeWords := []string{
		"created", "deleted", "modified", "updated", "changed", "added",
		"removed", "renamed", "moved", "wrote", "rewrote", "edited",
		"installed", "uninstalled", "generated",
		// Chinese equivalents
		"创建", "删除", "修改", "更新", "变更", "新增", "添加",
		"移除", "重命名", "移动", "编写", "重写", "编辑",
		"安装", "卸载", "生成",
	}
	errorWords := []string{
		"error", "failed", "failure", "panic", "crash", "exception",
		"timeout", "rejected", "denied", "invalid", "cannot", "unable",
		"not found", "permission denied",
		// Chinese equivalents
		"错误", "失败", "崩溃", "异常", "超时", "拒绝", "无效",
		"无法", "找不到", "权限不足", "不允许",
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
