package runnerctx

// Residual pure-helper peel #1141: history compaction and summary heuristics
// extracted from context_budget.go. Same package runnerctx; zero behavior change.

import (
	"strings"
)

// CompactionResult contains statistics about a history compaction operation.
type CompactionResult struct {
	OriginalCount  int    `json:"originalCount"`  // number of messages before compaction
	CompactedCount int    `json:"compactedCount"` // number of messages after compaction
	Summary        string `json:"summary"`        // the generated system summary
	TokensSaved    int    `json:"tokensSaved"`    // estimated tokens freed by compaction
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
