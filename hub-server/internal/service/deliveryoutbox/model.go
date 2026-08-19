// Model ownership for the delivery_outbox journal: private GORM row, read
// view, and repository helpers. Only Outbox journal/repository helpers may
// construct or query outboxRecord; callers outside the package use Entry.
package deliveryoutbox

import (
	"context"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/uuidv7"
)

// outboxRecord is the private GORM row for delivery_outbox.
// Only Outbox journal/repository helpers may construct or query it.
// Callers outside the outbox surface use Entry (read view) or
// redispatchTarget (opaque redispatch fields).
type outboxRecord struct {
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

func (r *outboxRecord) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	r.ID = id
	return nil
}

func (r *outboxRecord) BeforeUpdate(tx *gorm.DB) error {
	r.UpdatedAt = time.Now()
	return nil
}

// TableName overrides the default pluralized table name for GORM.
func (outboxRecord) TableName() string {
	return "delivery_outbox"
}

// Entry is a read-only journal view for scan/test callers.
// It intentionally carries no GORM tags so callers do not couple
// to the private persistence shape of outboxRecord.
type Entry struct {
	ID           string
	TaskID       string
	DeliveryID   string
	Payload      string
	Status       string
	AttemptCount int
	MaxAttempts  int
	NextRetryAt  *time.Time
	LastError    string
	EdgeDeviceID string
	CreatedAt    time.Time
	UpdatedAt    time.Time
	DeliveredAt  *time.Time
}

func (r outboxRecord) toEntry() Entry {
	return Entry(r)
}

// ── Outbox private repository helpers ──────────────────────────────────────

// outboxModel is the GORM model handle for delivery_outbox mutations.
func outboxModel() *outboxRecord { return &outboxRecord{} }

// findOutboxByDeliveryID loads one private row by delivery_id.
func (o *Outbox) findOutboxByDeliveryID(ctx context.Context, deliveryID string) (outboxRecord, error) {
	var rec outboxRecord
	err := o.db.WithContext(ctx).Where("delivery_id = ?", deliveryID).First(&rec).Error
	return rec, err
}

// updateOutboxByDeliveryID applies column updates for rows matching delivery_id
// and (optional) status filter. statusIn may be nil to skip status constraint.
func (o *Outbox) updateOutboxByDeliveryID(ctx context.Context, deliveryID string, statusIn []string, fields map[string]interface{}) (int64, error) {
	q := o.db.WithContext(ctx).Model(outboxModel()).Where("delivery_id = ?", deliveryID)
	if len(statusIn) > 0 {
		q = q.Where("status IN ?", statusIn)
	}
	result := q.Updates(fields)
	return result.RowsAffected, result.Error
}

// claimOutboxRetry performs an atomic outbox claim: UPDATE only succeeds when
// delivery_id matches, status is still active, and attempt_count equals the
// expected value observed by the caller. RowsAffected==1 means this worker owns
// the redispatch; 0 means another worker already claimed (or row left active set).
func (o *Outbox) claimOutboxRetry(ctx context.Context, deliveryID string, expectedAttempt int, fields map[string]interface{}) (int64, error) {
	result := o.db.WithContext(ctx).Model(outboxModel()).
		Where("delivery_id = ? AND status IN ? AND attempt_count = ?",
			deliveryID, ActiveStatuses(), expectedAttempt).
		Updates(fields)
	return result.RowsAffected, result.Error
}
