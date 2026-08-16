package model

import (
	"fmt"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/uuidv7"
)

type Skill struct {
	ID           string     `gorm:"primaryKey;type:uuid" json:"id"`
	OwnerID      string     `gorm:"column:owner_id;type:uuid;not null" json:"owner_id"`
	Name         string     `gorm:"column:name;type:varchar(128);not null" json:"name"`
	Description  string     `gorm:"column:description;type:text" json:"description,omitempty"`
	SkillType    string     `gorm:"column:skill_type;type:varchar(32);not null;default:agent_skill" json:"skill_type"`
	RuntimeIDs   string     `gorm:"column:runtime_ids;type:jsonb;default:'[]'" json:"runtime_ids,omitempty"`
	EntryPoint   string     `gorm:"column:entry_point;type:varchar(512)" json:"entry_point,omitempty"`
	ConfigSchema string     `gorm:"column:config_schema;type:jsonb;default:'{}'" json:"config_schema,omitempty"`
	IsPublic     bool       `gorm:"column:is_public;default:false" json:"is_public"`
	Version      string     `gorm:"column:version;type:varchar(32);default:1.0.0" json:"version,omitempty"`
	InstallCount int        `gorm:"column:install_count;default:0" json:"install_count,omitempty"`
	CreatedAt    time.Time  `gorm:"column:created_at;autoCreateTime" json:"created_at"`
	UpdatedAt    time.Time  `gorm:"column:updated_at;autoUpdateTime" json:"updated_at"`
	DeletedAt    *time.Time `gorm:"column:deleted_at;type:timestamptz;index" json:"-"`
}

func (s *Skill) BeforeCreate(tx *gorm.DB) error {
	if s.ID == "" {
		id, err := uuidv7.New()
		if err != nil {
			return err
		}
		s.ID = id
	}
	return s.Validate()
}

func (s *Skill) BeforeSave(tx *gorm.DB) error {
	return s.Validate()
}

// Validate checks JSONB fields have correct types.
func (s *Skill) Validate() error {
	if s.RuntimeIDs != "" && !isJSONArray(s.RuntimeIDs) {
		return fmt.Errorf("runtime_ids must be a JSON array")
	}
	if s.ConfigSchema != "" && !isJSONObject(s.ConfigSchema) {
		return fmt.Errorf("config_schema must be a JSON object")
	}
	return nil
}
