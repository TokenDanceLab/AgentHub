package model

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/uuidv7"
)

const (
	StatusPending  = "pending"
	StatusAccepted = "accepted"
	StatusRejected = "rejected"
	StatusBlocked  = "blocked"
)

type Friendship struct {
	ID             string    `gorm:"primaryKey;type:uuid" json:"id"`
	UserID         string    `gorm:"type:uuid;not null;index:idx_friendships_user_friend,priority:1" json:"user_id"`
	FriendID       string    `gorm:"type:uuid;not null;index:idx_friendships_user_friend,priority:2" json:"friend_id"`
	Status         string    `gorm:"type:varchar(16);not null;index:idx_friendships_user_friend,priority:3" json:"status"`
	Remark         string    `gorm:"type:varchar(64)" json:"remark,omitempty"`
	RequestMessage string    `gorm:"type:varchar(255)" json:"request_message,omitempty"`
	CreatedAt      time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt      time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (f *Friendship) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	f.ID = id
	return nil
}
