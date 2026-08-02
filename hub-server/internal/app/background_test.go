package app

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"sync/atomic"
	"testing"
	"time"

	"github.com/agenthub/hub-server/internal/config"
)

// TestBackgroundGroupWaitDeadline: Wait must return a deadline error when a
// task outlives the caller's bounded context (#1542 — no unbounded waits).
func TestBackgroundGroupWaitDeadline(t *testing.T) {
	bg := newBackgroundGroup(context.Background())
	bg.Go(func() error {
		<-bg.Ctx().Done()
		return nil
	})

	short, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	err := bg.Wait(short)
	if err == nil {
		t.Fatal("Wait must fail when the bounded deadline expires")
	}
	bg.Cancel() // release the goroutine
}

// TestBackgroundGroupErrorPropagates: a task error must surface through Wait
// (no more log-line-only failures, #1542 requirement 9).
func TestBackgroundGroupErrorPropagates(t *testing.T) {
	bg := newBackgroundGroup(context.Background())
	sentinel := errors.New("background task exploded")
	bg.Go(func() error {
		<-bg.Ctx().Done()
		return sentinel
	})
	bg.Cancel()
	err := bg.Wait(context.Background())
	if !errors.Is(err, sentinel) {
		t.Fatalf("Wait error = %v, want sentinel", err)
	}
}

// TestShutdownIdempotent: Shutdown must be safe to call repeatedly (#1542
// constraint: multiple calls must not panic or re-run stages).
func TestShutdownIdempotent(t *testing.T) {
	a := &App{
		Config: &config.Config{},
		bg:     newBackgroundGroup(context.Background()),
	}
	var ran atomic.Int64
	a.bg.Go(func() error {
		ran.Add(1)
		<-a.bg.Ctx().Done()
		return nil
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	err1 := a.Shutdown(ctx)
	err2 := a.Shutdown(ctx) // second call must no-op
	if err1 != nil {
		t.Fatalf("first shutdown: %v", err1)
	}
	if err2 != err1 {
		t.Fatalf("second shutdown returned different result: %v vs %v", err2, err1)
	}
	if ran.Load() != 1 {
		t.Fatalf("background task ran %d times, want 1", ran.Load())
	}
}

// TestShutdownWaitsForBackground: Shutdown must not return before registered
// background tasks have exited (#1542 — DB/Redis close must not race them).
func TestShutdownWaitsForBackground(t *testing.T) {
	a := &App{
		Config: &config.Config{},
		bg:     newBackgroundGroup(context.Background()),
	}
	var exited atomic.Bool
	a.bg.Go(func() error {
		<-a.bg.Ctx().Done()
		time.Sleep(100 * time.Millisecond) // slow cleanup
		exited.Store(true)
		return nil
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := a.Shutdown(ctx); err != nil {
		t.Fatalf("shutdown: %v", err)
	}
	if !exited.Load() {
		t.Fatal("Shutdown returned before the background task exited")
	}
}

// TestBackgroundGroupCyclesNoGoroutineGrowth: 20 create/cancel/wait cycles
// must not accumulate goroutines (#1542 must-test 6).
func TestBackgroundGroupCyclesNoGoroutineGrowth(t *testing.T) {
	before := runtime.NumGoroutine()
	for i := 0; i < 20; i++ {
		bg := newBackgroundGroup(context.Background())
		bg.Go(func() error {
			<-bg.Ctx().Done()
			return nil
		})
		bg.Cancel()
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		err := bg.Wait(ctx)
		cancel()
		if err != nil {
			t.Fatalf("cycle %d wait: %v", i, err)
		}
	}
	// Give any stragglers a moment, then compare.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
		if runtime.NumGoroutine() <= before+2 {
			break
		}
	}
	if got := runtime.NumGoroutine(); got > before+2 {
		t.Fatalf("goroutines grew across 20 cycles: before=%d after=%d", before, got)
	}
}

var _ = fmt.Sprintf // keep fmt import if unused in future edits
