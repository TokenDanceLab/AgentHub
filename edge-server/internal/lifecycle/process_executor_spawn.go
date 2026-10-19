package lifecycle

import (
	"log/slog"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/store"
)

func (e *ProcessExecutor) SpawnSubAgent(parentRun store.Run, task adapters.SubAgentTask) (agentInstanceID string, runID string, err error) {
	// Atomically check and reserve a spawn slot under the same write lock.
	// This prevents the TOCTOU race where two concurrent goroutines both pass
	// CanSpawn (seeing count=4) and both subsequently increment, exceeding
	// MaxChildrenPerAgent=5.
	slotReserved := false
	if e.agentRegistry != nil {
		if reserveErr := e.agentRegistry.TryReserveSlot(parentRun.ID, task.Depth); reserveErr != nil {
			slog.Warn("spawn slot rejected", "parentRunId", parentRun.ID, "taskId", task.TaskID, "depth", task.Depth, "error", reserveErr)
			return "", "", reserveErr
		}
		slotReserved = true
	}

	// Deferred cleanup: release the reserved slot on any error exit path.
	// On success, the slot is released by sendSubAgentResult when the child
	// run completes (keeps increment/decrement pair lexically close).
	defer func() {
		if err != nil && slotReserved {
			e.agentRegistry.DecrChildCount(parentRun.ID)
		}
	}()

	runID, agentInstanceID = subAgentRunID(task.TaskID), subAgentInstanceID(task.TaskID)

	// Resolve ThreadID: each sub-agent MUST have its own distinct thread so
	// that its context space is fully isolated from the parent. If the task
	// provides an explicit ThreadID we use it; otherwise we create a
	// hierarchical child thread ID derived from the parent ThreadID.
	// This prevents context contamination between parent and child.
	threadID := resolveSubAgentThreadID(parentRun.ThreadID, runID, task.ThreadID)

	// Create the run in the store
	run, createErr := e.store.(store.Writer).CreateRun(runID, parentRun.ProjectID, threadID)
	if createErr != nil {
		slog.Error("failed to create sub-agent run", "taskId", task.TaskID, "error", createErr)
		err = createErr
		return "", "", err
	}

	// Register the child agent instance in the agent registry with its own
	// context scope. This ensures budget tracking in publishStructuredOutput
	// monitors only the child's tokens, and parent/child results are
	// independently routed via the message queue.
	registered := false
	if e.agentRegistry != nil {
		inst := newSubAgentInstance(parentRun.ID, agentInstanceID, runID, threadID, task, time.Now())
		regErr := e.agentRegistry.Register(inst)
		registered = regErr == nil
		if regErr != nil {
			slog.Warn("failed to register sub-agent instance in registry", "agentInstanceId", agentInstanceID, "error", regErr)
		}
	}

	// Emit run.queued
	e.bus.Publish("run.queued", runScope(run), run)

	// Parent workDir lookup stays here; pure runCtx composition is buildSubAgentRunContext.
	e.mu.Lock()
	parentWorkDir := e.workDirs[parentRun.ID]
	e.mu.Unlock()
	runCtx := buildSubAgentRunContext(run, task, threadID, parentWorkDir)

	// Store the run-to-agent mapping so result aggregation can find the agent later.
	e.mu.Lock()
	e.runToAgent[runID] = agentInstanceID
	e.mu.Unlock()

	// Start the run
	if startErr := e.Start(run, runCtx); startErr != nil {
		slog.Error("failed to start sub-agent run", "runId", runID, "error", startErr)
		e.mu.Lock()
		delete(e.runToAgent, runID)
		e.mu.Unlock()

		// Cleanup on start failure: unregister the agent instance,
		// mark the run as failed, and release the reserved slot.
		// Set slotReserved=false BEFORE Unregister to prevent the
		// deferred DecrChildCount from double-decrementing.
		// Unregister already decrements childrenCount internally.
		if registered {
			slotReserved = false
			e.agentRegistry.Unregister(agentInstanceID)
		}
		_, _ = e.store.SetRunStatus(runID, "failed")

		err = startErr
		return "", "", err
	}

	// Start the parent's sub-agent timeout clock in the result aggregator so
	// the collector timeout fallback can emit partial results if a child hangs.
	if e.resultAgg != nil {
		e.resultAgg.RecordSubAgentSpawn(parentRun.ID)
	}

	return agentInstanceID, runID, nil
}
