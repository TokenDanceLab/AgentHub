package service

import (
	"context"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/service/deliveryoutbox"
	"github.com/agenthub/hub-server/internal/uuidv7"
)

// ── Model (owned by DeliveryOutbox; not part of AgentService surface) ──────
//
// Adjacent same-package residual split (#801): private GORM row, read view,
// redispatch target, and repository helpers. Orchestration stays in
// delivery_outbox.go; AgentService facades/aliases in delivery_outbox_facade.go.
// Full model package move remains deferred (boundary map residual).

// deliveryOutboxRecord is the private GORM row for delivery_outbox.
// Only DeliveryOutbox journal/repository helpers may construct or query it.
// Callers outside the outbox surface use DeliveryOutboxEntry (read view) or
// redispatchTarget (opaque redispatch fields). Full model/repository package
// move remains deferred; this residual seals ownership inside DeliveryOutbox.
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

func (r *deliveryOutboxRecord) BeforeCreate(tx *gorm.DB) error {
	id, err := uuidv7.New()
	if err != nil {
		return err
	}
	r.ID = id
	return nil
}

func (r *deliveryOutboxRecord) BeforeUpdate(tx *gorm.DB) error {
	r.UpdatedAt = time.Now()
	return nil
}

// TableName overrides the default pluralized table name for GORM.
func (deliveryOutboxRecord) TableName() string {
	return "delivery_outbox"
}

// DeliveryOutboxEntry is a read-only journal view for scan/test callers.
// It intentionally carries no GORM tags so AgentService / tests do not couple
// to the private persistence shape of deliveryOutboxRecord.
type DeliveryOutboxEntry struct {
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

func (r deliveryOutboxRecord) toEntry() DeliveryOutboxEntry {
	return DeliveryOutboxEntry(r)
}

// ── DeliveryOutbox private repository helpers ──────────────────────────────

// outboxModel is the GORM model handle for delivery_outbox mutations.
func outboxModel() *deliveryOutboxRecord { return &deliveryOutboxRecord{} }

// findOutboxByDeliveryID loads one private row by delivery_id.
func (o *DeliveryOutbox) findOutboxByDeliveryID(ctx context.Context, deliveryID string) (deliveryOutboxRecord, error) {
	var rec deliveryOutboxRecord
	err := o.db.WithContext(ctx).Where("delivery_id = ?", deliveryID).First(&rec).Error
	return rec, err
}

// updateOutboxByDeliveryID applies column updates for rows matching delivery_id
// and (optional) status filter. statusIn may be nil to skip status constraint.
func (o *DeliveryOutbox) updateOutboxByDeliveryID(ctx context.Context, deliveryID string, statusIn []string, fields map[string]interface{}) (int64, error) {
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
func (o *DeliveryOutbox) claimOutboxRetry(ctx context.Context, deliveryID string, expectedAttempt int, fields map[string]interface{}) (int64, error) {
	result := o.db.WithContext(ctx).Model(outboxModel()).
		Where("delivery_id = ? AND status IN ? AND attempt_count = ?",
			deliveryID, deliveryoutbox.ActiveStatuses(), expectedAttempt).
		Updates(fields)
	return result.RowsAffected, result.Error
}
