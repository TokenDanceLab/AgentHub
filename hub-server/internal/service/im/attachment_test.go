package im

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestIsValidAttachmentHash(t *testing.T) {
	valid := strings.Repeat("ab", 32)
	assert.True(t, IsValidAttachmentHash(valid))
	assert.False(t, IsValidAttachmentHash(""))
	assert.False(t, IsValidAttachmentHash(strings.Repeat("ab", 31)))
	assert.False(t, IsValidAttachmentHash(strings.ToUpper(valid)))
	assert.False(t, IsValidAttachmentHash(strings.Repeat("zz", 32)))
}

func TestPathFromHash(t *testing.T) {
	hash := strings.Repeat("ab", 32)
	got := PathFromHash(hash)
	assert.Equal(t, "uploads/ab/ab/"+hash, got)
	assert.Equal(t, "", PathFromHash("bad"))
}

func TestNormalizeAttachmentMetadataJSON(t *testing.T) {
	got, err := NormalizeAttachmentMetadataJSON("")
	require.NoError(t, err)
	assert.Equal(t, "{}", got)

	got, err = NormalizeAttachmentMetadataJSON(`{"width": 10, "height": 20}`)
	require.NoError(t, err)
	var payload map[string]interface{}
	require.NoError(t, json.Unmarshal([]byte(got), &payload))
	assert.Equal(t, float64(10), payload["width"])
	assert.Equal(t, float64(20), payload["height"])

	_, err = NormalizeAttachmentMetadataJSON(`[]`)
	require.Error(t, err)

	_, err = NormalizeAttachmentMetadataJSON(`not-json`)
	require.Error(t, err)
}
