package repository

import (
	"time"

	"github.com/agenthub/hub-server/internal/model"
	"gorm.io/gorm"
)

const defaultAuditPageSize = 50

// CreateAuditEvent inserts a new audit event record with hash-chain linking.
// It computes PrevHash from the most recent audit event, then inserts the new
// event in a single transaction to avoid race conditions in the hash chain.
func CreateAuditEvent(db *gorm.DB, event *model.AuditEvent) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var prev model.AuditEvent
		err := tx.Model(&model.AuditEvent{}).
			Order("created_at DESC, id DESC").
			Limit(1).
			First(&prev).Error
		if err != nil && err != gorm.ErrRecordNotFound {
			return err
		}
		if err == gorm.ErrRecordNotFound {
			// Genesis event: no predecessor.
			event.PrevHash = ""
		} else {
			event.PrevHash = model.ComputeHash(prev.ID, prev.PrevHash)
		}
		return tx.Create(event).Error
	})
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

// GetLatestAuditEvent returns the most recent audit event for hash-chain
// computation, or nil if no events exist.
func GetLatestAuditEvent(db *gorm.DB) (*model.AuditEvent, error) {
	var e model.AuditEvent
	err := db.Model(&model.AuditEvent{}).
		Order("created_at DESC, id DESC").
		Limit(1).
		First(&e).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

// VerifyAuditChain verifies the integrity of up to limit audit events
// ordered by creation time. Returns the index of the first invalid link,
// or -1 if the chain is valid.
func VerifyAuditChain(db *gorm.DB, limit int) (int, error) {
	if limit <= 0 {
		limit = 1000
	}
	var events []model.AuditEvent
	if err := db.Model(&model.AuditEvent{}).
		Order("created_at ASC, id ASC").
		Limit(limit).
		Find(&events).Error; err != nil {
		return -1, err
	}
	return model.VerifyChain(events), nil
}
