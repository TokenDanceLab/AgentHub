package audit

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPrivilegedActionConstants_Length(t *testing.T) {
	// audit_events.event_type is varchar(64); every constant must fit.
	constants := []string{
		EventTaskDispatch,
		EventTaskCancel,
		EventTaskRegenerate,
		EventApprovalDecide,
		EventMemberAdd,
		EventMemberRemove,
		EventTargetCreate,
		EventTargetUpdate,
		EventTargetDelete,
		EventReviewDecide,
		EventRouteDecide,
	}
	for _, c := range constants {
		assert.NotEmpty(t, c, "constant must not be empty")
		assert.LessOrEqual(t, len(c), 64, "event_type %q exceeds varchar(64)", c)
	}
}

func TestRecordPrivilegedAction_NilService_Noop(t *testing.T) {
	var s *Service
	// Must not panic on nil receiver.
	s.RecordPrivilegedAction(context.Background(), PrivilegedActionInput{
		ActorUserID:  "u1",
		Action:       EventTaskCancel,
		ResourceType: "task",
		ResourceID:   "t1",
		Outcome:      OutcomeSuccess,
	})
}

func TestRecordPrivilegedAction_MissingRequiredFields_Noop(t *testing.T) {
	// Use a real service backed by a no-op DB to confirm validation short-circuits.
	// We only assert it doesn't panic or call RecordSync with invalid data.
	// A full integration test covers the happy path against a real DB.
	s := NewService(nil, &Config{RetryBufferSize: 0})
	// Empty actor
	s.RecordPrivilegedAction(context.Background(), PrivilegedActionInput{
		Action:     EventTaskCancel,
		ResourceID: "t1",
		Outcome:    OutcomeSuccess,
	})
	// Empty action
	s.RecordPrivilegedAction(context.Background(), PrivilegedActionInput{
		ActorUserID: "u1",
		ResourceID:  "t1",
		Outcome:     OutcomeSuccess,
	})
}

func TestDefaultOutcomeSuffix(t *testing.T) {
	require.Equal(t, "ok", defaultOutcomeSuffix(OutcomeSuccess))
	require.Equal(t, "denied", defaultOutcomeSuffix(OutcomeDenied))
	require.Equal(t, "err", defaultOutcomeSuffix(OutcomeError))
	require.Equal(t, "recorded", defaultOutcomeSuffix(""))
	require.Equal(t, "recorded", defaultOutcomeSuffix("unexpected"))
}
