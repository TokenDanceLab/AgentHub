package repository

import (
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const defaultAuditPageSize = 50

// CreateAuditEvent inserts a new audit event record with hash-chain linking.
// It computes PrevHash from the most recent audit event, then inserts the new
// event in a single transaction to avoid race conditions in the hash chain.
// The tail row is locked FOR UPDATE; the unique prev_hash index (migration
// 0058) is the second line of defense: a concurrent writer that raced onto
// the same predecessor gets a unique violation and retries against the new
// tail (including the genesis race on an empty table) (#1541).
func CreateAuditEvent(db *gorm.DB, event *model.AuditEvent) error {
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		lastErr = createAuditEventOnce(db, event)
		if lastErr == nil {
			return nil
		}
		if !isUniqueViolation(lastErr) {
			return lastErr
		}
	}
	return lastErr
}

// auditChainAdvisoryLockKey serializes audit chain writers. A row-level
// FOR UPDATE on the tail cannot prevent forks: a concurrent writer's tail
// query does not see uncommitted new rows (READ COMMITTED), so two writers
// can both link to the same committed tail. The advisory xact lock is held
// until commit regardless of row visibility — no two transactions can read
// the same tail (#1541). The unique prev_hash index remains the final
// defense; the retry loop in CreateAuditEvent absorbs the genesis race.
const auditChainAdvisoryLockKey = 8642884100019247 // fixed; matches no hash

func createAuditEventOnce(db *gorm.DB, event *model.AuditEvent) error {
	return db.Transaction(func(tx *gorm.DB) error {
		// Advisory xact lock: serialize all chain writers (multi-instance
		// safe). Not available on sqlite (unit tests) — the integration
		// lane exercises the PostgreSQL path.
		if tx.Name() == "postgres" {
			if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", auditChainAdvisoryLockKey).Error; err != nil {
				return err
			}
		}
		var prev model.AuditEvent
		err := tx.Model(&model.AuditEvent{}).
			Clauses(clause.Locking{Strength: "UPDATE"}).
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
			event.PrevHash = model.ComputeLinkHash(&prev)
		}
		return tx.Create(event).Error
	})
}

// ListAuditEvents returns audit events with optional filters and cursor-based pagination.
// When userID is empty, queries across all users (admin). When non-empty, filters to that user.
// Cursor-based pagination uses descending order (newest first): WHERE id < cursor.
func ListAuditEvents(db *gorm.DB, userID, eventType, severity string, since, until *time.Time, cursor string, pageSize int) ([]model.AuditEvent, bool, error) {
	pageSize = config.ClampPageSize(pageSize, config.MaxListPageSize, defaultAuditPageSize)

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
