package lifecycle

import (
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/store"
)

// Residual pure-helper peel #1121: domain pure helpers extracted from
// process_executor_pure.go. Same package lifecycle; zero behavior change.

// newSubAgentRunContext builds the isolated RunProcessContext for a dispatched
// sub-agent. SessionID is a fresh random UUID — the claude-code CLI validates
// --session-id as a UUID and the gateway rejects hierarchical thread paths
// like "parent/sub/run_x" ("Invalid session ID. Must be a valid UUID"). The
// ThreadID stays hierarchical (stored on the run), so context isolation is
// preserved without poisoning the CC session argument.
func newSubAgentRunContext(run store.Run, task adapters.SubAgentTask) RunProcessContext {
	return RunProcessContext{
		Run:       run,
		Prompt:    task.Prompt,
		AgentID:   task.AgentID,
		Budget:    childBudget(task.Budget, task.Depth),
		Model:     task.Model,
		SessionID: newRandomSessionID(),
	}
}

// withSiblingSystemPrompt prepends a sibling-context prompt when the task lists
// parallel sibling agents.
func withSiblingSystemPrompt(existing string, siblingAgents []adapters.SiblingInfo) string {
	if len(siblingAgents) == 0 {
		return existing
	}
	return appendSystemPromptPrefix(existing, adapters.BuildSiblingContextPrompt(siblingAgents))
}

// shouldDeliverSubAgentResult reports whether result delivery plumbing is configured.
func shouldDeliverSubAgentResult(hasRegistry, hasQueue bool) bool {
	return hasRegistry && hasQueue
}

// shouldRouteSubAgentToParent reports whether a registry instance has a parent to notify.
func shouldRouteSubAgentToParent(found bool, parentID string) bool {
	return found && parentID != ""
}

// shouldReleaseReservedSpawnSlot reports whether a deferred spawn-slot release
// should run (error path while the slot is still reserved).
func shouldReleaseReservedSpawnSlot(err error, slotReserved bool) bool {
	return err != nil && slotReserved
}

// shouldUnregisterOnStartFailure reports whether a successfully registered
// sub-agent instance should be unregistered after Start fails.
func shouldUnregisterOnStartFailure(registered bool) bool {
	return registered
}

// buildSubAgentResult packages a completed child run for the result aggregator.
// completedAt is injected so the helper stays pure.
func buildSubAgentResult(agentID, agentName, runID, status string, output any, completedAt time.Time) SubAgentResult {
	return SubAgentResult{
		AgentID:     agentID,
		AgentName:   agentName,
		RunID:       runID,
		Status:      status,
		Output:      output,
		CompletedAt: completedAt,
	}
}

// shouldCascadeAgentShutdown reports whether finish should cascade-terminate
// descendant sub-agents via the registry.
func shouldCascadeAgentShutdown(hasRegistry bool) bool {
	return hasRegistry
}

// shouldStoreSubAgentAggregatorResult reports whether a completed child result
// should be written into the result aggregator.
func shouldStoreSubAgentAggregatorResult(hasAggregator bool) bool {
	return hasAggregator
}

// shouldReserveSpawnSlot reports whether SpawnSubAgent should consult the
// registry for a TOCTOU-safe child slot reservation.
func shouldReserveSpawnSlot(hasRegistry bool) bool {
	return hasRegistry
}

// shouldRegisterSubAgentInstance reports whether a child agent instance should
// be registered in the agent registry.
func shouldRegisterSubAgentInstance(hasRegistry bool) bool {
	return hasRegistry
}

// buildSubAgentResultMessage builds the inter-agent result/error message for a
// completed child run. timestamp is injected so the helper stays pure.
func buildSubAgentResultMessage(
	runID, agentID, agentName, parentID, status string,
	sanitizedResult any,
	sanitizeReason string,
	timestamp time.Time,
) agents.Message {
	return agents.Message{
		ID:          subAgentMessageID(runID),
		FromAgentID: agentID,
		ToAgentID:   parentID,
		Type:        subAgentResultMsgType(status),
		TriggerTurn: true, // wake parent orchestrator on sub-agent completion
		Payload: subAgentResultQueuePayload(
			runID, status, agentID, agentName, sanitizedResult, sanitizeReason,
		),
		Timestamp: timestamp,
	}
}

// shouldClearRunAgentMappingOnStartFailure reports whether SpawnSubAgent should
// drop the run→agent map entry after Start fails.
func shouldClearRunAgentMappingOnStartFailure(startErr error) bool {
	return startErr != nil
}

// shouldLogSpawnSlotRejection reports whether TryReserveSlot rejected the spawn.
func shouldLogSpawnSlotRejection(err error) bool {
	return err != nil
}

// shouldLogSubAgentCreateFailure reports whether CreateRun failed for a spawn.
func shouldLogSubAgentCreateFailure(err error) bool {
	return err != nil
}

// shouldLogSubAgentRegisterFailure reports whether registry Register failed for
// a spawned child (non-fatal; spawn continues without registry tracking).
func shouldLogSubAgentRegisterFailure(err error) bool {
	return err != nil
}

// subAgentSpawnIDs builds the stable run and agent-instance IDs for a task.
func subAgentSpawnIDs(taskID string) (runID, agentInstanceID string) {
	return subAgentRunID(taskID), subAgentInstanceID(taskID)
}

// shouldLookupSubAgentMapping reports whether a run→agent map entry was found
// for result delivery.
func shouldLookupSubAgentMapping(found bool) bool {
	return found
}

// shouldMarkSubAgentRegistered reports whether registry Register succeeded so
// start-failure cleanup must Unregister the child.
func shouldMarkSubAgentRegistered(err error) bool {
	return err == nil
}

// evaluateSpawnSlotReservation maps a TryReserveSlot result to reserved/reject
// without touching registry state. hasRegistry gates the call site.
func evaluateSpawnSlotReservation(hasRegistry bool, reserveErr error) (reserved bool, reject error) {
	if !shouldReserveSpawnSlot(hasRegistry) {
		return false, nil
	}
	if shouldLogSpawnSlotRejection(reserveErr) {
		return false, reserveErr
	}
	return true, nil
}

// evaluateSubAgentRegistration maps a registry Register result to registered /
// logFailure flags. hasRegistry gates the call site.
func evaluateSubAgentRegistration(hasRegistry bool, regErr error) (registered, logFailure bool) {
	if !shouldRegisterSubAgentInstance(hasRegistry) {
		return false, false
	}
	if shouldLogSubAgentRegisterFailure(regErr) {
		return false, true
	}
	return shouldMarkSubAgentRegistered(regErr), false
}

// slotReservedAfterUnregister clears the reserved flag when Unregister will
// already DecrChildCount, preventing the deferred release from double-decrementing.
func slotReservedAfterUnregister(registered, slotReserved bool) bool {
	if shouldUnregisterOnStartFailure(registered) {
		return false
	}
	return slotReserved
}

// spawnStartFailurePlan is the pure cleanup plan when SpawnSubAgent's Start fails.
type spawnStartFailurePlan struct {
	ClearMapping bool
	Unregister   bool
	SlotReserved bool
}

// planSpawnStartFailureCleanup maps Start failure + registration state into the
// cleanup flags used before returning the error. SlotReserved is the value to
// assign back to the deferred release flag (false when Unregister will Decr).
func planSpawnStartFailureCleanup(startErr error, registered, slotReserved bool) spawnStartFailurePlan {
	if !shouldClearRunAgentMappingOnStartFailure(startErr) {
		return spawnStartFailurePlan{SlotReserved: slotReserved}
	}
	return spawnStartFailurePlan{
		ClearMapping: true,
		Unregister:   shouldUnregisterOnStartFailure(registered),
		SlotReserved: slotReservedAfterUnregister(registered, slotReserved),
	}
}

// subAgentResultDeliveryPlan is the pure delivery plan for sendSubAgentResult.
type subAgentResultDeliveryPlan struct {
	Deliver        bool
	UpdateRegistry bool
	RegistryStatus agents.Status
	StoreAgg       bool
}

// planSubAgentResultDelivery decides whether to deliver a result message, update
// the agent registry terminal status, and store into the result aggregator.
// Sanitization and queue I/O stay in the executor.
func planSubAgentResultDelivery(
	hasRegistry, hasQueue, mappingFound, agentFound bool,
	parentID, status string,
	hasAggregator bool,
) subAgentResultDeliveryPlan {
	if !shouldDeliverSubAgentResult(hasRegistry, hasQueue) {
		return subAgentResultDeliveryPlan{}
	}
	if !shouldLookupSubAgentMapping(mappingFound) {
		return subAgentResultDeliveryPlan{}
	}
	if !shouldRouteSubAgentToParent(agentFound, parentID) {
		return subAgentResultDeliveryPlan{}
	}
	regStatus, update := subAgentRegistryTerminalStatus(status)
	return subAgentResultDeliveryPlan{
		Deliver:        true,
		UpdateRegistry: update,
		RegistryStatus: regStatus,
		StoreAgg:       shouldStoreSubAgentAggregatorResult(hasAggregator),
	}
}

// spawnSlotReservePlan is the pure registry presence gate before TryReserveSlot.
type spawnSlotReservePlan struct {
	Try bool
}

// planSpawnSlotReserve reports whether SpawnSubAgent should call TryReserveSlot.
func planSpawnSlotReserve(hasRegistry bool) spawnSlotReservePlan {
	return spawnSlotReservePlan{Try: shouldReserveSpawnSlot(hasRegistry)}
}

// spawnSlotRejectLogPlan is the pure spawn-slot rejection log gate.
type spawnSlotRejectLogPlan struct {
	Log bool
}

// planSpawnSlotRejectLog reports whether a rejected spawn slot should be warned.
func planSpawnSlotRejectLog(err error) spawnSlotRejectLogPlan {
	return spawnSlotRejectLogPlan{Log: shouldLogSpawnSlotRejection(err)}
}

// spawnSlotReleasePlan is the pure deferred DecrChildCount gate on spawn error paths.
type spawnSlotReleasePlan struct {
	Release bool
}

// planSpawnSlotRelease reports whether the deferred spawn cleanup should DecrChildCount.
func planSpawnSlotRelease(err error, slotReserved bool) spawnSlotReleasePlan {
	return spawnSlotReleasePlan{Release: shouldReleaseReservedSpawnSlot(err, slotReserved)}
}

// subAgentCreateLogPlan is the pure CreateRun failure log gate for SpawnSubAgent.
type subAgentCreateLogPlan struct {
	Log bool
}

// planSubAgentCreateLog reports whether a sub-agent CreateRun error should be logged.
func planSubAgentCreateLog(err error) subAgentCreateLogPlan {
	return subAgentCreateLogPlan{Log: shouldLogSubAgentCreateFailure(err)}
}

// subAgentRegisterPlan is the pure registry presence gate before Register.
type subAgentRegisterPlan struct {
	Register bool
}

// planSubAgentRegister reports whether SpawnSubAgent should Register a child instance.
func planSubAgentRegister(hasRegistry bool) subAgentRegisterPlan {
	return subAgentRegisterPlan{Register: shouldRegisterSubAgentInstance(hasRegistry)}
}

// subAgentInstanceLookupPlan is the pure gate before registry.Get in sendSubAgentResult.
type subAgentInstanceLookupPlan struct {
	Lookup bool
}

// planSubAgentInstanceLookup reports whether sendSubAgentResult should call
// agentRegistry.Get for the run→agent mapping.
func planSubAgentInstanceLookup(hasRegistry, mappingFound bool) subAgentInstanceLookupPlan {
	return subAgentInstanceLookupPlan{Lookup: hasRegistry && mappingFound}
}

// parentIDFromAgentInstance returns ParentID when inst is non-nil; empty otherwise.
// Keeps nil-deref free of orchestration in sendSubAgentResult.
func parentIDFromAgentInstance(inst *agents.AgentInstance) string {
	if inst == nil {
		return ""
	}
	return inst.ParentID
}

// buildSubAgentRunContext composes the pure sub-agent RunProcessContext from
// task fields, parent workdir memory, and sibling system prompt. Map/IO stays
// in SpawnSubAgent (parent workdir lookup).
func buildSubAgentRunContext(run store.Run, task adapters.SubAgentTask, threadID, parentWorkDir string) RunProcessContext {
	runCtx := newSubAgentRunContext(run, task)
	runCtx = applyParentWorkDirMemory(runCtx, parentWorkDir, threadID, task.AgentID)
	runCtx.AppendSystemPrompt = withSiblingSystemPrompt(runCtx.AppendSystemPrompt, task.SiblingAgents)
	return runCtx
}

// spawnSlotRejectPlan is the pure reject path after evaluateSpawnSlotReservation.
type spawnSlotRejectPlan struct {
	Reject bool
	Log    bool
}

// planSpawnSlotReject maps a non-nil reject error into reject/log flags.
// evaluateSpawnSlotReservation already filters non-reject cases; reject!=nil
// always logs (same as shouldLogSpawnSlotRejection for non-nil err).
func planSpawnSlotReject(reject error) spawnSlotRejectPlan {
	if reject == nil {
		return spawnSlotRejectPlan{}
	}
	return spawnSlotRejectPlan{Reject: true, Log: shouldLogSpawnSlotRejection(reject)}
}

// subAgentRegistrationOutcome is the pure Register result after registry.Register.
type subAgentRegistrationOutcome struct {
	Registered bool
	LogFailure bool
}

// planSubAgentRegistrationOutcome maps a Register error when the registry path
// was taken (hasRegistry=true at call site).
func planSubAgentRegistrationOutcome(regErr error) subAgentRegistrationOutcome {
	registered, logFailure := evaluateSubAgentRegistration(true, regErr)
	return subAgentRegistrationOutcome{Registered: registered, LogFailure: logFailure}
}

// spawnStartLogPlan reports whether a Start error should be logged.
type spawnStartLogPlan struct {
	Log bool
}

// planSpawnStartLog reports whether a Start error should be logged.
func planSpawnStartLog(startErr error) spawnStartLogPlan {
	return spawnStartLogPlan{Log: startErr != nil}
}

// prepareSubAgentResultOutbound sanitizes payload and builds the queue message plus
// aggregator result for sendSubAgentResult. Queue/registry I/O stays in the executor.
func prepareSubAgentResultOutbound(
	payload any,
	runID, agentID, agentName, parentID, status string,
	now time.Time,
) (agents.Message, SubAgentResult) {
	sanitizedResult, sanitizeReason := SanitizeSubAgentResult(payload)
	msg := buildSubAgentResultMessage(
		runID, agentID, agentName, parentID, status, sanitizedResult, sanitizeReason, now,
	)
	agg := buildSubAgentResult(
		agentID,
		agentName,
		runID,
		status,
		aggregatorOutput(payload, sanitizedResult, sanitizeReason),
		now,
	)
	return msg, agg
}
