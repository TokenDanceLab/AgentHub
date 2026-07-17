package im

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/model"
)

func TestIsValidContentType(t *testing.T) {
	assert.True(t, IsValidContentType(model.ContentTypeText))
	assert.True(t, IsValidContentType(model.ContentTypeFile))
	assert.True(t, IsValidContentType(model.ContentTypeDeployCard))
	assert.False(t, IsValidContentType(""))
	assert.False(t, IsValidContentType("unknown"))
}

func TestNormalizeMessageContent_TextWraps(t *testing.T) {
	got, err := NormalizeMessageContent(model.ContentTypeText, "hello")
	require.NoError(t, err)

	var payload map[string]string
	require.NoError(t, json.Unmarshal([]byte(got), &payload))
	assert.Equal(t, "hello", payload["text"])
}

func TestNormalizeMessageContent_CodeRequiresText(t *testing.T) {
	_, err := NormalizeMessageContent(model.ContentTypeCode, `{"lang":"go"}`)
	require.Error(t, err)

	got, err := NormalizeMessageContent(model.ContentTypeCode, `{"text":"fmt.Println()","lang":"go"}`)
	require.NoError(t, err)
	assert.Contains(t, got, `"text":"fmt.Println()"`)
}

func TestNormalizeMessageContent_ImageAcceptsAttachmentOrURL(t *testing.T) {
	got, err := NormalizeMessageContent(model.ContentTypeImage, `{"attachment_id":"11111111-1111-1111-1111-111111111111"}`)
	require.NoError(t, err)
	assert.Contains(t, got, "attachment_id")

	got, err = NormalizeMessageContent(model.ContentTypeImage, `{"url":"https://example.com/a.png"}`)
	require.NoError(t, err)
	assert.Contains(t, got, "url")

	_, err = NormalizeMessageContent(model.ContentTypeImage, `{"caption":"x"}`)
	require.Error(t, err)
}

func TestAttachmentIDsFromContent(t *testing.T) {
	ids, ok := AttachmentIDsFromContent(model.ContentTypeText, "hello")
	assert.True(t, ok)
	assert.Nil(t, ids)

	ids, ok = AttachmentIDsFromContent(model.ContentTypeFile, `{"attachment_id":"11111111-1111-1111-1111-111111111111"}`)
	assert.True(t, ok)
	require.Len(t, ids, 1)
	assert.Equal(t, "11111111-1111-1111-1111-111111111111", ids[0])

	ids, ok = AttachmentIDsFromContent(model.ContentTypeImage, `{"attachment_ids":["11111111-1111-1111-1111-111111111111","11111111-1111-1111-1111-111111111111"],"attachments":[{"id":"22222222-2222-2222-2222-222222222222"}]}`)
	assert.True(t, ok)
	require.Len(t, ids, 2)

	_, ok = AttachmentIDsFromContent(model.ContentTypeFile, `{"attachment_id":"not-a-uuid"}`)
	assert.False(t, ok)
}
