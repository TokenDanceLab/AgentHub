package httpserver

import (
	"sync"
	"testing"
	"time"
)

func TestRunShutdownHooks_AllComplete(t *testing.T) {
	var called []int
	var mu sync.Mutex
	hooks := []func(){
		func() { mu.Lock(); called = append(called, 1); mu.Unlock() },
		func() { mu.Lock(); called = append(called, 2); mu.Unlock() },
		func() { mu.Lock(); called = append(called, 3); mu.Unlock() },
	}
	runShutdownHooks(hooks)
	if len(called) != 3 || called[0] != 1 || called[1] != 2 || called[2] != 3 {
		t.Fatalf("hooks not all invoked in order: %v", called)
	}
}

func TestRunShutdownHooks_SlowHookDoesNotBlockNext(t *testing.T) {
	// Verifies that a slow hook is skipped after the per-hook budget and
	// subsequent hooks still run. Uses the package constant; accepts ~2s cost.
	// The slow hook blocks on a channel (no time.Sleep) and is released at
	// test cleanup so its goroutine cannot leak.
	if testing.Short() {
		t.Skip("skipping slow-hook test in short mode")
	}
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })

	orderCh := make(chan int, 3)
	hooks := []func(){
		func() { <-release; orderCh <- 1 },
		func() { orderCh <- 2 },
	}
	start := time.Now()
	runShutdownHooks(hooks)
	elapsed := time.Since(start)

	// Second hook must have been invoked promptly despite first being slow.
	select {
	case v := <-orderCh:
		if v != 2 {
			t.Fatalf("expected second hook to run first, got %d", v)
		}
	default:
		t.Fatal("second hook was not invoked")
	}
	if elapsed > shutdownPerHookBudget+1*time.Second {
		t.Fatalf("runShutdownHooks took %v, expected ~%v", elapsed, shutdownPerHookBudget)
	}
}

func TestRunShutdownHooks_NilSafe(t *testing.T) {
	runShutdownHooks([]func(){nil, nil})
}

func TestCloseBusWithTimeout_OK(t *testing.T) {
	closed := false
	err := closeBusWithTimeout(func() error { closed = true; return nil }, shutdownBusCloseBudget)
	if err != nil || !closed {
		t.Fatalf("expected clean close, err=%v closed=%v", err, closed)
	}
}

func TestCloseBusWithTimeout_ExceedsBudget(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping bus-close timeout test in short mode")
	}
	budget := 50 * time.Millisecond
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })

	start := time.Now()
	err := closeBusWithTimeout(func() error {
		<-release
		return nil
	}, budget)
	elapsed := time.Since(start)
	if err == nil {
		t.Fatal("expected timeout error")
	}
	if elapsed > budget+100*time.Millisecond {
		t.Fatalf("closeBusWithTimeout waited %v, expected ~%v", elapsed, budget)
	}
}
