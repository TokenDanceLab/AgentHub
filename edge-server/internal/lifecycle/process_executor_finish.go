package lifecycle

import (
	"log/slog"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/agents"
)

func (e *ProcessExecutor) finish(runID string) {
	// Pure cleanup plan; map deletes stay here. Do not rework #867 handoff.
	e.mu.Lock()
	_, hasCancelDone := e.cancelDone[runID]
	_, hasRunOutput := e.runOutputs[runID]
	e.mu.Unlock()
	plan := planFinishCleanup(e.agentRegistry != nil, hasCancelDone, hasRunOutput)
	// Cascade: when a parent agent finishes, disconnect descendant registry
	// nodes and Cancel their process runIDs (Codex AgentTree shutdown).
	// ShutdownCascade accepts parent runID even when no agent is registered
	// under that ID — children are keyed ParentID=parentRunID (#1001).
	// Preserve #867 terminalFinish, #987 hubOutputs, #988 Cancel grace path.
	if plan.Cascade {
		// Pure filter keeps #1001 self/empty skip; Cancel side-effects stay here.
		for _, childRunID := range filterCascadeCancelChildren(runID, e.agentRegistry.ShutdownCascade(runID)) {
			e.Cancel(childRunID)
		}
	}

	// Auto-surface: detect file changes and emit artifact/preview/diff events.
	// Only surfaces when the run finished successfully.
	e.surfaceRunArtifacts(runID)

	e.mu.Lock()
	delete(e.running, runID)
	delete(e.stdins, runID)
	delete(e.processes, runID)
	delete(e.runToAgent, runID)
	delete(e.hubTasks, runID)
	delete(e.hubOutputs, runID)
	delete(e.workDirs, runID)
	delete(e.surfacers, runID)
	if done, ok := e.cancelDone[runID]; shouldApplyTrackedClose(plan.CloseCancelDone, ok) {
		close(done)
		delete(e.cancelDone, runID)
	}
	if s, ok := e.runOutputs[runID]; shouldApplyTrackedClose(plan.CloseRunOutput, ok) {
		if err := s.Close(); planRunOutputCloseLog(err).Log {
			slog.Warn("process: failed to close output store", "runId", runID, "error", err)
		}
		delete(e.runOutputs, runID)
	}
	e.mu.Unlock()
}

// surfaceRunArtifacts performs auto-surface detection after a run completes.
// It reads the pre-run workdir snapshot, scans for new/modified files, and
// emits surfaced artifact/preview/diff events so the frontend can render them
// inline in the chat transcript. Errors are logged but never block cleanup.
func (e *ProcessExecutor) surfaceRunArtifacts(runID string) {
	e.mu.Lock()
	snapshot := e.surfacers[runID]
	e.mu.Unlock()

	// Only surface for successfully finished runs with a writable store.
	current, runFound := e.store.GetRun(runID)
	writer, hasWriter := asStoreWriter(e.store)
	plan := planSurfaceArtifacts(snapshot, runFound, current.Status, hasWriter)
	if plan.SkipWriterLog {
		slog.Debug("surfacing: store does not implement Writer, skipping", "runId", runID)
		return
	}
	if plan.Proceed {
		adapters.SurfaceAndEmit(e.bus, writer, snapshot, current)
	}
}

// sendSubAgentResult delivers a result message from a completed sub-agent run
// back to its parent agent via the message queue. This enables the orchestrator
// to aggregate results from dispatched sub-agents.
func (e *ProcessExecutor) sendSubAgentResult(runID, status string, payload any) {
	e.mu.Lock()
	agentID, mappingFound := e.runToAgent[runID]
	e.mu.Unlock()

	var inst *agents.AgentInstance
	if planSubAgentInstanceLookup(e.agentRegistry != nil, mappingFound).Lookup {
		inst, _ = e.agentRegistry.Get(agentID)
	}
	parentID := parentIDFromAgentInstance(inst)
	plan := planSubAgentResultDelivery(
		e.agentRegistry != nil, e.messageQueue != nil, mappingFound, inst != nil, parentID, status, e.resultAgg != nil,
	)
	if !plan.Deliver {
		return
	}

	if plan.UpdateRegistry {
		// completed_with_issues remains MsgTypeResult; registry must go StatusCompleted
		// so the parent orchestrator does not wait forever on evidence-gate issues.
		e.agentRegistry.SetStatus(agentID, plan.RegistryStatus, "")
	}

	// Pure outbound prep: sanitize + queue message + aggregator value.
	// Queue/registry side-effects stay here.
	now := time.Now().UTC()
	msg, aggResult := prepareSubAgentResultOutbound(
		payload, runID, agentID, inst.Name, inst.ParentID, status, now,
	)
	e.messageQueue.EnsureAgent(inst.ParentID, 64)
	e.messageQueue.Send(msg)

	// Store structured result in the aggregator's collector for eventual
	// synthesis when all children of the parent complete (or timeout).
	// Reference: AionUi Team Mode Mailbox — persisted sub-agent results.
	// Reference: LibreChat — structured subagent result return.
	if plan.StoreAgg {
		e.resultAgg.StoreSubAgentResult(inst.ParentID, aggResult)
	}

	// Decrement per-parent active child count so the slot can be reused.
	e.agentRegistry.DecrChildCount(inst.ParentID)
}

// publishStructuredOutput uses the configured AgentAdapter to parse the CLI's
// native protocol and emit typed events to the bus.
