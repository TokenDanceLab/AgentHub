package lifecycle

import (
	"context"
	"log/slog"
	"os"
)

// CancelAll synchronously cancels every in-flight run managed by this executor.
// It is intended for graceful process shutdown: when the Edge server receives a
// stop signal, lingering child processes must be terminated so they do not
// become orphans (notably on Windows, where a parent exit does not cascade a
// kill to CREATE_NEW_PROCESS_GROUP children). The provided ctx carries the
// shutdown deadline; CancelAll stops launching new grace goroutines once the
// deadline elapses but lets any in-flight kill syscalls finish.
//
// Unlike the per-run Cancel path (which arms an async grace goroutine with
// stdin interrupt → SIGTERM → SIGKILL timers), CancelAll takes the direct
// route: cancel each run context (stops parsers/timeouts), then immediately
// force-kill the process tree. This is appropriate at shutdown because there
// is no HTTP response to return quickly and no benefit in waiting for a child
// to flush state that will be discarded anyway.
func (e *ProcessExecutor) CancelAll(ctx context.Context) {
	// Snapshot under the lock so we release it before doing any blocking
	// syscall work (kill is fast, but never hold e.mu across a process kill).
	e.mu.Lock()
	runIDs := make([]string, 0, len(e.running))
	cancels := make([]context.CancelFunc, 0, len(e.running))
	procs := make(map[string]*os.Process, len(e.processes))
	for id, cancel := range e.running {
		runIDs = append(runIDs, id)
		cancels = append(cancels, cancel)
	}
	for id, proc := range e.processes {
		procs[id] = proc
	}
	e.mu.Unlock()

	if len(runIDs) == 0 {
		return
	}

	// Cancel contexts first so parsers/timeout watchers stop and do not fight
	// the kill path for the same process.
	for _, cancel := range cancels {
		cancel()
	}

	killed := 0
	for _, id := range runIDs {
		// Honor the shutdown deadline between iterations: once expired, stop
		// starting new kills. (Each individual kill is a single syscall, so
		// the deadline mainly guards against a pathological long syscall.)
		if err := ctx.Err(); err != nil {
			slog.Warn("cancelall: deadline reached; remaining runs left to async kill path",
				"cancelled", killed, "remaining", len(runIDs)-killed, "error", err)
			break
		}
		proc, ok := procs[id]
		if !ok || proc == nil {
			continue
		}
		if err := killProcessTree(proc); err != nil {
			slog.Debug("cancelall: force kill failed", "run_id", id, "error", err)
		} else {
			killed++
		}
		// Best-effort status transition so observability reflects the cancel;
		// any terminal status already set wins (SetRunStatusIf is conditional).
		if _, found := e.store.SetRunStatusIf(id, "cancelled", "queued", "started", "cancelling"); found {
			slog.Debug("cancelall: marked run cancelled", "run_id", id)
		}
	}
	slog.Info("cancelall: cancelled in-flight runs", "total", len(runIDs), "killed", killed)
}
