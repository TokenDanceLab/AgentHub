package service

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/agenthub/hub-server/internal/model"
)

// --- validConflictResolution ---

func TestValidConflictResolution(t *testing.T) {
	tests := []struct {
		name       string
		resolution string
		want       bool
	}{
		{"accept_agent_task", model.TeamConflictResolutionAcceptAgentTask, true},
		{"manual_merge", model.TeamConflictResolutionManualMerge, true},
		{"keep_all", model.TeamConflictResolutionKeepAll, true},
		{"discard_all", model.TeamConflictResolutionDiscardAll, true},
		{"blocked", model.TeamConflictResolutionBlocked, true},
		{"invalid", "invalid_resolution", false},
		{"empty", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, validConflictResolution(tt.resolution))
		})
	}
}

// --- approvalMatchesID ---

func TestApprovalMatchesID(t *testing.T) {
	approval := model.TeamApprovalState{
		ApprovalID: "approval-1",
		RequestID:  "req-1",
		ToolUseID:  "tool-1",
	}

	t.Run("matches ApprovalID", func(t *testing.T) {
		assert.True(t, approvalMatchesID(approval, "approval-1"))
	})
	t.Run("matches RequestID", func(t *testing.T) {
		assert.True(t, approvalMatchesID(approval, "req-1"))
	})
	t.Run("matches ToolUseID", func(t *testing.T) {
		assert.True(t, approvalMatchesID(approval, "tool-1"))
	})
	t.Run("no match", func(t *testing.T) {
		assert.False(t, approvalMatchesID(approval, "nonexistent"))
	})
	t.Run("empty approvalID", func(t *testing.T) {
		assert.False(t, approvalMatchesID(approval, ""))
	})
	t.Run("whitespace approvalID", func(t *testing.T) {
		assert.False(t, approvalMatchesID(approval, "   "))
	})
}

// --- validApprovalDecision ---

func TestValidApprovalDecision(t *testing.T) {
	assert.True(t, validApprovalDecision("allow"))
	assert.True(t, validApprovalDecision("deny"))
	assert.False(t, validApprovalDecision("maybe"))
	assert.False(t, validApprovalDecision(""))
	assert.False(t, validApprovalDecision("approve"))
}

// --- isActiveAssignmentStatus ---

func TestIsActiveAssignmentStatus(t *testing.T) {
	assert.True(t, isActiveAssignmentStatus(model.AssignmentStatusPending))
	assert.True(t, isActiveAssignmentStatus(model.AssignmentStatusDispatched))
	assert.True(t, isActiveAssignmentStatus(model.AssignmentStatusRunning))
	assert.False(t, isActiveAssignmentStatus(model.AssignmentStatusDone))
	assert.False(t, isActiveAssignmentStatus(model.AssignmentStatusFailed))
	assert.False(t, isActiveAssignmentStatus(model.AssignmentStatusCancelled))
	assert.False(t, isActiveAssignmentStatus("unknown"))
	assert.False(t, isActiveAssignmentStatus(""))
}

// --- stringInSlice ---

func TestStringInSlice(t *testing.T) {
	slice := []string{"apple", "banana", "cherry"}

	assert.True(t, stringInSlice(slice, "apple"))
	assert.True(t, stringInSlice(slice, "banana"))
	assert.True(t, stringInSlice(slice, "cherry"))
	assert.False(t, stringInSlice(slice, "grape"))
	assert.False(t, stringInSlice(slice, ""))
	assert.False(t, stringInSlice(slice, "  "))
	assert.False(t, stringInSlice([]string{}, "anything"))
	assert.False(t, stringInSlice(nil, "anything"))
}

// --- payloadString ---

func TestPayloadString(t *testing.T) {
	t.Run("finds first key", func(t *testing.T) {
		assert.Equal(t, "value1", payloadString(`{"key1":"value1","key2":"value2"}`, "key1", "key2"))
	})
	t.Run("falls back to second key", func(t *testing.T) {
		assert.Equal(t, "value2", payloadString(`{"key1":"","key2":"value2"}`, "key1", "key2"))
	})
	t.Run("no match", func(t *testing.T) {
		assert.Equal(t, "", payloadString(`{"key1":"v1"}`, "key3"))
	})
	t.Run("invalid json", func(t *testing.T) {
		assert.Equal(t, "", payloadString("not-json", "key1"))
	})
	t.Run("empty payload", func(t *testing.T) {
		assert.Equal(t, "", payloadString("", "key"))
	})
	t.Run("empty object", func(t *testing.T) {
		assert.Equal(t, "", payloadString("{}", "key"))
	})
}

// --- firstNonEmptyString ---

func TestFirstNonEmptyString(t *testing.T) {
	assert.Equal(t, "b", firstNonEmptyString("", "b", "c"))
	assert.Equal(t, "a", firstNonEmptyString("a", "b", "c"))
	assert.Equal(t, "", firstNonEmptyString("", "", ""))
	assert.Equal(t, "", firstNonEmptyString())
}

// --- firstJSONString ---

func TestFirstJSONString(t *testing.T) {
	t.Run("finds string value", func(t *testing.T) {
		values := map[string]any{"name": "test", "label": "Test"}
		assert.Equal(t, "test", firstJSONString(values, "name", "label"))
	})
	t.Run("falls back to second key", func(t *testing.T) {
		values := map[string]any{"label": "Test"}
		assert.Equal(t, "Test", firstJSONString(values, "name", "label"))
	})
	t.Run("no match", func(t *testing.T) {
		values := map[string]any{"other": "value"}
		assert.Equal(t, "", firstJSONString(values, "name"))
	})
	t.Run("non-string value", func(t *testing.T) {
		values := map[string]any{"count": 42}
		assert.Equal(t, "", firstJSONString(values, "count"))
	})
	t.Run("trims whitespace", func(t *testing.T) {
		values := map[string]any{"name": "  spaced  "}
		assert.Equal(t, "spaced", firstJSONString(values, "name"))
	})
	t.Run("empty map", func(t *testing.T) {
		assert.Equal(t, "", firstJSONString(map[string]any{}, "key"))
	})
}

// --- firstJSONInt ---

func TestFirstJSONInt(t *testing.T) {
	t.Run("int value", func(t *testing.T) {
		values := map[string]any{"count": 42}
		assert.Equal(t, int64(42), firstJSONInt(values, "count"))
	})
	t.Run("float64 value", func(t *testing.T) {
		values := map[string]any{"count": 99.9}
		assert.Equal(t, int64(99), firstJSONInt(values, "count"))
	})
	t.Run("json.Number value", func(t *testing.T) {
		values := map[string]any{"count": json.Number("77")}
		assert.Equal(t, int64(77), firstJSONInt(values, "count"))
	})
	t.Run("missing key", func(t *testing.T) {
		values := map[string]any{"other": 42}
		assert.Equal(t, int64(0), firstJSONInt(values, "count"))
	})
	t.Run("empty map", func(t *testing.T) {
		assert.Equal(t, int64(0), firstJSONInt(map[string]any{}, "count"))
	})
}

// --- firstJSONFloat ---

func TestFirstJSONFloat(t *testing.T) {
	t.Run("float64 value", func(t *testing.T) {
		values := map[string]any{"percent": 86.5}
		assert.InDelta(t, 86.5, firstJSONFloat(values, "percent"), 0.01)
	})
	t.Run("int value converted to float", func(t *testing.T) {
		values := map[string]any{"percent": 85}
		assert.InDelta(t, 85.0, firstJSONFloat(values, "percent"), 0.01)
	})
	t.Run("json.Number value", func(t *testing.T) {
		values := map[string]any{"percent": json.Number("92.3")}
		assert.InDelta(t, 92.3, firstJSONFloat(values, "percent"), 0.01)
	})
	t.Run("missing key", func(t *testing.T) {
		values := map[string]any{"other": 42.0}
		assert.InDelta(t, 0.0, firstJSONFloat(values, "percent"), 0.01)
	})
	t.Run("empty map", func(t *testing.T) {
		assert.InDelta(t, 0.0, firstJSONFloat(map[string]any{}, "percent"), 0.01)
	})
}
