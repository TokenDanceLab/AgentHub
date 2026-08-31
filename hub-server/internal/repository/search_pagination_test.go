package repository

import (
	"fmt"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/model"
)

func TestSearchMessagesCursorPagination(t *testing.T) {
	db := setupSQLite(t)
	session := createTestSession(t, db)
	for i := int64(1); i <= 5; i++ {
		require.NoError(t, InsertMessage(db, &model.Message{
			SessionID:   session.ID,
			SeqID:       i,
			ClientMsgID: fmt.Sprintf("m-%d", i),
			SenderType:  model.SenderTypeUser,
			SenderID:    "user-1",
			ContentType: model.ContentTypeText,
			Content:     fmt.Sprintf(`{"text":"needle %d"}`, i),
		}))
	}

	// Page 1: newest two (seq 5,4), hasMore.
	page1, hasMore, err := SearchMessages(db, "needle", session.ID, "", "", "", "", 2)
	require.NoError(t, err)
	require.True(t, hasMore)
	require.Len(t, page1, 2)
	require.Equal(t, int64(5), page1[0].SeqID)
	require.Equal(t, int64(4), page1[1].SeqID)

	// Page 2: seq 3,2.
	page2, hasMore, err := SearchMessages(db, "needle", session.ID, "", "", "", strconv.FormatInt(page1[1].SeqID, 10)+"|"+page1[1].ID, 2)
	require.NoError(t, err)
	require.True(t, hasMore)
	require.Len(t, page2, 2)
	require.Equal(t, int64(3), page2[0].SeqID)

	// Page 3: seq 1, no more.
	page3, hasMore, err := SearchMessages(db, "needle", session.ID, "", "", "", strconv.FormatInt(page2[1].SeqID, 10)+"|"+page2[1].ID, 2)
	require.NoError(t, err)
	require.False(t, hasMore)
	require.Len(t, page3, 1)
	require.Equal(t, int64(1), page3[0].SeqID)

	// Malformed cursor → fresh page.
	fresh, _, err := SearchMessages(db, "needle", session.ID, "", "", "", "garbage", 2)
	require.NoError(t, err)
	require.Len(t, fresh, 2)
	require.Equal(t, int64(5), fresh[0].SeqID)
}

func TestSearchAllMessagesCursorPagination(t *testing.T) {
	db := setupSQLite(t)
	session := createTestSession(t, db)
	require.NoError(t, CreateSessionMember(db, &model.SessionMember{
		SessionID:  session.ID,
		MemberType: model.MemberTypeUser,
		MemberID:   "user-1",
		Role:       model.MemberRoleMember,
	}))
	base := time.Now()
	for i := 0; i < 5; i++ {
		require.NoError(t, InsertMessage(db, &model.Message{
			SessionID:   session.ID,
			SeqID:       int64(i + 1),
			ClientMsgID: fmt.Sprintf("all-%d", i),
			SenderType:  model.SenderTypeUser,
			SenderID:    "user-1",
			ContentType: model.ContentTypeText,
			Content:     fmt.Sprintf(`{"text":"shared needle %d"}`, i),
			CreatedAt:   base.Add(time.Duration(i) * time.Second),
		}))
	}

	page1, hasMore, err := SearchAllMessages(db, "user-1", "needle", "", "", "", "", 2)
	require.NoError(t, err)
	require.True(t, hasMore)
	require.Len(t, page1, 2)
	require.Equal(t, "all-4", page1[0].ClientMsgID)

	cursor := strconv.FormatInt(page1[1].CreatedAt.UnixNano(), 10) + "|" + page1[1].ID
	page2, hasMore, err := SearchAllMessages(db, "user-1", "needle", "", "", "", cursor, 2)
	require.NoError(t, err)
	require.True(t, hasMore)
	require.Len(t, page2, 2)
	require.Equal(t, "all-2", page2[0].ClientMsgID)

	page3, hasMore, err := SearchAllMessages(db, "user-1", "needle", "", "", "", strconv.FormatInt(page2[1].CreatedAt.UnixNano(), 10)+"|"+page2[1].ID, 2)
	require.NoError(t, err)
	require.False(t, hasMore)
	require.Len(t, page3, 1)
	require.Equal(t, "all-0", page3[0].ClientMsgID)
}

func TestSearchSessionsCursorPagination(t *testing.T) {
	db := setupSQLite(t)
	require.NoError(t, CreateUser(db, &model.User{ID: "user-1", Username: "user-1", Nickname: "User One"}))
	for i := 0; i < 5; i++ {
		s := &model.Session{
			Type:        model.SessionTypeGroup,
			Name:        fmt.Sprintf("Searchable %d", i),
			OwnerUserID: strPtr("user-1"),
		}
		require.NoError(t, CreateSession(db, s))
		require.NoError(t, CreateSessionMember(db, &model.SessionMember{
			SessionID:  s.ID,
			MemberType: model.MemberTypeUser,
			MemberID:   "user-1",
			Role:       model.MemberRoleOwner,
		}))
	}

	page1, hasMore, err := SearchSessions(db, "user-1", "Searchable", "", 2)
	require.NoError(t, err)
	require.True(t, hasMore)
	require.Len(t, page1, 2)

	last := page1[1]
	activity := last.CreatedAt
	if last.LastMessageAt != nil {
		activity = *last.LastMessageAt
	}
	cursor := strconv.FormatInt(activity.UnixNano(), 10) + "|" + last.ID

	page2, hasMore, err := SearchSessions(db, "user-1", "Searchable", cursor, 2)
	require.NoError(t, err)
	require.True(t, hasMore)
	require.Len(t, page2, 2)

	last2 := page2[1]
	activity2 := last2.CreatedAt
	if last2.LastMessageAt != nil {
		activity2 = *last2.LastMessageAt
	}
	page3, hasMore, err := SearchSessions(db, "user-1", "Searchable", strconv.FormatInt(activity2.UnixNano(), 10)+"|"+last2.ID, 2)
	require.NoError(t, err)
	require.False(t, hasMore)
	require.Len(t, page3, 1)
}
