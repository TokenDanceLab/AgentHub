// #2067: per-action audit trail tests for dispatch operations.
// Full success/denied path tests require a Postgres-backed integration test
// (SQLite cannot scan PendingAgentTask.expire_at as time.Time). The nil-auditor
// noop test verifies the guard clause without hitting the DB read path.
package dispatchsvc

import (
	"context"
	"sync"
	"testing"

	"github.com/agenthub/hub-server/internal/config"

	"github.com/stretchr/testify/require"
)

type dsAuditSpy struct {
	mu    sync.Mutex
	calls []PrivilegedActionAuditInput
}

func (s *dsAuditSpy) RecordPrivilegedAction(_ context.Context, in PrivilegedActionAuditInput) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, in)
}

func TestDispatchAudit_NilAuditor_Noop(t *testing.T) {
	ds := NewDispatchService(nil, nil, nil, nil, nil, nil, config.EdgeDispatchConfig{}, nil, "")
	// Don't set audit — must not panic on nil receiver paths.
	ds.recordDispatchAudit(context.Background(), auditActionTaskCancel, "task-1", "user-1", auditOutcomeSuccess, "")
}

func TestDispatchAudit_SpyReceivesFields(t *testing.T) {
	spy := &dsAuditSpy{}
	ds := NewDispatchService(nil, nil, nil, nil, nil, nil, config.EdgeDispatchConfig{}, nil, "")
	ds.SetAuditService(spy)

	ds.recordDispatchAudit(context.Background(), auditActionTaskCancel, "task-42", "user-7", auditOutcomeDenied, "not owner")

	require.Len(t, spy.calls, 1)
	c := spy.calls[0]
	require.Equal(t, auditActionTaskCancel, c.Action)
	require.Equal(t, "task-42", c.ResourceID)
	require.Equal(t, "user-7", c.ActorUserID)
	require.Equal(t, auditOutcomeDenied, c.Outcome)
	require.Equal(t, "not owner", c.Reason)
	require.Equal(t, "task", c.ResourceType)
	require.Equal(t, "owner", c.AuthBasis)
}
