// Retry/TTL constants, backoff helpers, retry-loop orchestration, redispatch
// adapters, and the cleanup loop.
package deliveryoutbox

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"math/rand"
	"time"

	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/service/dispatchsvc"
)

// Retry / TTL constants for the delivery outbox scan and backoff paths.
const (
	// DefaultMaxAttempts is the default retry budget before dead-letter.
	DefaultMaxAttempts = 3

	// RetryBaseInterval is the base backoff interval (multiplied by 2^attempt).
	RetryBaseInterval = 2 * time.Second

	// RetryMaxInterval caps the exponential backoff ceiling.
	RetryMaxInterval = 30 * time.Second

	// RetryScanInterval controls how often retryable deliveries are scanned.
	RetryScanInterval = 15 * time.Second

	// PendingTimeout is the time after which a pending (never sent) delivery
	// is eligible for retry.
	PendingTimeout = 30 * time.Second

	// SentTimeout is the time after which a sent (unacked) delivery
	// is eligible for retry.
	SentTimeout = 60 * time.Second

	// MaxBatch caps the number of deliveries scanned per retry cycle.
	MaxBatch = 100

	// RetryJitterFraction is the symmetric jitter applied to each backoff as a
	// fraction of the computed delay (±25%). Spreading retries avoids a
	// thundering herd when many deliveries become eligible simultaneously
	// after a Hub outage recovery.
	RetryJitterFraction = 0.25

	// Retention is how long a delivered or dead-letter outbox row is kept
	// before CleanupOldDeliveries purges it. 7 days balances operator audit
	// window against unbounded table growth.
	Retention = 7 * 24 * time.Hour

	// CleanupInterval is how often the background cleanup loop fires. 24h
	// keeps the purge off the hot path; the retention window (not the
	// cadence) governs how old a row must be to qualify.
	CleanupInterval = 24 * time.Hour
)

// NextRetryDelay calculates the exponential backoff delay for a retry attempt
// with ±25% jitter. Formula: RetryBaseInterval * 2^attempt, capped at
// RetryMaxInterval, then multiplied by (1 + rand(±25%)). Jitter prevents
// thundering-herd retries when many deliveries recover at once. Negative
// attempts use the same math.Pow behavior as the historical helper (→ 0).
func NextRetryDelay(attempt int) time.Duration {
	base := RetryBaseInterval * time.Duration(int64(math.Pow(2, float64(attempt))))
	if base > RetryMaxInterval {
		base = RetryMaxInterval
	}
	return applyRetryJitter(base)
}

// NextRetryAt returns now + NextRetryDelay(attempt). The clock is injectable
// so unit tests can stay deterministic.
func NextRetryAt(attempt int, now time.Time) time.Time {
	return now.Add(NextRetryDelay(attempt))
}

// applyRetryJitter applies a symmetric ±RetryJitterFraction jitter to delay.
// A zero/negative delay stays zero (no negative backoff).
func applyRetryJitter(delay time.Duration) time.Duration {
	if delay <= 0 {
		return delay
	}
	jitter := int64(float64(delay) * RetryJitterFraction)
	if jitter <= 0 {
		return delay
	}
	// rand.Int63n(2*jitter+1) ∈ [0, 2*jitter]; shift to [-jitter, +jitter].
	// #nosec G404 -- backoff jitter only; randomness is not security-sensitive.
	delta := rand.Int63n(2*jitter+1) - jitter
	return delay + time.Duration(delta)
}

// ── Retry loop orchestration ───────────────────────────────────────────────

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
	// pending/sent/retrying/dead population without a separate scrape. The
	// refresh uses the same GROUP BY query shape as GetDeliveryStats so the
	// cost is one indexed aggregation per scan interval, not a full table.
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

// ── Redispatcher adapter (implementation on DispatchService) ────────────────

// dispatchRedispatcher adapts *dispatchsvc.DispatchService to the Redispatcher
// port without exporting dispatch payload types or the outbox row to Outbox.
// Redispatch residual ownership moved in #573; the dispatch implementation
// moved to service/dispatchsvc.
type dispatchRedispatcher struct {
	d *dispatchsvc.DispatchService
}

func (a dispatchRedispatcher) RedispatchDelivery(ctx context.Context, taskID, deliveryID, payloadJSON, edgeDeviceID string) error {
	if a.d == nil {
		return fmt.Errorf("redispatch: nil dispatch service")
	}
	// Propagate soft-fail errors so retryDeliveries does not MarkDeliverySent
	// after a failed offline-queue / route attempt (#999). Dead-letter paths
	// return nil (already terminal; MarkDeliverySent is a no-op).
	return a.d.RedispatchDelivery(ctx, taskID, deliveryID, payloadJSON, edgeDeviceID)
}

// SetDispatchRedispatcher injects the DispatchService redispatch adapter so
// the service package can wire redispatch without naming Redispatcher types.
func (o *Outbox) SetDispatchRedispatcher(dispatchService *dispatchsvc.DispatchService) {
	if o == nil {
		return
	}
	o.redispatcher = dispatchRedispatcher{d: dispatchService}
}

// refreshBacklogGauge updates the delivery_outbox_backlog GaugeVec with the
// current per-status row counts. Called once per retry tick. Failures are
// logged but never abort the retry scan — the backlog gauge is best-effort
// observability and must not shadow the retry/redispatch control flow.
func (o *Outbox) refreshBacklogGauge(ctx context.Context) {
	if o == nil || o.db == nil || metrics.DeliveryOutboxBacklog == nil {
		return
	}
	type statusCount struct {
		Status string
		Count  int64
	}
	var rows []statusCount
	if err := o.db.WithContext(ctx).
		Model(outboxModel()).
		Select("status, COUNT(*) as count").
		Group("status").
		Scan(&rows).Error; err != nil {
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
	for _, r := range rows {
		metrics.DeliveryOutboxBacklog.WithLabelValues(r.Status).Set(float64(r.Count))
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
