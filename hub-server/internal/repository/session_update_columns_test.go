package repository

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/model"
)

// A sessions row has columns with *other* writers:
//
//   - next_seq is advanced by message.go's
//     `UPDATE sessions SET next_seq = next_seq + 1 … RETURNING next_seq` and by
//     SyncSessionSeq, the mirror seqalloc recovers from after a Redis restart /
//     FLUSH / key expiry (the #1533 seq continuity contract);
//   - last_message_at is written by TouchSessionLastMessage and by that same
//     statement.
//
// Both service callers of the session update (DissolveGroup, UpdateGroupInfo)
// load the row, mutate one or two fields, then persist — so a full-row
// writeback rewound whatever those writers did in between. That was the shipped
// behaviour of UpdateSession (db.Save): this test is red against it, with
// next_seq back to 0 after the caller persisted `dissolved`.
//
// A rewound next_seq is not cosmetic: seqalloc reads this mirror to re-seed
// Redis, so the sequence can repeat and unread counts (next_seq −
// last_read_seq) go wrong.

func TestSessionUpdate_MustNotRewindColumnsOwnedByOtherWriters(t *testing.T) {
	db := setupSQLite(t)
	session := &model.Session{Type: model.SessionTypeGroup, Name: "group"}
	require.NoError(t, CreateSession(db, session))

	loaded, err := GetSessionByID(db, session.ID)
	require.NoError(t, err)
	require.EqualValues(t, 0, loaded.NextSeq)

	// The message path runs while the caller still holds its copy.
	require.NoError(t, SyncSessionSeq(db, session.ID, 7))
	require.NoError(t, TouchSessionLastMessage(db, session.ID))
	touched, err := GetSessionByID(db, session.ID)
	require.NoError(t, err)
	require.NotNil(t, touched.LastMessageAt)

	// The caller persists its own change.
	loaded.Dissolved = true
	require.NoError(t, UpdateSessionColumns(db, loaded, "dissolved"))

	after, err := GetSessionByID(db, session.ID)
	require.NoError(t, err)
	require.True(t, after.Dissolved, "the caller's own column must still be written")
	require.Equal(t, "group", after.Name, "untouched columns keep their stored value")
	require.EqualValues(t, 7, after.NextSeq,
		"a session update must not rewind next_seq behind the seq allocator (#1533 mirror)")
	require.NotNil(t, after.LastMessageAt,
		"a session update must not clear last_message_at (it is the conversation-list sort key)")
	require.WithinDuration(t, *touched.LastMessageAt, *after.LastMessageAt, time.Second,
		"last_message_at must stay the value the message path wrote")
}

func TestUpdateSessionColumns_WritesOnlyTheRequestedColumns(t *testing.T) {
	db := setupSQLite(t)
	session := &model.Session{Type: model.SessionTypeGroup, Name: "old name", AvatarURL: "old.png", Announcement: "old"}
	require.NoError(t, CreateSession(db, session))
	require.NoError(t, SyncSessionSeq(db, session.ID, 3))

	loaded, err := GetSessionByID(db, session.ID)
	require.NoError(t, err)
	loaded.Name = "new name"
	loaded.Announcement = "new announcement"
	// A field the caller did NOT list must not reach the database even though it
	// differs from the stored value — that is the whole point of the allowlist.
	loaded.AvatarURL = "clobber.png"

	require.NoError(t, UpdateSessionColumns(db, loaded, "name", "announcement"))

	after, err := GetSessionByID(db, session.ID)
	require.NoError(t, err)
	require.Equal(t, "new name", after.Name)
	require.Equal(t, "new announcement", after.Announcement)
	require.Equal(t, "old.png", after.AvatarURL, "a column outside the allowlist must not be written")
	require.EqualValues(t, 3, after.NextSeq)
	require.False(t, after.Dissolved)
}

func TestUpdateSessionColumns_EmptyAllowlistWritesNothing(t *testing.T) {
	db := setupSQLite(t)
	session := &model.Session{Type: model.SessionTypeGroup, Name: "keep me"}
	require.NoError(t, CreateSession(db, session))

	loaded, err := GetSessionByID(db, session.ID)
	require.NoError(t, err)
	loaded.Name = "mutated in memory only"

	require.NoError(t, UpdateSessionColumns(db, loaded),
		"UpdateGroupInfo calls this with whatever ApplyGroupInfoChanges touched; no changes must mean no write")

	after, err := GetSessionByID(db, session.ID)
	require.NoError(t, err)
	require.Equal(t, "keep me", after.Name)
}
