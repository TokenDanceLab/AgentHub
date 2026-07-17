package im

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/model"
)

func TestNormalizeMessageReaction(t *testing.T) {
	got, err := NormalizeMessageReaction("  heart  ")
	require.NoError(t, err)
	assert.Equal(t, "heart", got)

	_, err = NormalizeMessageReaction("   ")
	require.Error(t, err)

	_, err = NormalizeMessageReaction(strings.Repeat("x", MaxMessageReactionLength+1))
	require.Error(t, err)

	got, err = NormalizeMessageReaction(strings.Repeat("👍", MaxMessageReactionLength))
	require.NoError(t, err)
	assert.Equal(t, strings.Repeat("👍", MaxMessageReactionLength), got)
}

func TestUserReactedAndReactionCountFor(t *testing.T) {
	assert.True(t, UserReacted([]string{"u1", "u2"}, "u2"))
	assert.False(t, UserReacted([]string{"u1", "u2"}, "u3"))
	assert.False(t, UserReacted(nil, "u1"))

	summaries := []model.ReactionSummary{
		{Reaction: "heart", Count: 2, UserIDs: []string{"u1", "u2"}},
		{Reaction: "thumbs_up", Count: 1, UserIDs: []string{"u3"}},
	}
	count, reacted := ReactionCountFor(summaries, "heart", "u1")
	assert.Equal(t, 2, count)
	assert.True(t, reacted)

	count, reacted = ReactionCountFor(summaries, "heart", "u3")
	assert.Equal(t, 2, count)
	assert.False(t, reacted)

	count, reacted = ReactionCountFor(summaries, "missing", "u1")
	assert.Equal(t, 0, count)
	assert.False(t, reacted)
}
