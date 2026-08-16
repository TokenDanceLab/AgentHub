package model

import (
	"encoding/json"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/uuidv7"
)

const (
	RunEventTypeOutputBatch         = "run.output.batch"
	RunEventTypeMaxLength           = 96
	AgentCallbackEdgeRunIDMaxLength = 128
	// RunEventPayloadMaxBytes is the per-callback budget for runtime events,
	// done.final_content, and fail.error before Hub persists or broadcasts them.
	RunEventPayloadMaxBytes = 1 * 1024 * 1024
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

type AgentTaskApprovalList struct {
	TaskID       string              `json:"task_id"`
	EdgeRunID    string              `json:"edge_run_id,omitempty"`
	SessionID    string              `json:"session_id,omitempty"`
	Approvals    []AgentTaskApproval `json:"approvals"`
	Pending      []AgentTaskApproval `json:"pending"`
	Decided      []AgentTaskApproval `json:"decided"`
	LastEventSeq int64               `json:"last_event_seq,omitempty"`
}

type AgentTaskApproval struct {
	ApprovalID    string                   `json:"approval_id"`
	TaskID        string                   `json:"task_id"`
	TargetID      string                   `json:"target_id,omitempty"`
	EdgeDeviceID  string                   `json:"edge_device_id,omitempty"`
	CorrelationID string                   `json:"correlation_id,omitempty"`
	EdgeRunID     string                   `json:"edge_run_id,omitempty"`
	SessionID     string                   `json:"session_id,omitempty"`
	SourceEventID string                   `json:"source_event_id,omitempty"`
	EventSeq      int64                    `json:"event_seq,omitempty"`
	RequestID     string                   `json:"request_id"`
	ToolName      string                   `json:"tool_name,omitempty"`
	ToolUseID     string                   `json:"tool_use_id,omitempty"`
	Status        string                   `json:"status"`
	Reason        string                   `json:"reason,omitempty"`
	DecidedBy     string                   `json:"decided_by,omitempty"`
	CreatedAt     time.Time                `json:"created_at"`
	DecidedAt     *time.Time               `json:"decided_at,omitempty"`
	EdgeControl   *TeamApprovalEdgeControl `json:"edge_control,omitempty"`
}

type AgentTaskArtifactList struct {
	TaskID       string              `json:"task_id"`
	EdgeRunID    string              `json:"edge_run_id,omitempty"`
	SessionID    string              `json:"session_id,omitempty"`
	Artifacts    []AgentTaskArtifact `json:"artifacts"`
	LastEventSeq int64               `json:"last_event_seq,omitempty"`
}

type AgentTaskArtifact struct {
	TaskID        string    `json:"task_id"`
	EdgeRunID     string    `json:"edge_run_id,omitempty"`
	SessionID     string    `json:"session_id,omitempty"`
	SourceEventID string    `json:"source_event_id,omitempty"`
	EventSeq      int64     `json:"event_seq,omitempty"`
	Path          string    `json:"path"`
	Action        string    `json:"action,omitempty"`
	ToolName      string    `json:"tool_name,omitempty"`
	Status        string    `json:"status,omitempty"`
	Diff          string    `json:"diff,omitempty"`
	EditID        string    `json:"edit_id,omitempty"`
	Hash          string    `json:"hash,omitempty"`
	ReviewStatus  string    `json:"review_status,omitempty"`
	CanApply      *bool     `json:"can_apply,omitempty"`
	CanRevert     *bool     `json:"can_revert,omitempty"`
	ArtifactID    string    `json:"artifact_id,omitempty"`
	Name          string    `json:"name,omitempty"`
	MimeType      string    `json:"mime_type,omitempty"`
	SizeBytes     int64     `json:"size_bytes,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}
