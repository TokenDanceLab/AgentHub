package model

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/uuidv7"
)

type User struct {
	ID           string  `gorm:"primaryKey;type:uuid" json:"id"`
	Username     string  `gorm:"type:varchar(64);uniqueIndex;not null" json:"username"`
	PasswordHash *string `gorm:"type:varchar(128)" json:"-"`
	Nickname     string  `gorm:"type:varchar(64);not null" json:"nickname"`
	AvatarURL    string  `gorm:"type:varchar(512)" json:"avatar_url,omitempty"`

	// TokenDanceSub is retained only as legacy audit data from the retired
	// TokenDance ID provider. It is never used to authenticate or claim an
	// Account identity.
	TokenDanceSub *string `gorm:"column:tokendance_sub;uniqueIndex:idx_users_tokendance_sub,where:tokendance_sub IS NOT NULL AND tokendance_sub != ''" json:"-"`

	// TokenDanceSubLinkedAt records when the legacy identity was linked.
	TokenDanceSubLinkedAt *time.Time `gorm:"column:tokendance_sub_linked_at" json:"-"`

	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (u *User) BeforeCreate(tx *gorm.DB) error {
	if u.ID != "" {
		return nil
	}
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	u.ID = id
	return nil
}
