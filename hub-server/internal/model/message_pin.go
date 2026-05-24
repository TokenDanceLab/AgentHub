package model

import "time"

type MessagePin struct {
	SessionID      string    `gorm:"primaryKey;type:uuid" json:"session_id"`
	MessageID      string    `gorm:"primaryKey;type:uuid" json:"message_id"`
	PinnedByUserID string    `gorm:"type:uuid;not null" json:"pinned_by_user_id"`
	PinnedAt       time.Time `gorm:"autoCreateTime" json:"pinned_at"`
}
