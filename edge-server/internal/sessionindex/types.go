// Package sessionindex provides read-only discovery of local Agent Runtime
// session stores for Desktop import UI. It never mutates third-party stores.
package sessionindex

// Residual product surface #1173: local runtime session aggregation index.

// RuntimeID identifies an installed Agent Runtime family (adapter id).
type RuntimeID string

const (
	RuntimeClaudeCode RuntimeID = "claude-code"
	RuntimeCodex      RuntimeID = "codex"
	RuntimeOpenCode   RuntimeID = "opencode"
)

// SourceModeImport marks a summary as observed from a foreign runtime store
// for explicit import UX (never treated as AgentHub-native ownership).
const SourceModeImport = "import"

// SessionSummary is a normalized import/observed summary. Never mutates source stores.
type SessionSummary struct {
	Runtime    RuntimeID `json:"runtime"`
	ID         string    `json:"id"`
	Title      string    `json:"title,omitempty"`
	Path       string    `json:"path"`
	ProjectKey string    `json:"projectKey,omitempty"`
	UpdatedAt  string    `json:"updatedAt,omitempty"`
	// SourceMode is always import for foreign session indexes.
	SourceMode string `json:"sourceMode"`
}

// PathResolver maps a home/config root to the sessions directory for a runtime.
type PathResolver func(home string) string
