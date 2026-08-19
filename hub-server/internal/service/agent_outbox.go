// Outbox port + AgentService facade (wiring/handler stability).
//
// The outbox orchestration moved to internal/service/deliveryoutbox (#801 →
// moved). The flat service package must NOT import that package: the moved
// outbox tests import service for cross-domain auto-ack coverage, so a
// service→deliveryoutbox import would cycle. AgentService therefore consumes
// the outbox through this locally-defined port; the composition root
// (internal/app) constructs the concrete *deliveryoutbox.Outbox and injects it.
package service

import (
	"context"
	"log/slog"

	"github.com/agenthub/hub-server/internal/errcode"
	"github.com/agenthub/hub-server/internal/service/dispatchsvc"
)

// deliveryOutboxPort is the subset of *deliveryoutbox.Outbox consumed by the
// flat service package: the dispatch journal port (dispatchsvc), the edge
// callback auto-ack port, the status queries used by the app layer, the
// background loops, and the redispatch wiring.
type deliveryOutboxPort interface {
	RecordDelivery(ctx context.Context, taskID, payload, edgeDeviceID string) (string, error)
	MarkDeliverySent(ctx context.Context, deliveryID string) error
	MoveDeliveryToDeadLetter(ctx context.Context, deliveryID string, lastError string) error
	GetDeliveryStatus(ctx context.Context, deliveryID string) (string, error)
	AutoAckDeliveriesForTask(ctx context.Context, taskID string)
	StartDeliveryRetryLoop(ctx context.Context)
	StartDeliveryCleanupLoop(ctx context.Context)
	SetDispatchRedispatcher(redispatcher *dispatchsvc.DispatchService)
}

// GetDeliveryStatus returns the current status of a delivery record.
// Nil-safe: an unconfigured outbox (tests wiring AgentService without one)
// reports the delivery as unknown rather than panicking.
func (s *AgentService) GetDeliveryStatus(ctx context.Context, deliveryID string) (string, error) {
	if s == nil || s.deliveryOutbox == nil {
		slog.Debug("delivery status query skipped: no outbox configured", "delivery_id", deliveryID)
		return "", errcode.ErrInternal.WithMessage("delivery outbox not configured")
	}
	return s.deliveryOutbox.GetDeliveryStatus(ctx, deliveryID)
}

// MarkDeliverySent transitions an outbox record from pending to sent after
// the Hub has dispatched the task to the Edge. Nil-safe no-op without an
// outbox (degraded dispatch path).
func (s *AgentService) MarkDeliverySent(ctx context.Context, deliveryID string) error {
	if s == nil || s.deliveryOutbox == nil {
		slog.Debug("delivery sent mark skipped: no outbox configured", "delivery_id", deliveryID)
		return nil
	}
	return s.deliveryOutbox.MarkDeliverySent(ctx, deliveryID)
}

// StartDeliveryRetryLoop starts a background goroutine that periodically scans
// for retryable deliveries and re-dispatches them. Nil-safe no-op without an
// outbox.
func (s *AgentService) StartDeliveryRetryLoop(ctx context.Context) {
	if s == nil || s.deliveryOutbox == nil {
		return
	}
	s.deliveryOutbox.StartDeliveryRetryLoop(ctx)
}

// StartDeliveryCleanupLoop starts a background goroutine that periodically
// purges delivered and dead-letter delivery_outbox rows older than the
// retention window, bounding outbox table growth. Nil-safe no-op without an
// outbox.
func (s *AgentService) StartDeliveryCleanupLoop(ctx context.Context) {
	if s == nil || s.deliveryOutbox == nil {
		return
	}
	s.deliveryOutbox.StartDeliveryCleanupLoop(ctx)
}
