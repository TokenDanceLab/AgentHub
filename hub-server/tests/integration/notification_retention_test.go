//go:build integration

package integration

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/agenthub/hub-server/internal/repository"
)

// TestNotificationRetention_OldReadPurged verifies on real PG16 that the
// retention pass deletes only read notifications older than the cutoff:
// unread rows (unacknowledged signals) and fresh read rows are never touched.
func TestNotificationRetention_OldReadPurged(t *testing.T) {
	t.Cleanup(func() { CleanDB(t, db) })

	// Bypass FK checks so we can insert notifications without parent users
	// (same pattern as orphan_recovery_test.go insertOrphanTask).
	require.NoError(t, db.Exec(`SET session_replication_role = 'replica'`).Error)
	now := time.Now().UTC()
	rows := []struct {
		id   string
		read bool
		age  time.Duration
	}{
		{"11111111-1111-1111-1111-111111111111", true, 120 * 24 * time.Hour},
		{"22222222-2222-2222-2222-222222222222", false, 120 * 24 * time.Hour},
		{"33333333-3333-3333-3333-333333333333", true, 1 * time.Hour},
	}
	for _, r := range rows {
		require.NoError(t, db.Exec(`INSERT INTO notifications (id, user_id, type, payload, read, created_at)
			VALUES (?, gen_random_uuid(), 'test', '{}', ?, ?)`, r.id, r.read, now.Add(-r.age)).Error)
	}
	require.NoError(t, db.Exec(`SET session_replication_role = 'origin'`).Error)

	res, err := repository.PurgeReadNotifications(db, now.Add(-90*24*time.Hour))
	require.NoError(t, err)
	require.Equal(t, int64(1), res.DeletedRows, "only the old read row may be purged")

	var remaining []string
	require.NoError(t, db.Raw(`SELECT id FROM notifications ORDER BY id`).Scan(&remaining).Error)
	require.Equal(t, []string{"22222222-2222-2222-2222-222222222222", "33333333-3333-3333-3333-333333333333"}, remaining)
}
