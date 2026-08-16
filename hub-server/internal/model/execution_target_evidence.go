package model

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/uuidv7"
)

// ExecutionTargetEvidence is the single source of truth for an execution
// target's health (as of #1544). Previously health_state / is_online /
// last_seen_at were written directly by multiple paths (manual ping, device
// registration, HTTP probe) with no evidence of what was actually observed.
// Now every health write goes through one row per target; the readable
// health fields are a pure projection of this evidence (see
// dispatch.ResolveExecutionTargetHealthState).
type ExecutionTargetEvidence struct {
	ID       string `gorm:"primaryKey;type:uuid" json:"id"`
	TargetID string `gorm:"column:target_id;type:uuid;not null;uniqueIndex" json:"target_id"`

	// Source identifies what produced the evidence:
	//   "registration" — desktop device check-in (login/registration), local_edge
	//   "probe"        — explicit probe (manual ping for remote_* / local_edge route check)
	//   "relay_route"  — hub_relay route proof (exact device route, not owner presence)
	Source string `gorm:"column:source;type:varchar(32);not null" json:"source"`

	// Status is the observed health: online | offline | mismatch | degraded | unknown.
	Status string `gorm:"column:status;type:varchar(32);not null" json:"status"`

	// FailureCategory classifies why a probe/route proof failed (dns, connect,
	// timeout, http_5xx, mismatch, no_route, missing_device_binding, offline_owner).
	FailureCategory string `gorm:"column:failure_category;type:varchar(64);default:''" json:"failure_category,omitempty"`

	// ObservedTargetID is the target identity reported by the probed remote
	// (remote_* probes); mismatch with the stored target yields status mismatch.
	ObservedTargetID string `gorm:"column:observed_target_id;type:varchar(128);default:''" json:"observed_target_id,omitempty"`

	// RouteKey identifies the proven route (user:deviceType:deviceID) for
	// local_edge route probes and hub_relay route proofs.
	RouteKey string `gorm:"column:route_key;type:varchar(256);default:''" json:"route_key,omitempty"`

	// ObservedAt is when the evidence was recorded. Upserts are CAS'd on this
	// value: an older observed_at never overwrites a newer one.
	ObservedAt time.Time `gorm:"column:observed_at;type:timestamptz;not null" json:"observed_at"`

	// ExpiresAt bounds the evidence's freshness window; a nil ExpiresAt means
	// the evidence stays valid until replaced (not used today — every writer
	// sets a window so the projection can degrade to stale).
	ExpiresAt *time.Time `gorm:"column:expires_at;type:timestamptz" json:"expires_at,omitempty"`

	CreatedAt time.Time `gorm:"column:created_at;autoCreateTime" json:"created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at;autoUpdateTime" json:"updated_at"`
}

// TableName overrides the default table name.
func (ExecutionTargetEvidence) TableName() string {
	return "execution_target_evidence"
}

func (e *ExecutionTargetEvidence) BeforeCreate(tx *gorm.DB) error {
	if e.ID == "" {
		id, err := uuidv7.New()
		if err != nil {
			return err
		}
		e.ID = id
	}
	return nil
}
