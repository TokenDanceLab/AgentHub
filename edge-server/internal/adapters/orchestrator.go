package adapters

import (
	"context"
	"crypto/rand"
	"encoding/json"
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
	// maxSpawnRetries is the maximum number of retry attempts when spawning a
	// sub-agent fails. After this limit the failure is escalated to the user.
	maxSpawnRetries = 3

	// baseRetryDelay is the starting backoff duration for spawn retries.
	baseRetryDelay = 500 * time.Millisecond

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
	if a.systemPrompt != "" {
		args = append(args, "--system-prompt", a.systemPrompt)
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
	return "You are the Orchestrator. Available sub-agents: " + agentList + "\n" +
		"Analyze the request. Identify parallelizable sub-tasks. Dispatch each to the appropriate agent.\n" +
		"Aggregate results into a coherent final response. Delegate whenever possible.\n" +
		"\n" +
		"## Plan Output Format\n" +
		"\n" +
		"When planning complex multi-step tasks, output your plan as a JSON object with this EXACT structure:\n" +
		"```json\n" +
		"{\n" +
		"  \"tasks\": [\n" +
		"    {\n" +
		"      \"agent\": \"<agent-name>\",\n" +
		"      \"description\": \"<what to do>\",\n" +
		"      \"dependsOn\": [],\n" +
		"      \"mode\": \"parallel\"\n" +
		"    },\n" +
		"    {\n" +
		"      \"agent\": \"<agent-name>\",\n" +
		"      \"description\": \"<what to do>\",\n" +
		"      \"dependsOn\": [\"<agent-name>\"],\n" +
		"      \"mode\": \"sequential\"\n" +
		"    }\n" +
		"  ]\n" +
		"}\n" +
		"```\n" +
		"\n" +
		"## Example\n" +
		"\n" +
		"Given the request \"Review the auth module, then implement the login UI, and also write unit tests for both\":\n" +
		"```json\n" +
		"{\n" +
		"  \"tasks\": [\n" +
		"    {\n" +
		"      \"agent\": \"code-reviewer\",\n" +
		"      \"description\": \"Review code quality of auth module\",\n" +
		"      \"dependsOn\": [],\n" +
		"      \"mode\": \"sequential\"\n" +
		"    },\n" +
		"    {\n" +
		"      \"agent\": \"frontend-dev\",\n" +
		"      \"description\": \"Implement login UI component based on review feedback\",\n" +
		"      \"dependsOn\": [\"code-reviewer\"],\n" +
		"      \"mode\": \"sequential\"\n" +
		"    },\n" +
		"    {\n" +
		"      \"agent\": \"test-engineer\",\n" +
		"      \"description\": \"Write unit tests for auth module and login UI\",\n" +
		"      \"dependsOn\": [\"frontend-dev\"],\n" +
		"      \"mode\": \"parallel\"\n" +
		"    }\n" +
		"  ]\n" +
		"}\n" +
		"```\n" +
		"\n" +
		"## Field Rules\n" +
		"\n" +
		"- \"agent\": must be one of: " + agentList + ". Each agent should appear at most once in the plan.\n" +
		"- \"description\": a clear, actionable description of what the sub-agent should do.\n" +
		"- \"dependsOn\": an array of agent names that must complete before this task starts. Use [] for tasks with no dependencies.\n" +
		"- \"mode\": \"parallel\" (can run concurrently with other tasks at the same dependency level) or \"sequential\" (must wait for dependencies to complete).\n" +
		"- Tasks with no dependencies and mode \"parallel\" CAN run concurrently.\n" +
		"- The top-level object must contain a \"tasks\" array. Do NOT wrap it in a \"plan\" object.\n" +
		"\n" +
		"## Dispatching\n" +
		"\n" +
		"After outputting the plan, dispatch each task via: {\"action\":\"dispatch\",\"agent\":\"<agent>\",\"task\":\"<description>\",\"subtaskId\":\"<agent>\"}\n"
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

	if len(events) == 1 {
		d.handleDispatch(events[0], scope)
		return
	}

	d.fanOutDispatches(events, scope)
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

// handleDispatch validates the agent name (O-01), registers the sub-agent,
// spawns a run, sends a message, and emits events.
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

	agentID := genAgentID()
	now := time.Now().UTC()

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
		var err error
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

		taskID := ""
		if payload != nil {
			if tid, ok := payload["runId"].(string); ok {
				taskID = tid
			}
		}

		scope := map[string]any{"runId": d.parentRun.ID}
		decision, _ := d.failureRecovery.HandleSubAgentFailure(
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

		switch decision {
		case DecisionRetry:
			// Recovery manager already handled backoff.
			// Inject retry notification into orchestrator stream so it knows
			// the sub-agent will be re-attempted.
			retryMsg := fmt.Sprintf("[Sub-agent: %s] transient failure, retrying...\nError: %s", agentName, errMsg)
			d.inner.Emit(BusEventTextBlock, scope, map[string]any{
				"text":   retryMsg,
				"source": "sub_agent_retry",
			})
			return

		case DecisionSwitchAgent:
			// Inject switch notification so orchestrator knows a different
			// agent is being tried for this task.
			switchMsg := fmt.Sprintf("[Sub-agent: %s] capability failure, switching to alternate agent...\nError: %s", agentName, errMsg)
			d.inner.Emit(BusEventTextBlock, scope, map[string]any{
				"text":   switchMsg,
				"source": "sub_agent_switch",
			})
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