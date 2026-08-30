package agent

import (
	"context"
	"fmt"
	"time"

	"github.com/agenthub/hub-server/internal/service"
	"github.com/agenthub/hub-server/internal/service/deliveryoutbox"
	"github.com/agenthub/hub-server/internal/service/dispatchsvc"
)

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
	s *Service
}

func (a lazyDispatchRedispatcher) RedispatchDelivery(ctx context.Context, taskID, deliveryID, payloadJSON, edgeDeviceID string) error {
	if a.s == nil {
		return fmt.Errorf("redispatch: nil agent service")
	}
	return dispatchRedispatcher{a.s.dispatchService()}.RedispatchDelivery(ctx, taskID, deliveryID, payloadJSON, edgeDeviceID)
}

// ── Service facade (wiring/handler stability) ────────────────────────────────
//
// Thin delegating methods that forward the Service API surface to the composed
// deliveryoutbox.Outbox (gorm store + dispatchsvc redispatcher). Status / TTL
// aliases used by callers live in the flat service package; orchestration
// lives in service/deliveryoutbox. Split residual of #801 kept here when the
// agent family moved to service/agent (#1761).

// deliveryOutboxService returns the composed Outbox, lazily constructing
// one from Service deps when tests use struct literals without NewService.
// Lazy path uses lazyDispatchRedispatcher so construction does not recurse into
// dispatchService(); redispatch still lands on DispatchService at call time.
func (s *Service) deliveryOutboxService() *service.DeliveryOutbox {
	if s.deliveryOutbox != nil {
		return s.deliveryOutbox
	}
	return deliveryoutbox.NewOutbox(service.NewDeliveryOutboxStore(s.db), lazyDispatchRedispatcher{s})
}

// RecordDelivery inserts a delivery_outbox entry in status=pending before
// the Hub dispatches a task to the Edge. Returns the generated delivery_id.
func (s *Service) RecordDelivery(ctx context.Context, taskID, payload, edgeDeviceID string) (string, error) {
	return s.deliveryOutboxService().RecordDelivery(ctx, taskID, payload, edgeDeviceID)
}

// MarkDeliverySent transitions an outbox record from pending to sent after
// the Hub has dispatched the task to the Edge.
func (s *Service) MarkDeliverySent(ctx context.Context, deliveryID string) error {
	return s.deliveryOutboxService().MarkDeliverySent(ctx, deliveryID)
}

// AckDelivery marks an outbox record as delivered when the Edge acknowledges
// the dispatch with the matching delivery_id.
func (s *Service) AckDelivery(ctx context.Context, deliveryID string) error {
	return s.deliveryOutboxService().AckDelivery(ctx, deliveryID)
}

// ScanRetryableDeliveries returns deliveries eligible for retry as
// DeliveryOutboxEntry views (no private GORM row type on the facade).
func (s *Service) ScanRetryableDeliveries(ctx context.Context) ([]service.DeliveryOutboxEntry, error) {
	return s.deliveryOutboxService().ScanRetryableDeliveries(ctx)
}

// MarkDeliveryRetrying transitions a delivery to retrying status and increments
// the attempt counter.
func (s *Service) MarkDeliveryRetrying(ctx context.Context, deliveryID string, lastError string) (shouldRetry bool, err error) {
	return s.deliveryOutboxService().MarkDeliveryRetrying(ctx, deliveryID, lastError)
}

// MoveDeliveryToDeadLetter explicitly moves a delivery to dead-letter status.
func (s *Service) MoveDeliveryToDeadLetter(ctx context.Context, deliveryID string, lastError string) error {
	return s.deliveryOutboxService().MoveDeliveryToDeadLetter(ctx, deliveryID, lastError)
}

// GetDeliveryStatus returns the current status of a delivery record.
func (s *Service) GetDeliveryStatus(ctx context.Context, deliveryID string) (string, error) {
	return s.deliveryOutboxService().GetDeliveryStatus(ctx, deliveryID)
}

// StartDeliveryRetryLoop starts a background goroutine that periodically scans
// for retryable deliveries and re-dispatches them.
func (s *Service) StartDeliveryRetryLoop(ctx context.Context) {
	s.deliveryOutboxService().StartDeliveryRetryLoop(ctx)
}

// StartDeliveryCleanupLoop starts a background goroutine that periodically
// purges delivered and dead-letter delivery_outbox rows older than the
// retention window, bounding outbox table growth.
func (s *Service) StartDeliveryCleanupLoop(ctx context.Context) {
	s.deliveryOutboxService().StartDeliveryCleanupLoop(ctx)
}

// CleanupOldDeliveries removes delivered and dead-letter records older than
// the given duration.
func (s *Service) CleanupOldDeliveries(ctx context.Context, olderThan time.Duration) (int64, error) {
	return s.deliveryOutboxService().CleanupOldDeliveries(ctx, olderThan)
}

// GetDeliveryStats returns aggregate stats for the delivery outbox.
func (s *Service) GetDeliveryStats(ctx context.Context) (map[string]int64, error) {
	return s.deliveryOutboxService().GetDeliveryStats(ctx)
}

// StartOrphanRecoveryLoop starts a background goroutine that periodically
// scans for queued tasks with no delivery_outbox row (orphaned by crash or
// semaphore backoff) and redelivers them through DispatchTask.
func (s *Service) StartOrphanRecoveryLoop(ctx context.Context) {
	s.dispatchService().StartOrphanRecoveryLoop(ctx)
}
