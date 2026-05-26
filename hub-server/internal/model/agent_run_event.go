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

type AgentRunEventFilter struct {
	EventType string `json:"event_type,omitempty"`
	AfterSeq  int64  `json:"after_seq,omitempty"`
	Limit     int    `json:"limit,omitempty"`
}

type AgentRunEventSummary struct {
	TaskID           string         `json:"task_id"`
	EdgeRunID        string         `json:"edge_run_id,omitempty"`
	Status           string         `json:"status"`
	TotalEvents      int            `json:"total_events"`
	LastEventSeq     int64          `json:"last_event_seq"`
	EventTypeCounts  map[string]int `json:"event_type_counts"`
	ToolCallCount    int            `json:"tool_call_count"`
	StepCount        int            `json:"step_count"`
	ArtifactCount    int            `json:"artifact_count"`
	ApprovalCount    int            `json:"approval_count"`
	PendingApprovals int            `json:"pending_approvals"`
	DecidedApprovals int            `json:"decided_approvals"`
	InputTokens      int            `json:"input_tokens"`
	OutputTokens     int            `json:"output_tokens"`
	OutputBytes      int            `json:"output_bytes"`
	StartedAt        *time.Time     `json:"started_at,omitempty"`
	FinishedAt       *time.Time     `json:"finished_at,omitempty"`
	ElapsedMs        int64          `json:"elapsed_ms,omitempty"`
}
