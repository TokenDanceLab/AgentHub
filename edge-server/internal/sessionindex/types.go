package sessionindex

// Residual product surface #1173: read-only local runtime session aggregation.

// RuntimeID identifies an installed Agent Runtime family.
type RuntimeID string

const (
	RuntimeClaudeCode RuntimeID = "claude-code"
	RuntimeCodex      RuntimeID = "codex"
	RuntimeOpenCode   RuntimeID = "opencode"
)

// SessionSummary is a normalized import/observed summary. Never mutates source stores.
type SessionSummary struct {
	Runtime   RuntimeID `json:"runtime"`
	ID        string    `json:"id"`
	Title     string    `json:"title,omitempty"`
	Path      string    `json:"path"`
	UpdatedAt string    `json:"updatedAt,omitempty"`
	// SourceMode is always import/observed for foreign session indexes.
	SourceMode string `json:"sourceMode"`
}

// PathResolver maps a home/config root to the sessions directory for a runtime.
type PathResolver func(home string) string
