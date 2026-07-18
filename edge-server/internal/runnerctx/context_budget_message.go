package runnerctx

// Residual pure-helper peel #1141: message type, sanitization, and context
// preface helpers extracted from context_budget.go. Same package runnerctx;
// zero behavior change.

import (
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"
)

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
