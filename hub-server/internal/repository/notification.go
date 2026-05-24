package repository

import (
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
	"gorm.io/gorm"
)

func CreateNotification(db *gorm.DB, n *model.Notification) error {
	return db.Create(n).Error
}

func ListNotifications(db *gorm.DB, userID string, unreadOnly bool, limit, offset int) ([]model.Notification, error) {
	if limit <= 0 || limit > config.MaxMessagePageLimit {
		limit = config.DefaultPaginationLimit
	}
	var notifs []model.Notification
	query := db.Where("user_id = ?", userID)
	if unreadOnly {
		query = query.Where("read = false")
	}
	err := query.Order("created_at DESC").Limit(limit).Offset(offset).Find(&notifs).Error
	return notifs, err
}

func MarkNotificationRead(db *gorm.DB, notifID string) error {
	return db.Model(&model.Notification{}).Where("id = ?", notifID).Update("read", true).Error
}

func MarkAllNotificationsRead(db *gorm.DB, userID string) error {
	return db.Model(&model.Notification{}).Where("user_id = ? AND read = false", userID).Update("read", true).Error
}
