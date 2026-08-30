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

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	done := make(chan struct{})
	go func() { sched.Run(ctx); close(done) }()

	// Poll instead of a fixed observation window: slow CI runners (Windows)
	// may not fit ≥2 ticks into a 180ms window. The interval is still 50ms, so
	// the second rotation lands quickly once the ticker goroutine is scheduled.
	deadline := time.After(4 * time.Second)
	for {
		mu.Lock()
		got := successes >= 2
		mu.Unlock()
		if got {
			break
		}
		select {
		case <-deadline:
			mu.Lock()
			s := successes
			mu.Unlock()
			cancel()
			<-done
			t.Fatalf("timed out waiting for >=2 rotations, got %d", s)
		case <-time.After(5 * time.Millisecond):
		}
	}
	cancel()
	<-done

	mu.Lock()
	defer mu.Unlock()
	// Expect ≥2 rotations (immediate + at least one tick).
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

	var calledMu sync.Mutex
	called := false
	obs := func(ok bool, pending int, err error) {
		calledMu.Lock()
		called = true
		calledMu.Unlock()
		if !ok || err != nil {
			t.Errorf("expected success observation; got ok=%v err=%v", ok, err)
		}
		if pending < 0 {
			t.Errorf("pending negative: %d", pending)
		}
	}
	sched := NewScheduler(r, SchedulerConfig{Interval: time.Hour}, obs)

	// Run in a goroutine; poll for the immediate-rotation observation instead
	// of a fixed sleep so slow runners stay green.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { sched.Run(ctx); close(done) }()

	deadline := time.After(2 * time.Second)
	for {
		calledMu.Lock()
		seen := called
		calledMu.Unlock()
		if seen {
			break
		}
		select {
		case <-deadline:
			cancel()
			<-done
			t.Fatal("timed out waiting for observer call")
		case <-time.After(5 * time.Millisecond):
		}
	}
	cancel()
	<-done

	calledMu.Lock()
	defer calledMu.Unlock()
	if !called {
		t.Error("observer was not called")
	}
}
