package repository

import (
	"fmt"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

func TestSearchMessagesPostgresUsesTsvectorWithILikeFallback(t *testing.T) {
	db, mock, closeDB := setupPostgresSearchMock(t, []string{
		"to_tsvector('simple', coalesce(content->>'text', ''))",
		"@@ plainto_tsquery('simple',",
		"content->>'text' ilike",
		"escape",
	})
	defer closeDB()

	mock.ExpectQuery("message search tsvector").
		WillReturnRows(messageSearchRows())

	msgs, hasMore, err := SearchMessages(db, "needle", "session-1", "", "", "", "", 100)
	_ = hasMore
	require.NoError(t, err)
	require.Empty(t, msgs)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSearchAllMessagesPostgresUsesTsvectorWithILikeFallback(t *testing.T) {
	db, mock, closeDB := setupPostgresSearchMock(t, []string{
		"to_tsvector('simple', coalesce(m.content->>'text', ''))",
		"@@ plainto_tsquery('simple',",
		"m.content->>'text' ilike",
		"escape",
	})
	defer closeDB()

	mock.ExpectQuery("message search tsvector").
		WillReturnRows(messageSearchRows())

	msgs, hasMore, err := SearchAllMessages(db, "user-1", "needle", "", "", "", "", 100)
	_ = hasMore
	require.NoError(t, err)
	require.Empty(t, msgs)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSearchMessagesSQLiteUsesCompatibleTextFallback(t *testing.T) {
	db := setupSQLite(t)
	session := createTestSession(t, db)

	require.NoError(t, InsertMessage(db, &model.Message{
		SessionID:   session.ID,
		SeqID:       1,
		ClientMsgID: "search-sqlite-1",
		SenderType:  model.SenderTypeUser,
		SenderID:    "user-1",
		ContentType: model.ContentTypeText,
		Content:     `{"text":"Alpha needle"}`,
	}))
	require.NoError(t, InsertMessage(db, &model.Message{
		SessionID:   session.ID,
		SeqID:       2,
		ClientMsgID: "search-sqlite-2",
		SenderType:  model.SenderTypeUser,
		SenderID:    "user-1",
		ContentType: model.ContentTypeText,
		Content:     `{"text":"Beta only"}`,
	}))

	msgs, hasMore, err := SearchMessages(db, "needle", session.ID, "", "", "", "", 100)
	_ = hasMore
	require.NoError(t, err)
	require.Len(t, msgs, 1)
	require.Equal(t, "search-sqlite-1", msgs[0].ClientMsgID)
}

func TestSearchAllMessagesSQLiteUsesCompatibleTextFallback(t *testing.T) {
	db := setupSQLite(t)
	session := createTestSession(t, db)
	require.NoError(t, CreateSessionMember(db, &model.SessionMember{
		SessionID:  session.ID,
		MemberType: model.MemberTypeUser,
		MemberID:   "user-1",
		Role:       model.MemberRoleMember,
	}))

	require.NoError(t, InsertMessage(db, &model.Message{
		SessionID:   session.ID,
		SeqID:       1,
		ClientMsgID: "search-all-sqlite-1",
		SenderType:  model.SenderTypeUser,
		SenderID:    "user-1",
		ContentType: model.ContentTypeText,
		Content:     `{"text":"Shared needle"}`,
	}))

	msgs, hasMore, err := SearchAllMessages(db, "user-1", "needle", "", "", "", "", 100)
	_ = hasMore
	require.NoError(t, err)
	require.Len(t, msgs, 1)
	require.Equal(t, "search-all-sqlite-1", msgs[0].ClientMsgID)
}

func setupPostgresSearchMock(t *testing.T, fragments []string) (*gorm.DB, sqlmock.Sqlmock, func()) {
	t.Helper()

	sqlDB, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherFunc(
		func(_ string, actualSQL string) error {
			normalizedActual := normalizeSQL(actualSQL)
			for _, fragment := range fragments {
				if !strings.Contains(normalizedActual, normalizeSQL(fragment)) {
					return fmt.Errorf("expected SQL fragment %q in %q", fragment, actualSQL)
				}
			}
			return nil
		},
	)))
	require.NoError(t, err)

	db, err := gorm.Open(postgres.New(postgres.Config{
		Conn:                 sqlDB,
		PreferSimpleProtocol: true,
	}), &gorm.Config{
		DisableAutomaticPing: true,
		Logger:               gormlogger.Default.LogMode(gormlogger.Silent),
	})
	require.NoError(t, err)

	return db, mock, func() {
		_ = sqlDB.Close()
	}
}

func messageSearchRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id",
		"session_id",
		"seq_id",
		"client_msg_id",
		"sender_type",
		"sender_id",
		"content_type",
		"content",
		"recalled",
		"created_at",
	})
}
