// #2067: per-action audit trail tests for session member mutations.
package session

import (
	"context"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// auditSpy captures RecordPrivilegedAction calls without importing service/audit.
type auditSpy struct {
	mu    sync.Mutex
	calls []PrivilegedActionAuditInput
}

func (s *auditSpy) RecordPrivilegedAction(_ context.Context, in PrivilegedActionAuditInput) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, in)
}

func (s *auditSpy) last() *PrivilegedActionAuditInput {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.calls) == 0 {
		return nil
	}
	c := s.calls[len(s.calls)-1]
	return &c
}

func newAuditTestService(t *testing.T) (*Service, *auditSpy) {
	t.Helper()
	db := newBehaviorServiceDB(t)
	cacheClient := newBehaviorServiceCache(t)
	bus := newTestBus(t)
	spy := &auditSpy{}
	svc := NewService(db, cacheClient, bus)
	svc.SetAuditService(spy)
	return svc, spy
}

func TestAddGroupMembers_AuditSuccess(t *testing.T) {
	svc, spy := newAuditTestService(t)
	ctx := context.Background()

	owner := createUser(t, svc.db, "owner-add", "Owner")
	friend := createUser(t, svc.db, "friend-add", "Friend")
	createFriendship(t, svc.db, owner, friend)

	resp, err := svc.CreateGroupSession(ctx, owner, "audit-group-add", nil)
	require.NoError(t, err)
	sessionID := resp.SessionID

	err = svc.AddGroupMembers(ctx, owner, sessionID, []string{friend})
	require.NoError(t, err)

	last := spy.last()
	require.NotNil(t, last, "expected audit record on success")
	assert.Equal(t, auditActionMemberAdd, last.Action)
	assert.Equal(t, owner, last.ActorUserID)
	assert.Equal(t, sessionID, last.ResourceID)
	assert.Equal(t, "session_member", last.ResourceType)
	assert.Equal(t, auditOutcomeSuccess, last.Outcome)
	assert.Equal(t, "member-role-owner", last.AuthBasis)
	assert.Empty(t, last.Reason)
}

func TestAddGroupMembers_AuditDenied_NotOwner(t *testing.T) {
	svc, spy := newAuditTestService(t)
	ctx := context.Background()

	owner := createUser(t, svc.db, "owner-deny", "Owner")
	nonOwner := createUser(t, svc.db, "nonowner-add", "NonOwner")
	target := createUser(t, svc.db, "target-add", "Target")
	createFriendship(t, svc.db, owner, nonOwner)

	resp, err := svc.CreateGroupSession(ctx, owner, "audit-group-deny", []string{nonOwner})
	require.NoError(t, err)
	sessionID := resp.SessionID

	err = svc.AddGroupMembers(ctx, nonOwner, sessionID, []string{target})
	require.Error(t, err)

	last := spy.last()
	require.NotNil(t, last, "expected audit record on denial")
	assert.Equal(t, auditActionMemberAdd, last.Action)
	assert.Equal(t, nonOwner, last.ActorUserID)
	assert.Equal(t, auditOutcomeDenied, last.Outcome)
	assert.Equal(t, "not owner", last.Reason)
}

func TestRemoveGroupMember_AuditSuccess(t *testing.T) {
	svc, spy := newAuditTestService(t)
	ctx := context.Background()

	owner := createUser(t, svc.db, "owner-rm", "Owner")
	victim := createUser(t, svc.db, "victim-rm", "Victim")
	createFriendship(t, svc.db, owner, victim)

	resp, err := svc.CreateGroupSession(ctx, owner, "audit-group-rm", []string{victim})
	require.NoError(t, err)
	sessionID := resp.SessionID

	err = svc.RemoveGroupMember(ctx, owner, sessionID, victim)
	require.NoError(t, err)

	last := spy.last()
	require.NotNil(t, last)
	assert.Equal(t, auditActionMemberRemove, last.Action)
	assert.Equal(t, owner, last.ActorUserID)
	assert.Equal(t, sessionID, last.ResourceID)
	assert.Equal(t, auditOutcomeSuccess, last.Outcome)
}

func TestRemoveGroupMember_AuditDenied_NotOwner(t *testing.T) {
	svc, spy := newAuditTestService(t)
	ctx := context.Background()

	owner := createUser(t, svc.db, "owner-rm-deny", "Owner")
	nonOwner := createUser(t, svc.db, "nonowner-rm", "NonOwner")
	victim := createUser(t, svc.db, "victim-rm-deny", "Victim")
	createFriendship(t, svc.db, owner, nonOwner)
	createFriendship(t, svc.db, owner, victim)

	resp, err := svc.CreateGroupSession(ctx, owner, "audit-group-rm-deny", []string{nonOwner, victim})
	require.NoError(t, err)
	sessionID := resp.SessionID

	err = svc.RemoveGroupMember(ctx, nonOwner, sessionID, victim)
	require.Error(t, err)

	last := spy.last()
	require.NotNil(t, last)
	assert.Equal(t, auditActionMemberRemove, last.Action)
	assert.Equal(t, nonOwner, last.ActorUserID)
	assert.Equal(t, auditOutcomeDenied, last.Outcome)
	assert.Equal(t, "not owner", last.Reason)
}

func TestSessionAudit_NilAuditor_Noop(t *testing.T) {
	db := newBehaviorServiceDB(t)
	cacheClient := newBehaviorServiceCache(t)
	svc := NewService(db, cacheClient)
	// Don't set audit — must not panic.
	ctx := context.Background()
	owner := createUser(t, db, "owner-nil", "Owner")
	friend := createUser(t, db, "friend-nil", "Friend")
	createFriendship(t, db, owner, friend)
	resp, err := svc.CreateGroupSession(ctx, owner, "audit-nil", nil)
	require.NoError(t, err)
	require.NoError(t, svc.AddGroupMembers(ctx, owner, resp.SessionID, []string{friend}))
}
