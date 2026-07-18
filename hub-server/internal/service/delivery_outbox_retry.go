package service

import (
	"context"
	"fmt"
	"log/slog"
	"time"
)

// ── Retry loop orchestration ───────────────────────────────────────────────

// StartDeliveryRetryLoop starts a background goroutine that periodically scans
// for retryable deliveries and re-dispatches them.
func (o *DeliveryOutbox) StartDeliveryRetryLoop(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(DeliveryRetryScanInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				o.retryDeliveries(ctx)
			}
		}
	}()
}

// retryDeliveries scans for retryable deliveries and re-dispatches them via
// the injected Redispatcher (opaque payload bytes — no dispatchPayload here).
func (o *DeliveryOutbox) retryDeliveries(ctx context.Context) {
	records, err := o.ScanRetryableDeliveries(ctx)
	if err != nil {
		slog.Warn("failed to scan retryable deliveries", "error", err)
		return
	}

	for _, rec := range records {
		// Claim with the scan-time attempt_count so multi-worker ticks that
		// observed the same snapshot compete on one CAS key (#1009).
		shouldRetry, err := o.claimDeliveryRetrying(ctx, rec.DeliveryID, rec.TaskID, rec.AttemptCount, rec.MaxAttempts, rec.LastError)
		if err != nil {
			slog.Warn("failed to mark delivery retrying", "delivery_id", rec.DeliveryID, "error", err)
			continue
		}
		if !shouldRetry {
			// Lost claim, moved to dead-letter, or already claimed by a peer.
			continue
		}

		if o.redispatcher == nil {
			slog.Debug("delivery retry skipped: no redispatcher",
				"delivery_id", rec.DeliveryID,
				"task_id", rec.TaskID,
			)
			continue
		}

		if err := o.redispatcher.RedispatchDelivery(ctx, rec.TaskID, rec.DeliveryID, rec.Payload, rec.EdgeDeviceID); err != nil {
			// Failure: leave status=retrying with next_retry_at for backoff.
			slog.Warn("redispatch failed",
				"delivery_id", rec.DeliveryID,
				"task_id", rec.TaskID,
				"error", err,
			)
			continue
		}
		// Success: retrying→sent so the ack-timeout window (not retry
		// cadence) governs re-scan and prevents duplicate Edge runs.
		if err := o.MarkDeliverySent(ctx, rec.DeliveryID); err != nil {
			slog.Warn("failed to mark redispatched delivery sent",
				"delivery_id", rec.DeliveryID,
				"task_id", rec.TaskID,
				"error", err,
			)
		}
	}
}

// ── Redispatcher adapter (implementation on DispatchService) ────────────────

// dispatchRedispatcher adapts *DispatchService to the Redispatcher port without
// exporting dispatchPayload or deliveryOutboxRecord to DeliveryOutbox.
// Redispatch residual ownership moved in #573.
type dispatchRedispatcher struct {
	d *DispatchService
}

func (a dispatchRedispatcher) RedispatchDelivery(ctx context.Context, taskID, deliveryID, payloadJSON, edgeDeviceID string) error {
	if a.d == nil {
		return fmt.Errorf("redispatch: nil dispatch service")
	}
	// Propagate soft-fail errors so retryDeliveries does not MarkDeliverySent
	// after a failed offline-queue / route attempt (#999). Dead-letter paths
	// return nil (already terminal; MarkDeliverySent is a no-op).
	return a.d.redispatchDelivery(ctx, redispatchTarget{
		TaskID:       taskID,
		DeliveryID:   deliveryID,
		Payload:      payloadJSON,
		EdgeDeviceID: edgeDeviceID,
	})
}

// lazyDispatchRedispatcher resolves DispatchService only when a retry fires.
// Used by deliveryOutboxService() lazy construction so it does not call
// dispatchService() during outbox construction (avoids init recursion with
// dispatchService → deliveryOutboxService).
type lazyDispatchRedispatcher struct {
	s *AgentService
}

func (a lazyDispatchRedispatcher) RedispatchDelivery(ctx context.Context, taskID, deliveryID, payloadJSON, edgeDeviceID string) error {
	if a.s == nil {
		return fmt.Errorf("redispatch: nil agent service")
	}
	return dispatchRedispatcher{a.s.dispatchService()}.RedispatchDelivery(ctx, taskID, deliveryID, payloadJSON, edgeDeviceID)
}
