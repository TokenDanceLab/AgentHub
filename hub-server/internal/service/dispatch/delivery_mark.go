package dispatch

// DeliveryMarkAfterDispatch is true when a delivery was recorded and should be
// marked sent after a successful live dispatch path (HTTP / WS / hub_relay).
// Empty deliveryID means outbox record failed and durability is degraded.
func DeliveryMarkAfterDispatch(deliveryID string) bool {
	return deliveryID != ""
}

// DeliveryMarkAfterOfflineQueue is always false: offline queue acceptance is
// not Edge receipt. Outbox ownership stays pending/retrying so reconnect replay
// and outbox redispatch do not dual-fire the same delivery_id (#1031).
// Ack/stream paths (#999/#1000) remain the durable "delivered" signal.
func DeliveryMarkAfterOfflineQueue(deliveryID string) bool {
	_ = deliveryID
	return false
}

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

// ShouldIssueCapabilityToken is true when ResolveCapabilityMint returned Ok.
// Kept as a named predicate so orchestration reads as pure decision → mint.
func ShouldIssueCapabilityToken(resolved CapabilityMintResolved) bool {
	return resolved.Ok
}

// IsHTTPEdgeDispatchSuccess is true when local Edge HTTP returned a run id.
func IsHTTPEdgeDispatchSuccess(edgeRunID string) bool {
	return edgeRunID != ""
}
