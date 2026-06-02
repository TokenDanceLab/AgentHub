package model

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/pkg/uuidv7"
)

// AuditEvent represents a recorded audit event.
// Each event includes a PrevHash field that creates a SHA-256 hash chain,
// making the audit log tamper-evident. The hash chain links each record to
// its predecessor: hash = SHA-256(previous_id || previous_prev_hash).
// The first record (genesis) uses an empty string as its previous values.
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
	PrevHash  string    `gorm:"column:prev_hash;type:varchar(64);not null;default:''" json:"prev_hash"`
	CreatedAt time.Time `gorm:"column:created_at;autoCreateTime" json:"created_at"`
}

// AuditChainEntry is a compact representation of an audit event for hash-chain
// integrity verification and JSONL archival.
type AuditChainEntry struct {
	ID        string `json:"id"`
	PrevHash  string `json:"prev_hash"`
	Hash      string `json:"hash"`
	UserID    string `json:"user_id"`
	EventType string `json:"event_type"`
	Severity  string `json:"severity"`
	Summary   string `json:"summary"`
}

// ComputeHash computes the SHA-256 hash of (prevID || prevHash).
func ComputeHash(prevID, prevHash string) string {
	h := sha256.New()
	h.Write([]byte(prevID))
	h.Write([]byte(prevHash))
	return hex.EncodeToString(h.Sum(nil))
}

// HashChainEntry returns the AuditChainEntry for this event, computing the
// hash that links this event to the next one.
func (e *AuditEvent) HashChainEntry() AuditChainEntry {
	return AuditChainEntry{
		ID:        e.ID,
		PrevHash:  e.PrevHash,
		Hash:      ComputeHash(e.ID, e.PrevHash),
		UserID:    e.UserID,
		EventType: e.EventType,
		Severity:  e.Severity,
		Summary:   e.Summary,
	}
}

// VerifyChain verifies the integrity of an ordered list of audit events.
// Returns the index of the first invalid link, or -1 if the chain is valid.
func VerifyChain(events []AuditEvent) int {
	for i := 1; i < len(events); i++ {
		expectedPrev := ComputeHash(events[i-1].ID, events[i-1].PrevHash)
		if events[i].PrevHash != expectedPrev {
			return i
		}
	}
	return -1
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
