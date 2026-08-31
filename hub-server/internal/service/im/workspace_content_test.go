package im

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/model"
)

func TestNormalizeStructuredTextContent(t *testing.T) {
	got, ok, err := normalizeStructuredTextContent(`{"text":"hello","metadata":{"k":"v"}}`)
	require.NoError(t, err)
	assert.True(t, ok)
	var payload map[string]any
	require.NoError(t, json.Unmarshal([]byte(got), &payload))
	assert.Equal(t, "hello", payload["text"])

	_, ok, err = normalizeStructuredTextContent("plain text")
	require.NoError(t, err)
	assert.False(t, ok)

	_, ok, err = normalizeStructuredTextContent(`{"text":"  "}`)
	require.Error(t, err)
	assert.True(t, ok)

	_, ok, err = normalizeStructuredTextContent(`{"text":"hi","metadata":[]}`)
	require.Error(t, err)
	assert.True(t, ok)
}

func TestNormalizeWorkspaceThreadMessageContent(t *testing.T) {
	got, err := NormalizeWorkspaceThreadMessageContent(model.ContentTypeText, "hello")
	require.NoError(t, err)
	var payload map[string]string
	require.NoError(t, json.Unmarshal([]byte(got), &payload))
	assert.Equal(t, "hello", payload["text"])

	got, err = NormalizeWorkspaceThreadMessageContent(model.ContentTypeText, `{"text":"structured"}`)
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal([]byte(got), &payload))
	assert.Equal(t, "structured", payload["text"])

	got, err = NormalizeWorkspaceThreadMessageContent(model.ContentTypeCode, `{"text":"fmt.Println()"}`)
	require.NoError(t, err)
	assert.Contains(t, got, "fmt.Println()")

	_, err = NormalizeWorkspaceThreadMessageContent(model.ContentTypeText, `{"text":""}`)
	require.Error(t, err)
}
