package model

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/uuidv7"
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
	TriggeredByUserID string     `gorm:"type:uuid;not null;index" json:"triggered_by_user_id"`
	TriggerMessageID  string     `gorm:"type:uuid;not null" json:"trigger_message_id"`
	TargetID          string     `gorm:"type:uuid;default:null" json:"target_id,omitempty"`
	Status            string     `gorm:"type:varchar(16);not null;index:idx_pending_agent_tasks_status_expire,priority:1" json:"status"`
	EdgeRunID         string     `gorm:"type:varchar(128);default:null" json:"edge_run_id,omitempty"`
	EdgeDeviceID      string     `gorm:"type:uuid;default:null" json:"edge_device_id,omitempty"`
	ErrorMessage      string     `gorm:"type:text" json:"error_message,omitempty"`
	CreatedAt         time.Time  `gorm:"autoCreateTime" json:"created_at"`
	DispatchedAt      *time.Time `gorm:"type:timestamptz" json:"dispatched_at,omitempty"`
	FinishedAt        *time.Time `gorm:"type:timestamptz" json:"finished_at,omitempty"`
	ExpireAt          time.Time  `gorm:"type:timestamptz;not null;index:idx_pending_agent_tasks_status_expire,priority:2" json:"expire_at"`
}

func (t *PendingAgentTask) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	t.ID = id
	return nil
}
