package repository

import (
	"time"

	"github.com/agenthub/hub-server/internal/model"
	"gorm.io/gorm"
)

const defaultAuditPageSize = 50

// CreateAuditEvent inserts a new audit event record.
func CreateAuditEvent(db *gorm.DB, event *model.AuditEvent) error {
	return db.Create(event).Error
}

// GetAuditEventByID returns an audit event by its ID.
func GetAuditEventByID(db *gorm.DB, id string) (*model.AuditEvent, error) {
	var e model.AuditEvent
	err := db.Where("id = ?", id).First(&e).Error
	if err != nil {
		return nil, err
	}
	return &e, nil
}

// ListAuditEvents returns audit events with optional filters and cursor-based pagination.
// When userID is empty, queries across all users (admin). When non-empty, filters to that user.
// Cursor-based pagination uses descending order (newest first): WHERE id < cursor.
func ListAuditEvents(db *gorm.DB, userID, eventType, severity string, since, until *time.Time, cursor string, pageSize int) ([]model.AuditEvent, bool, error) {
	if pageSize <= 0 || pageSize > 200 {
		pageSize = defaultAuditPageSize
	}

	qry := db.Model(&model.AuditEvent{})
	if userID != "" {
		qry = qry.Where("user_id = ?", userID)
	}
	if eventType != "" {
		qry = qry.Where("event_type = ?", eventType)
	}
	if severity != "" {
		qry = qry.Where("severity = ?", severity)
	}
	if since != nil {
		qry = qry.Where("created_at >= ?", *since)
	}
	if until != nil {
		qry = qry.Where("created_at <= ?", *until)
	}
	if cursor != "" {
		qry = qry.Where("id < ?", cursor)
	}

	var events []model.AuditEvent
	if err := qry.Order("created_at DESC, id DESC").Limit(pageSize + 1).Find(&events).Error; err != nil {
		return nil, false, err
	}

	hasMore := len(events) > pageSize
	if hasMore {
		events = events[:pageSize]
	}
	return events, hasMore, nil
}

// DeleteAuditEventsBefore removes audit events older than the given time (TTL cleanup).
// Returns the number of deleted records.
func DeleteAuditEventsBefore(db *gorm.DB, before time.Time) (int64, error) {
	result := db.Where("created_at < ?", before).Delete(&model.AuditEvent{})
	return result.RowsAffected, result.Error
}
