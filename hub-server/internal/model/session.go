package model

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/pkg/uuidv7"
)

const (
	SessionTypePrivate = "private"
	SessionTypeGroup   = "group"
)

type Session struct {
	ID            string     `gorm:"primaryKey;type:uuid" json:"id"`
	Type          string     `gorm:"type:varchar(16);not null" json:"type"`
	Name          string     `gorm:"type:varchar(64)" json:"name,omitempty"`
	AvatarURL     string     `gorm:"type:varchar(512)" json:"avatar_url,omitempty"`
	Announcement  string     `gorm:"type:text" json:"announcement,omitempty"`
	OwnerUserID   *string    `gorm:"type:uuid" json:"owner_user_id,omitempty"`
	NextSeq       int64      `gorm:"not null;default:0" json:"next_seq"`
	LastMessageAt *time.Time `gorm:"type:timestamptz" json:"last_message_at,omitempty"`
	Dissolved     bool       `gorm:"not null;default:false" json:"dissolved"`
	CreatedAt     time.Time  `gorm:"autoCreateTime" json:"created_at"`
}

func (s *Session) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	s.ID = id
	return nil
}
