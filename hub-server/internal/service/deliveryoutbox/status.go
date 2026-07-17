package deliveryoutbox

// Journal status strings for delivery_outbox rows.
// Orchestration keeps thin aliases (DeliveryStatus*) for existing call sites.
const (
	StatusPending   = "pending"
	StatusSent      = "sent"
	StatusDelivered = "delivered"
	StatusRetrying  = "retrying"
	StatusDead      = "dead"
)

// LastErrorMaxLen caps persisted last_error text (matches historical truncate).
const LastErrorMaxLen = 1024

// ActiveStatuses are non-terminal statuses eligible for ack / retry transitions.
func ActiveStatuses() []string {
	return []string{StatusPending, StatusSent, StatusRetrying}
}

// CleanupStatuses are terminal statuses eligible for CleanupOldDeliveries.
func CleanupStatuses() []string {
	return []string{StatusDelivered, StatusDead}
}

// TruncateLastError truncates a delivery last_error to LastErrorMaxLen.
func TruncateLastError(s string) string {
	return TruncateString(s, LastErrorMaxLen)
}
