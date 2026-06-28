package runnerctx

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"
)

// PromptVersion records metadata for a system prompt version so that
// downstream CI gates, A/B testing, and prompt registry tooling can
// identify and compare prompts deterministically.
type PromptVersion struct {
	ID          string    `json:"id"`          // unique version identifier (e.g. "orchestrator-v3")
	Version     int       `json:"version"`     // monotonically increasing
	Created     time.Time `json:"created"`
	Author      string    `json:"author"`      // "agent-hub/edge-server"
	ModelTarget string    `json:"modelTarget"` // "claude-opus-4-8" or "any"
	Checksum    string    `json:"checksum"`    // sha256 of the prompt text
}

// ComputePromptChecksum returns the hex-encoded SHA-256 digest of prompt.
func ComputePromptChecksum(prompt string) string {
	h := sha256.Sum256([]byte(prompt))
	return hex.EncodeToString(h[:])
}

// Version returns a human-readable display string for this prompt version.
func (pv PromptVersion) VersionDisplay() string {
	return fmt.Sprintf("%s (v%d, %s)", pv.ID, pv.Version, pv.Created.Format(time.RFC3339))
}
