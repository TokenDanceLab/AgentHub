// GORM-backed Store implementation for the pure deliveryoutbox package.
// Kept in the flat service package (which may import gorm and deliveryoutbox)
// so the pure-package import gate stays satisfied inside deliveryoutbox.
package service

import (
	"context"
	"errors"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/service/deliveryoutbox"
	"github.com/agenthub/hub-server/internal/uuidv7"
)

// deliveryOutboxRecord is the GORM row for the delivery_outbox table.
// Owned by this file; deliveryoutbox.Entry is the public read view.
type deliveryOutboxRecord struct {
	ID           string     `gorm:"primaryKey;type:uuid"`
	TaskID       string     `gorm:"type:uuid;not null;index:idx_delivery_outbox_task_id"`
	DeliveryID   string     `gorm:"type:varchar(128);not null;uniqueIndex:idx_delivery_outbox_delivery_id"`
	Payload      string     `gorm:"type:text;not null"`
	Status       string     `gorm:"type:varchar(16);not null;default:pending;index:idx_delivery_outbox_status_nr,priority:1"`
	AttemptCount int        `gorm:"type:smallint;not null;default:0"`
	MaxAttempts  int        `gorm:"type:smallint;not null;default:3"`
	NextRetryAt  *time.Time `gorm:"type:timestamptz;index:idx_delivery_outbox_status_nr,priority:2"`
	LastError    string     `gorm:"type:text;default:''"`
	EdgeDeviceID string     `gorm:"type:uuid;default:null"`
	CreatedAt    time.Time  `gorm:"autoCreateTime"`
	UpdatedAt    time.Time  `gorm:"autoUpdateTime:false"`
	DeliveredAt  *time.Time `gorm:"type:timestamptz"`
}

// TableName overrides the default pluralized table name for GORM.
func (deliveryOutboxRecord) TableName() string {
	return "delivery_outbox"
}

func (r *deliveryOutboxRecord) beforeCreate() error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	r.ID = id
	return nil
}

// DeliveryOutboxStore is the gorm-backed implementation of deliveryoutbox.Store.
type DeliveryOutboxStore struct {
	db *gorm.DB
}

// NewDeliveryOutboxStore constructs the gorm store.
func NewDeliveryOutboxStore(db *gorm.DB) *DeliveryOutboxStore {
	return &DeliveryOutboxStore{db: db}
}

var _ deliveryoutbox.Store = (*DeliveryOutboxStore)(nil)

func recordFromEntry(e deliveryoutbox.Entry) *deliveryOutboxRecord {
	return &deliveryOutboxRecord{
		ID:           e.ID,
		TaskID:       e.TaskID,
		DeliveryID:   e.DeliveryID,
		Payload:      e.Payload,
		Status:       e.Status,
		AttemptCount: e.AttemptCount,
		MaxAttempts:  e.MaxAttempts,
		NextRetryAt:  e.NextRetryAt,
		LastError:    e.LastError,
		EdgeDeviceID: e.EdgeDeviceID,
		CreatedAt:    e.CreatedAt,
		UpdatedAt:    e.UpdatedAt,
		DeliveredAt:  e.DeliveredAt,
	}
}

func (r deliveryOutboxRecord) toEntry() deliveryoutbox.Entry {
	return deliveryoutbox.Entry{
		ID:           r.ID,
		TaskID:       r.TaskID,
		DeliveryID:   r.DeliveryID,
		Payload:      r.Payload,
		Status:       r.Status,
		AttemptCount: r.AttemptCount,
		MaxAttempts:  r.MaxAttempts,
		NextRetryAt:  r.NextRetryAt,
		LastError:    r.LastError,
		EdgeDeviceID: r.EdgeDeviceID,
		CreatedAt:    r.CreatedAt,
		UpdatedAt:    r.UpdatedAt,
		DeliveredAt:  r.DeliveredAt,
	}
}

// patchToMap converts the pure Patch into a gorm column map.
func patchToMap(patch deliveryoutbox.Patch) map[string]interface{} {
	fields := map[string]interface{}{}
	if patch.Status != nil {
		fields["status"] = *patch.Status
	}
	if patch.AttemptCount != nil {
		fields["attempt_count"] = *patch.AttemptCount
	}
	if patch.LastError != nil {
		fields["last_error"] = *patch.LastError
	}
	if patch.NextRetryAt != nil {
		fields["next_retry_at"] = *patch.NextRetryAt
	}
	if patch.ClearNextRetryAt {
		fields["next_retry_at"] = nil
	}
	if patch.DeliveredAt != nil {
		fields["delivered_at"] = *patch.DeliveredAt
	}
	if patch.UpdatedAt != nil {
		fields["updated_at"] = *patch.UpdatedAt
	}
	return fields
}

// Insert implements deliveryoutbox.Store.
func (s *DeliveryOutboxStore) Insert(ctx context.Context, entry deliveryoutbox.Entry) error {
	rec := recordFromEntry(entry)
	if err := rec.beforeCreate(); err != nil {
		return err
	}
	return s.db.WithContext(ctx).Create(rec).Error
}

// FindByDeliveryID implements deliveryoutbox.Store.
func (s *DeliveryOutboxStore) FindByDeliveryID(ctx context.Context, deliveryID string) (deliveryoutbox.Entry, error) {
	var rec deliveryOutboxRecord
	err := s.db.WithContext(ctx).Where("delivery_id = ?", deliveryID).First(&rec).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return deliveryoutbox.Entry{}, deliveryoutbox.ErrNotFound
	}
	return rec.toEntry(), err
}

// UpdateByDeliveryID implements deliveryoutbox.Store.
func (s *DeliveryOutboxStore) UpdateByDeliveryID(ctx context.Context, deliveryID string, statusIn []string, patch deliveryoutbox.Patch) (int64, error) {
	q := s.db.WithContext(ctx).Model(&deliveryOutboxRecord{}).Where("delivery_id = ?", deliveryID)
	if len(statusIn) > 0 {
		q = q.Where("status IN ?", statusIn)
	}
	result := q.Updates(patchToMap(patch))
	return result.RowsAffected, result.Error
}

// ClaimRetry implements deliveryoutbox.Store.
func (s *DeliveryOutboxStore) ClaimRetry(ctx context.Context, deliveryID string, statusIn []string, expectedAttempt int, patch deliveryoutbox.Patch) (int64, error) {
	result := s.db.WithContext(ctx).Model(&deliveryOutboxRecord{}).
		Where("delivery_id = ? AND status IN ? AND attempt_count = ?",
			deliveryID, statusIn, expectedAttempt).
		Updates(patchToMap(patch))
	return result.RowsAffected, result.Error
}

// UpdateByTaskID implements deliveryoutbox.Store.
func (s *DeliveryOutboxStore) UpdateByTaskID(ctx context.Context, taskID string, statusIn []string, patch deliveryoutbox.Patch) (int64, error) {
	q := s.db.WithContext(ctx).Model(&deliveryOutboxRecord{}).Where("task_id = ?", taskID)
	if len(statusIn) > 0 {
		q = q.Where("status IN ?", statusIn)
	}
	result := q.Updates(patchToMap(patch))
	return result.RowsAffected, result.Error
}

// ScanPending implements deliveryoutbox.Store.
func (s *DeliveryOutboxStore) ScanPending(ctx context.Context, createdBefore time.Time, limit int) ([]deliveryoutbox.Entry, error) {
	var rows []deliveryOutboxRecord
	err := s.db.WithContext(ctx).
		Where("status = ? AND created_at <= ?", deliveryoutbox.StatusPending, createdBefore).
		Limit(limit).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	entries := make([]deliveryoutbox.Entry, len(rows))
	for i, r := range rows {
		entries[i] = r.toEntry()
	}
	return entries, nil
}

// ScanSent implements deliveryoutbox.Store.
func (s *DeliveryOutboxStore) ScanSent(ctx context.Context, updatedBefore time.Time, limit int) ([]deliveryoutbox.Entry, error) {
	var rows []deliveryOutboxRecord
	err := s.db.WithContext(ctx).
		Where("status = ? AND updated_at <= ?", deliveryoutbox.StatusSent, updatedBefore).
		Limit(limit).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	entries := make([]deliveryoutbox.Entry, len(rows))
	for i, r := range rows {
		entries[i] = r.toEntry()
	}
	return entries, nil
}

// ScanRetrying implements deliveryoutbox.Store.
func (s *DeliveryOutboxStore) ScanRetrying(ctx context.Context, dueAt time.Time, limit int) ([]deliveryoutbox.Entry, error) {
	var rows []deliveryOutboxRecord
	err := s.db.WithContext(ctx).
		Where("status = ? AND next_retry_at IS NOT NULL AND next_retry_at <= ?", deliveryoutbox.StatusRetrying, dueAt).
		Limit(limit).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	entries := make([]deliveryoutbox.Entry, len(rows))
	for i, r := range rows {
		entries[i] = r.toEntry()
	}
	return entries, nil
}

// CountByStatus implements deliveryoutbox.Store.
func (s *DeliveryOutboxStore) CountByStatus(ctx context.Context) (map[string]int64, error) {
	type statusCount struct {
		Status string
		Count  int64
	}
	var rows []statusCount
	err := s.db.WithContext(ctx).
		Model(&deliveryOutboxRecord{}).
		Select("status, COUNT(*) as count").
		Group("status").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	stats := make(map[string]int64, len(rows))
	for _, r := range rows {
		stats[r.Status] = r.Count
	}
	return stats, nil
}

// DeleteTerminal implements deliveryoutbox.Store.
func (s *DeliveryOutboxStore) DeleteTerminal(ctx context.Context, statusIn []string, updatedBefore time.Time) (int64, error) {
	result := s.db.WithContext(ctx).
		Where("status IN ? AND updated_at <= ?", statusIn, updatedBefore).
		Delete(&deliveryOutboxRecord{})
	if result.Error != nil {
		return 0, result.Error
	}
	return result.RowsAffected, nil
}
