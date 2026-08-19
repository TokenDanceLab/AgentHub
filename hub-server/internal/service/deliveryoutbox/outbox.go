// Outbox journal operations: record / mark sent / ack / scan / retry claim /
// dead-letter / stats / cleanup / auto-ack. All persistence goes through the
// Store port so this package stays import-clean (pure-package gate).
package deliveryoutbox

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/uuidv7"
)

// Redispatcher re-sends a stored outbox payload for a delivery attempt.
// The outbox never unmarshals dispatchPayload; the implementer owns route
// selection (HTTP / WS / offline queue).
type Redispatcher interface {
	RedispatchDelivery(ctx context.Context, taskID, deliveryID, payloadJSON, edgeDeviceID string) error
}

// Outbox owns delivery journal operations and retry-loop orchestration.
// Redispatch implementation lives on DispatchService behind the Redispatcher port.
type Outbox struct {
	store        Store
	redispatcher Redispatcher // nil → journal only; retry loop skips redispatch
}

// NewOutbox constructs an Outbox. redispatcher may be nil for journal-only
// paths; retry loop then no-ops redispatch.
func NewOutbox(store Store, redispatcher Redispatcher) *Outbox {
	return &Outbox{store: store, redispatcher: redispatcher}
}

// SetRedispatcher injects (or replaces) the redispatch port.
// Useful after construct to avoid AgentService init cycles.
func (o *Outbox) SetRedispatcher(redispatcher Redispatcher) {
	if o == nil {
		return
	}
	o.redispatcher = redispatcher
}

// ── Journal operations ─────────────────────────────────────────────────────

// RecordDelivery inserts a delivery_outbox entry in status=pending before
// the Hub dispatches a task to the Edge. Returns the generated delivery_id.
func (o *Outbox) RecordDelivery(ctx context.Context, taskID, payload, edgeDeviceID string) (string, error) {
	deliveryID, err := uuidv7.New()
	if err != nil {
		return "", fmt.Errorf("generate delivery id: %w", err)
	}

	if err := o.store.Insert(ctx, Entry{
		DeliveryID:   deliveryID,
		TaskID:       taskID,
		Payload:      payload,
		Status:       StatusPending,
		MaxAttempts:  DefaultMaxAttempts,
		EdgeDeviceID: edgeDeviceID,
	}); err != nil {
		return "", fmt.Errorf("record delivery outbox: %w", err)
	}

	slog.Debug("delivery outbox recorded",
		"delivery_id", deliveryID,
		"task_id", taskID,
		"status", StatusPending,
	)
	return deliveryID, nil
}

// MarkDeliverySent transitions an outbox record from pending or retrying to
// sent after the Hub has dispatched (or successfully redispatched) the task
// to the Edge. Clears next_retry_at so the SentRetryCutoff ack-window governs
// the next scan rather than the retry cadence (avoids duplicate Edge runs).
// Already-sent/acked rows are a no-op (RowsAffected==0 tolerated).
//
// It also resets attempt_count to 0: a successful (re)dispatch proves the
// payload is durably queued/sent, so the dead-letter budget counts only
// CONSECUTIVE failed attempts. Without the reset, an offline-queued delivery
// whose every redispatch succeeds still exhausts max_attempts and goes dead
// within minutes — and the reconnect replay gate refuses to replay dead rows
// (outbox "owns" redelivery), permanently stranding the queued task for any
// desktop that reconnects later (#1031 offline replay contract).
func (o *Outbox) MarkDeliverySent(ctx context.Context, deliveryID string) error {
	// Explicit updated_at: model uses autoUpdateTime:false so map Updates must
	// bump it — SentRetryCutoff scans on updated_at for ack-window eligibility.
	now := time.Now()
	rows, err := o.store.UpdateByDeliveryID(ctx, deliveryID,
		[]string{StatusPending, StatusRetrying},
		Patch{
			Status:           strPtr(StatusSent),
			AttemptCount:     intPtr(0),
			ClearNextRetryAt: true,
			UpdatedAt:        &now,
		})
	if err != nil {
		return fmt.Errorf("mark delivery sent: %w", err)
	}
	if rows == 0 {
		// Already sent: a fresh dispatch (offline replay push to a live
		// desktop) restarts the ack-window so SentTimeout does not re-push a
		// duplicate right after the desktop just received the frame.
		_, bumpErr := o.store.UpdateByDeliveryID(ctx, deliveryID,
			[]string{StatusSent},
			Patch{UpdatedAt: &now})
		if bumpErr != nil {
			return fmt.Errorf("restart sent ack-window: %w", bumpErr)
		}
		return nil
	}
	slog.Debug("delivery marked sent", "delivery_id", deliveryID)
	return nil
}

// AckDelivery marks an outbox record as delivered when the Edge acknowledges
// the dispatch with the matching delivery_id.
func (o *Outbox) AckDelivery(ctx context.Context, deliveryID string) error {
	now := time.Now()
	rows, err := o.store.UpdateByDeliveryID(ctx, deliveryID, ActiveStatuses(), Patch{
		Status:      strPtr(StatusDelivered),
		DeliveredAt: &now,
	})
	if err != nil {
		return fmt.Errorf("ack delivery: %w", err)
	}
	if rows == 0 {
		// Check if already delivered (idempotent ack).
		existing, findErr := o.store.FindByDeliveryID(ctx, deliveryID)
		if findErr == nil && existing.Status == StatusDelivered {
			return nil
		}
		return errcode.ErrBadRequest.WithMessage("delivery not found or already terminal")
	}
	slog.Debug("delivery acked", "delivery_id", deliveryID)
	return nil
}

// ScanRetryableDeliveries returns deliveries eligible for retry: pending records
// past their pending timeout, and sent records past their sent timeout.
//
// Cutoff semantics mirror the pure helpers PendingRetryCutoff / SentRetryCutoff;
// the retrying branch matches IsRetryingDue (next_retry_at IS NOT NULL AND <= now)
// expressed in SQL by the store for batch efficiency (IsRetryingDue remains
// available for in-memory filters; do not change cutoff semantics).
func (o *Outbox) ScanRetryableDeliveries(ctx context.Context) ([]Entry, error) {
	now := time.Now()

	pending, err := o.store.ScanPending(ctx, PendingRetryCutoff(now), MaxBatch)
	if err != nil {
		return nil, fmt.Errorf("scan pending deliveries: %w", err)
	}
	sent, err := o.store.ScanSent(ctx, SentRetryCutoff(now), MaxBatch)
	if err != nil {
		return nil, fmt.Errorf("scan sent deliveries: %w", err)
	}
	retrying, err := o.store.ScanRetrying(ctx, now, MaxBatch)
	if err != nil {
		return nil, fmt.Errorf("scan retrying deliveries: %w", err)
	}

	combined := make([]Entry, 0, len(pending)+len(sent)+len(retrying))
	combined = append(combined, pending...)
	combined = append(combined, sent...)
	combined = append(combined, retrying...)
	return combined, nil
}

// MarkDeliveryRetrying transitions a delivery to retrying status and increments
// the attempt counter. Returns true if the retry should proceed, false if max
// attempts have been exceeded (caller should move to dead-letter) or if this
// worker lost the atomic claim to another concurrent retry worker.
//
// Claim is CAS on (delivery_id, active status, attempt_count): only one of
// multi-worker / overlapping ticks can redispatch the same delivery_id (#1009).
func (o *Outbox) MarkDeliveryRetrying(ctx context.Context, deliveryID string, lastError string) (shouldRetry bool, err error) {
	rec, err := o.store.FindByDeliveryID(ctx, deliveryID)
	if err != nil {
		return false, fmt.Errorf("find delivery for retry: %w", err)
	}
	return o.claimDeliveryRetrying(ctx, deliveryID, rec.TaskID, rec.AttemptCount, rec.MaxAttempts, lastError)
}

// claimDeliveryRetrying performs the atomic outbox claim for a known attempt
// snapshot (from find or from ScanRetryableDeliveries). expectedAttempt is the
// CAS key — concurrent workers that observed the same attempt compete, and only
// RowsAffected==1 may redispatch.
func (o *Outbox) claimDeliveryRetrying(ctx context.Context, deliveryID, taskID string, expectedAttempt, maxAttempts int, lastError string) (shouldRetry bool, err error) {
	newAttempt := NextAttempt(expectedAttempt)
	if ShouldDeadLetter(expectedAttempt, maxAttempts) {
		// Move to dead-letter under the same CAS so two workers cannot both
		// observe max-attempts and race the terminal transition.
		rows, updateErr := o.store.ClaimRetry(ctx, deliveryID, ActiveStatuses(), expectedAttempt, Patch{
			Status:           strPtr(StatusDead),
			AttemptCount:     intPtr(newAttempt),
			LastError:        strPtr(TruncateLastError(lastError)),
			ClearNextRetryAt: true,
		})
		if updateErr != nil {
			return false, fmt.Errorf("move to dead-letter: %w", updateErr)
		}
		if rows == 0 {
			// Lost claim or already terminal/stale attempt — skip.
			return false, nil
		}
		slog.Warn("delivery moved to dead-letter",
			"delivery_id", deliveryID,
			"task_id", taskID,
			"attempts", newAttempt,
			"max_attempts", maxAttempts,
			"last_error", lastError,
		)
		if metrics.DeliveryOutboxDeadLetters != nil {
			metrics.DeliveryOutboxDeadLetters.WithLabelValues("max_attempts").Inc()
		}
		return false, nil
	}

	nextRetry := NextRetryAt(newAttempt, time.Now())
	rows, err := o.store.ClaimRetry(ctx, deliveryID, ActiveStatuses(), expectedAttempt, Patch{
		Status:       strPtr(StatusRetrying),
		AttemptCount: intPtr(newAttempt),
		LastError:    strPtr(TruncateLastError(lastError)),
		NextRetryAt:  &nextRetry,
	})
	if err != nil {
		return false, fmt.Errorf("mark delivery retrying: %w", err)
	}
	if rows != 1 {
		// Another worker already claimed this delivery_id at this attempt.
		slog.Debug("delivery retry claim lost",
			"delivery_id", deliveryID,
			"expected_attempt", expectedAttempt,
		)
		return false, nil
	}

	slog.Info("delivery scheduled for retry",
		"delivery_id", deliveryID,
		"task_id", taskID,
		"attempt", newAttempt,
		"max_attempts", maxAttempts,
		"next_retry_at", nextRetry.Format(time.RFC3339),
	)
	if metrics.DeliveryOutboxRetryAttempts != nil {
		metrics.DeliveryOutboxRetryAttempts.Inc()
	}
	return true, nil
}

// MoveDeliveryToDeadLetter explicitly moves a delivery to dead-letter status.
// This is used when a retry attempt encounters a non-retryable error.
func (o *Outbox) MoveDeliveryToDeadLetter(ctx context.Context, deliveryID string, lastError string) error {
	_, err := o.store.UpdateByDeliveryID(ctx, deliveryID, ActiveStatuses(), Patch{
		Status:    strPtr(StatusDead),
		LastError: strPtr(TruncateLastError(lastError)),
	})
	if err != nil {
		return fmt.Errorf("move to dead-letter: %w", err)
	}
	slog.Warn("delivery moved to dead-letter (explicit)",
		"delivery_id", deliveryID,
		"last_error", lastError,
	)
	if metrics.DeliveryOutboxDeadLetters != nil {
		metrics.DeliveryOutboxDeadLetters.WithLabelValues("explicit").Inc()
	}
	return nil
}

// GetDeliveryStatus returns the current status of a delivery record.
func (o *Outbox) GetDeliveryStatus(ctx context.Context, deliveryID string) (string, error) {
	rec, err := o.store.FindByDeliveryID(ctx, deliveryID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return "", errcode.ErrBadRequest.WithMessage("delivery not found")
		}
		return "", err
	}
	return rec.Status, nil
}

// CleanupOldDeliveries removes delivered and dead-letter records older than
// the given duration. This should be called periodically to prevent unbounded
// outbox growth.
func (o *Outbox) CleanupOldDeliveries(ctx context.Context, olderThan time.Duration) (int64, error) {
	cutoff := time.Now().Add(-olderThan)
	removed, err := o.store.DeleteTerminal(ctx, CleanupStatuses(), cutoff)
	if err != nil {
		return 0, fmt.Errorf("cleanup old deliveries: %w", err)
	}
	if removed > 0 {
		slog.Info("cleaned up old delivery outbox records",
			"count", removed,
			"cutoff", cutoff.Format(time.RFC3339),
		)
	}
	return removed, nil
}

// GetDeliveryStats returns aggregate stats for the delivery outbox.
func (o *Outbox) GetDeliveryStats(ctx context.Context) (map[string]int64, error) {
	stats, err := o.store.CountByStatus(ctx)
	if err != nil {
		return nil, fmt.Errorf("get delivery stats: %w", err)
	}
	return stats, nil
}

// AutoAckDeliveriesForTask marks all pending/sent/retrying delivery outbox
// entries for a task as delivered. Exported so the flat service package can
// name it in the edgeCallbackOutbox port (edge callback no longer mutates the
// outbox row directly).
func (o *Outbox) AutoAckDeliveriesForTask(ctx context.Context, taskID string) {
	if o == nil || o.store == nil {
		return
	}
	now := time.Now()
	rows, err := o.store.UpdateByTaskID(ctx, taskID, ActiveStatuses(), Patch{
		Status:      strPtr(StatusDelivered),
		DeliveredAt: &now,
	})
	if err != nil {
		slog.Warn("failed to auto-ack deliveries for task", "task_id", taskID, "error", err)
		return
	}
	if rows > 0 {
		slog.Debug("auto-acked deliveries for task", "task_id", taskID, "count", rows)
	}
}

func strPtr(s string) *string { return &s }
func intPtr(i int) *int       { return &i }
