package model

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/pkg/uuidv7"
)

const (
	SenderTypeUser  = "user"
	SenderTypeAgent = "agent"

	ContentTypeText       = "text"
	ContentTypeCode       = "code"
	ContentTypeDiff       = "diff"
	ContentTypeImage      = "image"
	ContentTypeFile       = "file"
	ContentTypeLinkCard   = "link_card"
	ContentTypeDeployCard = "deploy_card"
)

type Message struct {
	ID           string    `gorm:"primaryKey;type:uuid" json:"id"`
	SessionID    string    `gorm:"type:uuid;not null" json:"session_id"`
	SeqID        int64     `gorm:"not null" json:"seq_id"`
	ClientMsgID  string    `gorm:"type:uuid;not null" json:"client_msg_id"`
	SenderType   string    `gorm:"type:varchar(16);not null" json:"sender_type"`
	SenderID     string    `gorm:"type:uuid;not null" json:"sender_id"`
	ContentType  string    `gorm:"type:varchar(32);not null" json:"content_type"`
	Content      string    `gorm:"type:jsonb;not null" json:"content"`
	ReplyToMsgID *string   `gorm:"type:uuid;column:reply_to_message_id" json:"reply_to_message_id,omitempty"`
	Recalled     bool      `gorm:"not null;default:false" json:"recalled"`
	CreatedAt    time.Time `gorm:"autoCreateTime" json:"created_at"`
}

func (m *Message) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	m.ID = id
	return nil
}
