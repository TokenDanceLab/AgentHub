package service

import (
	"context"

	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service/dispatch"
)

// ── AgentService facade (wiring/handler stability) ───────────────────────────
//
// Thin delegating methods that forward AgentService API surface to the composed
// DispatchService. Kept in a separate file to match delivery_outbox_facade.go
// pattern (#801). Orchestration stays in agent_dispatch.go.

// dispatchService returns the composed DispatchService, lazily constructing one
// from AgentService deps when tests use struct literals without NewAgentService.
func (s *AgentService) dispatchService() *DispatchService {
	if dispatch.ComposedDispatchReady(s.dispatch != nil) {
		return s.dispatch
	}
	return NewDispatchService(s.db, s.bus, s.mgr, s.cacheClient, s.relay, s.deliveryOutboxService(), s.edgeCfg, s.jwtSecret)
}

// TriggerAgentTask creates a pending task for an agent and dispatches it to the inviter's edge.
func (s *AgentService) TriggerAgentTask(ctx context.Context, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID string) (*model.PendingAgentTask, error) {
	return s.dispatchService().TriggerAgentTask(ctx, userID, triggerMessageID, targetAgentInstanceID, targetAgentType, targetCustomAgentID, modelParams, targetID)
}

// CancelTask cancels a pending task by its ID.
func (s *AgentService) CancelTask(ctx context.Context, userID, taskID string) error {
	return s.dispatchService().CancelTask(ctx, userID, taskID)
}

// RegenerateAgentTask creates a new task using the same prompt as an existing task.
func (s *AgentService) RegenerateAgentTask(ctx context.Context, userID, taskID string) (*model.PendingAgentTask, error) {
	return s.dispatchService().RegenerateAgentTask(ctx, userID, taskID)
}
