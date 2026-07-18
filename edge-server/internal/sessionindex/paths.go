package sessionindex

import (
	"path/filepath"
	"runtime"
)

// ResolveClaudeCodeSessionsDir returns the default Claude Code projects/sessions root.
// envOverride, when non-empty, wins (caller supplies CLAUDE_CONFIG_DIR or similar).
func ResolveClaudeCodeSessionsDir(home, envOverride string) string {
	if envOverride != "" {
		return filepath.Join(envOverride, "projects")
	}
	if home == "" {
		return ""
	}
	if runtime.GOOS == "windows" {
		return filepath.Join(home, ".claude", "projects")
	}
	return filepath.Join(home, ".claude", "projects")
}

// ResolveCodexSessionsDir returns the default Codex sessions root.
func ResolveCodexSessionsDir(home, envOverride string) string {
	if envOverride != "" {
		return filepath.Join(envOverride, "sessions")
	}
	if home == "" {
		return ""
	}
	if runtime.GOOS == "windows" {
		return filepath.Join(home, ".codex", "sessions")
	}
	return filepath.Join(home, ".codex", "sessions")
}
