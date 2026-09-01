package repository

import (
	"fmt"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

// NotificationRetentionResult reports what a notification retention pass did.
type NotificationRetentionResult struct {
	DeletedRows int64
}

// PurgeReadNotifications enforces the notifications retention policy: delete
// read notifications created at or before cutoff. Unread notifications are
// never touched — they represent unacknowledged user-facing signals and stay
// until the user acts on them. A single DELETE keeps the pass atomic; the
// user_id/created_at index family keeps the scan cheap.
func PurgeReadNotifications(db *gorm.DB, cutoff time.Time) (NotificationRetentionResult, error) {
	res := db.Where("read = ? AND created_at <= ?", true, cutoff).Delete(&model.Notification{})
	if res.Error != nil {
		return NotificationRetentionResult{}, fmt.Errorf("purge read notifications: %w", res.Error)
	}
	return NotificationRetentionResult{DeletedRows: res.RowsAffected}, nil
}
