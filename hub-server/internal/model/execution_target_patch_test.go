package model

// #1545 — PATCH three-state contract: absent / set / null must be
// distinguishable after JSON unmarshalling.

import (
	"encoding/json"
	"testing"
)

func TestPatchFieldThreeStateUnmarshal(t *testing.T) {
	var patch ExecutionTargetPatch
	if err := json.Unmarshal([]byte(`{"name":"renamed","port":0,"device_id":null,"host":""}`), &patch); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	// omitted → not present.
	if patch.WorkspaceRoot.Present() {
		t.Error("omitted workspace_root must be absent")
	}
	if patch.TrustLevel.Present() {
		t.Error("omitted trust_level must be absent")
	}

	// set with value.
	if !patch.Name.Present() || patch.Name.Null() || patch.Name.Value() != "renamed" {
		t.Errorf("name must be set-value: present=%v null=%v value=%q", patch.Name.Present(), patch.Name.Null(), patch.Name.Value())
	}

	// set to zero value (port 0) — the key case the old convention lost.
	if !patch.Port.Present() || patch.Port.Null() || patch.Port.Value() != 0 {
		t.Errorf("port must be present with value 0, got present=%v null=%v value=%d", patch.Port.Present(), patch.Port.Null(), patch.Port.Value())
	}

	// set to empty string — distinct from omitted and from null.
	if !patch.Host.Present() || patch.Host.Null() || patch.Host.Value() != "" {
		t.Errorf("host must be present empty string, got present=%v null=%v", patch.Host.Present(), patch.Host.Null())
	}

	// null → clear semantics.
	if !patch.DeviceID.Present() || !patch.DeviceID.Null() {
		t.Error("device_id null must be present+null (clear)")
	}
}

func TestPatchFieldConstructors(t *testing.T) {
	set := Patch("value")
	if !set.Present() || set.Null() || set.Value() != "value" {
		t.Errorf("Patch constructor: present=%v null=%v value=%q", set.Present(), set.Null(), set.Value())
	}
	null := PatchNull[string]()
	if !null.Present() || !null.Null() {
		t.Error("PatchNull constructor must be present+null")
	}
}

func TestPatchFieldRejectsTypeMismatch(t *testing.T) {
	var patch ExecutionTargetPatch
	err := json.Unmarshal([]byte(`{"port":"not-a-number"}`), &patch)
	if err == nil {
		t.Fatal("port string must be rejected")
	}
}

func TestPatchFieldRejectedFieldsSurface(t *testing.T) {
	// health_state / target_type must survive unmarshalling so the service
	// can reject them explicitly instead of silently ignoring.
	var patch ExecutionTargetPatch
	if err := json.Unmarshal([]byte(`{"health_state":"online","target_type":"hub_relay"}`), &patch); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if patch.HealthState == (PatchField[string]{}) || !patch.HealthState.Present() {
		t.Error("health_state must be captured for explicit rejection")
	}
	if patch.TargetType == (PatchField[string]{}) || !patch.TargetType.Present() {
		t.Error("target_type must be captured for explicit rejection")
	}
}
