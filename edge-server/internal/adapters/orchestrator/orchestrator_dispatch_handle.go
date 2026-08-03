package orchestrator

import (
	"fmt"
	"time"

	"github.com/agenthub/edge-server/internal/agents"
)

// Residual pure-helper peel of dispatchInterceptor.handleDispatch (#1111).

// handleDispatch validates the agent name (O-01), checks the circuit breaker,
// registers the sub-agent, spawns a run, sends a message, and emits events.
func (d *dispatchInterceptor) handleDispatch(evt dispatchEvent, scope map[string]any) {
	if d.adapterRegistry != nil {
		if _, ok := d.adapterRegistry.Get(evt.Agent); !ok {
			d.inner.Emit(BusEventTaskNotification, scope, dispatchErrorPayload(
				evt.Agent, evt.Task, "unknown agent: "+evt.Agent, evt.SubtaskID, "",
			))
			return
		}
	}

	// Check circuit breaker BEFORE registration and spawning.
	// Without this gate, a tripped breaker stops retries of existing failures
	// but does NOT prevent new dispatches to the same failing agent — the
	// orchestrator keeps spawning sub-agents to a known-broken target, each
	// one failing independently and consuming slots until per-parent cap.
	if d.failureRecovery != nil {
		if cbErr := d.failureRecovery.checkCircuitBreaker(evt.Agent); cbErr != nil {
			d.inner.Emit(BusEventTaskNotification, scope, dispatchRejectedPayload(
				evt.Agent, evt.Task, "circuit breaker open: "+cbErr.Error(), evt.SubtaskID,
			))
			return
		}
	}

	agentID := genAgentID()
	now := time.Now().UTC()

	// err is declared early so the deferred Unregister closure (below)
	// can capture it. It is set by SpawnSubAgent on the error path.
	var err error

	role := defaultDispatchRole(evt.Role)

	inst := &agents.AgentInstance{
		ID:        agentID,
		Name:      evt.Agent,
		Role:      role,
		Status:    agents.StatusIdle,
		ParentID:  d.parentRun.ID,
		Depth:     d.depth + 1,
		AgentPath: fmt.Sprintf("/orchestrator/%s", evt.Agent),
		AdapterID: evt.Agent,
		CreatedAt: now,
		LastSeen:  now,
	}

	if d.registry != nil {
		if err := d.registry.Register(inst); err != nil {
			d.inner.Emit(BusEventTaskNotification, scope, dispatchErrorPayload(
				evt.Agent, evt.Task, err.Error(), evt.SubtaskID, agentID,
			))
			return
		}
		// CRITICAL: orchestrator agentID (genAgentID) is a different identity
		// than SpawnSubAgent internal agentInstanceID. SpawnSubAgent cleanup
		// only covers its own registration -- not the orchestrator's. Leaking
		// this entry accumulates stale agents in the registry until restart.
		defer func() {
			if err != nil {
				d.registry.Unregister(agentID)
			}
		}()
	}

	threadID := evt.ThreadID
	if threadID == "" {
		threadID = d.threadID
	}
	model := evt.Model
	if model == "" {
		model = d.model
	}

	var runID string
	if d.spawner != nil {
		task := SubAgentTask{
			TaskID:        "task_" + genHexID(),
			Description:   evt.Task,
			AgentID:       evt.Agent,
			Prompt:        evt.Task,
			Depth:         d.depth + 1,
			ParentRunID:   d.parentRun.ID,
			ThreadID:      threadID,
			Model:         model,
			Budget:        d.budget,
			SiblingAgents: evt.siblings,
		}
		_, runID, err = d.spawner.SpawnSubAgent(d.parentRun, task)
		if err != nil {
			d.inner.Emit(BusEventTaskNotification, scope, dispatchErrorPayload(
				evt.Agent, evt.Task, err.Error(), evt.SubtaskID, agentID,
			))
			return
		}
		if runID != "" && d.registry != nil {
			d.registry.SetRunID(agentID, runID)
			d.registry.SetStatus(agentID, agents.StatusBusy, "")
		}
	}

	if d.queue != nil {
		d.queue.EnsureAgent(agentID, 64)
		d.queue.Send(agents.Message{
			ID:          "msg_" + genHexID(),
			FromAgentID: d.parentRun.ID,
			ToAgentID:   agentID,
			Type:        agents.MsgTypeTask,
			Payload: map[string]any{
				"task":     evt.Task,
				"agent":    evt.Agent,
				"role":     evt.Role,
				"threadId": threadID,
				"model":    model,
			},
			Timestamp: now,
		})
	}

	d.inner.Emit(BusEventTaskDispatched, scope, taskDispatchedPayload(
		agentID, evt.Agent, evt.Task, inst.Role, runID, d.parentRun.ID, threadID, model, evt.SubtaskID,
	))

	// P1: Sub-agent status streaming — emit initial status on dispatch.
	d.inner.Emit(BusEventSubAgentStatus, scope, subAgentStatusPayload(
		agentID, evt.Agent, string(agents.StatusBusy), "dispatched", false, "",
	))

	// P1: Track dispatched sub-agents for progress summary and result injection.
	d.dispatchedMu.Lock()
	d.dispatched[agentID] = evt
	d.dispatchedCount++
	d.dispatchedMu.Unlock()

	// P1: Start the result listener goroutine (once) to receive sub-agent results
	// and inject them back into the orchestrator's stream.
	d.resultListenerOnce.Do(func() {
		if d.ctx != nil && d.queue != nil {
			go d.runResultListener(d.ctx)
		}
	})

	// P1: Emit progress summary on dispatch.
	d.emitProgressSummary(scope)
}
