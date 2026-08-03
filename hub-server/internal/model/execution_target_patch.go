package model

import (
	"encoding/json"
)

// PatchField is a three-state JSON field for PATCH semantics (#1545):
//
//	field absent  = 不修改（Present() == false）
//	field value   = 设置（Present() && !Null()）
//	field null    = 清除（Present() && Null()）
//
// It replaces the previous "non-zero means provided" convention, where a
// caller could not distinguish "port omitted" from "port reset to 0" or
// "host omitted" from "host cleared".
type PatchField[T any] struct {
	present bool
	null    bool
	value   T
}

// UnmarshalJSON implements json.Unmarshaler: absent fields never reach this
// method; a literal null sets null=true; anything else is parsed into value.
func (p *PatchField[T]) UnmarshalJSON(b []byte) error {
	p.present = true
	if string(b) == "null" {
		p.null = true
		return nil
	}
	return json.Unmarshal(b, &p.value)
}

// Present reports whether the field was provided at all.
func (p PatchField[T]) Present() bool { return p.present }

// Null reports whether the field was provided as JSON null.
func (p PatchField[T]) Null() bool { return p.null }

// Value returns the parsed value; only meaningful when Present() && !Null().
func (p PatchField[T]) Value() T { return p.value }

// Patch constructs a set-semantics field (used by tests and programmatic
// callers; JSON unmarshalling fills it directly).
func Patch[T any](value T) PatchField[T] {
	return PatchField[T]{present: true, value: value}
}

// PatchNull constructs a clear-semantics field (JSON null equivalent).
func PatchNull[T any]() PatchField[T] {
	return PatchField[T]{present: true, null: true}
}

// ExecutionTargetPatch carries the PATCH semantics for ExecutionTarget
// updates (#1545). Fields not present in the request body are left
// untouched; present values are applied; null clears nullable fields.
// Value-typed PatchField (not pointers): a JSON null on a *T field would
// nil the pointer without calling UnmarshalJSON, losing the null-vs-absent
// distinction this type exists to make.
// target_type and health_state are present only to be rejected: a target's
// type is fixed at creation (type-specific policies/evidence depend on it)
// and health is system-managed (#1544). Silently ignoring them would let
// callers believe the update took effect.
type ExecutionTargetPatch struct {
	Name               PatchField[string]          `json:"name"`
	Host               PatchField[string]          `json:"host"`
	Port               PatchField[int]             `json:"port"`
	WorkspaceRoot      PatchField[string]          `json:"workspace_root"`
	WorkspaceAllowlist PatchField[json.RawMessage] `json:"workspace_allowlist"`
	TrustLevel         PatchField[string]          `json:"trust_level"`
	AuthMethod         PatchField[string]          `json:"auth_method"`
	DeviceID           PatchField[string]          `json:"device_id"`
	Capabilities       PatchField[json.RawMessage] `json:"capabilities"`
	Metadata           PatchField[json.RawMessage] `json:"metadata"`
	// Rejected fields (present ⇒ error):
	TargetType  PatchField[string] `json:"target_type"`
	HealthState PatchField[string] `json:"health_state"`
}
