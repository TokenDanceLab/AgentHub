package model

import (
	"fmt"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/pkg/uuidv7"
)

type ExecutionTarget struct {
	ID            string     `gorm:"primaryKey;type:uuid" json:"id"`
	OwnerID       string     `gorm:"column:owner_id;type:uuid;not null" json:"owner_id"`
	DeviceID      *string    `gorm:"column:device_id;type:uuid" json:"device_id,omitempty"`
	Name          string     `gorm:"column:name;type:varchar(128);not null" json:"name"`
	TargetType    string     `gorm:"column:target_type;type:varchar(32);not null;default:local_edge" json:"target_type,omitempty"`
	Host          string     `gorm:"column:host;type:varchar(256);default:''" json:"host,omitempty"`
	Port          int        `gorm:"column:port;default:0" json:"port,omitempty"`
	WorkspaceRoot string     `gorm:"column:workspace_root;type:varchar(512);default:''" json:"workspace_root,omitempty"`
	AuthMethod    string     `gorm:"column:auth_method;type:varchar(32);default:''" json:"auth_method,omitempty"`
	IsOnline      bool       `gorm:"column:is_online;default:false" json:"is_online"`
	LastSeenAt    *time.Time `gorm:"column:last_seen_at;type:timestamptz" json:"last_seen_at,omitempty"`
	Capabilities  string     `gorm:"column:capabilities;type:jsonb;default:'{}'" json:"capabilities,omitempty"`
	Metadata      string     `gorm:"column:metadata;type:jsonb;default:'{}'" json:"metadata,omitempty"`
	CreatedAt     time.Time  `gorm:"column:created_at;autoCreateTime" json:"created_at"`
	UpdatedAt     time.Time  `gorm:"column:updated_at;autoUpdateTime" json:"updated_at"`
	DeletedAt     *time.Time `gorm:"column:deleted_at;type:timestamptz;index" json:"-"`
}

func (e *ExecutionTarget) BeforeCreate(tx *gorm.DB) error {
	if e.ID == "" {
		id, err := uuidv7.New()
		if err != nil {
			return err
		}
		e.ID = id
	}
	return e.Validate()
}

func (e *ExecutionTarget) BeforeSave(tx *gorm.DB) error {
	return e.Validate()
}

func (e *ExecutionTarget) Validate() error {
	if e.Capabilities != "" && !isJSONObject(e.Capabilities) {
		return fmt.Errorf("capabilities must be a JSON object")
	}
	if e.Metadata != "" && !isJSONObject(e.Metadata) {
		return fmt.Errorf("metadata must be a JSON object")
	}
	return nil
}
