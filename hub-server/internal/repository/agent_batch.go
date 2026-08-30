package repository

import (
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/model"
)

// BatchCancelTasksByAgentInstance cancels pending tasks for multiple agent
// instances in a single UPDATE. Empty slice is a no-op. Mirrors the per-agent
// CancelTasksByAgentInstance semantics (status IN queued/dispatched/running →
// cancelled + finished_at set).
func BatchCancelTasksByAgentInstance(db *gorm.DB, agentInstanceIDs []string) error {
	if len(agentInstanceIDs) == 0 {
		return nil
	}
	now := time.Now()
	return db.Model(&model.PendingAgentTask{}).
		Where("agent_instance_id IN ? AND status IN ?", agentInstanceIDs,
			[]string{model.TaskStatusQueued, model.TaskStatusDispatched, model.TaskStatusRunning}).
		Updates(map[string]interface{}{"status": model.TaskStatusCancelled, "finished_at": &now}).Error
}

// BatchDeleteAgentInstances deletes multiple agent instances by ID in a single
// DELETE. Empty slice is a no-op. Mirrors per-agent DeleteAgentInstance.
func BatchDeleteAgentInstances(db *gorm.DB, agentIDs []string) error {
	if len(agentIDs) == 0 {
		return nil
	}
	return db.Where("id IN ?", agentIDs).Delete(&model.AgentInstance{}).Error
}
