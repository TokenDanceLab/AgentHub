// Retry-loop and cleanup-loop orchestration. Both loops run on the Outbox
// journal surface; redispatch goes through the Redispatcher port so this
// package never imports dispatchsvc (pure-package gate).
package deliveryoutbox

import (
	"context"
	"log/slog"
	"time"

	"github.com/agenthub/hub-server/internal/metrics"
)

// StartDeliveryRetryLoop starts a background goroutine that periodically scans
// for retryable deliveries and re-dispatches them.
func (o *Outbox) StartDeliveryRetryLoop(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(RetryScanInterval)
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
func (o *Outbox) retryDeliveries(ctx context.Context) {
	// Refresh the backlog gauge every tick so operators see the live
	// pending/sent/retrying/dead population without a separate scrape.
	o.refreshBacklogGauge(ctx)

	records, err := o.ScanRetryableDeliveries(ctx)
	if err != nil {
		slog.Warn("failed to scan retryable deliveries", "error", err)
		if metrics.DeliveryOutboxScanFailures != nil {
			metrics.DeliveryOutboxScanFailures.Inc()
		}
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
			if metrics.DeliveryOutboxRedispatchFailures != nil {
				metrics.DeliveryOutboxRedispatchFailures.Inc()
			}
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

// refreshBacklogGauge updates the delivery_outbox_backlog GaugeVec with the
// current per-status row counts. Called once per retry tick. Failures are
// logged but never abort the retry scan — the backlog gauge is best-effort
// observability and must not shadow the retry/redispatch control flow.
func (o *Outbox) refreshBacklogGauge(ctx context.Context) {
	if o == nil || o.store == nil || metrics.DeliveryOutboxBacklog == nil {
		return
	}
	rows, err := o.store.CountByStatus(ctx)
	if err != nil {
		slog.Debug("delivery outbox backlog gauge refresh failed", "error", err)
		return
	}
	// Reset all labels to 0 first so a status that vanished (e.g. all rows
	// cleaned up) does not leave a stale non-zero value pinned to the gauge.
	for _, status := range []string{
		StatusPending,
		StatusSent,
		StatusRetrying,
		StatusDelivered,
		StatusDead,
	} {
		metrics.DeliveryOutboxBacklog.WithLabelValues(status).Set(0)
	}
	for status, count := range rows {
		metrics.DeliveryOutboxBacklog.WithLabelValues(status).Set(float64(count))
	}
}

// StartDeliveryCleanupLoop starts a background goroutine that periodically
// purges delivered and dead-letter delivery_outbox rows older than the
// retention window. This bounds the outbox table's growth; without it,
// CleanupOldDeliveries is only ever invoked from tests (#1212 outbox backlog
// unbounded). Runs alongside StartDeliveryRetryLoop; both share the lifecycle
// context so shutdown cancels both.
func (o *Outbox) StartDeliveryCleanupLoop(ctx context.Context) {
	go func() {
		// 24h cadence: cleanup is a maintenance task, not a scan. The retention
		// window (Retention) is applied inside CleanupOldDeliveries.
		ticker := time.NewTicker(CleanupInterval)
		defer ticker.Stop()
		// Run once at startup so a long-downed Hub does not sit on a full
		// outbox for a full interval before the first purge.
		o.runCleanupOnce(ctx)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				o.runCleanupOnce(ctx)
			}
		}
	}()
}

// runCleanupOnce runs a single cleanup pass and records the result. Errors
// are logged and surfaced via the existing scan-failure counter family so
// operators see a stuck cleanup loop in the same place as retry-scan failures.
func (o *Outbox) runCleanupOnce(ctx context.Context) {
	removed, err := o.CleanupOldDeliveries(ctx, Retention)
	if err != nil {
		slog.Warn("delivery outbox cleanup failed", "error", err, "retention", Retention)
		if metrics.DeliveryOutboxScanFailures != nil {
			metrics.DeliveryOutboxScanFailures.Inc()
		}
		return
	}
	if removed > 0 {
		slog.Info("delivery outbox cleanup purged rows",
			"removed", removed,
			"retention", Retention,
		)
	}
}
