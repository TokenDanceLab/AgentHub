package adapters

import (
	"context"
	"errors"
	"fmt"
	"log/slog"

	"github.com/agenthub/edge-server/internal/agents"
)

// Residual pure-helper peel of dispatchInterceptor result/progress/plan methods (#1111).

// runResultListener reads the parent orchestrator's message queue for sub-agent
// result/error messages. When a result arrives, it emits status updates, injects
// the result/error as a text block into the orchestrator's stream, and emits an
// aggregate progress summary. Exits when the context is cancelled.
//
// INVARIANT: failureRecovery.RecordCircuitSuccess is only reachable through this
// listener (via handleSubAgentResult), which requires d.queue != nil. If the
// FailureRecoveryManager is created without a message queue, circuit breakers
// will never be reset on success and agents may become permanently tripped.
func (d *dispatchInterceptor) runResultListener(ctx context.Context) {
	// Guard: circuit breaker success recording is gated on the message queue path.
	// If failureRecovery exists but the queue doesn't, successes won't reset
	// circuit breakers — log a warning to surface this configuration gap.
	if d.failureRecovery != nil && d.queue == nil {
		slog.Warn("orchestrator: FailureRecoveryManager created without message queue; circuit breakers will never be reset on success")
		return
	}
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
// For errors, it invokes the failure recovery manager to classify and potentially
// retry, switch agents, or skip the task.
func (d *dispatchInterceptor) handleSubAgentResult(msg agents.Message, isError bool) {
	payload, _ := msg.Payload.(map[string]any)
	agentName := subAgentPayloadString(payload, "agentName")
	agentID := msg.FromAgentID

	// For error results, attempt failure recovery before injecting.
	if isError && d.failureRecovery != nil {
		errMsg := subAgentPayloadString(payload, "result")
		// Guard: if no error details are available, provide a meaningful
		// fallback message so ClassifyFailure does not receive an error
		// with an empty Error() string, which would pass the nil-guard
		// (err != nil is true) but fall through all pattern checks,
		// wrongly defaulting to FailureTransient on a phantom failure.
		if errMsg == "" {
			errMsg = "sub-agent reported error (no details)"
		}

		taskID := subAgentPayloadString(payload, "runId")

		scope := map[string]any{"runId": d.parentRun.ID}
		decision, fErr := d.failureRecovery.HandleSubAgentFailure(
			d.ctx,
			d.parentRun,
			agentID,
			agentName,
			taskID,
			fmt.Errorf("%s", errMsg),
			nil, // no RunError code available from message payload
			d.inner,
			scope,
		)
		// If the context was cancelled during the backoff wait inside
		// HandleSubAgentFailure, stop processing this result and let
		// the result listener loop exit naturally on the next iteration.
		// Without this check, context cancellation is indistinguishable
		// from DecisionSkip — the caller continues processing further
		// sub-agent results instead of stopping all work.
		if fErr != nil && (errors.Is(fErr, context.Canceled) || errors.Is(fErr, context.DeadlineExceeded)) {
			return
		}

		if handled := d.handleRecoveryDecision(decision, scope, agentID, agentName, taskID, errMsg, payload); handled {
			return
		}
	}

	// Record success on the circuit breaker for non-error sub-agent completions.
	// Use agentName (stable across dispatches) as the circuit breaker key,
	// falling back to agentID if agentName is empty.
	if !isError && d.failureRecovery != nil {
		cbKey := agentName
		if cbKey == "" {
			cbKey = agentID
		}
		d.failureRecovery.RecordCircuitSuccess(cbKey)
	}

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

// handleRecoveryDecision applies the failure-recovery decision for a failed
// sub-agent. It returns true when the caller should stop processing this
// result (retry/switch/skip handled), or false when the caller should fall
// through to the normal error injection (DecisionFail).
func (d *dispatchInterceptor) handleRecoveryDecision(decision FailureDecision, scope map[string]any, agentID, agentName, taskID, errMsg string, payload map[string]any) bool {
	switch decision {
	case DecisionRetry:
		// Recovery manager already handled backoff.
		// Inject retry notification with a Reflexion critique so the
		// orchestrator can learn from the failure before re-attempting.
		// The critique follows the Reflexion pattern (Shinn et al., 2023):
		// verbal self-reflection on failure to turn a blind retry into
		// a learning opportunity.
		failureErr := fmt.Errorf("%s", errMsg)
		category, reason := ClassifyFailure(failureErr, nil)
		critique := BuildReflexionCritique(agentName, taskID, category, reason, failureErr)
		// T1-D03: Retry context purification — inject a directive marker
		// into the task description that will flow back to the retried
		// sub-agent via the orchestrator's text stream. This prevents
		// the orchestrator from repeating the same failing approach.
		retryDirective := formatRetryDirective(failureErr)
		retryMsg := formatRetryInjectText(agentName, errMsg, retryDirective, critique)
		d.inner.Emit(BusEventTextBlock, scope, resultInjectPayload(retryMsg, "sub_agent_retry"))
		return true

	case DecisionSwitchAgent:
		// Look up the original dispatch event so we can re-dispatch
		// to the alternate agent with the same task parameters.
		d.dispatchedMu.Lock()
		origEvt, hasOrig := d.dispatched[agentID]
		d.dispatchedMu.Unlock()

		altID := d.failureRecovery.FindAlternateAgentID(agentName)
		if altID != "" && hasOrig {
			switchMsg := formatSwitchInjectText(agentName, altID, errMsg, true)
			d.inner.Emit(BusEventTextBlock, scope, resultInjectPayload(switchMsg, "sub_agent_switch"))
			// Construct a new dispatch event targeting the alternate agent,
			// copying the original task description and parameters.
			newEvt := cloneDispatchForAgent(origEvt, altID)
			d.handleDispatch(newEvt, scope)
		} else {
			switchMsg := formatSwitchInjectText(agentName, altID, errMsg, false)
			d.inner.Emit(BusEventTextBlock, scope, resultInjectPayload(switchMsg, "sub_agent_switch"))
		}
		return true

	case DecisionSkip:
		// Skip: inject skip notification and continue.
		skipMsg := formatSkipInjectText(agentName, errMsg)
		d.inner.Emit(BusEventTextBlock, scope, resultInjectPayload(skipMsg, "sub_agent_skip"))
		// Still emit status update for the skipped agent.
		errStr := ""
		if payload != nil {
			if err, ok := payload["result"].(string); ok {
				errStr = err
			}
		}
		d.inner.Emit(BusEventSubAgentStatus, scope, subAgentStatusPayload(
			agentID, agentName, string(agents.StatusError), "skipped", true, errStr,
		))
		d.emitProgressSummary(scope)
		return true

	case DecisionFail:
		// Inject reflexion critique before falling through to the
		// normal error injection, so the orchestrator SEES the
		// failure analysis even when depth limit prevents retry.
		failureErr := fmt.Errorf("%s", errMsg)
		category, reason := ClassifyFailure(failureErr, nil)
		critique := BuildReflexionCritique(agentName, taskID, category, reason, failureErr)
		failMsg := formatFailInjectText(agentName, errMsg, critique)
		d.inner.Emit(BusEventTextBlock, scope, resultInjectPayload(failMsg, "sub_agent_fail"))
		// Fall through to the normal error injection below.
		return false

	default:
		return false
	}
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
