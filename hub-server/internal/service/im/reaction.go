package im

import (
	"fmt"
	"strings"

	"github.com/agenthub/hub-server/internal/model"
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

// UserReacted reports whether userID appears in a reaction summary's UserIDs.
func UserReacted(userIDs []string, userID string) bool {
	for _, reactedUserID := range userIDs {
		if reactedUserID == userID {
			return true
		}
	}
	return false
}

// ReactionCountFor returns the count and reacted-by-me flag for one reaction
// key from a summary list. Missing keys yield (0, false).
func ReactionCountFor(summaries []model.ReactionSummary, reaction, userID string) (count int, reactedByMe bool) {
	for _, summary := range summaries {
		if summary.Reaction != reaction {
			continue
		}
		return summary.Count, UserReacted(summary.UserIDs, userID)
	}
	return 0, false
}
