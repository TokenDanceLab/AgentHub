// #2067: per-action audit trail tests for agent run event operations.
package agent

import (
	"context"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
)

type reAuditSpy struct {
	mu    sync.Mutex
	calls []PrivilegedActionAuditInput
}

func (s *reAuditSpy) RecordPrivilegedAction(_ context.Context, in PrivilegedActionAuditInput) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, in)
}

func TestRunEventAudit_NilAuditor_Noop(t *testing.T) {
	res := NewRunEventService(nil, nil)
	// Must not panic with nil audit.
	res.recordApprovalAudit(context.Background(), "task-1", "user-1", auditOutcomeSuccess, "")
}

func TestRunEventAudit_SpyReceivesFields(t *testing.T) {
	spy := &reAuditSpy{}
	res := NewRunEventService(nil, nil)
	res.SetAuditService(spy)

	res.recordApprovalAudit(context.Background(), "task-42", "user-7", auditOutcomeDenied, "not owner")

	require.Len(t, spy.calls, 1)
	c := spy.calls[0]
	require.Equal(t, auditActionApprovalDecide, c.Action)
	require.Equal(t, "task-42", c.ResourceID)
	require.Equal(t, "user-7", c.ActorUserID)
	require.Equal(t, auditOutcomeDenied, c.Outcome)
	require.Equal(t, "not owner", c.Reason)
	require.Equal(t, "task", c.ResourceType)
	require.Equal(t, "owner", c.AuthBasis)
}
