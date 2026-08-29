// #2067: per-action audit trail tests for agent team operations.
package agentteam

import (
	"context"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

type atAuditSpy struct {
	mu    sync.Mutex
	calls []PrivilegedActionAuditInput
}

func (s *atAuditSpy) RecordPrivilegedAction(_ context.Context, in PrivilegedActionAuditInput) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, in)
}

func (s *atAuditSpy) last() *PrivilegedActionAuditInput {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.calls) == 0 {
		return nil
	}
	c := s.calls[len(s.calls)-1]
	return &c
}

func newATServiceWithAudit(t *testing.T) (*AgentTeamService, *atAuditSpy) {
	t.Helper()
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	spy := &atAuditSpy{}
	svc.SetAuditService(spy)
	return svc, spy
}

func TestDecideApproval_AuditDenied_NotOwner(t *testing.T) {
	svc, spy := newATServiceWithAudit(t)
	ctx := context.Background()

	// Create a team owned by user-1
	team := &model.AgentTeam{OwnerID: "user-1", Name: "audit-team"}
	require.NoError(t, repository.CreateTeam(svc.db, team))

	// Try to decide approval as user-2 (not owner)
	_, err := svc.DecideApproval(ctx, "user-2", team.ID, "run-1", "appr-1", model.TeamApprovalDecision{
		Decision: "allow",
	})
	require.Error(t, err)

	last := spy.last()
	require.NotNil(t, last, "expected audit record on denial")
	assert.Equal(t, auditActionApprovalDecide, last.Action)
	assert.Equal(t, "user-2", last.ActorUserID)
	assert.Equal(t, "run-1", last.ResourceID)
	assert.Equal(t, auditOutcomeDenied, last.Outcome)
	assert.Equal(t, "not team owner", last.Reason)
}

func TestHandleRouteDecision_AuditDenied_NotOwner(t *testing.T) {
	svc, spy := newATServiceWithAudit(t)
	ctx := context.Background()

	team := &model.AgentTeam{OwnerID: "user-1", Name: "route-team"}
	require.NoError(t, repository.CreateTeam(svc.db, team))

	_, err := svc.HandleRouteDecision(ctx, "user-2", team.ID, "run-1", model.CoordinatorRouteDecision{
		Action:       "delegate",
		NextWorker:   "worker-1",
		Instructions: "do something",
	})
	require.Error(t, err)

	last := spy.last()
	require.NotNil(t, last)
	assert.Equal(t, auditActionRouteDecide, last.Action)
	assert.Equal(t, "user-2", last.ActorUserID)
	assert.Equal(t, auditOutcomeDenied, last.Outcome)
}

func TestReviewDagPlan_AuditDenied_NotTriggerUser(t *testing.T) {
	svc, spy := newATServiceWithAudit(t)
	ctx := context.Background()

	team := &model.AgentTeam{OwnerID: "user-1", Name: "review-team"}
	require.NoError(t, repository.CreateTeam(svc.db, team))

	// Create a run in pending_review status triggered by user-1
	run := &model.AgentTeamRun{
		TeamID:          team.ID,
		TriggerUserID:   "user-1",
		Status:          model.TeamRunStatusPendingReview,
		Mode:            "supervisor",
	}
	require.NoError(t, repository.CreateTeamRun(svc.db, run))

	// Try to review as user-2
	svc.SetHumanReviewEnabled(true)
	_, err := svc.ReviewDagPlan(ctx, "user-2", run.ID, model.HumanReviewDecision{
		Action: model.ReviewActionApprove,
	})
	require.Error(t, err)

	last := spy.last()
	require.NotNil(t, last)
	assert.Equal(t, auditActionReviewDecide, last.Action)
	assert.Equal(t, "user-2", last.ActorUserID)
	assert.Equal(t, auditOutcomeDenied, last.Outcome)
	assert.Equal(t, "not trigger user", last.Reason)
}

func TestAgentTeamAudit_NilAuditor_Noop(t *testing.T) {
	db := setupAgentTeamStateSQLite(t)
	svc := NewAgentTeamService(db, nil, nil)
	// Don't set audit — must not panic.
	team := &model.AgentTeam{OwnerID: "user-1", Name: "nil-audit-team"}
	require.NoError(t, repository.CreateTeam(db, team))
	_, _ = svc.DecideApproval(context.Background(), "user-2", team.ID, "run-1", "appr-1", model.TeamApprovalDecision{
		Decision: "allow",
	})
}
