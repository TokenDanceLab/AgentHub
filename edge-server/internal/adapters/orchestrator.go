package adapters

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/store"
)

const (
	// DefaultDispatchConcurrency is the default maximum number of concurrent
	// sub-agent dispatch goroutines. Matches OpenCode default tool concurrency of 10.
	DefaultDispatchConcurrency = 10
)

// OrchestratorAdapter wraps a ClaudeCodeAdapter with an orchestrator system prompt.
// It is used in group-chat mode to decompose complex tasks and dispatch sub-agents.
//
// The orchestrator is Claude Code with a specialized system prompt that instructs
// it to break down user requests, identify sub-tasks, and coordinate other agents.
// Edge listens for orchestrator events to spawn sub-agent runs.
type OrchestratorAdapter struct {
	inner               *ClaudeCodeAdapter
	systemPrompt        string
	agentRegistry       *agents.Registry
	adapterRegistry     *Registry
	messageQueue        *agents.Queue
	spawner             SubAgentSpawner
	depth               int
	parentModel         string
	dispatchConcurrency int

	// Plan approval gate (P0 #3): when non-nil, the orchestrator pauses after
	// detecting dispatch events and waits for user approval before spawning sub-agents.
	planBroker *PlanApprovalBroker
}

// NewOrchestratorAdapter creates an orchestrator wrapping a Claude Code instance.
func NewOrchestratorAdapter(claudePath, model, systemPrompt string, subAgents []string) *OrchestratorAdapter {
	_ = subAgents
	return &OrchestratorAdapter{
		inner:        NewClaudeCodeAdapter(claudePath, model, ""),
		systemPrompt: escapePromptLiteral(systemPrompt),
		depth:        0,
	}
}

// WithAgentRegistry attaches an agent instance registry for tracking sub-agents.
func (a *OrchestratorAdapter) WithAgentRegistry(r *agents.Registry) *OrchestratorAdapter {
	a.agentRegistry = r
	return a
}

// WithMessageQueue attaches a message queue for inter-agent communication.
func (a *OrchestratorAdapter) WithMessageQueue(q *agents.Queue) *OrchestratorAdapter {
	a.messageQueue = q
	return a
}

// WithSpawner attaches a SubAgentSpawner for creating sub-agent runs.
func (a *OrchestratorAdapter) WithSpawner(s SubAgentSpawner) *OrchestratorAdapter {
	a.spawner = s
	return a
}

// WithDepth sets the delegation depth for this orchestrator instance.
func (a *OrchestratorAdapter) WithDepth(d int) *OrchestratorAdapter {
	a.depth = d
	return a
}

// WithDispatchConcurrency sets the max concurrent dispatch goroutines.
// Values <= 0 use DefaultDispatchConcurrency (10, matching OpenCode default).
func (a *OrchestratorAdapter) WithDispatchConcurrency(n int) *OrchestratorAdapter {
	a.dispatchConcurrency = n
	return a
}

// WithAdapterRegistry attaches the adapter registry for agent name validation (O-01).
func (a *OrchestratorAdapter) WithAdapterRegistry(r *Registry) *OrchestratorAdapter {
	a.adapterRegistry = r
	return a
}

// WithPlanBroker attaches the plan approval broker for the plan confirmation gate (P0 #3).
// When set, the orchestrator pauses after detecting dispatch events and waits for
// user approval before spawning sub-agents.
func (a *OrchestratorAdapter) WithPlanBroker(b *PlanApprovalBroker) *OrchestratorAdapter {
	a.planBroker = b
	return a
}

func (a *OrchestratorAdapter) Metadata() AdapterMetadata {
	m := a.inner.Metadata()
	m.ID = "orchestrator"
	m.Name = "Orchestrator"
	m.Description = "Orchestrator Agent - decomposes tasks, dispatches sub-agents, aggregates results"
	return m
}

func (a *OrchestratorAdapter) Capabilities() AgentCapabilities {
	c := a.inner.Capabilities()
	c.SubAgentSpawn = true
	return c
}

func (a *OrchestratorAdapter) BuildCommand(ctx RunProcessContext) (string, []string, []string, string) {
	cmdPath, args, env, workDir := a.inner.BuildCommand(ctx)
	a.parentModel = ctx.Model
	// Use --append-system-prompt (not --system-prompt) to avoid silently
	// discarding the agent profile's system prompt. Claude Code concatenates
	// multiple --append-system-prompt values, so both the agent's profile
	// prompt AND the orchestrator's orchestration instructions are included.
	if a.systemPrompt != "" {
		args = append(args, "--append-system-prompt", a.systemPrompt)
	}
	return cmdPath, args, env, workDir
}

func (a *OrchestratorAdapter) ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) error {
	effectiveEmitter := emitter
	if a.agentRegistry != nil || a.spawner != nil {
		if a.messageQueue != nil {
			a.messageQueue.EnsureAgent(run.ID, 64)
		}
		// Build failure recovery manager if adapter registry is available.
		var frm *FailureRecoveryManager
		if a.adapterRegistry != nil && a.spawner != nil {
			frm = NewFailureRecoveryManager(a.adapterRegistry, a.spawner)
		}
		effectiveEmitter = &dispatchInterceptor{
			inner:           emitter,
			registry:        a.agentRegistry,
			adapterRegistry: a.adapterRegistry,
			queue:           a.messageQueue,
			spawner:         a.spawner,
			parentRun:       run,
			depth:           a.depth,
			threadID:        run.ThreadID,
			model:           a.parentModel,
			maxConcurrency:  a.dispatchConcurrency,
			ctx:             ctx,
			dispatched:      make(map[string]dispatchEvent),
			planBroker:      a.planBroker,
			failureRecovery: frm,
		}
		if budget, ok := ctx.Value(CtxBudgetKey).(*runnerctx.ContextBudget); ok {
			effectiveEmitter.(*dispatchInterceptor).budget = budget
		}
	}
	return a.inner.ParseStream(ctx, stdout, stdin, effectiveEmitter, run)
}

func (a *OrchestratorAdapter) NeedsStdin() bool { return true }

func (a *OrchestratorAdapter) Available() bool {
	available := a.inner.Available()
	slog.Debug("adapter.availability", "adapter", "orchestrator", "path", a.inner.binaryPath, "available", available)
	return available
}

// --- dispatch interception ---

// dispatchInterceptor wraps an EventEmitter to detect dispatch events.
type dispatchInterceptor struct {
	inner           EventEmitter
	registry        *agents.Registry
	adapterRegistry *Registry
	queue           *agents.Queue
	spawner         SubAgentSpawner
	parentRun       store.Run
	depth           int
	threadID        string
	model           string
	budget          *runnerctx.ContextBudget
	maxConcurrency  int

	// Plan approval gate (P0 #3): when planBroker is non-nil, the interceptor
	// pauses after detecting dispatch events and emits a plan.proposed event.
	// It then blocks until the user approves or rejects the plan, or the
	// auto-approve timeout fires. When nil, dispatches proceed immediately.
	planBroker *PlanApprovalBroker

	// Sub-agent result injection and status tracking.
	ctx                context.Context // set from ParseStream; cancelled when run ends
	resultListenerOnce sync.Once       // ensures result listener starts exactly once
	dispatchedMu       sync.Mutex
	dispatchedCount    int                      // total sub-agents dispatched by this interceptor
	dispatched         map[string]dispatchEvent // agentID -> original dispatch event for result injection

	// Failure degradation: classifies sub-agent errors and drives recovery
	// (retry / switch / skip / fail).
	failureRecovery *FailureRecoveryManager

	// textBuffer accumulates streamed text deltas to prevent dispatch JSON
	// fragmentation across BusEventTextDelta events (ISSUE 3.2).
	// Reset on BusEventTextBlock or after successful dispatch detection.
	textBuffer strings.Builder
}

func (d *dispatchInterceptor) Emit(eventType string, scope map[string]any, payload any) {
	d.inner.Emit(eventType, scope, payload)
	switch eventType {
	case BusEventTextBlock:
		d.textBuffer.Reset()
		d.scanForDispatch(payload, scope)
	case BusEventTextDelta:
		text := extractTextContent(payload)
		if text != "" {
			d.textBuffer.WriteString(text)
		}
		// Scan the FULL accumulated buffer to catch JSON lines split
		// across deltas (ISSUE 3.2).
		d.scanTextForDispatch(d.textBuffer.String(), scope)
	}
}

// scanForDispatch collects dispatch events from a payload and fans out
// multiple dispatches concurrently. Used for BusEventTextBlock (complete blocks).
func (d *dispatchInterceptor) scanForDispatch(payload any, scope map[string]any) {
	text := extractTextContent(payload)
	if text == "" {
		return
	}
	d.scanTextForDispatch(text, scope)
}

// scanTextForDispatch scans pre-extracted text for dispatch events.
// Used directly for buffered TextDelta accumulation to prevent JSON
// lines split across deltas from being silently skipped (ISSUE 3.2).
func (d *dispatchInterceptor) scanTextForDispatch(text string, scope map[string]any) {
	// T2-A08: Rule engine pre-processing layer — intercept simple
	// termination/completion signals before JSON dispatch parsing.
	if d.applyRuleEngine(text, scope) {
		return // rule engine consumed the decision
	}

	events := parseDispatchEvents(text)
	if len(events) == 0 {
		return
	}

	// Plan approval gate (P0 #3): pause and wait for user decision.
	if !d.awaitPlanApproval(events, scope) {
		return // plan was rejected or cancelled
	}

	// T2-A08: Apply rule engine to parsed dispatch events for
	// trivial routing optimization (single-finish skip, same-agent sequential).
	events = d.ruleEnginePreprocess(events, scope)
	if len(events) == 0 {
		return
	}

	if len(events) == 1 {
		d.handleDispatch(events[0], scope)
		return
	}

	d.fanOutDispatches(events, scope)
}

// applyRuleEngine scans raw text for simple termination/completion signals
// that can be handled deterministically without JSON dispatch parsing.
// Returns true if the text was consumed (short-circuited).
//
// Rules (evaluated in order):
//  1. Done/finish detection: matches standalone completion signals (e.g. "done",
//     "finish", "all tasks done") and emits aggregate progress events.
//  2. Simple yes/no: when a plan approval is pending, standalone decision
//     keywords (yes/no/approve/reject/deny) short-circuit the JSON parse.
func (d *dispatchInterceptor) applyRuleEngine(text string, scope map[string]any) bool {
	textLower := strings.ToLower(strings.TrimSpace(text))

	// Rule 1: Done/finish/completion detection.
	if matchCompletion(textLower) {
		slog.Info("orchestrator: rule engine completion signal, short-circuiting",
			"runId", d.parentRun.ID,
		)
		d.emitProgressSummary(scope)
		d.inner.Emit(BusEventTextBlock, scope, ruleEngineCompletionPayload())
		return true
	}

	// Rule 2: Standalone yes/no/approve/reject for pending plan decisions.
	if d.planBroker != nil && matchDecisionKeyword(textLower) {
		slog.Info("orchestrator: rule engine decision keyword, skipping JSON parse",
			"runId", d.parentRun.ID,
		)
		return true
	}

	return false
}

// ruleEnginePreprocess applies optimization rules to already-parsed dispatch
// events before fan-out. Returns the filtered/optimized event slice.
//
// Rules (evaluated in order):
//  1. Single "finish" dispatch with no sub-tasks: skip fanOut entirely.
//  2. All dispatches target the same agent: execute sequentially to avoid
//     intra-agent contention (no benefit from parallel fanOut).
func (d *dispatchInterceptor) ruleEnginePreprocess(events []dispatchEvent, scope map[string]any) []dispatchEvent {
	if len(events) == 0 {
		return events
	}

	// Rule 1: Single "finish" dispatch with no actual sub-task work.
	// When the orchestrator emits a lone dispatch with a finish-like
	// description and no task payload, skip fanOut to save resources.
	if len(events) == 1 && isFinishDispatch(events[0]) {
		slog.Info("orchestrator: rule engine skipping single finish dispatch",
			"runId", d.parentRun.ID,
			"agent", events[0].Agent,
		)
		d.emitProgressSummary(scope)
		return nil
	}

	// Rule 2: All dispatches to the same agent — run sequentially.
	// Parallel fanOut provides no benefit when all dispatches target
	// the same agent (they share one adapter and serialize anyway).
	if allSameAgent(events) {
		slog.Info("orchestrator: rule engine sequential fanOut for same-agent batch",
			"runId", d.parentRun.ID,
			"agent", events[0].Agent,
			"count", len(events),
		)
		d.fanOutSequential(events, scope)
		return nil
	}

	return events
}

// fanOutSequential executes dispatch events one at a time for same-agent
// batches where parallel execution would cause intra-agent contention.
// Sibling context is injected identically to fanOutDispatches.
func (d *dispatchInterceptor) fanOutSequential(events []dispatchEvent, scope map[string]any) {
	events = attachSiblingContexts(events)
	for _, evt := range events {
		d.handleDispatch(evt, scope)
	}
}

// fanOutDispatches executes multiple dispatch events concurrently via a
// semaphore-limited goroutine pool. Blocks until all dispatches complete.
// Concurrency bounded by maxConcurrency (default DefaultDispatchConcurrency = 10,
// matching OpenCode default tool concurrency).
//
// Before dispatching, each event is injected with sibling context so every
// sub-agent knows what other agents in the same parallel batch are doing.
// This prevents file conflicts when multiple agents work on the same workspace.
func (d *dispatchInterceptor) fanOutDispatches(events []dispatchEvent, scope map[string]any) {
	maxConc := d.maxConcurrency
	if maxConc <= 0 {
		maxConc = DefaultDispatchConcurrency
	}

	events = attachSiblingContexts(events)

	sem := make(chan struct{}, maxConc)
	var wg sync.WaitGroup

	for i := range events {
		wg.Add(1)
		go func(evt dispatchEvent) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			d.handleDispatch(evt, scope)
		}(events[i])
	}
	wg.Wait()
}

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
	agentName := ""
	if payload != nil {
		if name, ok := payload["agentName"].(string); ok {
			agentName = name
		}
	}
	agentID := msg.FromAgentID

	// For error results, attempt failure recovery before injecting.
	if isError && d.failureRecovery != nil {
		errMsg := ""
		if payload != nil {
			if err, ok := payload["result"].(string); ok {
				errMsg = err
			}
		}
		// Guard: if no error details are available, provide a meaningful
		// fallback message so ClassifyFailure does not receive an error
		// with an empty Error() string, which would pass the nil-guard
		// (err != nil is true) but fall through all pattern checks,
		// wrongly defaulting to FailureTransient on a phantom failure.
		if errMsg == "" {
			errMsg = "sub-agent reported error (no details)"
		}

		taskID := ""
		if payload != nil {
			if tid, ok := payload["runId"].(string); ok {
				taskID = tid
			}
		}

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
			return

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
			return

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
			return

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

	// Build the injected message following OpenCode's XML task result injection pattern.
	errMsg := ""
	if isError && payload != nil {
		if err, ok := payload["result"].(string); ok {
			errMsg = err
		}
	}
	resultSummary := ""
	if !isError {
		resultSummary = formatResultSummary(payload)
	}
	injectedText := formatSubAgentResultInjectText(agentName, isError, errMsg, resultSummary)

	// P1: Inject result/error into the orchestrator's text stream.
	scope := map[string]any{"runId": d.parentRun.ID}
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
