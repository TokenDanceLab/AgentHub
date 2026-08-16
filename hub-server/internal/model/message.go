package model

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/uuidv7"
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
	ID           string     `gorm:"primaryKey;type:uuid" json:"id"`
	SessionID    string     `gorm:"type:uuid;not null;index:idx_messages_session_seq,priority:1;uniqueIndex:idx_messages_session_client_msg,priority:1" json:"session_id"`
	SeqID        int64      `gorm:"not null;index:idx_messages_session_seq,priority:2" json:"seq_id"`
	ClientMsgID  string     `gorm:"type:uuid;not null;uniqueIndex:idx_messages_session_client_msg,priority:2" json:"client_msg_id"`
	SenderType   string     `gorm:"type:varchar(16);not null" json:"sender_type"`
	SenderID     string     `gorm:"type:uuid;not null" json:"sender_id"`
	ContentType  string     `gorm:"type:varchar(32);not null" json:"content_type"`
	Content      string     `gorm:"type:jsonb;not null" json:"content"`
	ReplyToMsgID *string    `gorm:"type:uuid;column:reply_to_message_id" json:"reply_to_message_id,omitempty"`
	Recalled     bool       `gorm:"not null;default:false" json:"recalled"`
	Edited       bool       `gorm:"not null;default:false" json:"edited"`
	EditedAt     *time.Time `gorm:"column:edited_at" json:"edited_at,omitempty"`
	CreatedAt    time.Time  `gorm:"autoCreateTime" json:"created_at"`
}

func (m *Message) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	m.ID = id
	return nil
}
