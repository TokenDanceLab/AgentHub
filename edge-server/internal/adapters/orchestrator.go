package adapters

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
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
		inner:        NewClaudeCodeAdapter(claudePath, model, "bypassPermissions"),
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
		}
		if budget, ok := ctx.Value(CtxBudgetKey).(*runnerctx.ContextBudget); ok {
			effectiveEmitter.(*dispatchInterceptor).budget = budget
		}
	}
	return a.inner.ParseStream(ctx, stdout, stdin, effectiveEmitter, run)
}

func (a *OrchestratorAdapter) NeedsStdin() bool { return true }

func (a *OrchestratorAdapter) Available() bool { return a.inner.Available() }

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