package repository

import (
	"testing"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// =============================================================================
// Attachment repository tests
// =============================================================================

func TestAttachmentRepo_CreateAndGet(t *testing.T) {
	db := setupSQLite(t)

	a := &model.Attachment{
		Hash:           "abc123hash",
		Size:           2048,
		MimeType:       "image/png",
		OriginalName:   "screenshot.png",
		UploaderUserID: "user-att",
		Metadata:       `{"origin":"test"}`,
	}
	err := CreateAttachment(db, a)
	require.NoError(t, err)
	assert.NotEmpty(t, a.ID)

	// Get by ID
	fetched, err := GetAttachmentByID(db, a.ID)
	require.NoError(t, err)
	assert.Equal(t, "abc123hash", fetched.Hash)
	assert.Equal(t, int64(2048), fetched.Size)
	assert.JSONEq(t, `{"origin":"test"}`, fetched.Metadata)

	// Get by hash
	fetched, err = GetAttachmentByHash(db, "abc123hash")
	require.NoError(t, err)
	assert.Equal(t, a.ID, fetched.ID)

	// Non-existent
	_, err = GetAttachmentByID(db, "nonexistent")
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound)

	_, err = GetAttachmentByHash(db, "nonexistent")
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
}
