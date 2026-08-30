package session

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

func TestUnreadCount(t *testing.T) {
	assert.Equal(t, int64(0), UnreadCount(5, 5))
	assert.Equal(t, int64(3), UnreadCount(10, 7))
	assert.Equal(t, int64(0), UnreadCount(2, 5))
}

func TestOwnerUserIDString(t *testing.T) {
	assert.Equal(t, "", OwnerUserIDString(nil))
	id := "u-1"
	assert.Equal(t, "u-1", OwnerUserIDString(&id))
}

func TestSessionListItemFromMetaAndMap(t *testing.T) {
	owner := "owner-1"
	last := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	created := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	row := repository.SessionWithMeta{
		Session: model.Session{
			ID:            "s-1",
			Type:          model.SessionTypeGroup,
			Name:          "G",
			AvatarURL:     "http://a",
			OwnerUserID:   &owner,
			NextSeq:       10,
			LastMessageAt: &last,
			CreatedAt:     created,
		},
		Role:        model.MemberRoleOwner,
		Pinned:      true,
		Archived:    false,
		Muted:       true,
		LastReadSeq: 7,
		MemberCount: 4,
	}
	item := SessionListItemFromMeta(row)
	assert.Equal(t, "s-1", item.SessionID)
	assert.Equal(t, model.SessionTypeGroup, item.Type)
	assert.Equal(t, "G", item.Name)
	assert.Equal(t, "http://a", item.AvatarURL)
	assert.Equal(t, "owner-1", item.OwnerUserID)
	assert.True(t, item.Pinned)
	assert.False(t, item.Archived)
	assert.True(t, item.Muted)
	assert.Equal(t, &last, item.LastMessageAt)
	assert.Equal(t, int64(3), item.UnreadCount)
	assert.Equal(t, int64(4), item.MemberCount)
	assert.Equal(t, model.MemberRoleOwner, item.Role)
	assert.Equal(t, created, item.CreatedAt)

	mapped := MapSessionListItems([]repository.SessionWithMeta{row})
	require.Len(t, mapped, 1)
	assert.Equal(t, item, mapped[0])
}

func TestNewCreateSessionResponse(t *testing.T) {
	created := NewCreateSessionResponse("s1", model.SessionTypePrivate, true)
	assert.Equal(t, &CreateSessionResponse{SessionID: "s1", Type: model.SessionTypePrivate, Created: true}, created)
	existing := NewExistingSessionResponse("s2", model.SessionTypeGroup)
	assert.Equal(t, &CreateSessionResponse{SessionID: "s2", Type: model.SessionTypeGroup, Created: false}, existing)
}

func TestFriendHelpersAndDeduplicate(t *testing.T) {
	assert.True(t, AllAreFriends([]string{"a", "b"}, nil))
	assert.True(t, AllAreFriends([]string{"a", "b"}, []string{"a"}))
	assert.False(t, AllAreFriends([]string{"a"}, []string{"a", "c"}))
	assert.Equal(t, []string{"a", "b"}, DeduplicateIDs([]string{"a", "b", "a", "b"}))
	assert.Equal(t, map[string]bool{"a": true, "b": true}, FriendIDSet([]string{"a", "b"}))
}

func TestMemberBuilders(t *testing.T) {
	priv := PrivateSessionMembers("s1", "u1", "u2")
	require.Len(t, priv, 2)
	assert.Equal(t, model.MemberTypeUser, priv[0].MemberType)
	assert.Equal(t, model.MemberRoleMember, priv[0].Role)
	assert.Equal(t, "u1", priv[0].MemberID)
	assert.Equal(t, "u2", priv[1].MemberID)

	group := GroupSessionMembers("s2", "owner", []string{"m1", "m2"})
	require.Len(t, group, 3)
	assert.Equal(t, model.MemberRoleOwner, group[0].Role)
	assert.Equal(t, "owner", group[0].MemberID)
	assert.Equal(t, model.MemberRoleMember, group[1].Role)
	assert.Equal(t, []string{"owner", "m1", "m2"}, GroupMemberIDsForEvent("owner", []string{"m1", "m2"}))
}

func TestPartitionJoinMembers(t *testing.T) {
	soft := map[string]bool{"old": true}
	toReactivate, toCreate, joined := PartitionJoinMembers("s1", []string{"old", "new"}, soft)
	assert.Equal(t, []string{"old"}, toReactivate)
	require.Len(t, toCreate, 1)
	assert.Equal(t, "new", toCreate[0].MemberID)
	require.Len(t, joined, 2)
	assert.Equal(t, "old", joined[0].MemberID)
	assert.Equal(t, "new", joined[1].MemberID)
}

func TestAnyActiveMemberAndOwnerGuards(t *testing.T) {
	assert.True(t, AnyActiveMember(map[string]bool{"a": true}, []string{"b", "a"}))
	assert.False(t, AnyActiveMember(map[string]bool{"a": false}, []string{"a"}))

	owner := "o1"
	assert.True(t, IsSessionOwnerID(&owner, "o1"))
	assert.False(t, IsSessionOwnerID(&owner, "x"))
	assert.False(t, IsSessionOwnerID(nil, "o1"))

	members := []*model.SessionMember{
		{MemberID: "o1", MemberType: model.MemberTypeUser},
		{MemberID: "a1", MemberType: model.MemberTypeAgent},
		{MemberID: "u2", MemberType: model.MemberTypeUser},
	}
	assert.True(t, HasOtherActiveMember(members, "o1"))
	assert.False(t, HasOtherActiveMember([]*model.SessionMember{{MemberID: "o1"}}, "o1"))
	assert.True(t, HasOtherActiveUser(members, "o1"))
	assert.False(t, HasOtherActiveUser([]*model.SessionMember{
		{MemberID: "o1", MemberType: model.MemberTypeUser},
		{MemberID: "a1", MemberType: model.MemberTypeAgent},
	}, "o1"))
}

func TestEventPayloads(t *testing.T) {
	assert.Equal(t, map[string]interface{}{
		"session_id": "s1",
		"type":       "private",
		"owner_id":   "",
		"members":    []string{"u1", "u2"},
	}, PrivateSessionCreatedPayload("s1", "u1", "u2"))

	assert.Equal(t, map[string]interface{}{
		"session_id": "s2",
		"type":       "group",
		"name":       "G",
		"owner_id":   "o1",
		"members":    []string{"o1", "m1"},
	}, GroupSessionCreatedPayload("s2", "G", "o1", []string{"o1", "m1"}))

	assert.Equal(t, map[string]interface{}{
		"session_id":  "s1",
		"member_id":   "u1",
		"member_type": model.MemberTypeUser,
	}, MemberJoinedPayload("s1", "u1", model.MemberTypeUser))

	assert.Equal(t, map[string]interface{}{
		"session_id": "s1",
		"member_id":  "u1",
	}, MemberLeftPayload("s1", "u1"))

	assert.Equal(t, map[string]interface{}{"session_id": "s1"}, SessionDissolvedPayload("s1"))

	changes := map[string]interface{}{"name": "N"}
	assert.Equal(t, map[string]interface{}{
		"session_id": "s1",
		"changes":    changes,
	}, SessionInfoUpdatedPayload("s1", changes))

	assert.Equal(t, EventTypeSessionCreated, "session.created")
	assert.Equal(t, EventTypeSessionMemberJoined, "session.member_joined")
	assert.Equal(t, EventTypeSessionMemberLeft, "session.member_left")
	assert.Equal(t, EventTypeSessionDissolved, "session.dissolved")
	assert.Equal(t, EventTypeSessionInfoUpdated, "session.info_updated")
}

func TestApplyGroupInfoChangesAndCacheKeys(t *testing.T) {
	sess := &model.Session{Name: "old", AvatarURL: "a0", Announcement: "ann0"}
	name := "new"
	avatar := "a1"
	ann := "ann1"
	changes := ApplyGroupInfoChanges(sess, &name, &avatar, &ann)
	assert.Equal(t, "new", sess.Name)
	assert.Equal(t, "a1", sess.AvatarURL)
	assert.Equal(t, "ann1", sess.Announcement)
	assert.Equal(t, map[string]interface{}{
		"name":         "new",
		"avatar_url":   "a1",
		"announcement": "ann1",
	}, changes)

	onlyName := "x"
	partial := ApplyGroupInfoChanges(&model.Session{}, &onlyName, nil, nil)
	assert.Equal(t, map[string]interface{}{"name": "x"}, partial)
	assert.Equal(t, map[string]interface{}{}, ApplyGroupInfoChanges(nil, &onlyName, nil, nil))

	assert.Equal(t, "session:members:s1", SessionMembersCacheKey("s1"))
}
