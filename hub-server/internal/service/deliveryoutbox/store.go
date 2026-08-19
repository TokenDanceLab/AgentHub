package deliveryoutbox

import (
	"context"
	"errors"
	"time"
)

// ErrNotFound is returned by Store.FindByDeliveryID when no row matches.
// GORM-backed implementations map gorm.ErrRecordNotFound to it so this
// package stays free of gorm (pure-package gate).
var ErrNotFound = errors.New("delivery outbox record not found")

// Store persists delivery_outbox rows. Implementations live outside this
// package (the gorm-backed store lives in the service package) so the
// pure-package import gate stays satisfied here.
type Store interface {
	// Insert inserts a new row. The implementation owns the primary key
	// and timestamp generation.
	Insert(ctx context.Context, entry Entry) error

	// FindByDeliveryID loads one row by delivery_id.
	FindByDeliveryID(ctx context.Context, deliveryID string) (Entry, error)

	// UpdateByDeliveryID applies a patch to rows matching delivery_id and,
	// when statusIn is non-empty, one of those statuses. Returns rows affected.
	UpdateByDeliveryID(ctx context.Context, deliveryID string, statusIn []string, patch Patch) (int64, error)

	// ClaimRetry performs the atomic CAS claim: update only when delivery_id
	// matches, status is in statusIn, and attempt_count equals expectedAttempt.
	ClaimRetry(ctx context.Context, deliveryID string, statusIn []string, expectedAttempt int, patch Patch) (int64, error)

	// UpdateByTaskID applies a patch to rows matching task_id and statusIn.
	UpdateByTaskID(ctx context.Context, taskID string, statusIn []string, patch Patch) (int64, error)

	// ScanPending / ScanSent / ScanRetrying return eligible rows for the
	// retry scan, capped at limit.
	ScanPending(ctx context.Context, createdBefore time.Time, limit int) ([]Entry, error)
	ScanSent(ctx context.Context, updatedBefore time.Time, limit int) ([]Entry, error)
	ScanRetrying(ctx context.Context, dueAt time.Time, limit int) ([]Entry, error)

	// CountByStatus returns per-status row counts (backlog gauge + stats).
	CountByStatus(ctx context.Context) (map[string]int64, error)

	// DeleteTerminal deletes rows whose status is in statusIn and whose
	// updated_at is at or before updatedBefore. Returns rows removed.
	DeleteTerminal(ctx context.Context, statusIn []string, updatedBefore time.Time) (int64, error)
}

// Patch carries optional column updates for Store update operations.
// Pointer fields are applied only when non-nil. ClearNextRetryAt forces
// next_retry_at to NULL.
type Patch struct {
	Status           *string
	AttemptCount     *int
	LastError        *string
	NextRetryAt      *time.Time
	ClearNextRetryAt bool
	DeliveredAt      *time.Time
	UpdatedAt        *time.Time
}
