package model

import (
	"encoding/json"
	"fmt"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/uuidv7"
)

// MaxOutputSchemaSize caps the raw JSON Schema string size for structured output.
// Schemas exceeding 16 KB are rejected at create/update time to prevent silent
// failures when the schema exceeds OS command-line argument limits (Windows
// CreateProcess ~32KB) or Claude Code's --json-schema argument limit.
const MaxOutputSchemaSize = 16 << 10 // 16 KB

type CustomAgent struct {
	ID             string           `gorm:"primaryKey;type:uuid" json:"id"`
	OwnerUserID    string           `gorm:"type:uuid;not null" json:"owner_user_id"`
	Name           string           `gorm:"type:varchar(64);not null" json:"name"`
	AvatarURL      string           `gorm:"type:varchar(512)" json:"avatar_url,omitempty"`
	AgentType      string           `gorm:"type:varchar(64);not null" json:"agent_type"`
	SystemPrompt   string           `gorm:"type:text;not null" json:"system_prompt"`
	CapabilityTags string           `gorm:"type:jsonb;default:'[]'" json:"capability_tags,omitempty"`
	ToolWhitelist  string           `gorm:"type:jsonb;default:'[]'" json:"tool_whitelist,omitempty"`
	ModelParams    string           `gorm:"type:jsonb;default:'{}'" json:"model_params,omitempty"`
	OutputSchema   *json.RawMessage `gorm:"type:jsonb" json:"output_schema,omitempty"`
	DeletedAt      *time.Time       `gorm:"type:timestamptz" json:"deleted_at,omitempty"`
	CreatedAt      time.Time        `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt      time.Time        `gorm:"autoUpdateTime" json:"updated_at"`
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
	fields := []struct {
		ptr  *string
		name string
	}{
		{&c.CapabilityTags, "capability_tags"},
		{&c.ToolWhitelist, "tool_whitelist"},
		{&c.ModelParams, "model_params"},
	}
	for _, f := range fields {
		if err := normalizeJSONField(f.ptr, f.name); err != nil {
			return err
		}
	}
	return nil
}

// normalizeJSONField normalizes a single JSON string field by unmarshaling and
// re-marshaling to compact form. No-op when the field is empty.
func normalizeJSONField(field *string, name string) error {
	if *field == "" {
		return nil
	}
	normalized, err := NormalizeJSONValue(*field)
	if err != nil {
		return fmt.Errorf("invalid JSON in %s: %w", name, err)
	}
	*field = normalized
	return nil
}

// NormalizeJSONValue normalizes a JSON string by unmarshaling and re-marshaling
// to compact form. Returns the compact JSON string or an error if the input is
// not valid JSON. This is the shared JSON normalization utility used by all
// model types and handlers.
func NormalizeJSONValue(raw string) (string, error) {
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

// Deprecated: use NormalizeJSONValue instead.
func normalizeJSONValue(raw string) (string, error) {
	return NormalizeJSONValue(raw)
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
		if len(field.value) > MaxOutputSchemaSize {
			return fmt.Errorf("%s exceeds maximum size of %d bytes", field.name, MaxOutputSchemaSize)
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
	// Validate output_schema: must be a valid JSON object if set,
	// must not exceed MaxOutputSchemaSize, and must have basic JSON Schema
	// structure (a "type" field at minimum) to catch common mistakes like
	// empty objects or bare strings.
	if c.OutputSchema != nil && len(*c.OutputSchema) > 0 {
		raw := *c.OutputSchema
		// Size check: json.RawMessage is []byte, len checks byte count.
		if len(raw) > MaxOutputSchemaSize {
			return fmt.Errorf("output_schema exceeds maximum size of %d bytes", MaxOutputSchemaSize)
		}
		var decoded any
		if err := json.Unmarshal(raw, &decoded); err != nil {
			return fmt.Errorf("invalid JSON in output_schema: %w", err)
		}
		obj, ok := decoded.(map[string]any)
		if !ok {
			return fmt.Errorf("output_schema must be a JSON object")
		}
		// Basic JSON Schema structural check: the object must have a "type"
		// field. This catches empty objects {} and unrelated JSON objects
		// like {"foo": "bar"} that are not valid schemas.
		if _, hasType := obj["type"]; !hasType {
			return fmt.Errorf("output_schema must contain a \"type\" field (valid JSON Schema required)")
		}
	}
	return nil
}
