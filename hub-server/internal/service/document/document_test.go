package document

import (
	"context"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/model"
)

func newDocumentTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Document{}))
	return db
}

// seedDocument inserts a document with a fixed ID via raw SQL so the
// BeforeCreate hook does not overwrite it.
func seedDocument(t *testing.T, db *gorm.DB, id, ownerID, title string) {
	t.Helper()
	err := db.Exec(
		`INSERT INTO documents (id, owner_id, title, type, source, location, status, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id, ownerID, title, "md", model.DocumentSourceUser, "我的文档库", model.DocumentStatusActive, "{}",
	).Error
	require.NoError(t, err)
}

// TestDocumentGetIsOwnerScoped ensures a non-owner receives DocNotFound when
// reading another user's document (#2100 P1 audit).
func TestDocumentGetIsOwnerScoped(t *testing.T) {
	db := newDocumentTestDB(t)
	seedDocument(t, db, "doc-1", "owner-1", "Owner One Notes")
	svc := NewService(db)

	got, err := svc.GetDocument(context.Background(), "owner-1", "doc-1")
	require.NoError(t, err)
	require.Equal(t, "doc-1", got.ID)

	_, err = svc.GetDocument(context.Background(), "other-owner", "doc-1")
	require.ErrorIs(t, err, errcode.DocNotFound)
}

// TestDocumentUpdateIsOwnerScoped ensures PATCH by a non-owner returns
// DocNotFound and does not mutate the row (#2100 P1 audit).
func TestDocumentUpdateIsOwnerScoped(t *testing.T) {
	db := newDocumentTestDB(t)
	seedDocument(t, db, "doc-1", "owner-1", "Original Title")
	svc := NewService(db)

	newTitle := "Hijacked Title"
	_, err := svc.UpdateDocument(context.Background(), "other-owner", "doc-1", &newTitle, nil, nil, nil)
	require.ErrorIs(t, err, errcode.DocNotFound)

	var doc model.Document
	require.NoError(t, db.Where("id = ?", "doc-1").First(&doc).Error)
	require.Equal(t, "Original Title", doc.Title, "title must not be mutated by non-owner")
}

// TestDocumentDeleteIsOwnerScoped ensures DELETE by a non-owner returns
// DocNotFound and leaves the row intact (#2100 P1 audit).
func TestDocumentDeleteIsOwnerScoped(t *testing.T) {
	db := newDocumentTestDB(t)
	seedDocument(t, db, "doc-1", "owner-1", "Owner One Notes")
	svc := NewService(db)

	err := svc.DeleteDocument(context.Background(), "other-owner", "doc-1")
	require.ErrorIs(t, err, errcode.DocNotFound)

	var doc model.Document
	require.NoError(t, db.Where("id = ?", "doc-1").First(&doc).Error)
	require.Equal(t, model.DocumentStatusActive, doc.Status, "document must not be soft-deleted by non-owner")
}
