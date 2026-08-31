package repository

import (
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
)

// CreateDocument inserts a new document record.
func CreateDocument(db *gorm.DB, doc *model.Document) error {
	return db.Create(doc).Error
}

// GetDocumentByID returns a single document by its primary key.
func GetDocumentByID(db *gorm.DB, id string) (*model.Document, error) {
	var doc model.Document
	err := db.Where("id = ?", id).First(&doc).Error
	if err != nil {
		return nil, err
	}
	return &doc, nil
}

// ListDocumentsByOwner returns documents owned by the given user, applying
// the provided filter for pagination and source filtering.
func ListDocumentsByOwner(db *gorm.DB, ownerID string, filter model.DocumentFilter) ([]model.Document, error) {
	if filter.Limit <= 0 {
		filter.Limit = 50
	}
	if filter.Limit > config.MaxPageLimit {
		// #2136 P1: repo cap was 200 while the API layer accepts up to
		// MaxPageLimit=500; align so the declared contract holds.
		filter.Limit = config.MaxPageLimit
	}

	q := db.Where("owner_id = ? AND status = ?", ownerID, model.DocumentStatusActive)

	if filter.Source != "" {
		q = q.Where("source = ?", filter.Source)
	}
	if filter.Search != "" {
		q = q.Where("title ILIKE ?", "%"+filter.Search+"%")
	}
	if filter.After != "" {
		q = q.Where("created_at < ?", filter.After)
	}

	var docs []model.Document
	err := q.Order("created_at DESC").Limit(filter.Limit).Find(&docs).Error
	return docs, err
}

// UpdateDocument applies a partial update patch to the document with the given ID.
func UpdateDocument(db *gorm.DB, id string, patch map[string]interface{}) error {
	result := db.Model(&model.Document{}).Where("id = ?", id).Updates(patch)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// SoftDeleteDocument marks a document as deleted by setting status.
func SoftDeleteDocument(db *gorm.DB, id string) error {
	result := db.Model(&model.Document{}).
		Where("id = ? AND status = ?", id, model.DocumentStatusActive).
		Update("status", model.DocumentStatusDeleted)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
