package app

import (
	"context"
	"log/slog"
	"time"

	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/hub-server/internal/service"
)

// Shutdown gracefully stops all servers and background goroutines with
// the following order: HTTP → Admin → WS → EventBus → cancel background → DB → Redis.
func (a *App) Shutdown(ctx context.Context) error {
	// 1. Stop accepting new HTTP requests.
	if a.HTTPServer != nil {
		if err := a.HTTPServer.Shutdown(ctx); err != nil {
			slog.Error("http server shutdown failed", "error", err)
		}
	}
	// 2. Stop admin server (pprof/metrics).
	if a.AdminServer != nil {
		if err := a.AdminServer.Shutdown(ctx); err != nil {
			slog.Error("admin server shutdown failed", "error", err)
		}
	}

	// 3. Close all WebSocket connections.
	if a.mgr != nil {
		a.mgr.Shutdown()
	}

	// 4. Close event bus (stop publishing events).
	if a.bus != nil {
		a.bus.Close()
	}

	// 5. Cancel background goroutines (scheduler, heartbeat, metrics collector).
	if a.coreCancel != nil {
		a.coreCancel()
	}

	// 5b. Shutdown audit service (drains retry queue, closes file sink).
	if a.AuditService != nil {
		a.AuditService.Shutdown()
	}

	// 6. Close database connection pool.
	if a.DB != nil {
		if sqlDB, err := a.DB.DB(); err == nil {
			if closeErr := sqlDB.Close(); closeErr != nil {
				slog.Error("db close failed", "error", closeErr)
			}
		}
	}

	// 7. Close Redis connection pool.
	if a.CacheClient != nil {
		if err := a.CacheClient.Close(); err != nil {
			slog.Error("redis close failed", "error", err)
		}
	}

	slog.Info("shutdown complete")
	return nil
}

// startTaskScheduler periodically scans for expired agent tasks and publishes timeout events.
func (a *App) startTaskScheduler(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(config.PendingTaskScanInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				tasks, err := a.AgentService.ScanExpiredTasks()
				if err != nil {
					slog.Warn("failed to scan expired agent tasks", "error", err)
					continue
				}
				for _, task := range tasks {
					a.publishExpiredTaskTimeout(ctx, task)
				}
			case <-ctx.Done():
				return
			}
		}
	}()
}

func (a *App) publishExpiredTaskTimeout(ctx context.Context, task model.PendingAgentTask) {
	timedOut, err := a.AgentService.TimeoutExpiredTask(task.ID, task.Status)
	if err != nil {
		slog.Warn("failed to mark expired agent task timeout", "task_id", task.ID, "status", task.Status, "error", err)
		return
	}
	if !timedOut {
		slog.Info("skip stale expired agent task timeout", "task_id", task.ID, "scanned_status", task.Status)
		return
	}

	ai, _ := a.AgentService.GetAgentInstanceByID(task.AgentInstanceID)
	sessionID := ""
	if ai != nil {
		sessionID = ai.SessionID
	}
	a.bus.Publish(ctx, service.Event{
		Type: "agent.timeout",
		Payload: map[string]interface{}{
			"task_id":           task.ID,
			"agent_instance_id": task.AgentInstanceID,
			"session_id":        sessionID,
		},
	})
}

// startWebSocketCleanup starts heartbeat-based stale connection cleanup.
func (a *App) startWebSocketCleanup(ctx context.Context) {
	a.mgr.StartHeartbeat()
}

// syncLegacySeqs copies existing session next_seq values from DB into Redis.
func (a *App) syncLegacySeqs() {
	ctx := a.coreCtx
	var sessions []model.Session
	if err := a.DB.Select("id, next_seq").Where("next_seq > 0").Order("created_at ASC").Limit(5000).Find(&sessions).Error; err != nil {
		slog.Warn("failed to query sessions for seq sync", "error", err)
		return
	}
	if len(sessions) == 5000 {
		slog.Warn("syncLegacySeqs: processed batch of 5000, more sessions may remain; run migration again if needed")
	}
	count := 0
	for _, sess := range sessions {
		if err := a.CacheClient.InitSeqIfAbsent(ctx, sess.ID, sess.NextSeq); err != nil {
			slog.Warn("failed to init seq in redis", "session_id", sess.ID, "error", err)
		} else {
			count++
		}
	}
	slog.Info("legacy session seq sync completed", "total", len(sessions), "synced", count)
}
