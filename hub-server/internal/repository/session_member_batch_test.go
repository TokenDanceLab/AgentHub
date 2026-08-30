package repository

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/model"
)

func TestBatchSoftDeleteMembers_Empty(t *testing.T) {
	db := setupSQLite(t)
	assert.NoError(t, BatchSoftDeleteMembers(db, "s1", model.MemberTypeAgent, nil))
	assert.NoError(t, BatchSoftDeleteMembers(db, "s1", model.MemberTypeAgent, []string{}))
}

func TestBatchSoftDeleteMembers_Multiple(t *testing.T) {
	db := setupSQLite(t)
	members := []model.SessionMember{
		{ID: "m1", SessionID: "s1", MemberType: model.MemberTypeAgent, MemberID: "a1", Role: model.MemberRoleMember},
		{ID: "m2", SessionID: "s1", MemberType: model.MemberTypeAgent, MemberID: "a2", Role: model.MemberRoleMember},
		{ID: "m3", SessionID: "s1", MemberType: model.MemberTypeAgent, MemberID: "a3", Role: model.MemberRoleMember},
		{ID: "m4", SessionID: "s1", MemberType: model.MemberTypeUser, MemberID: "u1", Role: model.MemberRoleMember},
	}
	for i := range members {
		require.NoError(t, db.Create(&members[i]).Error)
	}

	require.NoError(t, BatchSoftDeleteMembers(db, "s1", model.MemberTypeAgent, []string{"a1", "a2"}))

	var active []model.SessionMember
	require.NoError(t, db.Where("session_id = ? AND member_type = ? AND left_at IS NULL", "s1", model.MemberTypeAgent).Find(&active).Error)
	assert.Len(t, active, 1)
	assert.Equal(t, "a3", active[0].MemberID)

	var softDeletedCount int64
	require.NoError(t, db.Model(&model.SessionMember{}).Where("session_id = ? AND member_type = ? AND left_at IS NOT NULL", "s1", model.MemberTypeAgent).Count(&softDeletedCount).Error)
	assert.Equal(t, int64(2), softDeletedCount)

	var userActive []model.SessionMember
	require.NoError(t, db.Where("session_id = ? AND member_type = ? AND left_at IS NULL", "s1", model.MemberTypeUser).Find(&userActive).Error)
	assert.Len(t, userActive, 1)
}
