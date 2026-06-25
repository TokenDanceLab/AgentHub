package adapters

import (
	"context"
	"crypto/rand"
	"encoding/json"
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

// DefaultOrchestratorPrompt returns the built-in orchestrator system prompt.
// It instructs the orchestrator to output structured plans with DAG dependencies
// using a flat JSON schema where tasks are identified by agent name and
// dependsOn references agent names directly (no separate task IDs).
func DefaultOrchestratorPrompt(availableAgents []string) string {
	agentList := formatAgentList(availableAgents)
	return "<ROLE>\n" +
		"You are the Orchestrator, the central coordination agent in a multi-agent system.\n" +
		"Your job is to decompose complex user requests into parallelizable sub-tasks,\n" +
		"dispatch them to the appropriate specialized sub-agents, and synthesize their\n" +
		"results into a single coherent final response. Delegate whenever possible —\n" +
		"never execute a task that a sub-agent can handle.\n" +
		"If you are uncertain about how to decompose a request or which agent to use,\n" +
		"admit it and ask the user for clarification rather than guessing.\n" +
		"</ROLE>\n" +
		"\n" +
		"<LIMITS>\n" +
		"- Available sub-agents: " + agentList + "\n" +
		"- Each sub-agent may appear at most once per plan.\n" +
		"- Sub-agent names are validated at dispatch time; unknown agents are rejected.\n" +
		"- You may NOT execute sub-tasks yourself — always delegate to sub-agents.\n" +
		"- Maximum concurrent dispatches: 10.\n" +
		"- Dependencies MUST form a valid directed acyclic graph (DAG) — no circular dependencies.\n" +
		"</LIMITS>\n" +
		"\n" +
		"<WORKFLOW>\n" +
		"1. ANALYZE: Break the user request into independent sub-tasks.\n" +
		"2. PLAN: Output a structured JSON plan with agent assignments and dependencies.\n" +
		"3. DISPATCH: For each task in the plan, emit a dispatch action.\n" +
		"4. AGGREGATE: After all sub-agents report results, synthesize the final answer.\n" +
		"5. TERMINATE: Signal completion when all tasks are done.\n" +
		"</WORKFLOW>\n" +
		"\n" +
		"<OUTPUT>\n" +
		"Emit your plan as a JSON object with this EXACT structure:\n" +
		"```json\n" +
		"{\n" +
		"  \"tasks\": [\n" +
		"    {\n" +
		"      \"agent\": \"<agent-name>\",\n" +
		"      \"description\": \"<what to do>\",\n" +
		"      \"dependsOn\": [],\n" +
		"      \"mode\": \"parallel\"\n" +
		"    }\n" +
		"  ]\n" +
		"}\n" +
		"```\n" +
		"\n" +
		"Field rules:\n" +
		"- \"agent\": Must be one of: " + agentList + ". Each agent should appear at most once in the plan.\n" +
		"- \"description\": Actionable, specific task description for the sub-agent.\n" +
		"- \"dependsOn\": Array of agent names that must complete before this task starts. Use [] for independent tasks.\n" +
		"- \"mode\": \"parallel\" (can run concurrently with same-level tasks) or \"sequential\" (must wait for all dependencies).\n" +
		"- The top-level object must contain a \"tasks\" array. Do NOT wrap it in a \"plan\" object.\n" +
		"\n" +
		"After outputting the plan, dispatch each task with:\n" +
		"{\"action\":\"dispatch\",\"agent\":\"<agent>\",\"task\":\"<description>\",\"subtaskId\":\"<agent>\"}\n" +
		"</OUTPUT>\n" +
		"\n" +
		"<CONSTRAINTS>\n" +
		"- NEVER execute sub-tasks inline — always dispatch to sub-agents.\n" +
		"- NEVER invent agent names not in the available sub-agent list.\n" +
		"- NEVER create circular dependencies (A depends on B depends on A).\n" +
		"- If a sub-agent fails, report the failure and suggest alternatives or next steps.\n" +
		"- If no sub-agents are suitable for a task, explain why and ask the user for guidance.\n" +
		"- If uncertain about the decomposition or agent assignment, admit it and ask for clarification.\n" +
		"- Output ONLY the plan JSON and dispatch actions — no explanatory commentary between them.\n" +
		"</CONSTRAINTS>"
}

// --- dispatch interception ---

// dispatchEvent is the expected JSON shape for a sub-agent dispatch.
type dispatchEvent struct {
	Action      string   `json:"action"`
	Agent       string   `json:"agent"`
	Task        string   `json:"task"`
	Role        string   `json:"role"`
	ThreadID    string   `json:"threadId,omitempty"`
	Model       string   `json:"model,omitempty"`
	SubtaskID   string   `json:"subtaskId,omitempty"`
	TargetFiles []string `json:"targetFiles,omitempty"` // files this sub-agent intends to modify
	DependsOn   []string `json:"dependsOn,omitempty"`   // task IDs this dispatch depends on

	// siblings is set by fanOutDispatches to carry sibling agent context.
	// Not parsed from JSON — populated programmatically before handleDispatch.
	siblings []SiblingInfo
}

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
	ctx                context.Context    // set from ParseStream; cancelled when run ends
	resultListenerOnce sync.Once         // ensures result listener starts exactly once
	dispatchedMu       sync.Mutex
	dispatchedCount    int               // total sub-agents dispatched by this interceptor
	dispatched         map[string]dispatchEvent // agentID -> original dispatch event for result injection

	// Failure degradation: classifies sub-agent errors and drives recovery
	// (retry / switch / skip / fail).
	failureRecovery *FailureRecoveryManager
}

func (d *dispatchInterceptor) Emit(eventType string, scope map[string]any, payload any) {
	d.inner.Emit(eventType, scope, payload)
	switch eventType {
	case BusEventTextBlock, BusEventTextDelta:
		d.scanForDispatch(payload, scope)
	}
}

// scanForDispatch collects dispatch events and fans out multiple dispatches concurrently.
// When the plan approval gate is enabled (planBroker != nil), it first pauses,
// emits a plan.proposed event, and waits for user approval before proceeding.
func (d *dispatchInterceptor) scanForDispatch(payload any, scope map[string]any) {
	text := extractTextContent(payload)
	if text == "" {
		return
	}

	// T2-A08: Rule engine pre-processing layer — intercept simple
	// termination/completion signals before JSON dispatch parsing.
	if d.applyRuleEngine(text, scope) {
		return // rule engine consumed the decision
	}

	var events []dispatchEvent
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if len(line) < 20 || line[0] != '{' {
			continue
		}
		var evt dispatchEvent
		if err := json.Unmarshal([]byte(line), &evt); err != nil {
			continue
		}
		if evt.Action != "dispatch" || evt.Agent == "" {
			continue
		}
		events = append(events, evt)
	}

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
	if d.matchCompletion(textLower) {
		slog.Info("orchestrator: rule engine completion signal, short-circuiting",
			"runId", d.parentRun.ID,
		)
		d.emitProgressSummary(scope)
		d.inner.Emit(BusEventTextBlock, scope, map[string]any{
			"text":   "[Orchestrator] All sub-agent tasks have completed.",
			"source": "rule_engine",
		})
		return true
	}

	// Rule 2: Standalone yes/no/approve/reject for pending plan decisions.
	if d.planBroker != nil && d.matchDecisionKeyword(textLower) {
		slog.Info("orchestrator: rule engine decision keyword, skipping JSON parse",
			"runId", d.parentRun.ID,
		)
		return true
	}

	return false
}

// matchCompletion checks for known orchestrator termination signals.
// Multi-word phrases match on any-length text; single-word signals
// only match on short text (<= 80 chars) to avoid false positives.
func (d *dispatchInterceptor) matchCompletion(textLower string) bool {
	// Multi-word phrases — match on any text length.
	for _, phrase := range []string{
		"all tasks done", "all done", "all tasks complete",
		"all sub-agent tasks have completed",
	} {
		if strings.Contains(textLower, phrase) {
			return true
		}
	}
	// Single-word signals — only match on short text to avoid false positives.
	if len(textLower) <= 80 {
		trimmed := strings.TrimSpace(textLower)
		for _, word := range []string{"done", "finish", "complete", "completed"} {
			if trimmed == word {
				return true
			}
			// Match word followed by a sentence-ending character (".", "!")
			// ONLY when the remainder after the prefix is whitespace-only.
			// This prevents false positives like "done. Now we should also
			// check..." from being treated as a completion signal.
			for _, suffix := range []string{".", "!"} {
				prefixed := word + suffix
				if strings.HasPrefix(trimmed, prefixed) {
					rest := trimmed[len(prefixed):]
					if strings.TrimSpace(rest) == "" {
						return true
					}
				}
			}
		}
	}
	return false
}

// matchDecisionKeyword checks for standalone plan-approval decision keywords.
func (d *dispatchInterceptor) matchDecisionKeyword(textLower string) bool {
	if len(textLower) > 40 {
		return false
	}
	for _, kw := range []string{"yes", "no", "approve", "approved", "reject", "rejected", "deny", "denied"} {
		if strings.TrimSpace(textLower) == kw {
			return true
		}
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
	if len(events) == 1 && d.isFinishDispatch(events[0]) {
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
	if d.allSameAgent(events) {
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

// isFinishDispatch checks whether a dispatch event is a termination signal
// with no actual sub-task work to perform.
func (d *dispatchInterceptor) isFinishDispatch(evt dispatchEvent) bool {
	taskLower := strings.ToLower(strings.TrimSpace(evt.Task))
	if taskLower == "" {
		return true
	}
	for _, w := range []string{"done", "finish", "complete", "finished", "completed", "all done", "all tasks done"} {
		if taskLower == w {
			return true
		}
	}
	return false
}

// allSameAgent checks whether all dispatch events target the same agent name.
func (d *dispatchInterceptor) allSameAgent(events []dispatchEvent) bool {
	if len(events) <= 1 {
		return false
	}
	first := events[0].Agent
	for _, evt := range events[1:] {
		if evt.Agent != first {
			return false
		}
	}
	return true
}

// fanOutSequential executes dispatch events one at a time for same-agent
// batches where parallel execution would cause intra-agent contention.
// Sibling context is injected identically to fanOutDispatches.
func (d *dispatchInterceptor) fanOutSequential(events []dispatchEvent, scope map[string]any) {
	// Inject sibling context (same pattern as fanOutDispatches).
	for i := range events {
		var siblings []SiblingInfo
		for j := range events {
			if i == j {
				continue
			}
			siblings = append(siblings, SiblingInfo{
				AgentName:   events[j].Agent,
				TaskDesc:    events[j].Task,
				TargetFiles: events[j].TargetFiles,
			})
		}
		events[i].siblings = siblings
	}

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

	// Build sibling context: for each event, collect the other events as siblings.
	for i := range events {
		var siblings []SiblingInfo
		for j := range events {
			if i == j {
				continue
			}
			siblings = append(siblings, SiblingInfo{
				AgentName:   events[j].Agent,
				TaskDesc:    events[j].Task,
				TargetFiles: events[j].TargetFiles,
			})
		}
		events[i].siblings = siblings
	}

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
			d.inner.Emit(BusEventTaskNotification, scope, map[string]any{
				"action":    "dispatch_error",
				"agent":     evt.Agent,
				"task":      evt.Task,
				"error":     "unknown agent: " + evt.Agent,
				"subtaskId": evt.SubtaskID,
			})
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
			d.inner.Emit(BusEventTaskNotification, scope, map[string]any{
				"action":    "dispatch_rejected",
				"agent":     evt.Agent,
				"task":      evt.Task,
				"error":     "circuit breaker open: " + cbErr.Error(),
				"subtaskId": evt.SubtaskID,
			})
			return
		}
	}

	agentID := genAgentID()
	now := time.Now().UTC()

	// err is declared early so the deferred Unregister closure (below)
	// can capture it. It is set by SpawnSubAgent on the error path.
	var err error

	role := evt.Role
	if role == "" {
		role = "worker"
	}

	inst := &agents.AgentInstance{
		ID:         agentID,
		Name:       evt.Agent,
		Role:       role,
		Status:     agents.StatusIdle,
		ParentID:   d.parentRun.ID,
		Depth:      d.depth + 1,
		AgentPath:  fmt.Sprintf("/orchestrator/%s", evt.Agent),
		AdapterID:  evt.Agent,
		CreatedAt:  now,
		LastSeen:   now,
	}

	if d.registry != nil {
		if err := d.registry.Register(inst); err != nil {
			d.inner.Emit(BusEventTaskNotification, scope, map[string]any{
				"action":    "dispatch_error",
				"agent":     evt.Agent,
				"task":      evt.Task,
				"error":     err.Error(),
				"agentId":   agentID,
				"subtaskId": evt.SubtaskID,
			})
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
			TaskID:       "task_" + genHexID(),
			Description:  evt.Task,
			AgentID:      evt.Agent,
			Prompt:       evt.Task,
			Depth:        d.depth + 1,
			ParentRunID:  d.parentRun.ID,
			ThreadID:     threadID,
			Model:        model,
			Budget:       d.budget,
			SiblingAgents: evt.siblings,
		}
		_, runID, err = d.spawner.SpawnSubAgent(d.parentRun, task)
		if err != nil {
			d.inner.Emit(BusEventTaskNotification, scope, map[string]any{
				"action":    "dispatch_error",
				"agent":     evt.Agent,
				"task":      evt.Task,
				"error":     err.Error(),
				"agentId":   agentID,
				"subtaskId": evt.SubtaskID,
			})
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

	d.inner.Emit(BusEventTaskDispatched, scope, map[string]any{
		"agentId":   agentID,
		"agent":     evt.Agent,
		"task":      evt.Task,
		"role":      inst.Role,
		"runId":     runID,
		"parentId":  d.parentRun.ID,
		"threadId":  threadID,
		"model":     model,
		"subtaskId": evt.SubtaskID,
	})

	// P1: Sub-agent status streaming — emit initial status on dispatch.
	d.inner.Emit(BusEventSubAgentStatus, scope, map[string]any{
		"agentId":   agentID,
		"agentName": evt.Agent,
		"status":    string(agents.StatusBusy),
		"progress":  "dispatched",
	})

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

// extractTextContent pulls the text string from various event payload shapes.
func extractTextContent(payload any) string {
	if payload == nil {
		return ""
	}
	switch v := payload.(type) {
	case map[string]any:
		if text, ok := v["text"].(string); ok {
			return text
		}
		if content, ok := v["content"].(string); ok {
			return content
		}
		return ""
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return ""
		}
		var m map[string]any
		if err := json.Unmarshal(b, &m); err != nil {
			return ""
		}
		if text, ok := m["text"].(string); ok {
			return text
		}
		if content, ok := m["content"].(string); ok {
			return content
		}
		return ""
	}
}

// genHexID generates a random 16-character hex string.
func genHexID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%016x", b)
}

// genAgentID generates a random agent instance ID.
func genAgentID() string {
	return "agent_" + genHexID()
}

// escapePromptLiteral escapes backticks and ${} sequences.
func escapePromptLiteral(s string) string {
	s = strings.ReplaceAll(s, "`", "\\`")
	s = strings.ReplaceAll(s, "${", "\\${")
	return s
}

func formatAgentList(agents []string) string {
	if len(agents) == 0 {
		return "none"
	}
	escaped := make([]string, len(agents))
	for i, a := range agents {
		escaped[i] = escapePromptLiteral(a)
	}
	return strings.Join(escaped, ", ")
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
		if fErr != nil && errors.Is(fErr, context.Canceled) {
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
			retryMsg := fmt.Sprintf("[Sub-agent: %s] transient failure, retrying with analysis...\nError: %s\nCritique: %s", agentName, errMsg, critique)
			d.inner.Emit(BusEventTextBlock, scope, map[string]any{
				"text":   retryMsg,
				"source": "sub_agent_retry",
			})
			return

		case DecisionSwitchAgent:
			// Look up the original dispatch event so we can re-dispatch
			// to the alternate agent with the same task parameters.
			d.dispatchedMu.Lock()
			origEvt, hasOrig := d.dispatched[agentID]
			d.dispatchedMu.Unlock()

			altID := d.failureRecovery.FindAlternateAgentID(agentName)
			if altID != "" && hasOrig {
				switchMsg := fmt.Sprintf("[Sub-agent: %s] capability failure, switching to alternate agent %s...\nError: %s", agentName, altID, errMsg)
				d.inner.Emit(BusEventTextBlock, scope, map[string]any{
					"text":   switchMsg,
					"source": "sub_agent_switch",
				})
				// Construct a new dispatch event targeting the alternate agent,
				// copying the original task description and parameters.
				newEvt := dispatchEvent{
					Action:      "dispatch",
					Agent:       altID,
					Task:        origEvt.Task,
					Role:        origEvt.Role,
					ThreadID:    origEvt.ThreadID,
					Model:       origEvt.Model,
					SubtaskID:   origEvt.SubtaskID,
					TargetFiles: origEvt.TargetFiles,
					DependsOn:   origEvt.DependsOn,
				}
				d.handleDispatch(newEvt, scope)
			} else {
				switchMsg := fmt.Sprintf("[Sub-agent: %s] capability failure, no alternate agent available\nError: %s", agentName, errMsg)
				d.inner.Emit(BusEventTextBlock, scope, map[string]any{
					"text":   switchMsg,
					"source": "sub_agent_switch",
				})
			}
			return

		case DecisionSkip:
			// Skip: inject skip notification and continue.
			skipMsg := fmt.Sprintf("[Sub-agent: %s] task skipped (unrecoverable)\nError: %s", agentName, errMsg)
			d.inner.Emit(BusEventTextBlock, scope, map[string]any{
				"text":   skipMsg,
				"source": "sub_agent_skip",
			})
			// Still emit status update for the skipped agent.
			errStr := ""
			if payload != nil {
				if err, ok := payload["result"].(string); ok {
					errStr = err
				}
			}
			d.inner.Emit(BusEventSubAgentStatus, scope, map[string]any{
				"agentId":   agentID,
				"agentName": agentName,
				"status":    string(agents.StatusError),
				"progress":  "skipped",
				"error":     errStr,
			})
			d.emitProgressSummary(scope)
			return

		case DecisionFail:
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
	var injectedText string
	if isError {
		errMsg := ""
		if payload != nil {
			if err, ok := payload["result"].(string); ok {
				errMsg = err
			}
		}
		injectedText = fmt.Sprintf("[Sub-agent: %s] failed\nError: %s", agentName, errMsg)
	} else {
		resultSummary := formatResultSummary(payload)
		injectedText = fmt.Sprintf("[Sub-agent: %s] completed task\nResult: %s", agentName, resultSummary)
	}

	// P1: Inject result/error into the orchestrator's text stream.
	scope := map[string]any{"runId": d.parentRun.ID}
	d.inner.Emit(BusEventTextBlock, scope, map[string]any{
		"text":   injectedText,
		"source": "sub_agent_result",
	})

	// P1: Emit sub-agent status update.
	status := string(agents.StatusCompleted)
	errStr := ""
	if isError {
		status = string(agents.StatusError)
		if payload != nil {
			if err, ok := payload["result"].(string); ok {
				errStr = err
			}
		}
	}
	d.inner.Emit(BusEventSubAgentStatus, scope, map[string]any{
		"agentId":   agentID,
		"agentName": agentName,
		"status":    status,
		"progress":  status,
		"error":     errStr,
	})

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

	var completed, running, waiting, errored int
	for _, child := range children {
		switch child.Status {
		case agents.StatusCompleted:
			completed++
		case agents.StatusError:
			errored++
		case agents.StatusBusy:
			running++
		default:
			waiting++
		}
	}

	var parts []string
	if completed > 0 {
		parts = append(parts, fmt.Sprintf("%d completed", completed))
	}
	if errored > 0 {
		parts = append(parts, fmt.Sprintf("%d error", errored))
	}
	if running > 0 {
		parts = append(parts, fmt.Sprintf("%d running", running))
	}
	if waiting > 0 {
		parts = append(parts, fmt.Sprintf("%d waiting", waiting))
	}

	summary := fmt.Sprintf("%d of %d sub-agents done", completed+errored, len(children))
	if len(parts) > 0 {
		summary += " (" + strings.Join(parts, ", ") + ")"
	}

	d.inner.Emit(BusEventTaskProgress, scope, map[string]any{
		"summary":    summary,
		"completed":  completed,
		"errored":    errored,
		"running":    running,
		"waiting":    waiting,
		"total":      len(children),
	})
}

// formatResultSummary extracts a human-readable summary from the sub-agent
// result payload, truncating to approximately 500 characters.
func formatResultSummary(payload map[string]any) string {
	if payload == nil {
		return "(no output)"
	}
	if result, ok := payload["result"].(string); ok && result != "" {
		if len(result) > 500 {
			return result[:500] + "..."
		}
		return result
	}
	// Try to marshal the whole payload as a fallback.
	b, err := json.Marshal(payload)
	if err != nil {
		return "(unable to format result)"
	}
	s := string(b)
	if len(s) > 500 {
		s = s[:500] + "..."
	}
	return s
}

// awaitPlanApproval implements the plan confirmation gate (P0 #3).
// When the plan broker is configured, it builds a plan from the detected dispatch
// events, emits a plan.proposed event, and blocks until the user approves or rejects.
// Returns true if the plan is approved (or approval gate is disabled), false if rejected.
func (d *dispatchInterceptor) awaitPlanApproval(events []dispatchEvent, scope map[string]any) bool {
	if d.planBroker == nil {
		return true // approval gate not configured
	}

	// Build the plan from detected dispatch events.
	tasks := make([]PlanTask, len(events))
	for i, evt := range events {
		deps := evt.DependsOn
		if deps == nil {
			deps = []string{}
		}
		tasks[i] = PlanTask{
			Agent:       evt.Agent,
			Description: evt.Task,
			DependsOn:   deps,
		}
	}

	mode := "parallel"
	if len(events) == 1 {
		mode = "single"
	}

	plan := PendingPlan{
		RunID:     d.parentRun.ID,
		ProjectID: d.parentRun.ProjectID,
		ThreadID:  d.parentRun.ThreadID,
		Tasks:     tasks,
		Mode:      mode,
		CreatedAt: time.Now().UTC(),
		Status:    "pending",
	}

	// Emit plan.proposed so the frontend can render the approval UI.
	d.inner.Emit(BusEventPlanProposed, scope, map[string]any{
		"runId": plan.RunID,
		"plan": map[string]any{
			"tasks": tasks,
			"mode":  mode,
		},
	})

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
		d.inner.Emit(BusEventPlanApproved, scope, map[string]any{
			"runId":  plan.RunID,
			"reason": decision.Reason,
		})
		return true
	}

	slog.Info("plan approval: plan rejected",
		"runId", plan.RunID,
		"reason", decision.Reason,
	)
	d.inner.Emit(BusEventPlanRejected, scope, map[string]any{
		"runId":  plan.RunID,
		"reason": decision.Reason,
	})

	// Inject rejection notification into the orchestrator's text stream
	// so it knows the plan was not executed.
	d.inner.Emit(BusEventTextBlock, scope, map[string]any{
		"text":   fmt.Sprintf("[Plan rejected by user: %s]", decision.Reason),
		"source": "plan_gate",
	})

	return false
}