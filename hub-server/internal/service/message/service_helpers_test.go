package message

import (
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// sessionUpdateRecorder captures every `UPDATE "sessions"` statement gorm
// executes on db, so a test can count how many times a given column is written
// by one request. Registered on the Update callback group's After("*") slot,
// which also fires for statements executed inside db.Transaction (the tx shares
// the callback processor).
type sessionUpdateRecorder struct {
	mu         sync.Mutex
	statements []string
}

func (r *sessionUpdateRecorder) register(t *testing.T, db *gorm.DB) {
	t.Helper()
	require.NoError(t, db.Callback().Update().After("*").Register(
		"test:record_session_updates",
		func(tx *gorm.DB) {
			statement := tx.Statement.SQL.String()
			if !strings.Contains(statement, `UPDATE "sessions"`) {
				return
			}
			r.mu.Lock()
			defer r.mu.Unlock()
			r.statements = append(r.statements, statement)
		},
	))
}

// countColumn returns how many recorded sessions UPDATEs write column.
func (r *sessionUpdateRecorder) countColumn(column string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	n := 0
	for _, statement := range r.statements {
		if strings.Contains(statement, column) {
			n++
		}
	}
	return n
}

func (r *sessionUpdateRecorder) total() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.statements)
}

// TestAllocateSeq_DoesNotTouchSessionLastMessage locks the #2154 P2-8 removal:
// sequence allocation writes only the sessions.next_seq mirror. The
// last_message_at activity touch belongs to the caller's persist transaction,
// where it is atomic with the message insert.
func TestAllocateSeq_DoesNotTouchSessionLastMessage(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	rec := &sessionUpdateRecorder{}
	rec.register(t, db)

	mock.ExpectExec(sqlmUpdateSessionNextSeq).
		WithArgs(int64(42), "sess-1", int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	svc := &Service{db: db, cacheClient: &mockMsgCache{seq: 42}}
	seq, err := svc.allocateSeq(context.Background(), "sess-1")
	require.NoError(t, err)
	require.Equal(t, int64(42), seq)

	require.Equal(t, 0, rec.countColumn("last_message_at"),
		"allocateSeq must not touch last_message_at (#2154 P2-8)")
	require.Equal(t, 1, rec.countColumn("next_seq"),
		"allocateSeq still mirrors the Redis seq forward")
	require.NoError(t, mock.ExpectationsWereMet())
}

// TestSendMessage_TouchesSessionLastMessageOnce is the P2-8 regression guard:
// one successful SendMessage must update sessions.last_message_at exactly once
// — inside the persist transaction, so the touch is atomic with the insert and
// can never survive a rollback — and must not lose the touch entirely (the
// "message sent but last_message_at stale" regression the change must not
// introduce).
//
// The ordered sqlmock expectations are part of the assertion: BEGIN comes
// before the last_message_at UPDATE, which places it inside the transaction,
// and the only sessions UPDATE outside the transaction is the seqalloc
// next_seq mirror.
func TestSendMessage_TouchesSessionLastMessageOnce(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	rec := &sessionUpdateRecorder{}
	rec.register(t, db)

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(sqlmSessionByID).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved"}).
			AddRow("sess-1", "group", false))
	mock.ExpectQuery(sqlmMessage).
		WithArgs("sess-1", "msg-once", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	// Outside the transaction: only the seqalloc next_seq mirror.
	mock.ExpectExec(sqlmUpdateSessionNextSeq).
		WithArgs(int64(7), "sess-1", int64(7)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	// Inside the transaction: insert + the single last_message_at touch.
	mock.ExpectBegin()
	mock.ExpectExec(sqlmInsertMsg).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(sqlmUpdateSessionLastMessage).
		WithArgs(sqlmock.AnyArg(), "sess-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	svc := &Service{db: db, bus: newTestBus(t), cacheClient: &mockMsgCache{seq: 7}}
	resp, err := svc.SendMessage(context.Background(), "sess-1", "user-1", SendMessageRequest{
		ClientMsgID: "msg-once",
		ContentType: "text",
		Content:     "hello once",
	})
	require.NoError(t, err)
	require.NotEmpty(t, resp.MessageID)
	require.Equal(t, int64(7), resp.SeqID)

	require.Equal(t, 1, rec.countColumn("last_message_at"),
		"last_message_at must be written exactly once per send (was twice before #2154 P2-8)")
	require.Equal(t, 2, rec.total(),
		"sessions must be updated exactly twice: next_seq mirror + last_message_at")
	require.NoError(t, mock.ExpectationsWereMet())
}
