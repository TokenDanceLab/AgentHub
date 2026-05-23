package model

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/pkg/uuidv7"
)

type CustomAgent struct {
	ID             string     `gorm:"primaryKey;type:uuid" json:"id"`
	OwnerUserID    string     `gorm:"type:uuid;not null" json:"owner_user_id"`
	Name           string     `gorm:"type:varchar(64);not null" json:"name"`
	AvatarURL      string     `gorm:"type:varchar(512)" json:"avatar_url,omitempty"`
	AgentType      string     `gorm:"type:varchar(64);not null" json:"agent_type"`
	SystemPrompt   string     `gorm:"type:text;not null" json:"system_prompt"`
	CapabilityTags string     `gorm:"type:jsonb;default:'[]'" json:"capability_tags,omitempty"`
	ToolWhitelist  string     `gorm:"type:jsonb;default:'[]'" json:"tool_whitelist,omitempty"`
	ModelParams    string     `gorm:"type:jsonb;default:'[]'" json:"model_params,omitempty"`
	DeletedAt      *time.Time `gorm:"type:timestamptz" json:"deleted_at,omitempty"`
	CreatedAt      time.Time  `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt      time.Time  `gorm:"autoUpdateTime" json:"updated_at"`
}

func (c *CustomAgent) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	c.ID = id
	return nil
}
