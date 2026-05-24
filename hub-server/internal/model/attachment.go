package model

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/pkg/uuidv7"
)

type Attachment struct {
	ID             string    `gorm:"primaryKey;type:uuid" json:"id"`
	Hash           string    `gorm:"type:varchar(64);uniqueIndex;not null" json:"hash"`
	Size           int64     `gorm:"not null" json:"size"`
	MimeType       string    `gorm:"type:varchar(128);not null" json:"mime_type"`
	OriginalName   string    `gorm:"type:varchar(255)" json:"original_name,omitempty"`
	UploaderUserID string    `gorm:"type:uuid;not null" json:"uploader_user_id"`
	CreatedAt      time.Time `gorm:"autoCreateTime" json:"created_at"`
}

func (a *Attachment) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	a.ID = id
	return nil
}
