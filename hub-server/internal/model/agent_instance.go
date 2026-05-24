package model

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/pkg/uuidv7"
)

type AgentInstance struct {
	ID            string    `gorm:"primaryKey;type:uuid" json:"id"`
	AgentType     string    `gorm:"type:varchar(64);not null" json:"agent_type"`
	CustomAgentID *string   `gorm:"type:uuid" json:"custom_agent_id,omitempty"`
	SessionID     string    `gorm:"type:uuid;not null" json:"session_id"`
	InviterUserID string    `gorm:"type:uuid;not null" json:"inviter_user_id"`
	WorkspaceID   *string   `gorm:"type:uuid" json:"workspace_id,omitempty"`
	DisplayName   string    `gorm:"type:varchar(64);not null" json:"display_name"`
	CreatedAt     time.Time `gorm:"autoCreateTime" json:"created_at"`
}

func (a *AgentInstance) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	a.ID = id
	return nil
}
