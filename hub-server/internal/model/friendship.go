package model

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/pkg/uuidv7"
)

const (
	StatusPending  = "pending"
	StatusAccepted = "accepted"
	StatusRejected = "rejected"
	StatusBlocked  = "blocked"
)

type Friendship struct {
	ID             string    `gorm:"primaryKey;type:uuid" json:"id"`
	UserID         string    `gorm:"type:uuid;not null" json:"user_id"`
	FriendID       string    `gorm:"type:uuid;not null" json:"friend_id"`
	Status         string    `gorm:"type:varchar(16);not null" json:"status"`
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
