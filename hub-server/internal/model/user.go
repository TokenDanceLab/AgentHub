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

	// TokenDanceSub is the subject claim from TokenDance ID OIDC.
	// Used to map TokenDance identity to Hub user account.
	// NULL for users who registered with username/password.
	TokenDanceSub *string `gorm:"column:tokendance_sub;uniqueIndex:idx_users_tokendance_sub,where:tokendance_sub IS NOT NULL AND tokendance_sub != ''" json:"tokendance_sub,omitempty"`

	// TokenDanceSubLinkedAt records when the TokenDance sub was first linked.
	TokenDanceSubLinkedAt *time.Time `gorm:"column:tokendance_sub_linked_at" json:"tokendance_sub_linked_at,omitempty"`

	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (u *User) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	u.ID = id
	return nil
}
