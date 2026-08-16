package model

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/uuidv7"
)

// AuditEvent represents a recorded audit event.
// Each event includes a PrevHash field that creates a SHA-256 hash chain,
// making the audit log tamper-evident. Since #1541 the link hash covers the
// predecessor's full event content (not only id + prev_hash), so tampering
// with any content field breaks the chain. The first record (genesis) uses
// an empty PrevHash.
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

// canonicalContent serializes the tamper-relevant fields of an audit event as
// a length-prefixed concatenation ("len:value" per field, in this exact
// order): user_id, profile_id, target_id, event_type, severity, summary,
// details, client_ip, created_at (UnixNano decimal). The length prefix makes
// the encoding unambiguous for arbitrary field values. Migration 0058
// implements the identical encoding in SQL (audit_canonical_content), so a
// re-linked chain verifies with the Go implementation and vice versa.
func canonicalContent(e *AuditEvent) string {
	if e == nil {
		return ""
	}
	var b strings.Builder
	appendField := func(s string) {
		b.WriteString(strconv.Itoa(len(s)))
		b.WriteByte(':')
		b.WriteString(s)
	}
	ptr := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	appendField(e.UserID)
	appendField(ptr(e.ProfileID))
	appendField(ptr(e.TargetID))
	appendField(e.EventType)
	appendField(e.Severity)
	appendField(e.Summary)
	appendField(e.Details)
	appendField(e.ClientIP)
	appendField(strconv.FormatInt(e.CreatedAt.UnixNano(), 10))
	return b.String()
}

// ComputeLinkHash computes the hash linking the event AFTER prev to prev:
// SHA-256(prev.ID || prev.PrevHash || canonicalContent(prev)). The content
// is included so that tampering with any field of prev breaks the chain
// (#1541). A nil prev (genesis) produces the empty hash.
func ComputeLinkHash(prev *AuditEvent) string {
	if prev == nil {
		return ""
	}
	h := sha256.New()
	h.Write([]byte(prev.ID))
	h.Write([]byte(prev.PrevHash))
	h.Write([]byte(canonicalContent(prev)))
	return hex.EncodeToString(h.Sum(nil))
}

// HashChainEntry returns the AuditChainEntry for this event, computing the
// hash that links this event to the next one.
func (e *AuditEvent) HashChainEntry() AuditChainEntry {
	return AuditChainEntry{
		ID:        e.ID,
		PrevHash:  e.PrevHash,
		Hash:      ComputeLinkHash(e),
		UserID:    e.UserID,
		EventType: e.EventType,
		Severity:  e.Severity,
		Summary:   e.Summary,
	}
}

// VerifyChain verifies the integrity of an ordered list of audit events.
// Returns the index of the first invalid link, or -1 if the chain is valid.
// Because ComputeLinkHash covers the full predecessor content, an event
// whose content was tampered with (while keeping id/prev_hash) is detected
// as a broken link.
func VerifyChain(events []AuditEvent) int {
	for i := 1; i < len(events); i++ {
		expectedPrev := ComputeLinkHash(&events[i-1])
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
