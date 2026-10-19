package dispatch

// ShouldReplayOfflinePayload is true when reconnect offline push may forward a
// queued payload. Only terminal outbox rows (delivered / dead) must not re-fire
// after reconnect (#1031).
//
// "sent" is allowed: the row is alive and its payload is still sitting in the
// offline queue. Blocking it here drops the popped payload with no redelivery
// to the desktop that just reconnected — the reconnect replay is the ONLY
// delivery trigger, so a sent-row skip permanently strands the queued task.
// After a successful replay push, the caller must re-mark the row sent so the
// ack-window restarts and the outbox does not re-push a duplicate immediately.
//
// When deliveryID is empty (legacy payloads without outbox), replay is allowed.
// lookupOK false (outbox unavailable / not found) also allows replay so offline
// durability is not lost when the journal is degraded.
func ShouldReplayOfflinePayload(deliveryID, outboxStatus string, lookupOK bool) bool {
	if deliveryID == "" {
		return true
	}
	if !lookupOK {
		return true
	}
	switch outboxStatus {
	case "pending", "retrying", "sent":
		return true
	default:
		// delivered / dead — terminal, outbox no longer owns redelivery.
		return false
	}
}
