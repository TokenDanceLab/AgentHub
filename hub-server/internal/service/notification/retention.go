package notification

import (
	"context"
	"log/slog"
	"time"

	"gorm.io/gorm"

	"github.com/agenthub/hub-server/internal/repository"
)

const (
	// DefaultRetentionWindow is how long read notifications are kept before
	// purge. 90 days balances user scroll-back against unbounded table growth
	// (the notifications table previously only ever grew — #2154 Ampere P2-3).
	// Unread notifications are never purged.
	DefaultRetentionWindow = 90 * 24 * time.Hour

	// CleanupInterval is how often the background retention loop fires. 24h
	// keeps the purge off the hot path; the retention window (not the cadence)
	// governs eligibility. Mirrors agent.StartRunEventRetentionLoop.
	CleanupInterval = 24 * time.Hour
)

// RetentionConfig parameterizes RetentionPass. Exported so callers
// (background loop, tests) can override defaults without package-level state.
type RetentionConfig struct {
	Window time.Duration
}

// DefaultRetentionConfig returns the documented defaults.
func DefaultRetentionConfig() RetentionConfig {
	return RetentionConfig{Window: DefaultRetentionWindow}
}

// RetentionResult mirrors repository.NotificationRetentionResult for the
// service layer so callers don't import repository directly.
type RetentionResult struct {
	DeletedRows int64
}

// RetentionPass executes one notification retention pass: purge read
// notifications older than cfg.Window; unread rows are never touched.
// Safe to call from any goroutine; idempotent.
func RetentionPass(ctx context.Context, db *gorm.DB, cfg RetentionConfig) (RetentionResult, error) {
	if db == nil {
		return RetentionResult{}, nil
	}
	cutoff := time.Now().Add(-cfg.Window)
	res, err := repository.PurgeReadNotifications(db.WithContext(ctx), cutoff)
	if err != nil {
		return RetentionResult{}, err
	}
	return RetentionResult{DeletedRows: res.DeletedRows}, nil
}

// StartRetentionLoop starts a background goroutine that periodically purges
// old read notifications per the retention policy. Modeled on
// agent.StartRunEventRetentionLoop. The loop runs once at startup so a Hub
// that was down for longer than CleanupInterval does not sit on an unbounded
// table for another full interval.
func StartRetentionLoop(ctx context.Context, db *gorm.DB, cfg RetentionConfig) {
	go func() {
		ticker := time.NewTicker(CleanupInterval)
		defer ticker.Stop()
		runOnce := func() {
			res, err := RetentionPass(ctx, db, cfg)
			if err != nil {
				slog.Warn("notification retention failed", "error", err)
				if RetentionFailures != nil {
					RetentionFailures.Inc()
				}
				return
			}
			if RetentionRuns != nil {
				RetentionRuns.Inc()
			}
			if res.DeletedRows > 0 {
				slog.Info("notification retention purged rows",
					"deleted_rows", res.DeletedRows,
					"window", cfg.Window,
				)
				if RetentionDeletedRows != nil {
					RetentionDeletedRows.Add(float64(res.DeletedRows))
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
