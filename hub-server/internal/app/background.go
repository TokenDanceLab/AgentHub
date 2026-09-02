package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/redis/go-redis/v9"

	"github.com/agenthub/hub-server/internal/bus"
	"github.com/agenthub/hub-server/internal/config"
	"github.com/agenthub/hub-server/internal/middleware"
	"github.com/agenthub/hub-server/internal/model"
	"github.com/agenthub/pkg/safego"
)

// BackgroundGroup supervises long-lived goroutines (#1542). Every background
// task derives from the same root context, registers at start, and is
// awaited at shutdown with a bounded deadline. A task error propagates to
// Wait (and cancels the group context), so a fatal background failure is no
// longer only a log line.
type BackgroundGroup struct {
	ctx    context.Context
	cancel context.CancelFunc
	eg     *errgroup.Group
}

// newBackgroundGroup creates a group whose context derives from parent.
func newBackgroundGroup(parent context.Context) *BackgroundGroup {
	ctx, cancel := context.WithCancel(parent)
	eg, _ := errgroup.WithContext(ctx)
	return &BackgroundGroup{ctx: ctx, cancel: cancel, eg: eg}
}

// Ctx is the root context for background tasks; it is cancelled by Cancel.
func (g *BackgroundGroup) Ctx() context.Context { return g.ctx }

// Go registers a background task. fn must return when g.Ctx() is done.
func (g *BackgroundGroup) Go(fn func() error) { g.eg.Go(fn) }

// Cancel stops the group root context; all registered tasks must exit.
func (g *BackgroundGroup) Cancel() { g.cancel() }

// Wait blocks until every registered task has returned, or ctx expires.
// Returns the first task error, or ctx.Err on deadline.
func (g *BackgroundGroup) Wait(ctx context.Context) error {
	done := make(chan error, 1)
	safego.SafeGo("background.wait_observer", func() { done <- g.eg.Wait() })
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		return fmt.Errorf("background group wait: %w", ctx.Err())
	}
}

// Shutdown gracefully stops all servers and background goroutines with the
// following order (#1542): HTTP → Admin → cancel background root → wait
// background (bounded) → event bus (producers already stopped) → audit
// drain → WS connections → DB → Redis. Idempotent: subsequent calls no-op.
func (a *App) Shutdown(ctx context.Context) error {
	a.shutdownOnce.Do(func() {
		a.shutdownErr = a.shutdown(ctx)
	})
	return a.shutdownErr
}

func (a *App) shutdown(ctx context.Context) error {
	var errs []error
	record := func(stage string, err error) {
		if err != nil {
			slog.Error("shutdown stage failed", "stage", stage, "error", err)
			errs = append(errs, fmt.Errorf("%s: %w", stage, err))
		}
	}

	// 1. Stop accepting new HTTP requests.
	if a.HTTPServer != nil {
		record("http", a.HTTPServer.Shutdown(ctx))
	}

	// 2. Stop admin server (pprof/metrics).
	if a.AdminServer != nil {
		record("admin", a.shutdownAdminServer(ctx))
	}

	// 3. Cancel background root: scheduler, heartbeat, metrics collector,
	// delivery outbox retry, legacy seq sync all observe this context.
	if a.bg != nil {
		a.bg.Cancel()
	}

	// 4. Wait for every background goroutine to exit (bounded by ctx).
	if a.bg != nil {
		record("background", a.bg.Wait(ctx))
	}

	// 5. Close event bus — producers are stopped and awaited above, so no
	// publish-after-close can occur. Close drains pending handlers bounded
	// by the shutdown deadline (#1548).
	if a.bus != nil {
		a.bus.Close(ctx)
	}

	// 6. Shutdown audit service (bounded drain of retry queue, closes file sink).
	if a.AuditService != nil {
		a.AuditService.Shutdown(ctx)
	}

	// 7. Close WebSocket connections and stop heartbeat.
	if a.mgr != nil {
		a.mgr.Shutdown()
	}

	// 7.5 Stop the process-wide WS rate limiter cleanup goroutine.
	middleware.StopWSIPRateLimiter()

	// 8. Close database connection pool.
	if a.DB != nil {
		if sqlDB, err := a.DB.DB(); err == nil {
			record("db", sqlDB.Close())
		}
	}

	// 9. Close Redis connection pool.
	if a.CacheClient != nil {
		record("redis", a.CacheClient.Close())
	}

	slog.Info("shutdown complete")
	return errors.Join(errs...)
}

// startTaskScheduler periodically scans for expired agent tasks and publishes timeout events.
// It also terminates timed-out agentteam assignments so they do not remain active forever.
func (a *App) startTaskScheduler(ctx context.Context) {
	a.bg.Go(func() error {
		ticker := time.NewTicker(config.PendingTaskScanInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				tasks, err := a.AgentService.ScanExpiredTasks()
				if err != nil {
					slog.Warn("failed to scan expired agent tasks", "error", err)
				} else {
					for _, task := range tasks {
						a.publishExpiredTaskTimeout(ctx, task)
					}
				}
				a.failTimedOutTeamAssignments(ctx)
			case <-ctx.Done():
				return nil
			}
		}
	})
}

// failTimedOutTeamAssignments is the write-side counterpart of the route
// guardrail hasTimedOutActiveAssignment: active assignments past the timeout
// are marked failed and emit assignment.failed events.
func (a *App) failTimedOutTeamAssignments(ctx context.Context) {
	if a.AgentTeamService == nil {
		return
	}
	n, err := a.AgentTeamService.FailTimedOutAssignments(ctx)
	if err != nil {
		slog.Warn("failed to scan timed-out team assignments", "error", err)
		return
	}
	if n > 0 {
		slog.Info("terminated timed-out team assignments", "count", n)
	}
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
	if err := a.bus.Publish(ctx, bus.Event{
		Type: bus.EventTypeAgentTimeout,
		Payload: bus.AgentTaskPayload{
			TaskID:          task.ID,
			AgentInstanceID: task.AgentInstanceID,
			SessionID:       sessionID,
		},
	}); err != nil {
		slog.Warn("failed to publish agent timeout event", "task_id", task.ID, "error", err)
	}
}

// startWebSocketCleanup starts heartbeat-based stale connection cleanup.
// The heartbeat loop observes the group context and stops at shutdown.
func (a *App) startWebSocketCleanup(ctx context.Context) {
	a.mgr.StartHeartbeat(ctx)
}

// legacySeqSyncMarkerKey marks the legacy session-seq warm-up as completed.
// syncLegacySeqs is an explicit one-time migration (#1675): the first run
// sets this marker in Redis with a 30-day TTL, every later startup skips the
// DB scan while the marker lives. The TTL prevents permanent key residue if
// the deployment is decommissioned without explicit cleanup; expiry triggers
// a harmless idempotent re-scan because InitSeqIfAbsent is SetNX and runtime
// self-healing (seqalloc.recoverFromDB) covers any lost seq keys. Delete the
// key to force an immediate re-run (e.g. after a Redis flush).
const legacySeqSyncMarkerKey = "migration:legacy-seq-sync:v1"

// syncLegacySeqs copies existing session next_seq values from DB into Redis
// once per deployment. It observes ctx (cancelled at shutdown) and is a
// one-time migration, not a startup routine:
//
//   - If the marker key is already present, the migration completed on an
//     earlier boot and this run returns immediately (no DB scan).
//   - If the migration is cancelled or errors out partway, the marker is
//     removed so the next startup retries the remaining work.
//   - Sessions whose Redis seq key disappears later are covered by the
//     runtime self-healing path (seqalloc.recoverFromDB), so this bulk
//     warm-up is only the bootstrap for legacy data.
func (a *App) syncLegacySeqs(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}
	rdb := a.CacheClient.GetRDB()
	if rdb == nil {
		slog.Warn("legacy session seq sync skipped: redis client unavailable")
		return
	}
	claimed, err := rdb.SetNX(ctx, legacySeqSyncMarkerKey, time.Now().UTC().Format(time.RFC3339), 30*24*time.Hour).Result()
	if err != nil {
		slog.Warn("failed to check legacy seq sync marker", "error", err)
		return
	}
	if !claimed {
		slog.Debug("legacy session seq sync already completed; skipping")
		return
	}

	const batchSize = 5000
	total := 0
	offset := 0
	for {
		if err := ctx.Err(); err != nil {
			unsetLegacySeqSyncMarker(ctx, rdb)
			slog.Info("legacy session seq sync cancelled", "synced", total)
			return
		}
		var sessions []model.Session
		if err := a.DB.Select("id, next_seq").Where("next_seq > 0").Order("created_at ASC").Limit(batchSize).Offset(offset).Find(&sessions).Error; err != nil {
			unsetLegacySeqSyncMarker(ctx, rdb)
			slog.Warn("failed to query sessions for seq sync", "error", err)
			return
		}
		if len(sessions) == 0 {
			break
		}
		for _, sess := range sessions {
			if err := ctx.Err(); err != nil {
				unsetLegacySeqSyncMarker(ctx, rdb)
				slog.Info("legacy session seq sync cancelled", "synced", total)
				return
			}
			if err := a.CacheClient.InitSeqIfAbsent(ctx, sess.ID, sess.NextSeq); err != nil {
				slog.Warn("failed to init seq in redis", "session_id", sess.ID, "error", err)
			} else {
				total++
			}
		}
		if len(sessions) < batchSize {
			break
		}
		offset += batchSize
	}
	slog.Info("legacy session seq sync completed", "total", total)
}

// unsetLegacySeqSyncMarker removes the one-time marker so the next startup
// retries the migration. Best effort: the marker is only removed when the
// migration did not finish, and a leftover marker just skips a redundant
// warm-up the runtime self-healing path covers anyway.
func unsetLegacySeqSyncMarker(ctx context.Context, rdb *redis.Client) {
	if err := rdb.Del(ctx, legacySeqSyncMarkerKey).Err(); err != nil {
		slog.Warn("failed to clear legacy seq sync marker", "error", err)
	}
}
