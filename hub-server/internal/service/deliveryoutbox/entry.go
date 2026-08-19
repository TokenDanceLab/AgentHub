package deliveryoutbox

import "time"

// Entry is a read-only journal view for scan/test callers and store
// implementations. It intentionally carries no GORM tags so callers never
// couple to the persistence shape of the underlying row.
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
