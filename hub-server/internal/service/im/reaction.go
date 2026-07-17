package im

import (
	"fmt"
	"strings"
)

// MaxMessageReactionLength is the maximum rune count for a reaction string.
const MaxMessageReactionLength = 64

// NormalizeMessageReaction trims and validates a reaction string.
// Empty or over-length values return an error (callers map to domain errors).
func NormalizeMessageReaction(reaction string) (string, error) {
	reaction = strings.TrimSpace(reaction)
	if reaction == "" || len([]rune(reaction)) > MaxMessageReactionLength {
		return "", fmt.Errorf("invalid message reaction")
	}
	return reaction, nil
}
