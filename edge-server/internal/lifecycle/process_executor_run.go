package lifecycle

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/store"
)

func (e *ProcessExecutor) run(ctx context.Context, run store.Run, runCtx RunProcessContext) {
	// terminalFinish is true unless this attempt hands off to a fault-escalation
	// successor. The deferred finish must not tear down the concurrency slot the
	// successor just re-registered.
	terminalFinish := true
	defer func() {
		if terminalFinish {
			e.finish(run.ID)
		}
	}()

	// Store Hub task ID and allocate a bounded final-content collector for
	// Edge→Hub direct callback reporting. Without the collector, recordHubOutput
	// no-ops and fireHubDone falls back to literal "Run finished" (#987).
	// hubOutputs allocation is owned here.
	e.bindHubTask(run.ID, runCtx.HubTaskID, run.CallbackOwner)

	// Resolve adapter for this run: explicit agentID first, then default
	adapter := e.adapter
	if e.adapterReg != nil && (runCtx.AgentID != "" || adapter != nil) {
		resolved, err := e.adapterReg.Resolve(runCtx.AgentID)
		if err != nil {
			e.publishFailed(run, err)
			return
		}
		adapter = resolved
	}

	// Preflight check: if the adapter implements PreflightAdapter, verify
	// it is properly configured (e.g. API keys, credentials) before launching
	// the subprocess. This prevents hangs from CLIs that block on auth prompts.
	if preflight, ok := adapter.(adapters.PreflightAdapter); ok {
		err := preflight.PreflightCheck()
		if err != nil {
			slog.Warn("process: adapter preflight check failed", "runId", run.ID, "agentId", runCtx.AgentID, "error", err)
			e.publishFailed(run, (fmt.Errorf("adapter preflight failed: %w", err)))
			return
		}
	}

	// Resolve adapter label for Prometheus metrics
	var adapterLabel string
	if e.metrics != nil {
		if adapter == nil {
			adapterLabel = "none"
		} else {
			adapterLabel = adapterMetricsLabel(adapter.Metadata().ID)
		}
	}

	// Defense-in-depth — reject 'bypassPermissions' at the executor level
	// before launching the agent process. If the API validation is somehow
	// bypassed (e.g. direct internal calls), this fallback ensures the agent
	// never receives a permission mode that disables all security hooks.
	if runCtx.PermissionMode == "bypassPermissions" {
		slog.Warn("process: permission mode 'bypassPermissions' is forbidden, falling back to 'default'", "runId", run.ID, "agentId", runCtx.AgentID)
		runCtx.PermissionMode = "default"
	}

	var runStartTime time.Time
	recordStart := e.metrics != nil
	if recordStart {
		defer func() {
			r, ok := e.store.GetRun(run.ID)
			if runStartTime.IsZero() || !ok {
				return // never started or missing run
			}
			e.metrics.RecordRunFinish(adapterLabel, r.Status, time.Since(runStartTime).Seconds())
		}()
	}

	// Session retry loop: when CC exits quickly with a session conflict error
	// ("Session ID ... is already in use" or "No conversation found with session ID"),
	// generate a fresh random session ID and retry once. This handles the case where
	// a stale CC process from a previous Edge instance still holds the session lock.
	var lastWaitErr error
	var lastOutStore *runnerctx.RunOutputStore
	for attempt := 0; attempt < maxSessionRetries; attempt++ {
		// Phase 1 — Build & start the subprocess.
		proc, err := e.buildAndStartProcess(ctx, run, runCtx, adapter, adapterLabel, recordStart, &runStartTime, attempt)
		if err != nil {
			return
		}

		// Phase 2 — Collect output and wait for process exit.
		outStore, waitErr, parseErr := e.collectAndWaitOutput(ctx, run, runCtx, proc, adapter)
		lastWaitErr = waitErr
		lastOutStore = outStore
		slog.Debug("executor.subprocess.exited", "runId", run.ID, "exitCode", ExitCodeFromErr(lastWaitErr), "attempt", attempt)

		// Phase 3 — Decide: context checks, session retry, parse error, evidence gate, finish.
		switch e.completeRunAttempt(ctx, run, &runCtx, proc, attempt, lastWaitErr, parseErr, outStore) {
		case outcomeDone:
			return
		case outcomeRetry:
			continue
		case outcomeBreak:
			// Non-recoverable wait error — fall through to fault escalation.
			goto escalate
		case outcomeHandoff:
			// Fault-escalation successor already launched; it owns the
			// terminal finish.
			terminalFinish = false
			return
		case outcomeDeferred:
			// Orchestrator parent with active sub-agents: the terminal
			// publish is parked and owned by FinalizeParentRun (invoked by
			// the ResultAggregator). The deferred finish() still runs for
			// map cleanup, but skips the cascade-cancel while the parent
			// entry stays in pendingParentFinish.
			return
		}
	}

escalate:
	// Exhausted session retries — attempt fault escalation if configured.
	if e.handleFaultEscalation(&run, runCtx, lastWaitErr) {
		// Successor attempt launched; it owns the terminal finish.
		terminalFinish = false
		return
	}
	// Report the last error (terminal failure after retries exhausted or disabled).
	if lastWaitErr != nil {
		e.publishFailed(run, errorWithRunOutput(lastWaitErr, lastOutStore))
		e.sendSubAgentResult(run.ID, "failed", subAgentErrorPayload(lastWaitErr))
	}
}
