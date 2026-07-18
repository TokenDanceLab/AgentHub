package dispatch

import "fmt"

// RedispatchPrepFailure classifies PrepareRedispatchPayload errors into the
// historical dead-letter kind + unwrap used by redispatchDelivery logging.
// Non-prep errors fall back to payload-unmarshal kind (defensive).
func RedispatchPrepFailure(err error) (kind string, unwrap error) {
	if err == nil {
		return "", nil
	}
	if prep, ok := err.(*PayloadPrepError); ok {
		return prep.Kind, prep.Err
	}
	return DeadLetterKindPayloadUnmarshal, err
}

// RedispatchOfflineQueueError wraps offline-queue push failures so
// retryDeliveries does not MarkDeliverySent (#999 soft-fail path).
func RedispatchOfflineQueueError(err error) error {
	return fmt.Errorf("redispatch offline queue: %w", err)
}

// RedispatchOfflineSuccessLogAttrs builds structured slog attrs for offline-queue
// success logs (device-bound path historically includes user_id).
func RedispatchOfflineSuccessLogAttrs(preferDevice bool, deliveryID, taskID, userID string) []any {
	attrs := []any{"delivery_id", deliveryID, "task_id", taskID}
	if RedispatchOfflineSuccessIncludesUserID(preferDevice) {
		attrs = append(attrs, "user_id", userID)
	}
	return attrs
}

// IsPayloadMarshalDeadLetter is true when redispatch prep failed on re-marshal
// (historical log branch split in redispatchDelivery).
func IsPayloadMarshalDeadLetter(kind string) bool {
	return kind == DeadLetterKindPayloadMarshal
}

// RedeliveryConnFacts captures pure connection observations after a route
// lookup for ClassifyRedeliveryRoute. Callers still own FindByConnID side-effects.
type RedeliveryConnFacts struct {
	ConnFound     bool
	ConnUserMatch bool
}

// ObserveRedeliveryConn builds RedeliveryConnFacts from looked-up connection
// identity. When conn is unavailable (nil lookup), both flags are false.
func ObserveRedeliveryConn(connFound bool, connUserID, triggeredByUserID string) RedeliveryConnFacts {
	if !connFound {
		return RedeliveryConnFacts{}
	}
	return RedeliveryConnFacts{
		ConnFound:     true,
		ConnUserMatch: IsMatchingRedeliveryConn(connUserID, triggeredByUserID),
	}
}

// RedeliveryOfflineLogKind selects historical offline-queue log wording for
// redispatch fallthrough (device-bound vs inviter fallback).
func RedeliveryOfflineLogKind(preferDevice bool) string {
	if preferDevice {
		return "offline"
	}
	return "fallback"
}

// RedispatchPrepLogMessage returns the historical redispatchDelivery slog message
// for a prep dead-letter kind (marshal vs unmarshal branch).
func RedispatchPrepLogMessage(kind string) string {
	if IsPayloadMarshalDeadLetter(kind) {
		return "failed to marshal redispatch payload"
	}
	return "failed to unmarshal delivery payload for redispatch"
}

// RedispatchOfflineSuccessLogMessage returns the historical success slog message
// after PushPendingTask on redispatch fallthrough.
func RedispatchOfflineSuccessLogMessage(preferDevice bool) string {
	if preferDevice {
		return "redispatch: queued to offline queue"
	}
	return "redispatch: queued to fallback queue"
}

// RedispatchOfflineSuccessIncludesUserID is true when the offline-queue success
// log historically included user_id (device-bound path only).
func RedispatchOfflineSuccessIncludesUserID(preferDevice bool) bool {
	return preferDevice
}

// RedeliveryWSPushSucceeded is true when a redispatch WS push was queued.
func RedeliveryWSPushSucceeded(queued bool) bool {
	return queued
}

// Historical redispatchDelivery / retryDispatchToTarget slog messages.
const (
	RedispatchLogTaskLookupFailed    = "redispatch: task lookup failed, marking dead-letter"
	RedispatchLogTaskTerminal        = "redispatch: task in terminal state, moving delivery to dead-letter"
	RedispatchLogHTTPSucceeded       = "redispatch: HTTP dispatch succeeded"
	RedispatchLogWSSucceeded         = "redispatch: WS dispatch succeeded"
	RedispatchLogWSNotQueued         = "redispatch: WS push not queued"
	RedispatchLogWSFallbackSucceeded = "redispatch: WS fallback dispatch succeeded"
)

// RedispatchOfflinePushFailedLogMessage returns the historical offline-queue push
// failure slog message for preferDevice-bound vs inviter fallback.
func RedispatchOfflinePushFailedLogMessage(preferDevice bool) string {
	return "redispatch: failed to push to " + RedeliveryOfflineLogKind(preferDevice) + " queue"
}
