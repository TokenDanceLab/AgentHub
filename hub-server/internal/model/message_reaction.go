package model

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/uuidv7"
)

// MessageReaction represents one reaction by one user on one message.
type MessageReaction struct {
	ID        string    `gorm:"primaryKey;type:uuid" json:"id"`
	SessionID string    `gorm:"type:uuid;not null;uniqueIndex:idx_message_reaction_unique,priority:1;index:idx_message_reactions_message,priority:1" json:"session_id"`
	MessageID string    `gorm:"type:uuid;not null;uniqueIndex:idx_message_reaction_unique,priority:2;index:idx_message_reactions_message,priority:2" json:"message_id"`
	UserID    string    `gorm:"type:uuid;not null;uniqueIndex:idx_message_reaction_unique,priority:3;index:idx_message_reactions_user" json:"user_id"`
	Reaction  string    `gorm:"column:emoji;type:varchar(64);not null;uniqueIndex:idx_message_reaction_unique,priority:4" json:"reaction"`
	CreatedAt time.Time `gorm:"autoCreateTime" json:"created_at"`
}

func (m *MessageReaction) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	m.ID = id
	return nil
}

type ReactionSummary struct {
	Reaction string   `json:"reaction"`
	Count    int      `json:"count"`
	UserIDs  []string `json:"user_ids"`
}
