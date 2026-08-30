// #2067: per-action audit trail tests for execution target mutations.
package executiontarget

import (
	"context"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/model"
)

type etAuditSpy struct {
	mu    sync.Mutex
	calls []PrivilegedActionAuditInput
}

func (s *etAuditSpy) RecordPrivilegedAction(_ context.Context, in PrivilegedActionAuditInput) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, in)
}

func (s *etAuditSpy) last() *PrivilegedActionAuditInput {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.calls) == 0 {
		return nil
	}
	c := s.calls[len(s.calls)-1]
	return &c
}

func newETServiceWithAudit(t *testing.T) (*Service, *etAuditSpy) {
	t.Helper()
	db := newExecutionTargetTestDB(t)
	svc := newExecutionTargetSvc(t, db)
	spy := &etAuditSpy{}
	svc.SetAuditService(spy)
	return svc, spy
}

func TestCreate_AuditSuccess(t *testing.T) {
	svc, spy := newETServiceWithAudit(t)
	ctx := context.Background()
	ownerID := "owner-create"

	target, err := svc.Create(ctx, ownerID, &model.ExecutionTarget{
		Name:       "test-target",
		TargetType: "local_edge",
	})
	require.NoError(t, err)

	last := spy.last()
	require.NotNil(t, last)
	assert.Equal(t, auditActionTargetCreate, last.Action)
	assert.Equal(t, ownerID, last.ActorUserID)
	assert.Equal(t, target.ID, last.ResourceID)
	assert.Equal(t, "execution_target", last.ResourceType)
	assert.Equal(t, auditOutcomeSuccess, last.Outcome)
	assert.Equal(t, "owner", last.AuthBasis)
}

func TestUpdate_AuditDenied_OwnerMismatch(t *testing.T) {
	svc, spy := newETServiceWithAudit(t)
	ctx := context.Background()
	ownerID := "owner-upd"
	otherID := "other-upd"

	target, err := svc.Create(ctx, ownerID, &model.ExecutionTarget{
		Name:       "upd-target",
		TargetType: "local_edge",
	})
	require.NoError(t, err)

	newName := "renamed"
	_, err = svc.Update(ctx, target.ID, otherID, &model.ExecutionTargetPatch{
		Name: model.Patch(newName),
	})
	require.Error(t, err)

	last := spy.last()
	require.NotNil(t, last)
	assert.Equal(t, auditActionTargetUpdate, last.Action)
	assert.Equal(t, otherID, last.ActorUserID)
	assert.Equal(t, auditOutcomeDenied, last.Outcome)
	assert.Equal(t, "owner mismatch", last.Reason)
}

func TestUpdate_AuditSuccess(t *testing.T) {
	svc, spy := newETServiceWithAudit(t)
	ctx := context.Background()
	ownerID := "owner-upd-ok"

	target, err := svc.Create(ctx, ownerID, &model.ExecutionTarget{
		Name:       "upd-ok-target",
		TargetType: "local_edge",
	})
	require.NoError(t, err)

	newName := "renamed-ok"
	_, err = svc.Update(ctx, target.ID, ownerID, &model.ExecutionTargetPatch{
		Name: model.Patch(newName),
	})
	require.NoError(t, err)

	last := spy.last()
	require.NotNil(t, last)
	assert.Equal(t, auditActionTargetUpdate, last.Action)
	assert.Equal(t, ownerID, last.ActorUserID)
	assert.Equal(t, auditOutcomeSuccess, last.Outcome)
}

func TestDelete_AuditDenied_OwnerMismatch(t *testing.T) {
	svc, spy := newETServiceWithAudit(t)
	ctx := context.Background()
	ownerID := "owner-del"
	otherID := "other-del"

	target, err := svc.Create(ctx, ownerID, &model.ExecutionTarget{
		Name:       "del-target",
		TargetType: "local_edge",
	})
	require.NoError(t, err)

	err = svc.Delete(ctx, target.ID, otherID)
	require.Error(t, err)

	last := spy.last()
	require.NotNil(t, last)
	assert.Equal(t, auditActionTargetDelete, last.Action)
	assert.Equal(t, otherID, last.ActorUserID)
	assert.Equal(t, auditOutcomeDenied, last.Outcome)
}

func TestDelete_AuditSuccess(t *testing.T) {
	svc, spy := newETServiceWithAudit(t)
	ctx := context.Background()
	ownerID := "owner-del-ok"

	target, err := svc.Create(ctx, ownerID, &model.ExecutionTarget{
		Name:       "del-ok-target",
		TargetType: "local_edge",
	})
	require.NoError(t, err)

	err = svc.Delete(ctx, target.ID, ownerID)
	require.NoError(t, err)

	last := spy.last()
	require.NotNil(t, last)
	assert.Equal(t, auditActionTargetDelete, last.Action)
	assert.Equal(t, ownerID, last.ActorUserID)
	assert.Equal(t, auditOutcomeSuccess, last.Outcome)
}
