package notification

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newRetentionTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.Exec(`CREATE TABLE notifications (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		type TEXT NOT NULL,
		payload TEXT NOT NULL DEFAULT '',
		read INTEGER NOT NULL DEFAULT 0,
		created_at DATETIME
	)`).Error)
	return db
}

func TestRetentionPass_NilDB_Noop(t *testing.T) {
	res, err := RetentionPass(context.Background(), nil, DefaultRetentionConfig())
	require.NoError(t, err)
	require.Equal(t, RetentionResult{}, res)
}

func TestRetentionPass_WindowRespected(t *testing.T) {
	db := newRetentionTestDB(t)
	now := time.Now().UTC()
	require.NoError(t, db.Exec(`INSERT INTO notifications (id, user_id, type, payload, read, created_at) VALUES ('n-old-read', 'u1', 'test', '{}', 1, ?)`, now.Add(-120*24*time.Hour)).Error)
	require.NoError(t, db.Exec(`INSERT INTO notifications (id, user_id, type, payload, read, created_at) VALUES ('n-old-unread', 'u1', 'test', '{}', 0, ?)`, now.Add(-120*24*time.Hour)).Error)

	res, err := RetentionPass(context.Background(), db, RetentionConfig{Window: 90 * 24 * time.Hour})
	require.NoError(t, err)
	require.Equal(t, int64(1), res.DeletedRows, "old read purged, old unread kept")

	var count int64
	require.NoError(t, db.Table("notifications").Where("id = ?", "n-old-unread").Count(&count).Error)
	require.Equal(t, int64(1), count)
}
