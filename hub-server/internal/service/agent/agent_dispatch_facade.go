package agent

import (
	"context"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/dispatch"
	"github.com/agenthub/hub-server/internal/service/dispatchsvc"
)

// ── Service facade (wiring/handler stability) ───────────────────────────
//
// Thin delegating methods that forward Service API surface to the composed
// DispatchService. Kept in a separate file to match delivery_outbox_facade.go
// pattern (#801). Orchestration stays in agent_dispatch.go.

// dispatchService returns the composed DispatchService, lazily constructing one
// from Service deps when tests use struct literals without NewService.
func (s *Service) dispatchService() *dispatchsvc.DispatchService {
	if dispatch.ComposedDispatchReady(s.dispatch != nil) {
		return s.dispatch
	}
	return dispatchsvc.NewDispatchService(s.db, s.bus, wsManagerAdapter{manager: s.mgr}, s.cacheClient, relayServiceAdapter{relay: s.relay}, s.deliveryOutboxService(), s.edgeCfg, s.edgeClient, s.jwtSecret)
}

// TriggerAgentTask creates a pending task for an agent and dispatches it to the inviter's edge.
func (s *Service) TriggerAgentTask(ctx context.Context, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID string) (*model.PendingAgentTask, error) {
	return s.dispatchService().TriggerAgentTask(ctx, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID)
}

// CancelTask cancels a pending task by its ID.
func (s *Service) CancelTask(ctx context.Context, userID, taskID string) error {
	return s.dispatchService().CancelTask(ctx, userID, taskID)
}

// RegenerateAgentTask creates a new task using the same prompt as an existing task.
func (s *Service) RegenerateAgentTask(ctx context.Context, userID, taskID string) (*model.PendingAgentTask, error) {
	return s.dispatchService().RegenerateAgentTask(ctx, userID, taskID)
}
