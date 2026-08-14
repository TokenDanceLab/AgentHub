package orchestrator

import (
	"context"
	"log/slog"

	"github.com/agenthub/edge-server/internal/agents"
)

// Residual pure-helper peel of dispatchInterceptor result/progress/plan methods (#1111).

// runResultListener reads the parent orchestrator's message queue for sub-agent
// result/error messages. When a result arrives, it emits status updates, injects
// the result/error as a text block into the orchestrator's stream, and emits an
// aggregate progress summary. Exits when the context is cancelled.
func (d *dispatchInterceptor) runResultListener(ctx context.Context) {
	ch := d.queue.Receive(d.parentRun.ID)
	if ch == nil {
		return
	}
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			d.processResultMessage(msg)
		}
	}
}

// processResultMessage handles a single sub-agent result or error message from
// the parent queue, injecting it into the orchestrator's text stream.
func (d *dispatchInterceptor) processResultMessage(msg agents.Message) {
	switch msg.Type {
	case agents.MsgTypeResult:
		d.handleSubAgentResult(msg, false)
	case agents.MsgTypeError:
		d.handleSubAgentResult(msg, true)
	}
}

// handleSubAgentResult injects a sub-agent result or error as a system message
// into the orchestrator's text stream, emits a status update, and updates progress.
// Failure handling is in-context: the orchestrator model sees the injected
// result/error text and self-corrects (retry / switch / skip) without an
// external recovery state machine.
func (d *dispatchInterceptor) handleSubAgentResult(msg agents.Message, isError bool) {
	payload, _ := msg.Payload.(map[string]any)
	agentName := subAgentPayloadString(payload, "agentName")
	agentID := msg.FromAgentID

	scope := map[string]any{"runId": d.parentRun.ID}
	d.emitSubAgentResult(scope, agentID, agentName, isError, payload)
}

// emitSubAgentResult injects the sub-agent result/error as a text block into
// the orchestrator's stream and emits the status update plus the aggregate
// progress summary.
func (d *dispatchInterceptor) emitSubAgentResult(scope map[string]any, agentID, agentName string, isError bool, payload map[string]any) {
	// Build the injected message following OpenCode's XML task result injection pattern.
	errMsg := subAgentPayloadString(payload, "result")
	resultSummary := ""
	if !isError {
		resultSummary = formatResultSummary(payload)
	}
	injectedText := formatSubAgentResultInjectText(agentName, isError, errMsg, resultSummary)

	// P1: Inject result/error into the orchestrator's text stream.
	d.inner.Emit(BusEventTextBlock, scope, resultInjectPayload(injectedText, "sub_agent_result"))

	// P1: Emit sub-agent status update.
	status := string(agents.StatusCompleted)
	errStr := ""
	if isError {
		status = string(agents.StatusError)
		errStr = errMsg
	}
	d.inner.Emit(BusEventSubAgentStatus, scope, subAgentStatusPayload(
		agentID, agentName, status, status, true, errStr,
	))

	// P1: Emit aggregate progress summary.
	d.emitProgressSummary(scope)
}

// subAgentPayloadString extracts a string field from a sub-agent result
// payload, returning "" when the payload or field is missing/not a string.
func subAgentPayloadString(payload map[string]any, key string) string {
	if payload == nil {
		return ""
	}
	if v, ok := payload[key].(string); ok {
		return v
	}
	return ""
}

// emitProgressSummary counts sub-agents by status and emits a human-readable
// progress summary. Fires whenever a sub-agent status changes (dispatch or completion).
func (d *dispatchInterceptor) emitProgressSummary(scope map[string]any) {
	if d.registry == nil {
		return
	}
	children := d.registry.ListByParent(d.parentRun.ID)
	if len(children) == 0 {
		return
	}

	counts := countChildStatuses(children)
	summary := formatProgressSummaryText(counts)
	d.inner.Emit(BusEventTaskProgress, scope, taskProgressPayload(
		summary, counts.completed, counts.errored, counts.running, counts.waiting, counts.total,
	))
}

// awaitPlanApproval implements the plan confirmation gate (P0 #3).
// When the plan broker is configured, it builds a plan from the detected dispatch
// events, emits a plan.proposed event, and blocks until the user approves or rejects.
// Returns true if the plan is approved (or approval gate is disabled), false if rejected.
func (d *dispatchInterceptor) awaitPlanApproval(events []dispatchEvent, scope map[string]any) bool {
	if d.planBroker == nil {
		return true // approval gate not configured
	}

	plan := buildPendingPlanFromDispatches(d.parentRun, events)
	tasks := plan.Tasks
	mode := plan.Mode

	// Emit plan.proposed so the frontend can render the approval UI.
	d.inner.Emit(BusEventPlanProposed, scope, planProposedPayload(plan.RunID, tasks, mode))

	// Register the plan with the broker and wait for user decision.
	wait, ok := d.planBroker.SubmitPlan(d.ctx, plan)
	if !ok {
		slog.Warn("plan approval: failed to submit plan, proceeding without approval",
			"runId", plan.RunID,
		)
		return true
	}

	decision := wait(d.ctx)

	if decision.Approved {
		slog.Info("plan approval: plan approved",
			"runId", plan.RunID,
			"taskCount", len(tasks),
		)
		d.inner.Emit(BusEventPlanApproved, scope, planDecisionPayload(plan.RunID, decision.Reason))
		return true
	}

	slog.Info("plan approval: plan rejected",
		"runId", plan.RunID,
		"reason", decision.Reason,
	)
	d.inner.Emit(BusEventPlanRejected, scope, planDecisionPayload(plan.RunID, decision.Reason))

	// Inject rejection notification into the orchestrator's text stream
	// so it knows the plan was not executed.
	d.inner.Emit(BusEventTextBlock, scope, resultInjectPayload(
		formatPlanRejectedInjectText(decision.Reason), "plan_gate",
	))

	return false
}
