package model

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/uuidv7"
)

type MCPServer struct {
	ID           string     `gorm:"primaryKey;type:uuid" json:"id"`
	OwnerID      string     `gorm:"column:owner_id;type:uuid;not null" json:"owner_id"`
	Name         string     `gorm:"column:name;type:varchar(128);not null" json:"name"`
	Transport    string     `gorm:"column:transport;type:varchar(32);default:stdio" json:"transport"`
	Command      string     `gorm:"column:command;type:varchar(512)" json:"command,omitempty"`
	Args         string     `gorm:"column:args;type:jsonb;default:'[]'" json:"args,omitempty"`
	EnvVars      string     `gorm:"column:env_vars;type:jsonb;default:'{}'" json:"env_vars,omitempty"`
	URL          string     `gorm:"column:url;type:varchar(512)" json:"url,omitempty"`
	AuthType     string     `gorm:"column:auth_type;type:varchar(32);default:none" json:"auth_type"`
	AuthConfig   string     `gorm:"column:auth_config;type:jsonb;default:'{}'" json:"auth_config,omitempty"`
	ToolSchema   string     `gorm:"column:tool_schema;type:jsonb;default:'{}'" json:"tool_schema,omitempty"`
	IsPublic     bool       `gorm:"column:is_public;default:false" json:"is_public"`
	InstallCount int        `gorm:"column:install_count;default:0" json:"install_count,omitempty"`
	CreatedAt    time.Time  `gorm:"column:created_at;autoCreateTime" json:"created_at"`
	UpdatedAt    time.Time  `gorm:"column:updated_at;autoUpdateTime" json:"updated_at"`
	DeletedAt    *time.Time `gorm:"column:deleted_at;type:timestamptz;index" json:"-"`
}

func (m *MCPServer) BeforeCreate(tx *gorm.DB) error {
	if m.ID == "" {
		id, err := uuidv7.New()
		if err != nil {
			return err
		}
		m.ID = id
	}
	return m.Validate()
}

func (m *MCPServer) BeforeSave(tx *gorm.DB) error {
	return m.Validate()
}

// Validate checks JSONB types AND rejects plaintext secrets in auth_config.
// SECURITY: This is the gate that prevents credential leakage into the database.
func (m *MCPServer) Validate() error {
	if err := m.validateJSONBTypes(); err != nil {
		return err
	}
	if err := m.validateAuthConfigSecrets(); err != nil {
		return err
	}
	return m.validateURLHasNoCredentials()
}

// validateJSONBTypes verifies every JSONB field holds the expected shape.
func (m *MCPServer) validateJSONBTypes() error {
	if m.Args != "" && !isJSONArray(m.Args) {
		return fmt.Errorf("args must be a JSON array")
	}
	if m.EnvVars != "" && !isJSONObject(m.EnvVars) {
		return fmt.Errorf("env_vars must be a JSON object")
	}
	if m.AuthConfig != "" && !isJSONObject(m.AuthConfig) {
		return fmt.Errorf("auth_config must be a JSON object")
	}
	if m.ToolSchema != "" && !isJSONObject(m.ToolSchema) {
		return fmt.Errorf("tool_schema must be a JSON object")
	}
	return nil
}

// validateAuthConfigSecrets rejects plaintext (non-masked) secrets in auth_config.
func (m *MCPServer) validateAuthConfigSecrets() error {
	if m.AuthConfig == "" || m.AuthConfig == "{}" {
		return nil
	}
	var cfg map[string]interface{}
	if err := json.Unmarshal([]byte(m.AuthConfig), &cfg); err != nil {
		return nil
	}
	dangerousKeys := []string{"api_key", "secret", "token", "password", "key", "api_secret", "access_token"}
	for _, key := range dangerousKeys {
		if val, ok := cfg[key]; ok {
			if s, isStr := val.(string); isStr && s != "" && s != "***" {
				return fmt.Errorf("auth_config must not contain plaintext %s (use \"***\" for masked values)", key)
			}
		}
	}
	return nil
}

// validateURLHasNoCredentials rejects URLs carrying embedded credentials and
// non-http(s) schemes (#2154 security lane F12: the previous substring checks
// accepted e.g. ftp://host or a bare hostname that edge-side clients would
// then consume).
func (m *MCPServer) validateURLHasNoCredentials() error {
	if m.URL == "" {
		return nil
	}
	for _, pattern := range []string{"@", "token=", "key=", "secret="} {
		if contains(m.URL, pattern) {
			return fmt.Errorf("url must not contain credentials")
		}
	}
	u, err := url.Parse(m.URL)
	if err != nil {
		return fmt.Errorf("url must be a valid http(s) URL")
	}
	if !strings.EqualFold(u.Scheme, "http") && !strings.EqualFold(u.Scheme, "https") {
		return fmt.Errorf("url must be http or https")
	}
	if u.Host == "" {
		return fmt.Errorf("url must include a host")
	}
	return nil
}

// contains is a simple substring check.
func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchSubstring(s, substr)
}

func searchSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
