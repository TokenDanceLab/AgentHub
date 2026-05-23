package model

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/pkg/uuidv7"
)

const (
	TaskStatusQueued     = "queued"
	TaskStatusDispatched = "dispatched"
	TaskStatusRunning    = "running"
	TaskStatusDone       = "done"
	TaskStatusFailed     = "failed"
	TaskStatusTimeout    = "timeout"
	TaskStatusCancelled  = "cancelled"
)

type PendingAgentTask struct {
	ID                string     `gorm:"primaryKey;type:uuid" json:"id"`
	AgentInstanceID   string     `gorm:"type:uuid;not null" json:"agent_instance_id"`
	TriggeredByUserID string     `gorm:"type:uuid;not null" json:"triggered_by_user_id"`
	TriggerMessageID  string     `gorm:"type:uuid;not null" json:"trigger_message_id"`
	Status            string     `gorm:"type:varchar(16);not null" json:"status"`
	ErrorMessage      string     `gorm:"type:text" json:"error_message,omitempty"`
	CreatedAt         time.Time  `gorm:"autoCreateTime" json:"created_at"`
	DispatchedAt      *time.Time `gorm:"type:timestamptz" json:"dispatched_at,omitempty"`
	FinishedAt        *time.Time `gorm:"type:timestamptz" json:"finished_at,omitempty"`
	ExpireAt          time.Time  `gorm:"type:timestamptz;not null" json:"expire_at"`
}

func (t *PendingAgentTask) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	t.ID = id
	return nil
}
