package orchestrator

import (
	"encoding/json"
	"strings"
)

// dispatchEvent is the expected JSON shape for a sub-agent dispatch.
type dispatchEvent struct {
	Action      string   `json:"action"`
	Agent       string   `json:"agent"`
	Task        string   `json:"task"`
	Role        string   `json:"role"`
	ThreadID    string   `json:"threadId,omitempty"`
	Model       string   `json:"model,omitempty"`
	SubtaskID   string   `json:"subtaskId,omitempty"`
	TargetFiles []string `json:"targetFiles,omitempty"` // files this sub-agent intends to modify
	DependsOn   []string `json:"dependsOn,omitempty"`   // task IDs this dispatch depends on

	// siblings is set by fanOutDispatches to carry sibling agent context.
	// Not parsed from JSON — populated programmatically before handleDispatch.
	siblings []SiblingInfo
}

// parseDispatchEvents extracts dispatch action lines from free-form orchestrator text.
// Filters match scanTextForDispatch: line length >= 20, leading '{', action=="dispatch",
// and non-empty agent.
func parseDispatchEvents(text string) []dispatchEvent {
	var events []dispatchEvent
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if len(line) < 20 || line[0] != '{' {
			continue
		}
		var evt dispatchEvent
		if err := json.Unmarshal([]byte(line), &evt); err != nil {
			continue
		}
		if evt.Action != "dispatch" || evt.Agent == "" {
			continue
		}
		events = append(events, evt)
	}
	return events
}

// extractTextContent pulls the text string from various event payload shapes.
func extractTextContent(payload any) string {
	if payload == nil {
		return ""
	}
	switch v := payload.(type) {
	case map[string]any:
		if text, ok := v["text"].(string); ok {
			return text
		}
		if content, ok := v["content"].(string); ok {
			return content
		}
		return ""
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return ""
		}
		var m map[string]any
		if err := json.Unmarshal(b, &m); err != nil {
			return ""
		}
		if text, ok := m["text"].(string); ok {
			return text
		}
		if content, ok := m["content"].(string); ok {
			return content
		}
		return ""
	}
}

// matchCompletion checks for known orchestrator termination signals.
// Multi-word phrases match on short text (<= 200 chars) to prevent false
// positives when completion phrases appear inside longer orchestrator
// output that is not a termination signal (ISSUE 3.11).
// Single-word signals only match on very short text (<= 80 chars).
func matchCompletion(textLower string) bool {
	// Multi-word phrases — only match on reasonably short text.
	if len(textLower) <= 200 {
		for _, phrase := range []string{
			"all tasks done", "all done", "all tasks complete",
			"all sub-agent tasks have completed",
		} {
			if strings.Contains(textLower, phrase) {
				return true
			}
		}
	}
	// Single-word signals — only match on short text to avoid false positives.
	if len(textLower) <= 80 {
		trimmed := strings.TrimSpace(textLower)
		for _, word := range []string{"done", "finish", "complete", "completed"} {
			if trimmed == word {
				return true
			}
			// Match word followed by a sentence-ending character (".", "!")
			// ONLY when the remainder after the prefix is whitespace-only.
			// This prevents false positives like "done. Now we should also
			// check..." from being treated as a completion signal.
			for _, suffix := range []string{".", "!"} {
				prefixed := word + suffix
				if strings.HasPrefix(trimmed, prefixed) {
					rest := trimmed[len(prefixed):]
					if strings.TrimSpace(rest) == "" {
						return true
					}
				}
			}
		}
	}
	return false
}

// matchDecisionKeyword checks for standalone plan-approval decision keywords.
func matchDecisionKeyword(textLower string) bool {
	if len(textLower) > 40 {
		return false
	}
	for _, kw := range []string{"yes", "no", "approve", "approved", "reject", "rejected", "deny", "denied"} {
		if strings.TrimSpace(textLower) == kw {
			return true
		}
	}
	return false
}

// isFinishDispatch checks whether a dispatch event is a termination signal
// with no actual sub-task work to perform.
func isFinishDispatch(evt dispatchEvent) bool {
	taskLower := strings.ToLower(strings.TrimSpace(evt.Task))
	if taskLower == "" {
		return true
	}
	for _, w := range []string{"done", "finish", "complete", "finished", "completed", "all done", "all tasks done"} {
		if taskLower == w {
			return true
		}
	}
	return false
}

// allSameAgent checks whether all dispatch events target the same agent name.
func allSameAgent(events []dispatchEvent) bool {
	if len(events) <= 1 {
		return false
	}
	first := events[0].Agent
	for _, evt := range events[1:] {
		if evt.Agent != first {
			return false
		}
	}
	return true
}
