package model

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/pkg/uuidv7"
)

type User struct {
	ID           string    `gorm:"primaryKey;type:uuid" json:"id"`
	Username     string    `gorm:"type:varchar(64);uniqueIndex;not null" json:"username"`
	PasswordHash string    `gorm:"type:varchar(128);not null" json:"-"`
	Nickname     string    `gorm:"type:varchar(64);not null" json:"nickname"`
	AvatarURL    string    `gorm:"type:varchar(512)" json:"avatar_url,omitempty"`
	CreatedAt    time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt    time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (u *User) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	u.ID = id
	return nil
}
