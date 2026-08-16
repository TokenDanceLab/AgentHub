package model

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/uuidv7"
)

// UserSetting stores a single user preference as a key-value pair.
type UserSetting struct {
	ID        string    `gorm:"primaryKey;type:uuid" json:"id"`
	UserID    string    `gorm:"type:uuid;not null;uniqueIndex:idx_user_settings_user_key" json:"user_id"`
	Key       string    `gorm:"type:varchar(128);not null;uniqueIndex:idx_user_settings_user_key" json:"key"`
	Value     string    `gorm:"type:text;not null" json:"value"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (u *UserSetting) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	u.ID = id
	return nil
}
