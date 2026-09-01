package repository

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

func insertNotificationRow(t *testing.T, db *gorm.DB, id, userID string, read bool, createdAt time.Time) {
	t.Helper()
	readVal := 0
	if read {
		readVal = 1
	}
	require.NoError(t, db.Exec(`INSERT INTO notifications (id, user_id, type, payload, read, created_at) VALUES (?, ?, 'test', '{}', ?, ?)`,
		id, userID, readVal, createdAt).Error)
}

func TestPurgeReadNotifications_OldReadDeleted(t *testing.T) {
	db := setupSQLite(t)
	now := time.Now().UTC()
	insertNotificationRow(t, db, "n-old-read", "user-1", true, now.Add(-120*24*time.Hour))
	insertNotificationRow(t, db, "n-old-unread", "user-1", false, now.Add(-120*24*time.Hour))
	insertNotificationRow(t, db, "n-new-read", "user-1", true, now.Add(-1*time.Hour))
	insertNotificationRow(t, db, "n-new-unread", "user-2", false, now.Add(-1*time.Hour))

	res, err := PurgeReadNotifications(db, now.Add(-90*24*time.Hour))
	require.NoError(t, err)
	require.Equal(t, int64(1), res.DeletedRows, "only the old read row may be purged")

	var remaining []model.Notification
	require.NoError(t, db.Order("id").Find(&remaining).Error)
	ids := make([]string, 0, len(remaining))
	for _, n := range remaining {
		ids = append(ids, n.ID)
	}
	require.ElementsMatch(t, []string{"n-old-unread", "n-new-read", "n-new-unread"}, ids)
}

func TestPurgeReadNotifications_NoQualifyingRows_Noop(t *testing.T) {
	db := setupSQLite(t)
	now := time.Now().UTC()
	insertNotificationRow(t, db, "n-new-read", "user-1", true, now.Add(-1*time.Hour))

	res, err := PurgeReadNotifications(db, now.Add(-90*24*time.Hour))
	require.NoError(t, err)
	require.Equal(t, int64(0), res.DeletedRows)
}
