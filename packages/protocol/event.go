package protocol

import (
	"errors"
	"time"
)

type EventEnvelope struct {
	Version string     `json:"version"`
	ID      string     `json:"id"`
	Seq     int64      `json:"seq"`
	Type    string     `json:"type"`
	Scope   EventScope `json:"scope"`
	TraceID string     `json:"traceId,omitempty"`
	SentAt  time.Time  `json:"sentAt"`
	Payload any        `json:"payload"`
}

type EventScope struct {
	ProjectID      string `json:"projectId,omitempty"`
	ConversationID string `json:"conversationId,omitempty"`
	ThreadID       string `json:"threadId,omitempty"`
	RunID          string `json:"runId,omitempty"`
	EdgeID         string `json:"edgeId,omitempty"`
}

func (e EventEnvelope) Validate() error {
	if e.Version == "" {
		return errors.New("event version is required")
	}
	if e.ID == "" {
		return errors.New("event id is required")
	}
	if e.Seq <= 0 {
		return errors.New("event seq must be positive")
	}
	if e.Type == "" {
		return errors.New("event type is required")
	}
	if e.SentAt.IsZero() {
		return errors.New("event sentAt is required")
	}
	if e.Payload == nil {
		return errors.New("event payload is required")
	}
	return nil
}
