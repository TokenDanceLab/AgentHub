package model

import (
	"fmt"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/uuidv7"
)

type ProviderBinding struct {
	ID          string     `gorm:"primaryKey;type:uuid" json:"id"`
	OwnerID     string     `gorm:"column:owner_id;type:uuid;not null" json:"owner_id"`
	BindingName string     `gorm:"column:binding_name;type:varchar(64);default:''" json:"binding_name,omitempty"`
	Provider    string     `gorm:"column:provider;type:varchar(64);not null" json:"provider"`
	BaseURL     string     `gorm:"column:base_url;type:varchar(512);default:''" json:"base_url,omitempty"`
	IsAvailable bool       `gorm:"column:is_available;default:true" json:"is_available"`
	QuotaUsed   int64      `gorm:"column:quota_used;default:0" json:"quota_used"`
	QuotaLimit  int64      `gorm:"column:quota_limit;default:0" json:"quota_limit"`
	LastChecked *time.Time `gorm:"column:last_checked;type:timestamptz" json:"last_checked,omitempty"`
	Metadata    string     `gorm:"column:metadata;type:jsonb;default:'{}'" json:"metadata,omitempty"`
	CreatedAt   time.Time  `gorm:"column:created_at;autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time  `gorm:"column:updated_at;autoUpdateTime" json:"updated_at"`
}

func (p *ProviderBinding) BeforeCreate(tx *gorm.DB) error {
	if p.ID == "" {
		id, err := uuidv7.New()
		if err != nil {
			return err
		}
		p.ID = id
	}
	return p.Validate()
}

func (p *ProviderBinding) BeforeSave(tx *gorm.DB) error {
	return p.Validate()
}

// Validate checks JSONB fields and rejects credential-like patterns in base_url.
func (p *ProviderBinding) Validate() error {
	if p.Metadata != "" && p.Metadata != "{}" && !isJSONObject(p.Metadata) {
		return fmt.Errorf("metadata must be a JSON object")
	}

	// Security: check base_url doesn't contain embedded credentials
	if p.BaseURL != "" {
		for _, pattern := range []string{"@", "token=", "key=", "secret="} {
			if containsSubstr(p.BaseURL, pattern) {
				return fmt.Errorf("base_url must not contain credentials")
			}
		}
	}

	return nil
}

// containsSubstr checks whether s contains substr.
func containsSubstr(s, substr string) bool {
	if len(substr) == 0 {
		return false
	}
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
