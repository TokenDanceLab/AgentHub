package repository

import (
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/agenthub/hub-server/internal/model"
)

// UpsertExecutionTargetEvidence records the latest health evidence for a
// target (#1544). It is CAS'd on observed_at: an evidence with an older
// observed_at never overwrites a newer one, so concurrent probes/heartbeats
// cannot regress fresh evidence with stale writes (the projection would
// otherwise flip a live target to stale on a slow writer).
func UpsertExecutionTargetEvidence(db *gorm.DB, ev *model.ExecutionTargetEvidence) error {
	return db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "target_id"}},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"source":             ev.Source,
			"status":             ev.Status,
			"failure_category":   ev.FailureCategory,
			"observed_target_id": ev.ObservedTargetID,
			"route_key":          ev.RouteKey,
			"observed_at":        ev.ObservedAt,
			"expires_at":         ev.ExpiresAt,
			// Go-side timestamp: NOW() is PostgreSQL-only and the unit tests
			// run on SQLite.
			"updated_at": time.Now(),
		}),
		// Only overwrite when the incoming evidence is not older than the
		// stored one — stale writers are dropped without error.
		Where: clause.Where{
			Exprs: []clause.Expression{
				clause.Expr{SQL: "execution_target_evidence.observed_at <= ?", Vars: []interface{}{ev.ObservedAt}},
			},
		},
	}).Create(ev).Error
}

// GetExecutionTargetEvidence returns the latest evidence row for a target,
// or gorm.ErrRecordNotFound when none has been recorded yet.
func GetExecutionTargetEvidence(db *gorm.DB, targetID string) (*model.ExecutionTargetEvidence, error) {
	var ev model.ExecutionTargetEvidence
	err := db.Where("target_id = ?", targetID).First(&ev).Error
	if err != nil {
		return nil, err
	}
	return &ev, nil
}

// GetExecutionTargetEvidenceByTargetIDs returns the latest evidence rows for
// a batch of target IDs, keyed by target_id. Missing evidence simply does
// not appear (callers treat absence as "no evidence recorded yet").
func GetExecutionTargetEvidenceByTargetIDs(db *gorm.DB, targetIDs []string) (map[string]model.ExecutionTargetEvidence, error) {
	result := make(map[string]model.ExecutionTargetEvidence)
	if len(targetIDs) == 0 {
		return result, nil
	}
	var rows []model.ExecutionTargetEvidence
	if err := db.Where("target_id IN ?", targetIDs).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.TargetID] = row
	}
	return result, nil
}

// IsEvidenceNotFound reports whether err is a not-found for an evidence row.
func IsEvidenceNotFound(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound)
}
