package model

import (
	"fmt"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/pkg/uuidv7"
)

// AuditEvent represents a recorded audit event.
type AuditEvent struct {
	ID        string    `gorm:"primaryKey;type:uuid" json:"id"`
	UserID    string    `gorm:"column:user_id;type:uuid;not null" json:"user_id"`
	ProfileID *string   `gorm:"column:profile_id;type:uuid" json:"profile_id,omitempty"`
	TargetID  *string   `gorm:"column:target_id;type:uuid" json:"target_id,omitempty"`
	EventType string    `gorm:"column:event_type;type:varchar(64);not null" json:"event_type"`
	Severity  string    `gorm:"column:severity;type:varchar(16);not null;default:info" json:"severity"`
	Summary   string    `gorm:"column:summary;type:text;not null" json:"summary"`
	Details   string    `gorm:"column:details;type:jsonb;default:'{}'" json:"details,omitempty"`
	ClientIP  string    `gorm:"column:client_ip;type:varchar(45);default:''" json:"client_ip,omitempty"`
	CreatedAt time.Time `gorm:"column:created_at;autoCreateTime" json:"created_at"`
}

// TableName overrides the default table name.
func (AuditEvent) TableName() string {
	return "audit_events"
}

func (e *AuditEvent) BeforeCreate(tx *gorm.DB) error {
	if e.ID == "" {
		id, err := uuidv7.New()
		if err != nil {
			return err
		}
		e.ID = id
	}
	return e.Validate()
}

// Validate checks that Details is a valid JSON object when non-empty.
func (e *AuditEvent) Validate() error {
	if e.Details != "" && !isJSONObject(e.Details) {
		return fmt.Errorf("details must be a JSON object")
	}
	return nil
}
