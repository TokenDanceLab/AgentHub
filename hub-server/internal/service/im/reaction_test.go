package im

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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
