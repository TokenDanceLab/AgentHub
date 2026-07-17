package im

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeRequiredName(t *testing.T) {
	got, err := NormalizeRequiredName("  AgentHub Demo  ")
	require.NoError(t, err)
	assert.Equal(t, "AgentHub Demo", got)

	_, err = NormalizeRequiredName("   ")
	require.Error(t, err)

	_, err = NormalizeRequiredName("")
	require.Error(t, err)
}

func TestNormalizeOptionalText(t *testing.T) {
	assert.Equal(t, "E2E workspace", NormalizeOptionalText("  E2E workspace  "))
	assert.Equal(t, "", NormalizeOptionalText("   "))
	assert.Equal(t, "", NormalizeOptionalText(""))
}
