package message

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/errcode"
)

func newTestBus(t *testing.T) *bus.Bus {
	t.Helper()
	b, err := bus.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { b.Close(context.Background()) })
	return b
}

func newMockDB(t *testing.T) (*gorm.DB, sqlmock.Sqlmock, *sql.DB) {
	t.Helper()
	sqlDB, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherFunc(func(expectedSQL, actualSQL string) error {
		if strings.Contains(actualSQL, expectedSQL) {
			return nil
		}
		return fmt.Errorf("expected SQL containing %q, got %q", expectedSQL, actualSQL)
	})))
	require.NoError(t, err)
	gormDB, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{
		SkipDefaultTransaction: true,
		PrepareStmt:            false,
	})
	require.NoError(t, err)
	return gormDB, mock, sqlDB
}

type mockMsgCache struct {
	seq int64
	err error
}

func (m *mockMsgCache) AllocateSeq(ctx context.Context, sessionID string) (int64, error) {
	return m.seq, m.err
}

func (m *mockMsgCache) SetSeq(ctx context.Context, sessionID string, seq int64) error {
	if m.err != nil {
		return m.err
	}
	m.seq = seq
	return nil
}

// recordingMsgBus is a Bus test double that records Publish calls.
type recordingMsgBus struct {
	events []bus.Event
}

func (b *recordingMsgBus) Publish(ctx context.Context, event bus.Event) error {
	b.events = append(b.events, event)
	return nil
}

func TestService_NilBusPublishIsNoop(t *testing.T) {
	svc := &Service{db: nil, bus: nil, cacheClient: &mockMsgCache{seq: 1}}
	// Must not panic when b port is unset (read-only/partial construction).
	svc.publish(context.Background(), bus.Event{Type: "message.new", Payload: "x"})
}

func TestService_SetBusAndSetCachePorts(t *testing.T) {
	rec := &recordingMsgBus{}
	cache := &mockMsgCache{seq: 9}
	svc := NewService(nil, nil, nil)
	require.NotNil(t, svc)

	svc.SetBus(rec)
	svc.SetCache(cache)
	svc.publish(context.Background(), bus.Event{Type: "message.read", Payload: map[string]string{"k": "v"}})

	require.Len(t, rec.events, 1)
	assert.Equal(t, "message.read", rec.events[0].Type)
	assert.Equal(t, int64(9), cache.seq)
}

// SQL substrings used for matching (QueryMatcherFunc with strings.Contains from newMockDB)
const (
	sqlmSessionMember = `FROM "session_members" WHERE`
	sqlmSessionByID   = `FROM "sessions" WHERE id =`
	sqlmMessage       = `FROM "messages" WHERE`
	sqlmPin           = `FROM "message_pins" WHERE`
	sqlmInsertMsg     = `INSERT INTO "messages"`
	sqlmInsertPin     = `INSERT INTO "message_pins"`
	sqlmUpdateMsg     = `UPDATE "messages" SET`
	sqlmUpdateSession = `UPDATE "sessions" SET`
	// Column-specific variants so a test can tell the seqalloc next_seq mirror
	// apart from the last_message_at activity touch (#2154 P2-8 asserts the
	// latter happens exactly once per send, inside the persist transaction).
	sqlmUpdateSessionNextSeq     = `UPDATE "sessions" SET "next_seq"`
	sqlmUpdateSessionLastMessage = `UPDATE "sessions" SET "last_message_at"`
	sqlmUpdateMember             = `UPDATE "session_members" SET`
	sqlmDeletePin                = `DELETE FROM "message_pins"`
	sqlmSeqFallbackMsg           = `UPDATE sessions SET next_seq`
)

// ==================== SendMessage ====================

func TestSendMessage_InvalidContentType(t *testing.T) {
	db, _, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	svc := &Service{db: db, cacheClient: &mockMsgCache{seq: 1}}
	_, err := svc.SendMessage(context.Background(), "sess-1", "user-1", SendMessageRequest{
		ClientMsgID: "msg-1",
		ContentType: "invalid_type",
		Content:     "hello",
	})
	assert.Error(t, err)
}

func TestSendMessage_InvalidContentJSON(t *testing.T) {
	db, _, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	svc := &Service{db: db, cacheClient: &mockMsgCache{seq: 1}}

	// Missing required "text" field for code type
	_, err := svc.SendMessage(context.Background(), "sess-1", "user-1", SendMessageRequest{
		ClientMsgID: "msg-1",
		ContentType: "code",
		Content:     `{}`,
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, errcode.ErrBadRequest)

	// Missing required "url" field for image type
	_, err = svc.SendMessage(context.Background(), "sess-1", "user-1", SendMessageRequest{
		ClientMsgID: "msg-2",
		ContentType: "image",
		Content:     `{"width": 100, "height": 200}`,
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, errcode.ErrBadRequest)

	// Missing required "attachment_id" for file type
	_, err = svc.SendMessage(context.Background(), "sess-1", "user-1", SendMessageRequest{
		ClientMsgID: "msg-3",
		ContentType: "file",
		Content:     `{"name": "test.txt"}`,
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, errcode.ErrBadRequest)

	// Not valid JSON at all
	_, err = svc.SendMessage(context.Background(), "sess-1", "user-1", SendMessageRequest{
		ClientMsgID: "msg-4",
		ContentType: "code",
		Content:     "not-json",
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, errcode.ErrBadRequest)

	// deploy_card has no required fields — always passes
	// (but it still gets validated by the caller... wait, we skip deploy_card in validation)
	// Text content type goes through wrapping, not validation
	_, err = svc.SendMessage(context.Background(), "sess-1", "user-1", SendMessageRequest{
		ClientMsgID: "msg-5",
		ContentType: "deploy_card",
		Content:     `{"anything": "goes"}`,
	})
	// Will fail at member check, not content validation
	assert.Error(t, err)
}

func TestSendMessage_NotMember(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	svc := &Service{db: db, cacheClient: &mockMsgCache{seq: 1}}
	_, err := svc.SendMessage(context.Background(), "sess-1", "user-1", SendMessageRequest{
		ClientMsgID: "msg-1",
		ContentType: "text",
		Content:     "hello",
	})
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestSendMessage_SessionDissolved(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	mock.ExpectQuery(sqlmSessionByID).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved"}).
			AddRow("sess-1", "group", true))

	svc := &Service{db: db, cacheClient: &mockMsgCache{seq: 1}}
	_, err := svc.SendMessage(context.Background(), "sess-1", "user-1", SendMessageRequest{
		ClientMsgID: "msg-1",
		ContentType: "code",
		Content:     `{"text":"print('hi')"}`,
	})
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestSendMessage_BlockedByReceiver(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	mock.ExpectQuery(sqlmSessionByID).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved"}).
			AddRow("sess-1", "private", false))

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "member_type", "member_id", "left_at"}).
			AddRow("mem-2", "sess-1", "user", "other-user", nil))

	mock.ExpectQuery(`FROM "friendships" WHERE`).
		WithArgs("other-user", "user-1", "blocked").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	svc := &Service{db: db, cacheClient: &mockMsgCache{seq: 1}}
	_, err := svc.SendMessage(context.Background(), "sess-1", "user-1", SendMessageRequest{
		ClientMsgID: "msg-1",
		ContentType: "text",
		Content:     "hello",
	})
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestSendMessage_DuplicateClientMsgID(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	mock.ExpectQuery(sqlmSessionByID).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved"}).
			AddRow("sess-1", "group", false))

	now := time.Now()
	mock.ExpectQuery(sqlmMessage).
		WithArgs("sess-1", "msg-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "seq_id", "client_msg_id", "content", "created_at"}).
			AddRow("existing-msg", "sess-1", 42, "msg-1", "hello", now))

	svc := &Service{db: db, cacheClient: &mockMsgCache{seq: 1}}
	resp, err := svc.SendMessage(context.Background(), "sess-1", "user-1", SendMessageRequest{
		ClientMsgID: "msg-1",
		ContentType: "text",
		Content:     "hello",
	})
	require.NoError(t, err)
	assert.Equal(t, "existing-msg", resp.MessageID)
	assert.Equal(t, int64(42), resp.SeqID)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestSendMessage_Success(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	mock.ExpectQuery(sqlmSessionByID).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved"}).
			AddRow("sess-1", "group", false))

	mock.ExpectQuery(sqlmMessage).
		WithArgs("sess-1", "msg-1", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	// seqalloc.Allocate mirrors the Redis seq into sessions.next_seq. This is
	// the ONLY sessions UPDATE outside the persist transaction: allocateSeq no
	// longer touches last_message_at (#2154 P2-8 removed the duplicate write).
	mock.ExpectExec(sqlmUpdateSessionNextSeq).
		WithArgs(sqlmock.AnyArg(), "sess-1", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))

	// db.Transaction wraps InsertMessage + TouchSessionLastMessage
	mock.ExpectBegin()
	mock.ExpectExec(sqlmInsertMsg).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(sqlmUpdateSessionLastMessage).
		WithArgs(sqlmock.AnyArg(), "sess-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	svc := &Service{db: db, bus: newTestBus(t), cacheClient: &mockMsgCache{seq: 42}}
	resp, err := svc.SendMessage(context.Background(), "sess-1", "user-1", SendMessageRequest{
		ClientMsgID: "msg-1",
		ContentType: "text",
		Content:     "hello world",
	})
	require.NoError(t, err)
	assert.NotEmpty(t, resp.MessageID)
	assert.Equal(t, int64(42), resp.SeqID)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestSendMessage_SuccessNonText(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	mock.ExpectQuery(sqlmSessionByID).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved"}).
			AddRow("sess-1", "group", false))

	mock.ExpectQuery(sqlmMessage).
		WithArgs("sess-1", "msg-c", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	// seqalloc seq mirror only — see TestSendMessage_Success (#2154 P2-8).
	mock.ExpectExec(sqlmUpdateSessionNextSeq).
		WithArgs(sqlmock.AnyArg(), "sess-1", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))

	// db.Transaction wraps InsertMessage + TouchSessionLastMessage
	mock.ExpectBegin()
	mock.ExpectExec(sqlmInsertMsg).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(sqlmUpdateSessionLastMessage).
		WithArgs(sqlmock.AnyArg(), "sess-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	svc := &Service{db: db, bus: newTestBus(t), cacheClient: &mockMsgCache{seq: 99}}
	resp, err := svc.SendMessage(context.Background(), "sess-1", "user-1", SendMessageRequest{
		ClientMsgID: "msg-c",
		ContentType: "code",
		Content:     `{"text":"console.log('hi')"}`,
	})
	require.NoError(t, err)
	assert.NotEmpty(t, resp.MessageID)
	assert.Equal(t, int64(99), resp.SeqID)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestSendMessage_NormalizesNonTextContentBeforeJsonbWrite(t *testing.T) {
	db := newMessageAttachmentTestDB(t)
	seedMessageSessionMember(t, db, "sess-code", "user-1")

	svc := &Service{db: db, bus: newTestBus(t), cacheClient: &mockMsgCache{seq: 5}}
	resp, err := svc.SendMessage(context.Background(), "sess-code", "user-1", SendMessageRequest{
		ClientMsgID: "11111111-1111-4111-8111-111111111111",
		ContentType: "code",
		Content: `{
			"text": "console.log('hi')",
			"language": "javascript"
		}`,
	})
	require.NoError(t, err)

	var stored string
	require.NoError(t, db.Table("messages").Select("content").Where("id = ?", resp.MessageID).Scan(&stored).Error)
	require.Equal(t, `{"language":"javascript","text":"console.log('hi')"}`, stored)
}

func TestSendMessage_RejectsInvalidDeployCardJSONBeforeDBLookup(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	svc := &Service{db: db, cacheClient: &mockMsgCache{seq: 1}}
	_, err := svc.SendMessage(context.Background(), "sess-1", "user-1", SendMessageRequest{
		ClientMsgID: "msg-deploy-card",
		ContentType: "deploy_card",
		Content:     `not-json`,
	})
	require.ErrorIs(t, err, errcode.ErrBadRequest)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSendMessage_FileContentRecordsAttachmentReference(t *testing.T) {
	db := newMessageAttachmentTestDB(t)
	svc := &Service{db: db, bus: newTestBus(t), cacheClient: &mockMsgCache{seq: 7}}
	ctx := context.Background()

	if err := db.Exec(`INSERT INTO sessions (id, type, next_seq, dissolved) VALUES ('sess-file', 'group', 0, 0)`).Error; err != nil {
		t.Fatalf("insert session: %v", err)
	}
	if err := db.Exec(`INSERT INTO session_members (id, session_id, member_type, member_id, role) VALUES ('mem-sender', 'sess-file', 'user', 'user-1', 'member')`).Error; err != nil {
		t.Fatalf("insert member: %v", err)
	}
	if err := db.Exec(`INSERT INTO attachments (id, hash, size, mime_type, original_name, uploader_user_id) VALUES (?, ?, ?, ?, ?, ?)`,
		"77777777-7777-4777-8777-777777777777", "7777777777777777777777777777777777777777777777777777777777777777", 12, "text/plain", "report.txt", "user-1").Error; err != nil {
		t.Fatalf("insert attachment: %v", err)
	}

	resp, err := svc.SendMessage(ctx, "sess-file", "user-1", SendMessageRequest{
		ClientMsgID: "55555555-5555-4555-8555-555555555555",
		ContentType: "file",
		Content:     `{"attachment_id":"77777777-7777-4777-8777-777777777777","name":"report.txt"}`,
	})
	require.NoError(t, err)

	var count int64
	if err := db.Table("message_attachments").
		Where("session_id = ? AND message_id = ? AND attachment_id = ?", "sess-file", resp.MessageID, "77777777-7777-4777-8777-777777777777").
		Count(&count).Error; err != nil {
		t.Fatalf("count message attachment reference: %v", err)
	}
	if count != 1 {
		t.Fatalf("message attachment reference count = %d, want 1", count)
	}
}

func TestSendMessage_ImageContentWithAttachmentIDRecordsAndReadsAttachment(t *testing.T) {
	db := newMessageAttachmentTestDB(t)
	svc := &Service{db: db, bus: newTestBus(t), cacheClient: &mockMsgCache{seq: 10}}
	ctx := context.Background()

	seedMessageSessionMember(t, db, "sess-image", "user-1")
	require.NoError(t, db.Exec(`INSERT INTO attachments (id, hash, size, mime_type, original_name, uploader_user_id) VALUES (?, ?, ?, ?, ?, ?)`,
		"77777777-7777-4777-8777-777777777778", "8888888888888888888888888888888888888888888888888888888888888888", 34, "image/png", "chart.png", "user-1").Error)

	resp, err := svc.SendMessage(ctx, "sess-image", "user-1", SendMessageRequest{
		ClientMsgID: "55555555-5555-4555-8555-555555555556",
		ContentType: "image",
		Content:     `{"attachment_id":"77777777-7777-4777-8777-777777777778","alt":"chart"}`,
	})
	require.NoError(t, err)

	var count int64
	require.NoError(t, db.Table("message_attachments").
		Where("session_id = ? AND message_id = ? AND attachment_id = ?", "sess-image", resp.MessageID, "77777777-7777-4777-8777-777777777778").
		Count(&count).Error)
	assert.Equal(t, int64(1), count)

	msgs, err := svc.GetMessages(ctx, "sess-image", "user-1", 0, 50)
	require.NoError(t, err)
	require.Len(t, msgs, 1)
	require.Len(t, msgs[0].Attachments, 1)
	assert.Equal(t, "77777777-7777-4777-8777-777777777778", msgs[0].Attachments[0].ID)
	assert.Equal(t, "8888888888888888888888888888888888888888888888888888888888888888", msgs[0].Attachments[0].Hash)
	assert.Equal(t, int64(34), msgs[0].Attachments[0].Size)
	assert.Equal(t, "image/png", msgs[0].Attachments[0].MimeType)
	assert.Equal(t, "chart.png", msgs[0].Attachments[0].OriginalName)
}

func TestSendMessage_ImageContentWithURLDoesNotRequireAttachment(t *testing.T) {
	db := newMessageAttachmentTestDB(t)
	svc := &Service{db: db, bus: newTestBus(t), cacheClient: &mockMsgCache{seq: 11}}
	ctx := context.Background()

	seedMessageSessionMember(t, db, "sess-image-url", "user-1")

	resp, err := svc.SendMessage(ctx, "sess-image-url", "user-1", SendMessageRequest{
		ClientMsgID: "55555555-5555-4555-8555-555555555557",
		ContentType: "image",
		Content:     `{"url":"https://example.test/chart.png","alt":"chart"}`,
	})
	require.NoError(t, err)
	assert.NotEmpty(t, resp.MessageID)

	msgs, err := svc.GetMessages(ctx, "sess-image-url", "user-1", 0, 50)
	require.NoError(t, err)
	require.Len(t, msgs, 1)
	assert.Empty(t, msgs[0].Attachments)
	assert.JSONEq(t, `{"url":"https://example.test/chart.png","alt":"chart"}`, msgs[0].Content)
}

func TestSendMessage_FileContentRejectsInvalidAttachmentID(t *testing.T) {
	db := newMessageAttachmentTestDB(t)
	svc := &Service{db: db, bus: newTestBus(t), cacheClient: &mockMsgCache{seq: 8}}
	ctx := context.Background()

	if err := db.Exec(`INSERT INTO sessions (id, type, next_seq, dissolved) VALUES ('sess-file-invalid', 'group', 0, 0)`).Error; err != nil {
		t.Fatalf("insert session: %v", err)
	}
	if err := db.Exec(`INSERT INTO session_members (id, session_id, member_type, member_id, role) VALUES ('mem-invalid', 'sess-file-invalid', 'user', 'user-1', 'member')`).Error; err != nil {
		t.Fatalf("insert member: %v", err)
	}

	_, err := svc.SendMessage(ctx, "sess-file-invalid", "user-1", SendMessageRequest{
		ClientMsgID: "88888888-8888-4888-8888-888888888888",
		ContentType: "file",
		Content:     `{"attachment_id":"not-a-uuid","name":"bad.txt"}`,
	})
	require.ErrorIs(t, err, errcode.ErrBadRequest)
}

func TestSendMessage_FileContentRejectsAttachmentOwnedByAnotherUser(t *testing.T) {
	db := newMessageAttachmentTestDB(t)
	svc := &Service{db: db, bus: newTestBus(t), cacheClient: &mockMsgCache{seq: 9}}
	ctx := context.Background()

	if err := db.Exec(`INSERT INTO sessions (id, type, next_seq, dissolved) VALUES ('sess-file-owned', 'group', 0, 0)`).Error; err != nil {
		t.Fatalf("insert session: %v", err)
	}
	if err := db.Exec(`INSERT INTO session_members (id, session_id, member_type, member_id, role) VALUES ('mem-owned', 'sess-file-owned', 'user', 'user-1', 'member')`).Error; err != nil {
		t.Fatalf("insert member: %v", err)
	}
	if err := db.Exec(`INSERT INTO attachments (id, hash, size, mime_type, original_name, uploader_user_id) VALUES (?, ?, ?, ?, ?, ?)`,
		"99999999-9999-4999-8999-999999999999", "9999999999999999999999999999999999999999999999999999999999999999", 12, "text/plain", "private.txt", "owner-2").Error; err != nil {
		t.Fatalf("insert attachment: %v", err)
	}

	_, err := svc.SendMessage(ctx, "sess-file-owned", "user-1", SendMessageRequest{
		ClientMsgID: "99999999-9999-4999-8999-999999999991",
		ContentType: "file",
		Content:     `{"attachment_id":"99999999-9999-4999-8999-999999999999","name":"private.txt"}`,
	})
	require.ErrorIs(t, err, errcode.AttachNotFound)
}

func TestSendMessage_NilCacheUsesDBSeqFallback(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	mock.ExpectQuery(sqlmSessionByID).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved"}).
			AddRow("sess-1", "group", false))

	mock.ExpectQuery(sqlmMessage).
		WithArgs("sess-1", "msg-nil-cache", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	mock.ExpectBegin()
	mock.ExpectQuery(sqlmSeqFallbackMsg).
		WithArgs("sess-1").
		WillReturnRows(sqlmock.NewRows([]string{"next_seq"}).AddRow(7))
	mock.ExpectCommit()

	mock.ExpectBegin()
	mock.ExpectExec(sqlmInsertMsg).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(sqlmUpdateSession).
		WithArgs(sqlmock.AnyArg(), "sess-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	svc := NewService(db, newTestBus(t), nil)
	resp, err := svc.SendMessage(context.Background(), "sess-1", "user-1", SendMessageRequest{
		ClientMsgID: "msg-nil-cache",
		ContentType: "text",
		Content:     "hello without redis",
	})
	require.NoError(t, err)
	assert.NotEmpty(t, resp.MessageID)
	assert.Equal(t, int64(7), resp.SeqID)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== RecallMessage ====================

func TestRecallMessage_NotFound(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmMessage).
		WithArgs("msg-99", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	svc := &Service{db: db}
	err := svc.RecallMessage(context.Background(), "msg-99", "user-1")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRecallMessage_NotMember(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmMessage).
		WithArgs("msg-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "sender_id", "content", "created_at"}).
			AddRow("msg-1", "sess-1", "sender-99", "hello", time.Now()))

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	svc := &Service{db: db}
	err := svc.RecallMessage(context.Background(), "msg-1", "user-1")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRecallMessage_NotSenderNorOwner(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmMessage).
		WithArgs("msg-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "sender_id", "content", "created_at"}).
			AddRow("msg-1", "sess-1", "sender-99", "hello", time.Now()))

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "member_type", "member_id", "role"}).
			AddRow("mem-1", "sess-1", "user", "user-1", "member"))

	svc := &Service{db: db}
	err := svc.RecallMessage(context.Background(), "msg-1", "user-1")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRecallMessage_TimeoutForNonOwner(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmMessage).
		WithArgs("msg-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "sender_id", "content", "created_at"}).
			AddRow("msg-1", "sess-1", "user-1", "hello", time.Now().Add(-10*time.Minute)))

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "member_type", "member_id", "role"}).
			AddRow("mem-1", "sess-1", "user", "user-1", "member"))

	svc := &Service{db: db}
	err := svc.RecallMessage(context.Background(), "msg-1", "user-1")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRecallMessage_SuccessAsSender(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmMessage).
		WithArgs("msg-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "sender_id", "content", "created_at"}).
			AddRow("msg-1", "sess-1", "user-1", "hello", time.Now()))

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "member_type", "member_id", "role"}).
			AddRow("mem-1", "sess-1", "user", "user-1", "member"))

	mock.ExpectExec(sqlmUpdateMsg).
		WithArgs(true, "msg-1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	svc := &Service{db: db, bus: newTestBus(t)}
	err := svc.RecallMessage(context.Background(), "msg-1", "user-1")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestRecallMessage_SuccessAsOwner(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmMessage).
		WithArgs("msg-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "sender_id", "content", "created_at"}).
			AddRow("msg-1", "sess-1", "sender-99", "hello", time.Now().Add(-10*time.Minute)))

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "member_type", "member_id", "role"}).
			AddRow("mem-1", "sess-1", "user", "user-1", "owner"))

	mock.ExpectExec(sqlmUpdateMsg).
		WithArgs(true, "msg-1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	svc := &Service{db: db, bus: newTestBus(t)}
	err := svc.RecallMessage(context.Background(), "msg-1", "user-1")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== PinMessage ====================

func TestPinMessage_NotMember(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	svc := &Service{db: db}
	err := svc.PinMessage(context.Background(), "user-1", "sess-1", "msg-1")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPinMessage_LimitExceeded(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	mock.ExpectQuery(sqlmMessage).
		WithArgs("sess-1", "msg-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "seq_id", "client_msg_id", "sender_type", "sender_id", "content_type", "content", "recalled", "created_at"}).
			AddRow("msg-1", "sess-1", 1, "c1", "user", "user-2", "text", `{"text":"pinned"}`, false, time.Now()))

	// PinMessageAtomic transaction (FOR UPDATE session + count + rollback on limit)
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id FROM sessions WHERE id =`).
		WithArgs("sess-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("sess-1"))
	mock.ExpectQuery(sqlmPin).
		WithArgs("sess-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(50))
	mock.ExpectRollback()

	svc := &Service{db: db}
	err := svc.PinMessage(context.Background(), "user-1", "sess-1", "msg-1")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPinMessage_RejectsMessageOutsideSession(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	mock.ExpectQuery(sqlmMessage).
		WithArgs("sess-1", "msg-other", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	svc := &Service{db: db}
	err := svc.PinMessage(context.Background(), "user-1", "sess-1", "msg-other")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPinMessage_DuplicatePin(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	mock.ExpectQuery(sqlmMessage).
		WithArgs("sess-1", "msg-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "seq_id", "client_msg_id", "sender_type", "sender_id", "content_type", "content", "recalled", "created_at"}).
			AddRow("msg-1", "sess-1", 1, "c1", "user", "user-2", "text", `{"text":"pinned"}`, false, time.Now()))

	// PinMessageAtomic transaction (FOR UPDATE session + count + insert dup -> rollback)
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id FROM sessions WHERE id =`).
		WithArgs("sess-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("sess-1"))
	mock.ExpectQuery(sqlmPin).
		WithArgs("sess-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(3))
	mock.ExpectExec(sqlmInsertPin).
		WillReturnError(errors.New("duplicate key value violates unique constraint"))
	mock.ExpectRollback()

	svc := &Service{db: db}
	err := svc.PinMessage(context.Background(), "user-1", "sess-1", "msg-1")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestPinMessage_Success(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	mock.ExpectQuery(sqlmMessage).
		WithArgs("sess-1", "msg-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "seq_id", "client_msg_id", "sender_type", "sender_id", "content_type", "content", "recalled", "created_at"}).
			AddRow("msg-1", "sess-1", 1, "c1", "user", "user-2", "text", `{"text":"pinned"}`, false, time.Now()))

	// PinMessageAtomic transaction (FOR UPDATE session + count + insert + commit)
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id FROM sessions WHERE id =`).
		WithArgs("sess-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("sess-1"))
	mock.ExpectQuery(sqlmPin).
		WithArgs("sess-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(3))
	mock.ExpectExec(sqlmInsertPin).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	svc := &Service{db: db, bus: newTestBus(t)}
	err := svc.PinMessage(context.Background(), "user-1", "sess-1", "msg-1")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== UnpinMessage ====================

func TestUnpinMessage_NotMember(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	svc := &Service{db: db}
	err := svc.UnpinMessage(context.Background(), "user-1", "sess-1", "msg-1")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestUnpinMessage_Success(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	mock.ExpectExec(sqlmDeletePin).
		WithArgs("sess-1", "msg-1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	svc := &Service{db: db, bus: newTestBus(t)}
	err := svc.UnpinMessage(context.Background(), "user-1", "sess-1", "msg-1")
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== GetMessages ====================

func TestGetMessages_NotMember(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	svc := &Service{db: db}
	_, err := svc.GetMessages(context.Background(), "sess-1", "user-1", 0, 50)
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestGetMessages_Success(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	mock.ExpectQuery(sqlmMessage).
		WithArgs("sess-1", 50).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "seq_id", "client_msg_id", "sender_type", "sender_id", "content_type", "content", "recalled", "created_at"}).
			AddRow("msg-1", "sess-1", 1, "c1", "user", "user-1", "text", `{"text":"hello"}`, false, time.Now()).
			AddRow("msg-2", "sess-1", 2, "c2", "user", "user-2", "text", `{"text":"hi"}`, false, time.Now()))

	svc := &Service{db: db}
	msgs, err := svc.GetMessages(context.Background(), "sess-1", "user-1", 0, 50)
	require.NoError(t, err)
	assert.Len(t, msgs, 2)
	assert.Equal(t, "msg-1", msgs[0].ID)
	assert.Equal(t, "msg-2", msgs[1].ID)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestGetMessages_ReadsAttachmentsFromMessageAttachmentRelation(t *testing.T) {
	db := newMessageAttachmentTestDB(t)
	svc := &Service{db: db}

	seedMessageSessionMember(t, db, "sess-read-attachments", "reader-1")
	require.NoError(t, db.Exec(`INSERT INTO messages (
		id, session_id, seq_id, client_msg_id, sender_type, sender_id, content_type, content, recalled, created_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"msg-file-1", "sess-read-attachments", 1, "client-file-1", "user", "sender-1", "file",
		`{"attachment_id":"att-read-1","name":"report.txt"}`, false, time.Now(),
	).Error)
	require.NoError(t, db.Exec(`INSERT INTO attachments (
		id, hash, size, mime_type, original_name, uploader_user_id, metadata, created_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"att-read-1", "hash-read-1", 128, "text/plain", "report.txt", "sender-1", `{"height":3,"width":2}`, time.Now(),
	).Error)
	require.NoError(t, db.Exec(`INSERT INTO message_attachments (
		session_id, message_id, attachment_id, created_at
	) VALUES (?, ?, ?, ?)`,
		"sess-read-attachments", "msg-file-1", "att-read-1", time.Now(),
	).Error)

	msgs, err := svc.GetMessages(context.Background(), "sess-read-attachments", "reader-1", 0, 50)
	require.NoError(t, err)
	require.Len(t, msgs, 1)
	require.Len(t, msgs[0].Attachments, 1)
	assert.Equal(t, "att-read-1", msgs[0].Attachments[0].ID)
	assert.Equal(t, "hash-read-1", msgs[0].Attachments[0].Hash)
	assert.Equal(t, int64(128), msgs[0].Attachments[0].Size)
	assert.Equal(t, "text/plain", msgs[0].Attachments[0].MimeType)
	assert.Equal(t, "report.txt", msgs[0].Attachments[0].OriginalName)
	assert.JSONEq(t, `{"height":3,"width":2}`, msgs[0].Attachments[0].Metadata)
}

// ==================== ForwardMessage ====================

func TestForwardMessage_PreservesOriginalSenderIdentity(t *testing.T) {
	db := newMessageAttachmentTestDB(t)
	svc := &Service{db: db, bus: newTestBus(t), cacheClient: &mockMsgCache{seq: 7}}
	ctx := context.Background()

	seedMessageSessionMember(t, db, "sess-forward-src", "forwarder-1")
	seedMessageSessionMember(t, db, "sess-forward-target", "forwarder-1")
	require.NoError(t, db.Exec(`INSERT INTO messages (
		id, session_id, seq_id, client_msg_id, sender_type, sender_id, content_type, content, recalled, created_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		"msg-forward-original", "sess-forward-src", 1, "client-forward-original",
		"agent", "agent-42", "text", `{"text":"agent answer"}`, false, time.Now(),
	).Error)

	require.NoError(t, svc.ForwardMessage(ctx, "forwarder-1", "msg-forward-original", []string{"sess-forward-target"}))

	var forwarded struct {
		SenderType string
		SenderID   string
		SeqID      int64
	}
	require.NoError(t, db.Table("messages").
		Select("sender_type, sender_id, seq_id").
		Where("session_id = ? AND content = ?", "sess-forward-target", `{"text":"agent answer"}`).
		First(&forwarded).Error)
	assert.Equal(t, "agent", forwarded.SenderType)
	assert.Equal(t, "agent-42", forwarded.SenderID)
	assert.Equal(t, int64(7), forwarded.SeqID)
}

// ==================== MarkRead ====================

func TestMarkRead_NotMember(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	svc := &Service{db: db}
	err := svc.MarkRead(context.Background(), "user-1", "sess-1", 42)
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestMarkRead_Success(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	// GetActiveMember returns last_read_seq=10, which is less than the new 42
	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "member_type", "member_id", "role", "last_read_seq"}).
			AddRow("mem-1", "sess-1", "user", "user-1", "member", 10))

	mock.ExpectExec(sqlmUpdateMember).
		WithArgs(42, "sess-1", "user", "user-1", 42).
		WillReturnResult(sqlmock.NewResult(0, 1))

	svc := &Service{db: db, bus: newTestBus(t)}
	err := svc.MarkRead(context.Background(), "user-1", "sess-1", 42)
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// Test that MarkRead rejects seq <= current last_read_seq (no-op + no b publish).
func TestMarkRead_SeqNotAdvanced(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	// GetActiveMember returns last_read_seq=50, which is GREATER than 42
	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "member_type", "member_id", "role", "last_read_seq"}).
			AddRow("mem-1", "sess-1", "user", "user-1", "member", 50))

	// No UpdateLastReadSeq and no b publish expected

	svc := &Service{db: db}
	err := svc.MarkRead(context.Background(), "user-1", "sess-1", 42)
	assert.NoError(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

// ==================== ListPinnedMessages ====================

func TestListPinnedMessages_NotMember(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	svc := &Service{db: db}
	_, err := svc.ListPinnedMessages(context.Background(), "user-1", "sess-1")
	assert.Error(t, err)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestListPinnedMessages_Empty(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	mock.ExpectQuery(sqlmPin).
		WithArgs("sess-1", 100).
		WillReturnRows(sqlmock.NewRows([]string{"session_id", "message_id", "pinned_by_user_id", "pinned_at"}))

	svc := &Service{db: db}
	pins, err := svc.ListPinnedMessages(context.Background(), "user-1", "sess-1")
	require.NoError(t, err)
	assert.Empty(t, pins)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestListPinnedMessages_WithPins(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	mock.ExpectQuery(sqlmPin).
		WithArgs("sess-1", 100).
		WillReturnRows(sqlmock.NewRows([]string{"session_id", "message_id", "pinned_by_user_id", "pinned_at"}).
			AddRow("sess-1", "msg-1", "user-1", time.Now()))

	mock.ExpectQuery(sqlmMessage).
		WithArgs("sess-1", "msg-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "seq_id", "client_msg_id", "sender_type", "sender_id", "content_type", "content", "recalled", "created_at"}).
			AddRow("msg-1", "sess-1", 1, "c1", "user", "user-2", "text", `{"text":"pinned"}`, false, time.Now()))

	svc := &Service{db: db}
	pins, err := svc.ListPinnedMessages(context.Background(), "user-1", "sess-1")
	require.NoError(t, err)
	assert.Len(t, pins, 1)
	assert.Equal(t, "msg-1", pins[0].ID)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func TestListPinnedMessages_FiltersMessagesOutsideSession(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	mock.ExpectQuery(sqlmPin).
		WithArgs("sess-1", 100).
		WillReturnRows(sqlmock.NewRows([]string{"session_id", "message_id", "pinned_by_user_id", "pinned_at"}).
			AddRow("sess-1", "msg-1", "user-1", time.Now()).
			AddRow("sess-1", "msg-other", "user-1", time.Now()))

	mock.ExpectQuery(sqlmMessage).
		WithArgs("sess-1", "msg-1", "msg-other").
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "seq_id", "client_msg_id", "sender_type", "sender_id", "content_type", "content", "recalled", "created_at"}).
			AddRow("msg-1", "sess-1", 1, "c1", "user", "user-2", "text", `{"text":"pinned"}`, false, time.Now()))

	svc := &Service{db: db}
	pins, err := svc.ListPinnedMessages(context.Background(), "user-1", "sess-1")
	require.NoError(t, err)
	require.Len(t, pins, 1)
	assert.Equal(t, "msg-1", pins[0].ID)
	assert.NoError(t, mock.ExpectationsWereMet())
}

func newMessageAttachmentTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}

	ddl := []string{
		`CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			type TEXT NOT NULL,
			workspace_id TEXT,
			next_seq INTEGER NOT NULL DEFAULT 0,
			last_message_at DATETIME,
			dissolved BOOLEAN NOT NULL DEFAULT FALSE,
			created_at DATETIME
		)`,
		`CREATE TABLE session_members (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			member_type TEXT NOT NULL,
			member_id TEXT NOT NULL,
			role TEXT NOT NULL,
			left_at DATETIME
		)`,
		`CREATE TABLE messages (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			seq_id INTEGER NOT NULL,
			client_msg_id TEXT NOT NULL,
			sender_type TEXT NOT NULL,
			sender_id TEXT NOT NULL,
			content_type TEXT NOT NULL,
			content TEXT NOT NULL,
			reply_to_message_id TEXT,
			recalled BOOLEAN NOT NULL DEFAULT FALSE,
			edited BOOLEAN NOT NULL DEFAULT FALSE,
			edited_at DATETIME,
			created_at DATETIME
		)`,
		`CREATE UNIQUE INDEX idx_messages_session_client_msg ON messages (session_id, client_msg_id)`,
		`CREATE TABLE attachments (
			id TEXT PRIMARY KEY,
			hash TEXT NOT NULL UNIQUE,
			size INTEGER NOT NULL,
			mime_type TEXT NOT NULL,
			original_name TEXT DEFAULT '',
			uploader_user_id TEXT NOT NULL,
			metadata TEXT NOT NULL DEFAULT '{}',
			created_at DATETIME
		)`,
		`CREATE TABLE message_attachments (
			session_id TEXT NOT NULL,
			message_id TEXT NOT NULL,
			attachment_id TEXT NOT NULL,
			created_at DATETIME,
			PRIMARY KEY (message_id, attachment_id)
		)`,
	}

	for _, stmt := range ddl {
		if err := db.Exec(stmt).Error; err != nil {
			t.Fatalf("run ddl %q: %v", stmt, err)
		}
	}
	return db
}

func seedMessageSessionMember(t *testing.T, db *gorm.DB, sessionID, userID string) {
	t.Helper()
	if err := db.Exec(`INSERT INTO sessions (id, type, next_seq, dissolved) VALUES (?, 'group', 0, 0)`, sessionID).Error; err != nil {
		t.Fatalf("insert session: %v", err)
	}
	if err := db.Exec(`INSERT INTO session_members (id, session_id, member_type, member_id, role) VALUES (?, ?, 'user', ?, 'member')`, "mem-"+sessionID, sessionID, userID).Error; err != nil {
		t.Fatalf("insert member: %v", err)
	}
}
