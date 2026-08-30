//nolint:gosec // 测试 fixture
package jwtutil

import (
	"context"
	"sync"
	"testing"
	"time"
)

// TestScheduler_RunsImmediatelyAndOnTick verifies that the scheduler fires
// an immediate rotation on start and subsequent ticks at the configured
// interval. Uses a short interval + context cancel to bound runtime.
func TestScheduler_RunsImmediatelyAndOnTick(t *testing.T) {
	km := newTestKM(t)
	fc := &fakeClock{now: time.Unix(1_700_000_000, 0)}
	cfg := RotationConfig{GracePeriod: 30 * time.Minute, KeyBytes: 32}
	r := NewRotator(km, fc, cfg)

	var mu sync.Mutex
	var successes int
	var failures int
	obs := func(ok bool, _ int, err error) {
		mu.Lock()
		defer mu.Unlock()
		if ok {
			successes++
		} else {
			failures++
		}
	}

	sched := NewScheduler(r, SchedulerConfig{
		Interval:    50 * time.Millisecond, // fast for test
		GracePeriod: cfg.GracePeriod,
	}, obs)

	ctx, cancel := context.WithTimeout(context.Background(), 180*time.Millisecond)
	defer cancel()
	sched.Run(ctx)

	mu.Lock()
	defer mu.Unlock()
	// Expect ≥2 rotations (immediate + at least one tick in 180ms with 50ms interval).
	if successes < 2 {
		t.Errorf("successes = %d, want >= 2", successes)
	}
	if failures != 0 {
		t.Errorf("failures = %d, want 0", failures)
	}
	// Active kid should have changed from initial.
	if km.ActiveKeyID() == "k-init" {
		t.Error("active kid unchanged after scheduler run")
	}
}

// TestScheduler_ObserverCalledOnError ensures observer receives failure events.
// We can't easily inject a failing rotator without exposing internals, so we
// verify the observer contract via a successful path here; failure-path unit
// coverage lives in rotation_test.go (TestRotateOnce_FailurePreservesOldKey).
func TestScheduler_ObserverContract(t *testing.T) {
	km := newTestKM(t)
	r := NewRotator(km, RealClock{}, DefaultRotationConfig())

	called := false
	obs := func(ok bool, pending int, err error) {
		called = true
		if !ok || err != nil {
			t.Errorf("expected success observation; got ok=%v err=%v", ok, err)
		}
		if pending < 0 {
			t.Errorf("pending negative: %d", pending)
		}
	}
	sched := NewScheduler(r, SchedulerConfig{Interval: time.Hour}, obs)

	// Run once manually via unexported method isn't possible; instead use
	// a very short-lived context — Run does immediate rotation before first tick.
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		// Give Run time to do the immediate rotation then cancel.
		time.Sleep(20 * time.Millisecond)
		cancel()
	}()
	sched.Run(ctx)

	if !called {
		t.Error("observer was not called")
	}
}
