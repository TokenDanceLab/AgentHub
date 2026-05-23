package model

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/pkg/uuidv7"
)

const (
	TypeMention       = "mention"
	TypeFriendRequest = "friend_request"
	TypeGroupInvite   = "group_invite"
	TypeAgentDone     = "agent_done"
	TypeSystem        = "system"
)

type Notification struct {
	ID        string    `gorm:"primaryKey;type:uuid" json:"id"`
	UserID    string    `gorm:"type:uuid;not null" json:"user_id"`
	Type      string    `gorm:"type:varchar(32);not null" json:"type"`
	Payload   string    `gorm:"type:jsonb;not null" json:"payload"`
	Read      bool      `gorm:"not null;default:false" json:"read"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
}

func (n *Notification) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	n.ID = id
	return nil
}
