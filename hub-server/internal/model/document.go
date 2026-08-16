package model

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/uuidv7"
)

const (
	DocumentStatusActive  = "active"
	DocumentStatusDeleted = "deleted"

	DocumentSourceUser     = "user"
	DocumentSourceArtifact = "artifact"
)

// Document represents a cloud document owned by a user or projected from an artifact.
type Document struct {
	ID        string    `gorm:"primaryKey;type:uuid" json:"id"`
	OwnerID   string    `gorm:"type:uuid;not null;index" json:"owner_id"`
	ProjectID *string   `gorm:"type:uuid" json:"project_id,omitempty"`
	Title     string    `gorm:"type:varchar(500);not null" json:"title"`
	Type      string    `gorm:"type:varchar(32);not null;default:'md'" json:"type"`
	Source    string    `gorm:"type:varchar(32);not null" json:"source"`
	SourceRef *string   `gorm:"type:varchar(256)" json:"source_ref,omitempty"`
	Tag       *string   `gorm:"type:varchar(64)" json:"tag,omitempty"`
	Location  string    `gorm:"type:varchar(128);not null;default:'我的文档库'" json:"location"`
	Content   *string   `gorm:"type:text" json:"content,omitempty"`
	Status    string    `gorm:"type:varchar(32);not null;default:'active'" json:"status"`
	Metadata  string    `gorm:"type:jsonb;not null;default:'{}'" json:"metadata,omitempty"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (d *Document) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	d.ID = id
	return nil
}

// ToListItem converts a Document to a DocumentListItem (omits large content field).
func (d *Document) ToListItem() DocumentListItem {
	return DocumentListItem{
		ID:        d.ID,
		OwnerID:   d.OwnerID,
		Title:     d.Title,
		Type:      d.Type,
		Source:    d.Source,
		SourceRef: d.SourceRef,
		Tag:       d.Tag,
		Location:  d.Location,
		Status:    d.Status,
		CreatedAt: d.CreatedAt,
		UpdatedAt: d.UpdatedAt,
	}
}

// DocumentFilter holds query parameters for listing documents.
type DocumentFilter struct {
	Limit  int    `json:"limit" form:"limit"`
	After  string `json:"after" form:"after"`
	Source string `json:"source" form:"source"`
	Search string `json:"search" form:"search"`
}

// DocumentListItem is a lightweight document representation for list responses.
type DocumentListItem struct {
	ID        string    `json:"id"`
	OwnerID   string    `json:"owner_id"`
	Title     string    `json:"title"`
	Type      string    `json:"type"`
	Source    string    `json:"source"`
	SourceRef *string   `json:"source_ref,omitempty"`
	Tag       *string   `json:"tag,omitempty"`
	Location  string    `json:"location"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
