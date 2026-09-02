package lifecycle

import (
	"context"

	"github.com/agenthub/edge-server/internal/store"
	"github.com/agenthub/pkg/safego"
)

func (e *ProcessExecutor) Start(run store.Run, runCtx RunProcessContext) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	current, found := e.store.GetRun(run.ID)
	_, alreadyRunning := e.running[run.ID]
	if err := planStartAdmission(found, current.Status, len(e.running), e.maxConcurrentRuns, alreadyRunning); err != nil {
		return err
	}
	// Create context and atomically insert cancel into the map while holding
	// the lock, so a concurrent Cancel can never miss the cancel func.
	ctx, cancel := context.WithTimeout(context.Background(), e.runTimeout)
	e.running[run.ID] = cancel

	// Spawn the run lifecycle goroutine through safeGo so a panic inside run()
	// (adapter parse, emitter chain, output store) is recovered and logged
	// instead of crashing the whole Edge process. run()'s deferred finish()
	// still runs during panic unwinding before recover catches, so terminal
	// state and package-level sync.Map hygiene are preserved.
	safego.SafeGo("run", func() { e.run(ctx, run, bindRunProcessContext(runCtx, run)) })
	return nil
}

// Cancel attempts to cancel a running or queued run. It looks up the run's cancel
// function in the executor's running map and invokes it, which cancels the run
// context (stopping stream parsers) and starts graceful process shutdown:
// stdin interrupt -> grace wait -> SIGTERM/group signal -> force timeout -> Kill.
//
// Process lifetime is intentionally NOT bound via exec.CommandContext: cancelling
// the run context must not immediately SIGKILL the child and defeat the grace
// path (#988). Escalation is owned by the grace goroutine below (or by the
// context watcher when Cancel is not involved, e.g. run timeout).
//
// Returns a CancelResult indicating whether the run was found and whether the
// cancellation was actually performed (a run already in terminal state cannot be
// cancelled). Cancel is safe to call on a run that has already finished.
