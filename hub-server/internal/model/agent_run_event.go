package model

import (
	"encoding/json"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/pkg/uuidv7"
)

const (
	RunEventTypeOutputBatch = "run.output.batch"
)

type AgentRunEvent struct {
	ID              string    `gorm:"primaryKey;type:uuid" json:"id"`
	TaskID          string    `gorm:"type:uuid;not null;index:idx_agent_run_events_task_seq" json:"task_id"`
	EdgeRunID       string    `gorm:"type:varchar(128);index" json:"edge_run_id,omitempty"`
	SessionID       string    `gorm:"type:uuid;not null;index" json:"session_id"`
	AgentInstanceID string    `gorm:"type:uuid;not null;index" json:"agent_instance_id"`
	EventSeq        int64     `gorm:"not null;index:idx_agent_run_events_task_seq" json:"event_seq"`
	EventType       string    `gorm:"type:varchar(96);not null;index" json:"event_type"`
	Payload         string    `gorm:"type:jsonb;not null" json:"payload"`
	CreatedAt       time.Time `gorm:"autoCreateTime" json:"created_at"`
}

func (e *AgentRunEvent) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	e.ID = id
	return nil
}

type AgentRunEventInput struct {
	EventType   string          `json:"event_type,omitempty"`
	Payload     json.RawMessage `json:"payload,omitempty"`
	Content     string          `json:"content,omitempty"`
	ClientMsgID string          `json:"client_msg_id,omitempty"`
}
