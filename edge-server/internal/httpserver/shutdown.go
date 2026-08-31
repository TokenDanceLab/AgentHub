package httpserver

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

const (
	// shutdownTotalBudget is the overall graceful-shutdown budget. It covers
	// CancelAll, HTTP srv.Shutdown, all ShutdownHooks, and Bus.Close. The same
	// value was previously hardcoded in Run(); it is now a named constant so
	// per-hook and bus-close budgets can be derived from it.
	shutdownTotalBudget = 10 * time.Second

	// shutdownPerHookBudget is the maximum wall time any single ShutdownHook
	// may consume. If a hook exceeds this budget it is abandoned (its
	// goroutine continues running but is no longer waited on) and the next
	// hook is invoked. 2s leaves room for multiple hooks plus Bus.Close
	// within the 10s total budget even after srv.Shutdown consumes some of it.
	shutdownPerHookBudget = 2 * time.Second

	// shutdownBusCloseBudget is the maximum wall time Bus.Close may consume.
	// Bus.Close waits on workersWg which cannot be interrupted; we cap the
	// wait so a stuck observer pool does not prevent process exit.
	shutdownBusCloseBudget = 3 * time.Second
)

// runShutdownHooks invokes each hook with a per-hook timeout. A hook that
// exceeds its budget is logged and skipped; remaining hooks still run. Hooks
// are identified by their 1-based index because func() carries no name.
func runShutdownHooks(hooks []func()) {
	for i, h := range hooks {
		if h == nil {
			continue
		}
		idx := i + 1
		done := make(chan struct{})
		go func() {
			defer close(done)
			h()
		}()
		select {
		case <-done:
			// ok
		case <-time.After(shutdownPerHookBudget):
			slog.Warn("shutdown hook exceeded budget, skipping",
				"hookIndex", idx, "budget", shutdownPerHookBudget)
		}
	}
}

// closeBusWithTimeout calls bus.Close() with a wall-time cap. If Close does
// not return within the budget, the error channel is abandoned and an error is
// returned indicating timeout. The underlying Close goroutine may still be
// running; this is accepted to avoid blocking process exit.
func closeBusWithTimeout(closeFn func() error, budget time.Duration) error {
	type result struct {
		err error
	}
	ch := make(chan result, 1)
	var once sync.Once
	go func() {
		err := closeFn()
		once.Do(func() { ch <- result{err: err} })
	}()
	select {
	case r := <-ch:
		return r.err
	case <-time.After(budget):
		// Prevent late write from blocking the goroutine forever.
		go func() {
			// Drain if it eventually arrives.
			<-ch
		}()
		slog.Warn("bus close exceeded budget, abandoning wait", "budget", budget)
		return context.DeadlineExceeded
	}
}
