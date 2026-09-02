package agent

import (
	"context"
	"log/slog"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/repository"
	"github.com/agenthub/pkg/safego"
)

const (
	// DefaultRetentionWindow is how long terminal-task events are kept before
	// purge. 30 days balances operator audit window against unbounded table
	// growth. Operators can override via config when exposed.
	DefaultRetentionWindow = 30 * 24 * time.Hour

	// DefaultKeepTail is the number of most-recent events (by event_seq) to
	// retain per terminal task regardless of age, so post-mortem inspection
	// always has a useful tail. Matches the brief's conservative default.
	DefaultKeepTail int64 = 500

	// CleanupInterval is how often the background retention loop fires. 24h
	// keeps the purge off the hot path; the retention window (not the cadence)
	// governs eligibility. Mirrors deliveryoutbox.CleanupInterval.
	CleanupInterval = 24 * time.Hour
)

// RetentionConfig parameterizes RunEventsRetentionPass. Exported so callers
// (background loop, tests) can override defaults without package-level state.
type RetentionConfig struct {
	Window   time.Duration
	KeepTail int64
}

// DefaultRetentionConfig returns the documented defaults.
func DefaultRetentionConfig() RetentionConfig {
	return RetentionConfig{Window: DefaultRetentionWindow, KeepTail: DefaultKeepTail}
}

// RetentionResult mirrors repository.AgentRunEventRetentionResult for the
// service layer so callers don't import repository directly.
type RetentionResult struct {
	DeletedRows   int64
	AffectedTasks int64
}

// RunEventsRetentionPass executes one retention pass: purge terminal-task
// events older than cfg.Window while keeping the most recent cfg.KeepTail
// events per task. Safe to call from any goroutine; idempotent.
func RunEventsRetentionPass(ctx context.Context, db *gorm.DB, cfg RetentionConfig) (RetentionResult, error) {
	if db == nil {
		return RetentionResult{}, nil
	}
	cutoff := time.Now().Add(-cfg.Window)
	res, err := repository.PurgeTerminalRunEvents(db.WithContext(ctx), cutoff, cfg.KeepTail)
	if err != nil {
		return RetentionResult{}, err
	}
	return RetentionResult{DeletedRows: res.DeletedRows, AffectedTasks: res.AffectedTasks}, nil
}

// StartRunEventRetentionLoop starts a background goroutine that periodically
// purges terminal-task agent_run_events per the retention policy. Modeled on
// deliveryoutbox.(*Outbox).StartDeliveryCleanupLoop. The loop runs once at
// startup so a Hub that was down for longer than CleanupInterval does not sit
// on an unbounded table for another full interval.
//
// Wiring note: this function is intentionally standalone so it can be invoked
// from app/wiring.go alongside StartDeliveryCleanupLoop. If wiring.go is
// currently owned by another lane, callers may instead invoke
// RunEventsRetentionPass directly from an existing maintenance tick.
func StartRunEventRetentionLoop(ctx context.Context, db *gorm.DB, cfg RetentionConfig) {
	go func() {
		defer safego.Recover("agent.run_event_retention_loop")
		ticker := time.NewTicker(CleanupInterval)
		defer ticker.Stop()
		runOnce := func() {
			res, err := RunEventsRetentionPass(ctx, db, cfg)
			if err != nil {
				slog.Warn("agent run event retention failed", "error", err)
				if AgentRunEventRetentionFailures != nil {
					AgentRunEventRetentionFailures.Inc()
				}
				return
			}
			if AgentRunEventRetentionRuns != nil {
				AgentRunEventRetentionRuns.Inc()
			}
			if res.DeletedRows > 0 {
				slog.Info("agent run event retention purged rows",
					"deleted_rows", res.DeletedRows,
					"affected_tasks", res.AffectedTasks,
					"window", cfg.Window,
					"keep_tail", cfg.KeepTail,
				)
				if AgentRunEventRetentionDeletedRows != nil {
					AgentRunEventRetentionDeletedRows.Add(float64(res.DeletedRows))
				}
			}
		}
		runOnce()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				runOnce()
			}
		}
	}()
}
