package model

import "time"

type MessageAttachment struct {
	SessionID    string    `gorm:"type:uuid;not null;index:idx_message_attachments_session_attachment,priority:1" json:"session_id"`
	MessageID    string    `gorm:"primaryKey;type:uuid" json:"message_id"`
	AttachmentID string    `gorm:"primaryKey;type:uuid;index:idx_message_attachments_attachment_id;index:idx_message_attachments_session_attachment,priority:2" json:"attachment_id"`
	CreatedAt    time.Time `gorm:"autoCreateTime" json:"created_at"`
}
