package lifecycle

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/pkg/safego"
)

func (e *ProcessExecutor) Cancel(runID string) CancelResult {
	run, ok := e.store.GetRun(runID)
	if !ok {
		return CancelResult{Found: false, Status: "not_found"}
	}
	if !isCancellableRunStatus(run.Status) {
		return CancelResult{Run: run, Found: true, Status: run.Status}
	}

	// Send adapter-specific interrupt via stdin before canceling context.
	// This allows Claude Code to clean up gracefully (finish current API call,
	// flush session state) rather than being killed by SIGTERM.
	e.mu.Lock()
	stdin, hasStdin := e.stdins[runID]
	if hasStdin {
		if err := adapters.WriteInterrupt(stdin, "interrupt-"+runID); err != nil {
			slog.Debug("process: interrupt write failed", "runId", runID, "error", err)
		}
	}
	cancel, ok := e.running[runID]
	e.mu.Unlock()
	if !ok {
		return CancelResult{Found: false, Status: "not_running"}
	}

	// Graceful shutdown: wait grace period for child to respond to stdin interrupt,
	// then send SIGTERM (process group on Unix), wait force timeout, and escalate
	// to SIGKILL as last resort. Register cancelDone BEFORE cancel() so the
	// context-timeout watcher defers to this path and does not force-kill early.
	// Idempotency guard (#2154): check-and-register cancelDone under one lock
	// hold. A repeat or racing Cancel must not overwrite the tracked channel;
	// overwriting orphans the previous grace goroutine because finish() only
	// closes the newest entry.
	e.mu.Lock()
	proc := e.processes[runID]
	_, alreadyArmed := e.cancelDone[runID]
	armGrace := proc != nil && !alreadyArmed
	var done chan struct{}
	if armGrace {
		done = make(chan struct{})
		e.cancelDone[runID] = done
	}
	e.mu.Unlock()
	if armGrace {
		// Graceful shutdown: run in a goroutine so Cancel() returns
		// immediately and does not block the HTTP response. The goroutine
		// is tracked via cancelDone so finish() can abort it early if the
		// process exits on its own before the grace periods elapse.
		safego.SafeGo("cancelGrace", func() {
			select {
			case <-done:
				return
			case <-time.After(e.shutdownGracePeriod):
			}
			if err := signalProcessGraceful(proc); err != nil {
				slog.Debug("process: graceful signal failed", "run_id", runID, "error", err)
			}
			select {
			case <-done:
				return
			case <-time.After(e.shutdownForceTimeout):
			}
			if err := killProcessTree(proc); err != nil {
				slog.Debug("process: force kill failed", "run_id", runID, "error", err)
			}
			// run() also Wait()s; a second Wait is best-effort reaping only.
			if _, err := proc.Wait(); err != nil {
				slog.Warn("process wait error after kill", "run_id", runID, "error", err)
			}
		})
	}

	// Cancel the run context after the grace path is armed. This stops
	// parsers/timeouts but must not itself kill the child process.
	cancel()

	run, ok = e.store.SetRunStatusIf(runID, "cancelling", "queued", "started", "cancelling")
	if ok {
		return CancelResult{Run: run, Found: true, Status: run.Status}
	}
	current, found := e.store.GetRun(runID)
	if !found {
		return CancelResult{Found: false, Status: "not_found"}
	}
	return CancelResult{Run: current, Found: true, Status: current.Status}
}

// watchRunProcess terminates a child when the run context ends and Cancel has
// not already armed a grace path. Without this, dropping CommandContext would
// leave run-timeout processes orphaned (#988).
func (e *ProcessExecutor) watchRunProcess(ctx context.Context, runID string, proc *os.Process, stop <-chan struct{}) {
	select {
	case <-stop:
		return
	case <-ctx.Done():
	}
	// If Cancel already registered a grace goroutine, let that path escalate.
	e.mu.Lock()
	_, graceActive := e.cancelDone[runID]
	e.mu.Unlock()
	if graceActive {
		return
	}
	if err := killProcessTree(proc); err != nil {
		slog.Debug("process: timeout kill failed", "run_id", runID, "error", err)
	}
}
