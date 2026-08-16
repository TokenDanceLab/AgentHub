package model

import (
	"fmt"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/uuidv7"
)

type Attachment struct {
	ID             string    `gorm:"primaryKey;type:uuid" json:"id"`
	Hash           string    `gorm:"type:varchar(64);uniqueIndex;not null" json:"hash"`
	Size           int64     `gorm:"not null" json:"size"`
	MimeType       string    `gorm:"type:varchar(128);not null" json:"mime_type"`
	OriginalName   string    `gorm:"type:varchar(255)" json:"original_name,omitempty"`
	UploaderUserID string    `gorm:"type:uuid;not null" json:"uploader_user_id"`
	Metadata       string    `gorm:"type:jsonb;not null;default:'{}'" json:"metadata,omitempty"`
	CreatedAt      time.Time `gorm:"autoCreateTime" json:"created_at"`
}

func (a *Attachment) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	a.ID = id
	return a.Validate()
}

func (a *Attachment) BeforeSave(tx *gorm.DB) error {
	return a.Validate()
}

func (a *Attachment) Validate() error {
	if a.Metadata != "" && !isJSONObject(a.Metadata) {
		return fmt.Errorf("metadata must be a JSON object")
	}
	return nil
}
