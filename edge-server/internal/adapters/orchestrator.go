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
func DefaultOrchestratorPrompt(availableAgents []string) string {
	return "You are the Orchestrator. Available sub-agents: " + formatAgentList(availableAgents) + "\n" +
		"Analyze the request. Identify parallelizable sub-tasks. Dispatch each to the appropriate agent.\n" +
		"Aggregate results into a coherent final response. Delegate whenever possible.\n"
}

// --- dispatch interception ---

// dispatchEvent is the expected JSON shape for a sub-agent dispatch.
type dispatchEvent struct {
	Action    string `json:"action"`
	Agent     string `json:"agent"`
	Task      string `json:"task"`
	Role      string `json:"role"`
	ThreadID  string `json:"threadId,omitempty"`
	Model     string `json:"model,omitempty"`
	SubtaskID string `json:"subtaskId,omitempty"`
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

	// Sub-agent result injection and status tracking.
	ctx                context.Context    // set from ParseStream; cancelled when run ends
	resultListenerOnce sync.Once         // ensures result listener starts exactly once
	dispatchedMu       sync.Mutex
	dispatchedCount    int               // total sub-agents dispatched by this interceptor
	dispatched         map[string]dispatchEvent // agentID -> original dispatch event for result injection
}

func (d *dispatchInterceptor) Emit(eventType string, scope map[string]any, payload any) {
	d.inner.Emit(eventType, scope, payload)
	switch eventType {
	case BusEventTextBlock, BusEventTextDelta:
		d.scanForDispatch(payload, scope)
	}
}

// scanForDispatch collects dispatch events and fans out multiple dispatches concurrently.
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
func (d *dispatchInterceptor) fanOutDispatches(events []dispatchEvent, scope map[string]any) {
	maxConc := d.maxConcurrency
	if maxConc <= 0 {
		maxConc = DefaultDispatchConcurrency
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
			TaskID:      "task_" + genHexID(),
			Description: evt.Task,
			AgentID:     evt.Agent,
			Prompt:      evt.Task,
			Depth:       d.depth + 1,
			ParentRunID: d.parentRun.ID,
			ThreadID:    threadID,
			Model:       model,
			Budget:      d.budget,
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
func (d *dispatchInterceptor) handleSubAgentResult(msg agents.Message, isError bool) {
	payload, _ := msg.Payload.(map[string]any)
	agentName := ""
	if payload != nil {
		if name, ok := payload["agentName"].(string); ok {
			agentName = name
		}
	}
	agentID := msg.FromAgentID

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