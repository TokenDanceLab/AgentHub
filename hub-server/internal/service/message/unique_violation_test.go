package message

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
)

// This file nails the two behaviors that #2244 slice 1 fixes in this package.
//
// Both write paths used to own a private duplicate-key classifier:
//
//   - builders.go isDuplicateKeyError matched "duplicate key"/"unique" WITHOUT
//     strings.ToLower, so SQLite's upper-case "UNIQUE constraint failed: ..."
//     (the shape every unit test in this package produces) was never recognised.
//     The repository package's copy had already been fixed to lower-case first —
//     its own comment said so — while the copy it "mirrored" here stayed broken.
//   - service_send.go PinMessage inlined an even narrower
//     strings.Contains(err.Error(), "duplicate key"), which misses SQLite's
//     UNIQUE-constraint wording entirely.
//
// The package now calls repository.IsUniqueViolation, the single implementation.

// sqliteUniquePins / sqliteUniqueMessages are SQLite's upper-case rendering of
// a unique-constraint violation. Upper case is the point: the pre-fix
// classifier here was case-sensitive and returned false for both.
const (
	sqliteUniquePins     = "UNIQUE constraint failed: message_pins.pkey"
	sqliteUniqueMessages = "UNIQUE constraint failed: messages.client_msg_id"
)

// TestSendMessage_PersistDuplicateSQLiteUppercaseIsIdempotent is the red→green
// regression test for the case-sensitivity bug: the pre-flight client_msg_id
// lookup misses (concurrent sender inserted between the lookup and the INSERT),
// the INSERT then fails with SQLite's UPPER-CASE unique violation, and
// SendMessage must resolve it as idempotent success by re-reading the winner's
// row instead of surfacing a 500 to the retrying client.
func TestSendMessage_PersistDuplicateSQLiteUppercaseIsIdempotent(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	mock.ExpectQuery(sqlmSessionByID).
		WithArgs("sess-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "dissolved"}).
			AddRow("sess-1", "group", false))

	// Pre-flight idempotency lookup: the competing row is not visible yet.
	mock.ExpectQuery(sqlmMessage).
		WithArgs("sess-1", "msg-1", 1).
		WillReturnError(gorm.ErrRecordNotFound)

	// seqalloc mirrors the allocated seq into sessions.next_seq.
	mock.ExpectExec(sqlmUpdateSessionNextSeq).
		WithArgs(sqlmock.AnyArg(), "sess-1", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))

	// The INSERT loses the race and hits the unique index on client_msg_id.
	mock.ExpectBegin()
	mock.ExpectExec(sqlmInsertMsg).
		WillReturnError(errors.New(sqliteUniqueMessages))
	mock.ExpectRollback()

	// The duplicate branch re-reads by client_msg_id and returns the winner.
	mock.ExpectQuery(sqlmMessage).
		WithArgs("sess-1", "msg-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "seq_id", "client_msg_id", "content", "created_at"}).
			AddRow("winner-msg", "sess-1", 42, "msg-1", "hello", time.Now()))

	svc := &Service{db: db, bus: &recordingMsgBus{}, cacheClient: &mockMsgCache{seq: 42}}
	resp, err := svc.SendMessage(context.Background(), "sess-1", "user-1", SendMessageRequest{
		ClientMsgID: "msg-1",
		ContentType: "text",
		Content:     "hello",
	})

	require.NoError(t, err,
		"SQLite's upper-case %q must be recognised as a benign duplicate; "+
			"the case-sensitive classifier this package used to own returned false for it (#2244)", sqliteUniqueMessages)
	require.NotNil(t, resp)
	assert.Equal(t, "winner-msg", resp.MessageID, "the duplicate branch must return the row that won the race")
	assert.NoError(t, mock.ExpectationsWereMet())
}

// TestPinMessage_DuplicateSQLiteUppercaseIsIdempotent is the red→green
// regression test for PinMessage's inlined, narrowest-in-the-repo check: it
// matched only the literal "duplicate key", so SQLite's unique wording was
// returned to the caller as a hard error even though the pin already existed.
func TestPinMessage_DuplicateSQLiteUppercaseIsIdempotent(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()
	rec := &recordingMsgBus{}
	mockPinDuplicate(t, mock, errors.New(sqliteUniquePins))

	svc := &Service{db: db, bus: rec}
	err := svc.PinMessage(context.Background(), "user-1", "sess-1", "msg-1")

	require.NoError(t, err,
		"an already-pinned (session_id, message_id) must be idempotent success, "+
			"but SQLite reports it as %q which the inlined \"duplicate key\" check never matched (#2244)", sqliteUniquePins)
	assert.NoError(t, mock.ExpectationsWereMet())
	assert.Empty(t, rec.events, "see TestPinMessage_DuplicatePublishesNothing for why nothing is published")
}

// TestPinMessage_DuplicatePublishesNothing pins the publish semantics that
// #2244 asked to have confirmed and recorded rather than changed.
//
// message_pins' only uniqueness is its composite PRIMARY KEY (session_id,
// message_id) (migrations/0008_message_pins.up.sql). A unique violation from
// PinMessageAtomic therefore means exactly one thing: this message is already
// pinned in this session, i.e. the pin set did not change, so there is no state
// transition to broadcast. Publishing anyway would make every subscriber
// (internal/app/events.go -> ws.TypeMessagePin) re-render a pin list that is
// byte-identical to what it already has.
//
// The residual gap is recorded in service_send.go next to the branch and in the
// lane report: s.publish is best-effort (service_helpers.go logs and swallows a
// failed Publish), so "the row exists" does not strictly prove "an event was
// once delivered". Closing that gap would mean changing publish semantics,
// which the host ruled out of scope for this slice.
func TestPinMessage_DuplicatePublishesNothing(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()
	rec := &recordingMsgBus{}
	mockPinDuplicate(t, mock, errors.New("duplicate key value violates unique constraint \"message_pins_pkey\""))

	svc := &Service{db: db, bus: rec}
	require.NoError(t, svc.PinMessage(context.Background(), "user-1", "sess-1", "msg-1"))

	assert.NoError(t, mock.ExpectationsWereMet())
	assert.Empty(t, rec.events,
		"the duplicate branch means the pin already existed, so no pin event may be published")
}

// TestPinMessage_SuccessPublishesPinEventOnce is the contrast case: the
// non-duplicate path publishes exactly one message.pin event. Together with
// TestPinMessage_DuplicatePublishesNothing this pins "publish iff the pin set
// actually changed".
func TestPinMessage_SuccessPublishesPinEventOnce(t *testing.T) {
	db, mock, sqlDB := newMockDB(t)
	defer sqlDB.Close()
	rec := &recordingMsgBus{}
	mockPinDuplicate(t, mock, nil)
	mock.ExpectCommit()

	svc := &Service{db: db, bus: rec}
	require.NoError(t, svc.PinMessage(context.Background(), "user-1", "sess-1", "msg-1"))

	assert.NoError(t, mock.ExpectationsWereMet())
	require.Len(t, rec.events, 1, "a real pin must broadcast exactly one message.pin event")
	assert.Equal(t, bus.EventTypeMessagePin, rec.events[0].Type)
	pin, ok := rec.events[0].Payload.(*model.MessagePin)
	require.True(t, ok, "message.pin payload must be *model.MessagePin (internal/app/events.go asserts this)")
	assert.Equal(t, "sess-1", pin.SessionID)
	assert.Equal(t, "msg-1", pin.MessageID)
	assert.Equal(t, "user-1", pin.PinnedByUserID)
}

// mockPinDuplicate stages the PinMessage SQL up to and including the
// INSERT INTO message_pins, whose outcome is insertErr (nil = success). The
// caller owns any expectation after that point (ExpectCommit / ExpectRollback).
func mockPinDuplicate(t *testing.T, mock sqlmock.Sqlmock, insertErr error) {
	t.Helper()

	mock.ExpectQuery(sqlmSessionMember).
		WithArgs("sess-1", "user", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	mock.ExpectQuery(sqlmMessage).
		WithArgs("sess-1", "msg-1", 1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "session_id", "seq_id", "client_msg_id", "sender_type", "sender_id", "content_type", "content", "recalled", "created_at"}).
			AddRow("msg-1", "sess-1", 1, "c1", "user", "user-2", "text", `{"text":"pinned"}`, false, time.Now()))

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id FROM sessions WHERE id =`).
		WithArgs("sess-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("sess-1"))
	mock.ExpectQuery(sqlmPin).
		WithArgs("sess-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(3))

	insert := mock.ExpectExec(sqlmInsertPin)
	if insertErr != nil {
		insert.WillReturnError(insertErr)
		mock.ExpectRollback()
	} else {
		insert.WillReturnResult(sqlmock.NewResult(1, 1))
	}
}

// TestMessagePackageUsesRepositoryUniqueViolationSSOT asserts the classifier
// this package now depends on behaves correctly for the three shapes that used
// to diverge across the five copies (#2244 slice 1).
func TestMessagePackageUsesRepositoryUniqueViolationSSOT(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"sqlite upper-case UNIQUE (the bug this package had)", errors.New(sqliteUniquePins), true},
		{"postgres 23505 text", errors.New(`ERROR: duplicate key value violates unique constraint "message_pins_pkey" (SQLSTATE 23505)`), true},
		{"postgres 23505 structured", &pgconn.PgError{Code: "23505", Message: `duplicate key value violates unique constraint "message_pins_pkey"`}, true},
		{"gorm sentinel", gorm.ErrDuplicatedKey, true},
		// 42P10 is an ON CONFLICT programming error, not a benign duplicate.
		// Its message contains "unique" but never "unique constraint"
		// ("unique or exclusion constraint"), which is why the substring tier
		// had to be narrowed.
		{"postgres 42P10 structured", &pgconn.PgError{Code: "42P10", Message: "there is no unique or exclusion constraint matching the ON CONFLICT specification"}, false},
		{"postgres 42P10 text", errors.New("ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification (SQLSTATE 42P10)"), false},
		{"postgres 23503 foreign key", &pgconn.PgError{Code: "23503", Message: `insert or update on table "message_pins" violates foreign key constraint "fk_message_pins_message_session"`}, false},
		{"unrelated", errors.New("connection refused"), false},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, repository.IsUniqueViolation(tc.err))
		})
	}
}
