package model

import (
	"encoding/json"
	"fmt"
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
	return c.validateJSONB()
}

func (c *CustomAgent) BeforeSave(tx *gorm.DB) error {
	if err := c.normalizeJSONB(); err != nil {
		return err
	}
	return c.validateJSONB()
}

func (c *CustomAgent) normalizeJSONB() error {
	// Normalize JSONB fields by unmarshaling and re-marshaling to compact form.
	if c.CapabilityTags != "" {
		normalized, err := normalizeJSONValue(c.CapabilityTags)
		if err != nil {
			return fmt.Errorf("invalid JSON in capability_tags: %w", err)
		}
		c.CapabilityTags = normalized
	}
	if c.ToolWhitelist != "" {
		normalized, err := normalizeJSONValue(c.ToolWhitelist)
		if err != nil {
			return fmt.Errorf("invalid JSON in tool_whitelist: %w", err)
		}
		c.ToolWhitelist = normalized
	}
	if c.ModelParams != "" {
		normalized, err := normalizeJSONValue(c.ModelParams)
		if err != nil {
			return fmt.Errorf("invalid JSON in model_params: %w", err)
		}
		c.ModelParams = normalized
	}
	return nil
}

func normalizeJSONValue(raw string) (string, error) {
	var v any
	if err := json.Unmarshal([]byte(raw), &v); err != nil {
		return "", err
	}
	normalized, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return string(normalized), nil
}

func (c *CustomAgent) Validate() error {
	return c.validateJSONB()
}

func (c *CustomAgent) validateJSONB() error {
	for _, field := range []struct {
		name      string
		value     string
		wantArray bool
	}{
		{"capability_tags", c.CapabilityTags, true},
		{"tool_whitelist", c.ToolWhitelist, true},
		{"model_params", c.ModelParams, false},
	} {
		if field.value == "" {
			continue
		}
		var decoded any
		if err := json.Unmarshal([]byte(field.value), &decoded); err != nil {
			return fmt.Errorf("invalid JSON in %s: %w", field.name, err)
		}
		if field.wantArray {
			if _, ok := decoded.([]any); !ok {
				return fmt.Errorf("%s must be a JSON array", field.name)
			}
			continue
		}
		if _, ok := decoded.(map[string]any); !ok {
			return fmt.Errorf("%s must be a JSON object", field.name)
		}
	}
	return nil
}
