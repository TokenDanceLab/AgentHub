package model

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/pkg/uuidv7"
)

// Document source constants.
const (
	DocumentSourceUser     = "user"
	DocumentSourceArtifact = "artifact"
	DocumentSourceUpload   = "upload"
	DocumentSourceExternal = "external"
)

// Document status constants.
const (
	DocumentStatusActive   = "active"
	DocumentStatusArchived = "archived"
	DocumentStatusDeleted  = "deleted"
)

// Document represents a cloud document in the documents table.
type Document struct {
	ID        string    `gorm:"primaryKey;type:uuid" json:"id"`
	OwnerID   string    `gorm:"type:uuid;not null;index:idx_documents_owner" json:"owner_id"`
	ProjectID *string   `gorm:"type:uuid" json:"project_id,omitempty"`
	Title     string    `gorm:"type:varchar(500);not null" json:"title"`
	Type      string    `gorm:"type:varchar(32);not null;default:'md'" json:"type"`
	Source    string    `gorm:"type:varchar(32);not null;default:'user'" json:"source"`
	SourceRef *string   `gorm:"type:varchar(256)" json:"source_ref,omitempty"`
	Tag       *string   `gorm:"type:varchar(64)" json:"tag,omitempty"`
	Location  string    `gorm:"type:varchar(128);not null;default:'我的文档库'" json:"location"`
	Status    string    `gorm:"type:varchar(32);not null;default:'active'" json:"status"`
	Content   *string   `gorm:"type:text" json:"content,omitempty"`
	Metadata  string    `gorm:"type:jsonb;not null;default:'{}'" json:"metadata"`
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

func (Document) TableName() string {
	return "documents"
}

// DocumentFilter holds query parameters for listing documents.
type DocumentFilter struct {
	Status    string `form:"status"`
	Source    string `form:"source"`
	ProjectID string `form:"project_id"`
	Search    string `form:"search"`
	After     string `form:"after"`
	Limit     int    `form:"limit"`
}

// DocumentListItem is the DTO returned in list responses (no content field).
type DocumentListItem struct {
	ID        string    `json:"id"`
	OwnerID   string    `json:"owner_id"`
	ProjectID *string   `json:"project_id,omitempty"`
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

// ToListItem converts a full Document to a list DTO.
func (d *Document) ToListItem() DocumentListItem {
	return DocumentListItem{
		ID:        d.ID,
		OwnerID:   d.OwnerID,
		ProjectID: d.ProjectID,
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
