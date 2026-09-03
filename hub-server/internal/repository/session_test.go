package repository

import (
	"testing"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// =============================================================================
// Session repository tests
// =============================================================================

func TestSessionRepo_CRUD(t *testing.T) {
	db := setupSQLite(t)

	session := &model.Session{
		Type:        model.SessionTypePrivate,
		Name:        "Test Session",
		OwnerUserID: strPtr("user-001"),
	}

	// Create
	err := CreateSession(db, session)
	require.NoError(t, err)
	assert.NotEmpty(t, session.ID)

	// Read
	fetched, err := GetSessionByID(db, session.ID)
	require.NoError(t, err)
	assert.Equal(t, model.SessionTypePrivate, fetched.Type)
	assert.Equal(t, "Test Session", fetched.Name)

	// Update
	fetched.Name = "Updated Session"
	err = UpdateSessionColumns(db, fetched, "name")
	require.NoError(t, err)

	fetched2, err := GetSessionByID(db, session.ID)
	require.NoError(t, err)
	assert.Equal(t, "Updated Session", fetched2.Name)
}

func TestSessionRepo_FindPrivateSessionBetween(t *testing.T) {
	db := setupSQLite(t)

	session := &model.Session{
		Type: model.SessionTypePrivate,
	}
	require.NoError(t, CreateSession(db, session))

	// Add both members
	m1 := &model.SessionMember{
		SessionID:  session.ID,
		MemberType: model.MemberTypeUser,
		MemberID:   "user-a",
		Role:       model.MemberRoleMember,
	}
	m2 := &model.SessionMember{
		SessionID:  session.ID,
		MemberType: model.MemberTypeUser,
		MemberID:   "user-b",
		Role:       model.MemberRoleMember,
	}
	require.NoError(t, CreateSessionMember(db, m1))
	require.NoError(t, CreateSessionMember(db, m2))

	// Find between
	found, err := FindPrivateSessionBetween(db, "user-a", "user-b")
	require.NoError(t, err)
	require.NotNil(t, found)
	assert.Equal(t, session.ID, found.ID)

	// Not found
	found, err = FindPrivateSessionBetween(db, "user-a", "user-c")
	require.NoError(t, err)
	assert.Nil(t, found)
}

func TestSessionRepo_TouchLastMessage(t *testing.T) {
	db := setupSQLite(t)

	session := &model.Session{Type: model.SessionTypeGroup, Name: "Group"}
	require.NoError(t, CreateSession(db, session))

	// Initially nil
	fetched, err := GetSessionByID(db, session.ID)
	require.NoError(t, err)
	assert.Nil(t, fetched.LastMessageAt)

	err = TouchSessionLastMessage(db, session.ID)
	require.NoError(t, err)

	fetched, err = GetSessionByID(db, session.ID)
	require.NoError(t, err)
	assert.NotNil(t, fetched.LastMessageAt)
}

func TestSessionRepo_ListUserSessions(t *testing.T) {
	// member_count uses a correlated scalar subquery compatible with both PG and SQLite.
	// Plan-level assertions are in session_member_count_test.go (PG-only EXPLAIN).
	db := setupSQLite(t)

	s := &model.Session{Type: model.SessionTypeGroup, Name: "ListGroup"}
	require.NoError(t, CreateSession(db, s))

	m := &model.SessionMember{
		SessionID:  s.ID,
		MemberType: model.MemberTypeUser,
		MemberID:   "user-l",
		Role:       model.MemberRoleOwner,
	}
	require.NoError(t, CreateSessionMember(db, m))

	result, err := ListUserSessions(db, "user-l")
	require.NoError(t, err)
	assert.Len(t, result, 1)
	assert.Equal(t, s.ID, result[0].ID)
	assert.Equal(t, model.MemberRoleOwner, result[0].Role)
}
