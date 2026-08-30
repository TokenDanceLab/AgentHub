package jwtutil

import (
	"context"
	"log/slog"
	"time"
)

// SchedulerConfig controls the periodic rotation scheduler.
type SchedulerConfig struct {
	Interval    time.Duration
	GracePeriod time.Duration
}

// RotationObserver is called after each rotation attempt so the caller can
// record metrics without this package importing a specific metrics library.
// success is true when rotation succeeded; pendingKeys is the current count
// of keys within their grace period; err is non-nil on failure.
type RotationObserver func(success bool, pendingKeys int, err error)

// Scheduler runs periodic key rotations on a Rotator. Stop via context
// cancellation. Designed for single-instance use per process.
type Scheduler struct {
	rotator  *Rotator
	cfg      SchedulerConfig
	observer RotationObserver
	interval time.Duration // override for testing
}

// NewScheduler creates a scheduler. observer may be nil.
func NewScheduler(rotator *Rotator, cfg SchedulerConfig, observer RotationObserver) *Scheduler {
	if cfg.Interval <= 0 {
		cfg.Interval = 24 * time.Hour
	}
	return &Scheduler{
		rotator:  rotator,
		cfg:      cfg,
		observer: observer,
		interval: cfg.Interval,
	}
}

// Run blocks until ctx is cancelled. It performs an immediate rotation on
// start (to establish a fresh key), then ticks at the configured interval.
func (s *Scheduler) Run(ctx context.Context) {
	s.runOnce()

	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			s.runOnceAt(now)
		}
	}
}

func (s *Scheduler) runOnce() {
	s.runOnceAt(time.Time{}) // zero → rotator uses its own clock
}

func (s *Scheduler) runOnceAt(now time.Time) {
	_, err := s.rotator.RotateOnce()

	// Also tick expired grace periods opportunistically on each rotation.
	if !now.IsZero() {
		s.rotator.Tick(now)
	} else {
		s.rotator.Tick(s.rotator.clock.Now())
	}
	pending := s.rotator.PendingCount()

	if err != nil {
		slog.Error("jwt rotation failed", "error", err, "pending_keys", pending)
	} else {
		slog.Info("jwt rotation completed", "pending_keys", pending)
	}
	if s.observer != nil {
		s.observer(err == nil, pending, err)
	}
}
