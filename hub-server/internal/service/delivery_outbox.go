package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/service/deliveryoutbox"
	"github.com/agenthub/hub-server/internal/uuidv7"
)

// Delivery outbox orchestration residual (#801 file split):
//   - delivery_outbox.go — Redispatcher port, DeliveryOutbox type, journal ops,
//     retry loop, redispatch adapters (this file)
//   - delivery_outbox_model.go — GORM record, Entry DTO, redispatchTarget, repo
//   - delivery_outbox_facade.go — status/TTL aliases, AgentService facades
// Pure helpers remain in service/deliveryoutbox (#514 + #744). Ports stay;
// full model package move deferred.

// ── Redispatcher port + DeliveryOutbox type ────────────────────────────────

// Redispatcher re-sends a stored outbox payload for a delivery attempt.
// The outbox never unmarshals dispatchPayload; the implementer owns route
// selection (HTTP / WS / offline queue).
type Redispatcher interface {
	RedispatchDelivery(ctx context.Context, taskID, deliveryID, payloadJSON, edgeDeviceID string) error
}

// DeliveryOutbox owns delivery journal operations and retry-loop orchestration.
// Redispatch implementation lives on DispatchService behind the Redispatcher port.
type DeliveryOutbox struct {
	db           *gorm.DB
	redispatcher Redispatcher // nil → journal only; retry loop skips redispatch
}

// NewDeliveryOutbox constructs a DeliveryOutbox. redispatcher may be nil for
// journal-only paths; retry loop then no-ops redispatch.
func NewDeliveryOutbox(db *gorm.DB, redispatcher Redispatcher) *DeliveryOutbox {
	return &DeliveryOutbox{db: db, redispatcher: redispatcher}
}

// SetRedispatcher injects (or replaces) the redispatch port.
// Useful after construct to avoid AgentService init cycles.
func (o *DeliveryOutbox) SetRedispatcher(redispatcher Redispatcher) {
	if o == nil {
		return
	}
	o.redispatcher = redispatcher
}

// ── Journal operations ─────────────────────────────────────────────────────

// RecordDelivery inserts a delivery_outbox entry in status=pending before
// the Hub dispatches a task to the Edge. Returns the generated delivery_id.
func (o *DeliveryOutbox) RecordDelivery(ctx context.Context, taskID, payload, edgeDeviceID string) (string, error) {
	deliveryID, err := uuidv7.New()
	if err != nil {
		return "", fmt.Errorf("generate delivery id: %w", err)
	}

	rec := &deliveryOutboxRecord{
		DeliveryID:   deliveryID,
		TaskID:       taskID,
		Payload:      payload,
		Status:       DeliveryStatusPending,
		MaxAttempts:  DefaultMaxDeliveryAttempts,
		EdgeDeviceID: edgeDeviceID,
	}

	if err := o.db.WithContext(ctx).Create(rec).Error; err != nil {
		return "", fmt.Errorf("record delivery outbox: %w", err)
	}

	slog.Debug("delivery outbox recorded",
		"delivery_id", deliveryID,
		"task_id", taskID,
		"status", DeliveryStatusPending,
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
func (o *DeliveryOutbox) MarkDeliverySent(ctx context.Context, deliveryID string) error {
	// Explicit updated_at: model uses autoUpdateTime:false so map Updates must
	// bump it — SentRetryCutoff scans on updated_at for ack-window eligibility.
	rows, err := o.updateOutboxByDeliveryID(ctx, deliveryID,
		[]string{DeliveryStatusPending, DeliveryStatusRetrying},
		map[string]interface{}{
			"status":        DeliveryStatusSent,
			"attempt_count": 0,
			"next_retry_at": nil,
			"updated_at":    time.Now(),
		})
	if err != nil {
		return fmt.Errorf("mark delivery sent: %w", err)
	}
	if rows == 0 {
		// Already sent: a fresh dispatch (offline replay push to a live
		// desktop) restarts the ack-window so SentTimeout does not re-push a
		// duplicate right after the desktop just received the frame.
		_, bumpErr := o.updateOutboxByDeliveryID(ctx, deliveryID,
			[]string{DeliveryStatusSent},
			map[string]interface{}{
				"updated_at": time.Now(),
			})
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
func (o *DeliveryOutbox) AckDelivery(ctx context.Context, deliveryID string) error {
	now := time.Now()
	rows, err := o.updateOutboxByDeliveryID(ctx, deliveryID, deliveryoutbox.ActiveStatuses(), map[string]interface{}{
		"status":       DeliveryStatusDelivered,
		"delivered_at": &now,
	})
	if err != nil {
		return fmt.Errorf("ack delivery: %w", err)
	}
	if rows == 0 {
		// Check if already delivered (idempotent ack).
		existing, findErr := o.findOutboxByDeliveryID(ctx, deliveryID)
		if findErr == nil && existing.Status == DeliveryStatusDelivered {
			return nil
		}
		return errcode.ErrBadRequest.WithMessage("delivery not found or already terminal")
	}
	slog.Debug("delivery acked", "delivery_id", deliveryID)
	return nil
}

// ScanRetryableDeliveries returns deliveries eligible for retry: pending records
// past their pending timeout, and sent records past their sent timeout.
// Returns DeliveryOutboxEntry views so callers never hold the private GORM row type.
//
// SQL cutoffs mirror pure helpers: PendingRetryCutoff / SentRetryCutoff; the
// retrying branch matches IsRetryingDue (next_retry_at IS NOT NULL AND <= now)
// expressed in SQL for batch efficiency (IsRetryingDue remains available for
// in-memory filters; do not change cutoff semantics).
func (o *DeliveryOutbox) ScanRetryableDeliveries(ctx context.Context) ([]DeliveryOutboxEntry, error) {
	now := time.Now()
	var records []deliveryOutboxRecord

	// Pending deliveries past their initial timeout → retryable.
	err := o.db.WithContext(ctx).
		Model(outboxModel()).
		Where("status = ? AND created_at <= ?", DeliveryStatusPending, deliveryoutbox.PendingRetryCutoff(now)).
		Limit(DeliveryOutboxMaxBatch).
		Find(&records).Error
	if err != nil {
		return nil, fmt.Errorf("scan pending deliveries: %w", err)
	}

	// Sent deliveries past their ack timeout → retryable.
	var sentRecords []deliveryOutboxRecord
	err = o.db.WithContext(ctx).
		Model(outboxModel()).
		Where("status = ? AND updated_at <= ?", DeliveryStatusSent, deliveryoutbox.SentRetryCutoff(now)).
		Limit(DeliveryOutboxMaxBatch).
		Find(&sentRecords).Error
	if err != nil {
		return nil, fmt.Errorf("scan sent deliveries: %w", err)
	}

	// Retrying deliveries past their next_retry_at → retryable.
	var retryingRecords []deliveryOutboxRecord
	err = o.db.WithContext(ctx).
		Model(outboxModel()).
		Where("status = ? AND next_retry_at IS NOT NULL AND next_retry_at <= ?", DeliveryStatusRetrying, now).
		Limit(DeliveryOutboxMaxBatch).
		Find(&retryingRecords).Error
	if err != nil {
		return nil, fmt.Errorf("scan retrying deliveries: %w", err)
	}

	combined := make([]deliveryOutboxRecord, 0, len(records)+len(sentRecords)+len(retryingRecords))
	combined = append(combined, records...)
	combined = append(combined, sentRecords...)
	combined = append(combined, retryingRecords...)
	records = combined

	entries := make([]DeliveryOutboxEntry, len(records))
	for i, r := range records {
		entries[i] = r.toEntry()
	}
	return entries, nil
}

// MarkDeliveryRetrying transitions a delivery to retrying status and increments
// the attempt counter. Returns true if the retry should proceed, false if max
// attempts have been exceeded (caller should move to dead-letter) or if this
// worker lost the atomic claim to another concurrent retry worker.
//
// Claim is CAS on (delivery_id, active status, attempt_count): only one of
// multi-worker / overlapping ticks can redispatch the same delivery_id (#1009).
func (o *DeliveryOutbox) MarkDeliveryRetrying(ctx context.Context, deliveryID string, lastError string) (shouldRetry bool, err error) {
	rec, err := o.findOutboxByDeliveryID(ctx, deliveryID)
	if err != nil {
		return false, fmt.Errorf("find delivery for retry: %w", err)
	}
	return o.claimDeliveryRetrying(ctx, deliveryID, rec.TaskID, rec.AttemptCount, rec.MaxAttempts, lastError)
}

// claimDeliveryRetrying performs the atomic outbox claim for a known attempt
// snapshot (from find or from ScanRetryableDeliveries). expectedAttempt is the
// CAS key — concurrent workers that observed the same attempt compete, and only
// RowsAffected==1 may redispatch.
func (o *DeliveryOutbox) claimDeliveryRetrying(ctx context.Context, deliveryID, taskID string, expectedAttempt, maxAttempts int, lastError string) (shouldRetry bool, err error) {
	newAttempt := deliveryoutbox.NextAttempt(expectedAttempt)
	if deliveryoutbox.ShouldDeadLetter(expectedAttempt, maxAttempts) {
		// Move to dead-letter under the same CAS so two workers cannot both
		// observe max-attempts and race the terminal transition.
		rows, updateErr := o.claimOutboxRetry(ctx, deliveryID, expectedAttempt, map[string]interface{}{
			"status":        DeliveryStatusDead,
			"attempt_count": newAttempt,
			"last_error":    deliveryoutbox.TruncateLastError(lastError),
			"next_retry_at": nil,
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

	nextRetry := computeNextRetryAt(newAttempt)
	rows, err := o.claimOutboxRetry(ctx, deliveryID, expectedAttempt, map[string]interface{}{
		"status":        DeliveryStatusRetrying,
		"attempt_count": newAttempt,
		"last_error":    deliveryoutbox.TruncateLastError(lastError),
		"next_retry_at": &nextRetry,
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
func (o *DeliveryOutbox) MoveDeliveryToDeadLetter(ctx context.Context, deliveryID string, lastError string) error {
	_, err := o.updateOutboxByDeliveryID(ctx, deliveryID, deliveryoutbox.ActiveStatuses(), map[string]interface{}{
		"status":     DeliveryStatusDead,
		"last_error": deliveryoutbox.TruncateLastError(lastError),
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
func (o *DeliveryOutbox) GetDeliveryStatus(ctx context.Context, deliveryID string) (string, error) {
	rec, err := o.findOutboxByDeliveryID(ctx, deliveryID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", errcode.ErrBadRequest.WithMessage("delivery not found")
		}
		return "", err
	}
	return rec.Status, nil
}

// CleanupOldDeliveries removes delivered and dead-letter records older than
// the given duration. This should be called periodically to prevent unbounded
// outbox growth.
func (o *DeliveryOutbox) CleanupOldDeliveries(ctx context.Context, olderThan time.Duration) (int64, error) {
	cutoff := time.Now().Add(-olderThan)
	result := o.db.WithContext(ctx).
		Where("status IN ? AND updated_at <= ?", deliveryoutbox.CleanupStatuses(), cutoff).
		Delete(outboxModel())
	if result.Error != nil {
		return 0, fmt.Errorf("cleanup old deliveries: %w", result.Error)
	}
	if result.RowsAffected > 0 {
		slog.Info("cleaned up old delivery outbox records",
			"count", result.RowsAffected,
			"cutoff", cutoff.Format(time.RFC3339),
		)
	}
	return result.RowsAffected, nil
}

// GetDeliveryStats returns aggregate stats for the delivery outbox.
func (o *DeliveryOutbox) GetDeliveryStats(ctx context.Context) (map[string]int64, error) {
	type statusCount struct {
		Status string
		Count  int64
	}
	var rows []statusCount
	err := o.db.WithContext(ctx).
		Model(outboxModel()).
		Select("status, COUNT(*) as count").
		Group("status").
		Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("get delivery stats: %w", err)
	}
	stats := make(map[string]int64, len(rows))
	for _, r := range rows {
		stats[r.Status] = r.Count
	}
	return stats, nil
}

// autoAckDeliveriesForTask marks all pending/sent/retrying delivery outbox
// entries for a task as delivered. Satisfies edgeCallbackOutbox; this is the
// sole package owner of task-scoped outbox auto-ack (edge callback no longer
// mutates deliveryOutboxRecord directly).
func (o *DeliveryOutbox) autoAckDeliveriesForTask(ctx context.Context, taskID string) {
	if o == nil || o.db == nil {
		return
	}
	now := time.Now()
	result := o.db.WithContext(ctx).
		Model(outboxModel()).
		Where("task_id = ? AND status IN ?", taskID, deliveryoutbox.ActiveStatuses()).
		Updates(map[string]interface{}{
			"status":       DeliveryStatusDelivered,
			"delivered_at": &now,
		})
	if result.Error != nil {
		slog.Warn("failed to auto-ack deliveries for task", "task_id", taskID, "error", result.Error)
		return
	}
	if result.RowsAffected > 0 {
		slog.Debug("auto-acked deliveries for task", "task_id", taskID, "count", result.RowsAffected)
	}
}
