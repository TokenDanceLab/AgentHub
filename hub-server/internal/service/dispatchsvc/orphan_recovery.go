package dispatchsvc

import (
	"context"
	"log/slog"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/metrics"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/hub-server/internal/service/dispatch"
	"github.com/agenthub/pkg/safego"
)

// StartOrphanRecoveryLoop starts a background sweeper that reclaims queued
// tasks with no delivery_outbox row (orphaned by process crash or semaphore
// backoff). Claimed tasks are redelivered through the existing DispatchTask
// path. The sweeper exits when ctx is cancelled.
//
// The sweeper runs in its own goroutine and this method returns immediately:
// it is wired into startServer on the main goroutine, so a blocking loop here
// prevents the HTTP server from ever starting (observed after #2074's
// regression shipped — hub stuck before "server starting").
func (s *DispatchService) StartOrphanRecoveryLoop(ctx context.Context) {
	go func() {
		defer safego.Recover("dispatch.orphan_recovery_loop")
		ticker := time.NewTicker(config.OrphanTaskScanInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.recoverOrphanedTasks(ctx)
			}
		}
	}()
}

// recoverOrphanedTasks performs one sweep cycle: claim orphans, rebuild
// context, and redeliver through DispatchTask (which respects dispatchSem).
func (s *DispatchService) recoverOrphanedTasks(ctx context.Context) {
	grace := time.Now().Add(-config.OrphanTaskGracePeriod)
	ids, err := repository.ClaimOrphanedTasks(s.db, grace, 10)
	if err != nil {
		slog.Error("orphan_recovery: claim failed", "error", err)
		return
	}
	if len(ids) == 0 {
		return
	}
	slog.Info("orphan_recovery: claimed tasks", "count", len(ids))
	if metrics.DispatchOrphanDiscovered != nil {
		metrics.DispatchOrphanDiscovered.Add(float64(len(ids)))
	}
	for _, id := range ids {
		s.redeliverOrphanedTask(ctx, id)
	}
}

// redeliverOrphanedTask rebuilds the dispatch context for a claimed orphan and
// feeds it back through DispatchTask. If the context rebuild fails the claim
// is rolled back (dispatched → queued) so the next sweep can re-claim the
// task; without the rollback the task would sit in dispatched with no outbox
// row until the TTL scanner expires it, silently dropping the work. Errors are
// logged but do not halt the sweep.
func (s *DispatchService) redeliverOrphanedTask(ctx context.Context, taskID string) {
	task, err := repository.GetPendingTaskByID(s.db, taskID)
	if err != nil {
		slog.Error("orphan_recovery: load task failed", "task_id", taskID, "error", err)
		s.rollbackOrphanClaim(taskID)
		return
	}

	// Rebuild prompt from trigger message.
	msg, err := repository.GetMessageByID(s.db, task.TriggerMessageID)
	if err != nil {
		slog.Error("orphan_recovery: load trigger message failed", "task_id", taskID, "error", err)
		s.rollbackOrphanClaim(taskID)
		return
	}
	prompt := dispatch.PromptFromMessage(msg)

	// Load agent instance.
	ai, err := repository.GetAgentInstanceByID(s.db, task.AgentInstanceID)
	if err != nil {
		slog.Error("orphan_recovery: load agent instance failed", "task_id", taskID, "error", err)
		s.rollbackOrphanClaim(taskID)
		return
	}

	// Preload CustomAgent if needed (same logic as TriggerAgentTask).
	var customAgent *model.CustomAgent
	if dispatch.NeedsCustomAgentPreload(ai.CustomAgentID) {
		ca, caErr := repository.GetCustomAgentByID(s.db, dispatch.CustomAgentIDValue(ai.CustomAgentID))
		customAgent = dispatch.CustomAgentPreloadOrNil(caErr, ca)
	}

	// Re-derive targetType from target_id via the same validation path.
	targetType := ""
	if task.TargetID != "" {
		dispatchTarget, valErr := s.validateDispatchTarget(ctx, task.TriggeredByUserID, task.TargetID)
		if valErr != nil {
			slog.Warn("orphan_recovery: target validation failed, dispatching without target",
				"task_id", taskID, "target_id", task.TargetID, "error", valErr)
		} else {
			_, targetType, _ = dispatch.ApplyValidatedTarget(dispatchTarget)
		}
	}

	slog.Info("orphan_recovery: redelivering",
		"task_id", taskID,
		"agent_instance_id", ai.ID,
		"model_params_len", len(task.ModelParams),
	)

	s.DispatchTask(ctx, task, ai, prompt, task.ModelParams, targetType, customAgent)
	if metrics.DispatchOrphanRedelivered != nil {
		metrics.DispatchOrphanRedelivered.Inc()
	}
}

// rollbackOrphanClaim returns a claimed orphan task from dispatched back to
// queued so a later sweep can re-claim it. The repository-layer CAS guard only
// touches tasks still in the claimed state; failures are logged, never fatal.
func (s *DispatchService) rollbackOrphanClaim(taskID string) {
	rolledBack, err := repository.RequeueClaimedOrphanTask(s.db, taskID)
	if err != nil {
		slog.Error("orphan_recovery: claim rollback failed", "task_id", taskID, "error", err)
		return
	}
	if !rolledBack {
		return
	}
	slog.Warn("orphan_recovery: claim rolled back to queued", "task_id", taskID)
	if metrics.DispatchOrphanClaimRolledBack != nil {
		metrics.DispatchOrphanClaimRolledBack.Inc()
	}
}
