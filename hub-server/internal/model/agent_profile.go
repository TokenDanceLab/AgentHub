package model

import (
	"encoding/json"
	"fmt"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/uuidv7"
)

type AgentProfile struct {
	ID                     string     `gorm:"primaryKey;type:uuid" json:"id"`
	OwnerID                string     `gorm:"column:owner_id;type:uuid;not null" json:"owner_id"`
	Name                   string     `gorm:"column:name;type:varchar(128);not null" json:"name"`
	Description            string     `gorm:"column:description;type:text" json:"description,omitempty"`
	RuntimeID              string     `gorm:"column:runtime_id;type:varchar(64);not null;index:idx_agent_profiles_runtime" json:"runtime_id"`
	Model                  string     `gorm:"column:model;type:varchar(128)" json:"model,omitempty"`
	Provider               string     `gorm:"column:provider;type:varchar(64)" json:"provider,omitempty"`
	ReasoningEffort        string     `gorm:"column:reasoning_effort;type:varchar(32);default:medium" json:"reasoning_effort,omitempty"`
	ModelMapping           string     `gorm:"column:model_mapping;type:jsonb;default:'{}'" json:"model_mapping,omitempty"`
	Skills                 string     `gorm:"column:skills;type:jsonb;default:'[]'" json:"skills,omitempty"`
	MCPServers             string     `gorm:"column:mcp_servers;type:jsonb;default:'[]'" json:"mcp_servers,omitempty"`
	ToolAllowlist          string     `gorm:"column:tool_allowlist;type:jsonb;default:'[]'" json:"tool_allowlist,omitempty"`
	ApprovalPolicy         string     `gorm:"column:approval_policy;type:jsonb;default:'{}'" json:"approval_policy,omitempty"`
	PermissionMode         string     `gorm:"column:permission_mode;type:varchar(32);default:default" json:"permission_mode,omitempty"`
	TargetPreferences      string     `gorm:"column:target_preferences;type:jsonb;default:'{}'" json:"target_preferences,omitempty"`
	ContextBudgetMaxTokens int        `gorm:"column:context_budget_max_tokens;default:200000" json:"context_budget_max_tokens"`
	IsPublic               bool       `gorm:"column:is_public;default:false" json:"is_public"`
	InstallCount           int        `gorm:"column:install_count;default:0" json:"install_count,omitempty"`
	RatingAvg              float64    `gorm:"column:rating_avg;type:decimal(3,2);default:0" json:"rating_avg,omitempty"`
	RatingCount            int        `gorm:"column:rating_count;default:0" json:"rating_count,omitempty"`
	Version                int        `gorm:"column:version;default:1" json:"version"`
	CreatedAt              time.Time  `gorm:"column:created_at;autoCreateTime" json:"created_at"`
	UpdatedAt              time.Time  `gorm:"column:updated_at;autoUpdateTime" json:"updated_at"`
	DeletedAt              *time.Time `gorm:"column:deleted_at;type:timestamptz;index" json:"-"`
}

func (p *AgentProfile) BeforeCreate(tx *gorm.DB) error {
	if p.ID == "" {
		id, err := uuidv7.New()
		if err != nil {
			return err
		}
		p.ID = id
	}
	return p.Validate()
}

func (p *AgentProfile) BeforeSave(tx *gorm.DB) error {
	return p.Validate()
}

// Validate checks JSONB fields have correct types.
func (p *AgentProfile) Validate() error {
	if p.Skills != "" && !isJSONArray(p.Skills) {
		return fmt.Errorf("skills must be a JSON array")
	}
	if p.MCPServers != "" && !isJSONArray(p.MCPServers) {
		return fmt.Errorf("mcp_servers must be a JSON array")
	}
	if p.ToolAllowlist != "" && !isJSONArray(p.ToolAllowlist) {
		return fmt.Errorf("tool_allowlist must be a JSON array")
	}
	if p.ModelMapping != "" && !isJSONObject(p.ModelMapping) {
		return fmt.Errorf("model_mapping must be a JSON object")
	}
	if p.ApprovalPolicy != "" && !isJSONObject(p.ApprovalPolicy) {
		return fmt.Errorf("approval_policy must be a JSON object")
	}
	if p.TargetPreferences != "" && !isJSONObject(p.TargetPreferences) {
		return fmt.Errorf("target_preferences must be a JSON object")
	}
	return nil
}

func isJSONArray(s string) bool {
	var v []interface{}
	return json.Unmarshal([]byte(s), &v) == nil
}

func isJSONStringArray(s string) bool {
	var v []string
	return json.Unmarshal([]byte(s), &v) == nil
}

func isJSONObject(s string) bool {
	var v map[string]interface{}
	return json.Unmarshal([]byte(s), &v) == nil
}
