package repository

import (
	"testing"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMessageReactionRepo_AddListCountAndRemove(t *testing.T) {
	db := setupSQLite(t)
	s := createTestSession(t, db)
	msg := &model.Message{
		SessionID:   s.ID,
		SeqID:       1,
		ClientMsgID: "reaction-client-1",
		SenderType:  model.SenderTypeUser,
		SenderID:    "sender-1",
		ContentType: model.ContentTypeText,
		Content:     `{"text":"hello"}`,
	}
	require.NoError(t, InsertMessage(db, msg))

	reaction := &model.MessageReaction{
		SessionID: s.ID,
		MessageID: msg.ID,
		UserID:    "user-1",
		Reaction:  "thumbs_up",
	}
	require.NoError(t, AddReaction(db, reaction))
	require.NotEmpty(t, reaction.ID)

	reactions, err := ListReactionsByMessage(db, s.ID, msg.ID)
	require.NoError(t, err)
	require.Len(t, reactions, 1)
	assert.Equal(t, "thumbs_up", reactions[0].Reaction)
	assert.Equal(t, "user-1", reactions[0].UserID)

	byMessage, err := ListReactionsByMessages(db, s.ID, []string{msg.ID, "missing-message"})
	require.NoError(t, err)
	require.Len(t, byMessage[msg.ID], 1)
	assert.Empty(t, byMessage["missing-message"])

	counts, err := ReactionCountsByMessage(db, s.ID, []string{msg.ID, "missing-message"})
	require.NoError(t, err)
	assert.Equal(t, int64(1), counts[msg.ID])
	assert.Zero(t, counts["missing-message"])

	summaries, err := ReactionSummariesByMessage(db, s.ID, msg.ID)
	require.NoError(t, err)
	require.Len(t, summaries, 1)
	assert.Equal(t, "thumbs_up", summaries[0].Reaction)
	assert.Equal(t, 1, summaries[0].Count)
	assert.Equal(t, []string{"user-1"}, summaries[0].UserIDs)

	require.NoError(t, RemoveReaction(db, s.ID, msg.ID, "user-1", "thumbs_up"))

	reactions, err = ListReactionsByMessage(db, s.ID, msg.ID)
	require.NoError(t, err)
	assert.Empty(t, reactions)
}

func TestMessageReactionRepo_AddReactionIsIdempotentForDuplicateUserReaction(t *testing.T) {
	db := setupSQLite(t)
	s := createTestSession(t, db)
	msg := &model.Message{
		SessionID:   s.ID,
		SeqID:       1,
		ClientMsgID: "reaction-client-duplicate",
		SenderType:  model.SenderTypeUser,
		SenderID:    "sender-1",
		ContentType: model.ContentTypeText,
		Content:     `{"text":"hello"}`,
	}
	require.NoError(t, InsertMessage(db, msg))

	reaction := model.MessageReaction{
		SessionID: s.ID,
		MessageID: msg.ID,
		UserID:    "user-1",
		Reaction:  "heart",
	}
	require.NoError(t, AddReaction(db, &reaction))
	require.NoError(t, AddReaction(db, &model.MessageReaction{
		SessionID: s.ID,
		MessageID: msg.ID,
		UserID:    "user-1",
		Reaction:  "heart",
	}))

	counts, err := ReactionCountsByMessage(db, s.ID, []string{msg.ID})
	require.NoError(t, err)
	assert.Equal(t, int64(1), counts[msg.ID])
}

func TestMessageReactionRepo_RemoveReactionIsIdempotentForMissingRows(t *testing.T) {
	db := setupSQLite(t)

	require.NoError(t, RemoveReaction(db, "missing-session", "missing-message", "missing-user", "heart"))
}

func TestMessageReactionRepo_EmptyInputsReturnEmptyMaps(t *testing.T) {
	db := setupSQLite(t)

	byMessage, err := ListReactionsByMessages(db, "session-1", nil)
	require.NoError(t, err)
	assert.Empty(t, byMessage)

	counts, err := ReactionCountsByMessage(db, "session-1", nil)
	require.NoError(t, err)
	assert.Empty(t, counts)

	summaries, err := ReactionSummariesByMessage(db, "session-1", "message-1")
	require.NoError(t, err)
	assert.Empty(t, summaries)
}
