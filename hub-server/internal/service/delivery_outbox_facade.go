package service

import (
	"context"
	"fmt"
	"time"

	"github.com/agenthub/hub-server/internal/service/deliveryoutbox"
	"github.com/agenthub/hub-server/internal/service/dispatchsvc"
)

// ── Outbox status constants (aliases to pure deliveryoutbox package) ────────
//
// Residual pure-helper extract (#744) after pure backoff/truncate (#514), thin
// type + Redispatcher (#540), and model ownership residual (#551). Status /
// eligibility / last-error helpers live in service/deliveryoutbox; thin aliases
// keep existing call sites stable. File split residual (#801): aliases +
// AgentService facades live here; orchestration in delivery_outbox.go; model in
// delivery_outbox_model.go. Full model package move remains deferred.

const (
	DeliveryStatusPending   = deliveryoutbox.StatusPending
	DeliveryStatusSent      = deliveryoutbox.StatusSent
	DeliveryStatusDelivered = deliveryoutbox.StatusDelivered
	DeliveryStatusRetrying  = deliveryoutbox.StatusRetrying
	DeliveryStatusDead      = deliveryoutbox.StatusDead
)

// ── Delivery outbox TTL constants (aliases to pure deliveryoutbox package) ──

const (
	// DefaultMaxDeliveryAttempts is the default retry budget before dead-letter.
	DefaultMaxDeliveryAttempts = deliveryoutbox.DefaultMaxAttempts

	// DeliveryRetryBaseInterval is the base backoff interval (multiplied by 2^attempt).
	DeliveryRetryBaseInterval = deliveryoutbox.RetryBaseInterval

	// DeliveryRetryMaxInterval caps the exponential backoff ceiling.
	DeliveryRetryMaxInterval = deliveryoutbox.RetryMaxInterval

	// DeliveryRetryScanInterval controls how often retryable deliveries are scanned.
	DeliveryRetryScanInterval = deliveryoutbox.RetryScanInterval

	// DeliveryPendingTimeout is the time after which a pending (never sent) delivery
	// is eligible for retry.
	DeliveryPendingTimeout = deliveryoutbox.PendingTimeout

	// DeliverySentTimeout is the time after which a sent (unacked) delivery
	// is eligible for retry.
	DeliverySentTimeout = deliveryoutbox.SentTimeout

	// DeliveryOutboxMaxBatch caps the number of deliveries scanned per retry cycle.
	DeliveryOutboxMaxBatch = deliveryoutbox.MaxBatch

	// DeliveryOutboxRetention is how long a delivered or dead-letter outbox
	// row is kept before CleanupOldDeliveries purges it. 7 days balances
	// operator audit window against unbounded table growth.
	DeliveryOutboxRetention = deliveryoutbox.Retention

	// DeliveryOutboxCleanupInterval is how often the background cleanup loop
	// fires. 24h keeps the purge off the hot path; the retention window
	// (not the cadence) governs how old a row must be to qualify.
	DeliveryOutboxCleanupInterval = deliveryoutbox.CleanupInterval
)

// computeNextRetryAt calculates the next retry time using exponential backoff.
// Thin wrapper around pure deliveryoutbox helpers (clock fixed at call time).
func computeNextRetryAt(attempt int) time.Time {
	return deliveryoutbox.NextRetryAt(attempt, time.Now())
}

// truncateString is a thin alias kept for same-package tests.
func truncateString(s string, maxLen int) string {
	return deliveryoutbox.TruncateString(s, maxLen)
}

// ── Redispatcher adapters (implementation on DispatchService) ────────────────

// dispatchRedispatcher adapts *dispatchsvc.DispatchService to the
// deliveryoutbox.Redispatcher port without exporting dispatch payload types
// or the outbox row to the outbox. Redispatch residual ownership moved in
// #573; the dispatch implementation moved to service/dispatchsvc.
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

// ── Outbox type aliases (thin views over the pure deliveryoutbox package) ──

// DeliveryOutbox aliases the pure orchestration type; construction now goes
// through deliveryoutbox.NewOutbox with the gorm-backed DeliveryOutboxStore
// (delivery_outbox_store.go).
type DeliveryOutbox = deliveryoutbox.Outbox

// DeliveryOutboxEntry aliases the pure read view (no GORM tags).
type DeliveryOutboxEntry = deliveryoutbox.Entry

// ── AgentService facade (wiring/handler stability) ───────────────────────────

// deliveryOutboxService returns the composed Outbox, lazily constructing
// one from AgentService deps when tests use struct literals without NewAgentService.
// Lazy path uses lazyDispatchRedispatcher so construction does not recurse into
// dispatchService(); redispatch still lands on DispatchService at call time.
func (s *AgentService) deliveryOutboxService() *DeliveryOutbox {
	if s.deliveryOutbox != nil {
		return s.deliveryOutbox
	}
	return deliveryoutbox.NewOutbox(NewDeliveryOutboxStore(s.db), lazyDispatchRedispatcher{s})
}

// RecordDelivery inserts a delivery_outbox entry in status=pending before
// the Hub dispatches a task to the Edge. Returns the generated delivery_id.
func (s *AgentService) RecordDelivery(ctx context.Context, taskID, payload, edgeDeviceID string) (string, error) {
	return s.deliveryOutboxService().RecordDelivery(ctx, taskID, payload, edgeDeviceID)
}

// MarkDeliverySent transitions an outbox record from pending to sent after
// the Hub has dispatched the task to the Edge.
func (s *AgentService) MarkDeliverySent(ctx context.Context, deliveryID string) error {
	return s.deliveryOutboxService().MarkDeliverySent(ctx, deliveryID)
}

// AckDelivery marks an outbox record as delivered when the Edge acknowledges
// the dispatch with the matching delivery_id.
func (s *AgentService) AckDelivery(ctx context.Context, deliveryID string) error {
	return s.deliveryOutboxService().AckDelivery(ctx, deliveryID)
}

// ScanRetryableDeliveries returns deliveries eligible for retry as
// DeliveryOutboxEntry views (no private GORM row type on the facade).
func (s *AgentService) ScanRetryableDeliveries(ctx context.Context) ([]DeliveryOutboxEntry, error) {
	return s.deliveryOutboxService().ScanRetryableDeliveries(ctx)
}

// MarkDeliveryRetrying transitions a delivery to retrying status and increments
// the attempt counter.
func (s *AgentService) MarkDeliveryRetrying(ctx context.Context, deliveryID string, lastError string) (shouldRetry bool, err error) {
	return s.deliveryOutboxService().MarkDeliveryRetrying(ctx, deliveryID, lastError)
}

// MoveDeliveryToDeadLetter explicitly moves a delivery to dead-letter status.
func (s *AgentService) MoveDeliveryToDeadLetter(ctx context.Context, deliveryID string, lastError string) error {
	return s.deliveryOutboxService().MoveDeliveryToDeadLetter(ctx, deliveryID, lastError)
}

// GetDeliveryStatus returns the current status of a delivery record.
func (s *AgentService) GetDeliveryStatus(ctx context.Context, deliveryID string) (string, error) {
	return s.deliveryOutboxService().GetDeliveryStatus(ctx, deliveryID)
}

// StartDeliveryRetryLoop starts a background goroutine that periodically scans
// for retryable deliveries and re-dispatches them.
func (s *AgentService) StartDeliveryRetryLoop(ctx context.Context) {
	s.deliveryOutboxService().StartDeliveryRetryLoop(ctx)
}

// StartDeliveryCleanupLoop starts a background goroutine that periodically
// purges delivered and dead-letter delivery_outbox rows older than the
// retention window, bounding outbox table growth.
func (s *AgentService) StartDeliveryCleanupLoop(ctx context.Context) {
	s.deliveryOutboxService().StartDeliveryCleanupLoop(ctx)
}

// CleanupOldDeliveries removes delivered and dead-letter records older than
// the given duration.
func (s *AgentService) CleanupOldDeliveries(ctx context.Context, olderThan time.Duration) (int64, error) {
	return s.deliveryOutboxService().CleanupOldDeliveries(ctx, olderThan)
}

// GetDeliveryStats returns aggregate stats for the delivery outbox.
func (s *AgentService) GetDeliveryStats(ctx context.Context) (map[string]int64, error) {
	return s.deliveryOutboxService().GetDeliveryStats(ctx)
}
