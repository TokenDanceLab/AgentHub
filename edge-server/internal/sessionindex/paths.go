package sessionindex

import (
	"os"
	"path/filepath"
	"strings"
)

// DefaultHome returns the process user home directory, or empty on failure.
func DefaultHome() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return home
}

// ResolveClaudeCodeSessionsDir returns the default Claude Code projects root.
// envOverride, when non-empty, is treated as the config dir (e.g. CLAUDE_CONFIG_DIR)
// and wins over home.
func ResolveClaudeCodeSessionsDir(home, envOverride string) string {
	if envOverride != "" {
		return filepath.Join(envOverride, "projects")
	}
	if home == "" {
		return ""
	}
	return filepath.Join(home, ".claude", "projects")
}

// ResolveClaudeCodeHistoryPath returns the history.jsonl path used for titles.
func ResolveClaudeCodeHistoryPath(home, envOverride string) string {
	if envOverride != "" {
		return filepath.Join(envOverride, "history.jsonl")
	}
	if home == "" {
		return ""
	}
	return filepath.Join(home, ".claude", "history.jsonl")
}

// ResolveCodexSessionsDir returns the default Codex sessions root.
// envOverride is CODEX_HOME-style config root when non-empty.
func ResolveCodexSessionsDir(home, envOverride string) string {
	if envOverride != "" {
		return filepath.Join(envOverride, "sessions")
	}
	if home == "" {
		return ""
	}
	return filepath.Join(home, ".codex", "sessions")
}

// ResolveCodexSessionIndexPath returns the optional session_index.jsonl path.
func ResolveCodexSessionIndexPath(home, envOverride string) string {
	if envOverride != "" {
		return filepath.Join(envOverride, "session_index.jsonl")
	}
	if home == "" {
		return ""
	}
	return filepath.Join(home, ".codex", "session_index.jsonl")
}

// ResolveOpenCodeSessionsDir is a stub-ready path for future OpenCode support.
// Returns empty-usable conventional path; ListRecent skips when no parser data.
func ResolveOpenCodeSessionsDir(home, envOverride string) string {
	if envOverride != "" {
		return filepath.Join(envOverride, "sessions")
	}
	if home == "" {
		return ""
	}
	// Stub: conventional layout not yet productized.
	return filepath.Join(home, ".opencode", "sessions")
}

// EnvClaudeConfigDir reads CLAUDE_CONFIG_DIR when set.
func EnvClaudeConfigDir() string {
	return strings.TrimSpace(os.Getenv("CLAUDE_CONFIG_DIR"))
}

// EnvCodexHome reads CODEX_HOME when set.
func EnvCodexHome() string {
	return strings.TrimSpace(os.Getenv("CODEX_HOME"))
}
