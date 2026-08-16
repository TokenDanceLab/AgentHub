package model

import (
	"fmt"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/uuidv7"
)

type ExecutionTarget struct {
	ID                 string     `gorm:"primaryKey;type:uuid" json:"id"`
	OwnerID            string     `gorm:"column:owner_id;type:uuid;not null" json:"owner_id"`
	DeviceID           *string    `gorm:"column:device_id;type:uuid" json:"device_id,omitempty"`
	Name               string     `gorm:"column:name;type:varchar(128);not null" json:"name"`
	TargetType         string     `gorm:"column:target_type;type:varchar(32);not null;default:local_edge" json:"target_type,omitempty"`
	Host               string     `gorm:"column:host;type:varchar(256);default:''" json:"host,omitempty"`
	Port               int        `gorm:"column:port;default:0" json:"port,omitempty"`
	WorkspaceRoot      string     `gorm:"column:workspace_root;type:varchar(512);default:''" json:"workspace_root,omitempty"`
	WorkspaceAllowlist string     `gorm:"column:workspace_allowlist;type:jsonb;default:'[]'" json:"workspace_allowlist,omitempty"`
	TrustLevel         string     `gorm:"column:trust_level;type:varchar(32);default:'local'" json:"trust_level,omitempty"`
	HealthState        string     `gorm:"column:health_state;type:varchar(32);default:'unknown'" json:"health_state,omitempty"`
	AuthMethod         string     `gorm:"column:auth_method;type:varchar(32);default:''" json:"-"`
	AuthCredential     string     `gorm:"-" json:"-"`
	IsOnline           bool       `gorm:"column:is_online;default:false" json:"is_online"`
	LastSeenAt         *time.Time `gorm:"column:last_seen_at;type:timestamptz" json:"last_seen_at,omitempty"`
	Capabilities       string     `gorm:"column:capabilities;type:jsonb;default:'{}'" json:"capabilities,omitempty"`
	Metadata           string     `gorm:"column:metadata;type:jsonb;default:'{}'" json:"metadata,omitempty"`
	CreatedAt          time.Time  `gorm:"column:created_at;autoCreateTime" json:"created_at"`
	UpdatedAt          time.Time  `gorm:"column:updated_at;autoUpdateTime" json:"updated_at"`
	DeletedAt          *time.Time `gorm:"column:deleted_at;type:timestamptz;index" json:"-"`
}

var validExecutionTargetTypes = map[string]struct{}{
	"local_edge": {},
	"remote_ssh": {},
	"tailscale":  {},
	"cloud_edge": {},
	"hub_relay":  {},
}

var validExecutionTargetTrustLevels = map[string]struct{}{
	"local":  {},
	"remote": {},
	"cloud":  {},
	"relay":  {},
}

var validExecutionTargetHealthStates = map[string]struct{}{
	"unknown":  {},
	"healthy":  {},
	"online":   {},
	"degraded": {},
	"offline":  {},
	"mismatch": {},
	"stale":    {},
}

var validExecutionTargetAuthMethods = map[string]struct{}{
	"none":           {},
	"ssh_tunnel":     {},
	"tailscale_mtls": {},
	"hub_jwt":        {},
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
	if e.TargetType != "" && !isAllowedExecutionTargetValue(e.TargetType, validExecutionTargetTypes) {
		return fmt.Errorf("target_type is not supported")
	}
	if e.WorkspaceAllowlist != "" && !isJSONStringArray(e.WorkspaceAllowlist) {
		return fmt.Errorf("workspace_allowlist must be a JSON string array")
	}
	if e.TrustLevel != "" && !isAllowedExecutionTargetValue(e.TrustLevel, validExecutionTargetTrustLevels) {
		return fmt.Errorf("trust_level is not supported")
	}
	if e.HealthState != "" && !isAllowedExecutionTargetValue(e.HealthState, validExecutionTargetHealthStates) {
		return fmt.Errorf("health_state is not supported")
	}
	if e.AuthMethod != "" && !IsValidExecutionTargetAuthMethod(e.AuthMethod) {
		return fmt.Errorf("auth_method is not supported")
	}
	if e.Capabilities != "" && !isJSONObject(e.Capabilities) {
		return fmt.Errorf("capabilities must be a JSON object")
	}
	if e.Metadata != "" && !isJSONObject(e.Metadata) {
		return fmt.Errorf("metadata must be a JSON object")
	}
	return nil
}

func isAllowedExecutionTargetValue(value string, allowed map[string]struct{}) bool {
	_, ok := allowed[value]
	return ok
}

func IsValidExecutionTargetAuthMethod(value string) bool {
	return isAllowedExecutionTargetValue(value, validExecutionTargetAuthMethods)
}
