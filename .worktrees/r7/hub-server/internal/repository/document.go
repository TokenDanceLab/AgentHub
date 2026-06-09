package repository

import (
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

// CreateDocument inserts a new document.
func CreateDocument(db *gorm.DB, doc *model.Document) error {
	return db.Create(doc).Error
}

// GetDocumentByID returns a single document by ID.
func GetDocumentByID(db *gorm.DB, id string) (*model.Document, error) {
	var doc model.Document
	err := db.Where("id = ?", id).First(&doc).Error
	return &doc, err
}

// ListDocumentsByOwner returns documents owned by a user, applying optional filters.
func ListDocumentsByOwner(db *gorm.DB, ownerID, status, source, after string, limit int) ([]model.Document, error) {
	q := db.Where("owner_id = ?", ownerID)
	q = applyDocumentFilters(q, status, source)
	q = applyDocumentPagination(q, after)
	if limit > 0 {
		q = q.Limit(limit)
	}
	var docs []model.Document
	err := q.Order("created_at DESC").Find(&docs).Error
	return docs, err
}

// ListAllDocuments returns all documents (admin use) with optional filters.
func ListAllDocuments(db *gorm.DB, status, source, after string, limit int) ([]model.Document, error) {
	q := db.Model(&model.Document{})
	q = applyDocumentFilters(q, status, source)
	q = applyDocumentPagination(q, after)
	if limit > 0 {
		q = q.Limit(limit)
	}
	var docs []model.Document
	err := q.Order("created_at DESC").Find(&docs).Error
	return docs, err
}

// UpdateDocument patches a document by ID.
func UpdateDocument(db *gorm.DB, id string, patch map[string]interface{}) error {
	return db.Model(&model.Document{}).Where("id = ?", id).Updates(patch).Error
}

// SoftDeleteDocument sets status to 'deleted'.
func SoftDeleteDocument(db *gorm.DB, id string) error {
	return db.Model(&model.Document{}).Where("id = ?", id).Update("status", model.DocumentStatusDeleted).Error
}

// --- helpers ---

func applyDocumentFilters(q *gorm.DB, status, source string) *gorm.DB {
	if status != "" {
		q = q.Where("status = ?", status)
	} else {
		q = q.Where("status != ?", model.DocumentStatusDeleted)
	}
	if source != "" {
		q = q.Where("source = ?", source)
	}
	return q
}

func applyDocumentPagination(q *gorm.DB, after string) *gorm.DB {
	if after != "" {
		q = q.Where("created_at < (SELECT created_at FROM documents WHERE id = ?)", after)
	}
	return q
}
