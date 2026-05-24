package adapters

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/store"
)

// OrchestratorAdapter wraps a ClaudeCodeAdapter with an orchestrator system prompt.
// It is used in group-chat mode to decompose complex tasks and dispatch sub-agents.
//
// The orchestrator is Claude Code with a specialized system prompt that instructs
// it to break down user requests, identify sub-tasks, and coordinate other agents.
// Edge listens for orchestrator events to spawn sub-agent runs.
type OrchestratorAdapter struct {
	inner         *ClaudeCodeAdapter
	systemPrompt  string
	agentRegistry *agents.Registry
	messageQueue  *agents.Queue
	spawner       SubAgentSpawner
	depth         int
}

// NewOrchestratorAdapter creates an orchestrator wrapping a Claude Code instance.
// systemPrompt is the orchestrator instruction text.
// subAgents lists agent IDs available for dispatch (used only in prompt construction).
func NewOrchestratorAdapter(claudePath, model, systemPrompt string, subAgents []string) *OrchestratorAdapter {
	_ = subAgents // reserved for future sub-agent dispatch interception
	return &OrchestratorAdapter{
		inner:        NewClaudeCodeAdapter(claudePath, model, "bypassPermissions"),
		systemPrompt: escapePromptLiteral(systemPrompt),
		depth:        0,
	}
}

// WithAgentRegistry attaches an agent instance registry for tracking sub-agents
// spawned during orchestration. When set, ParseStream will automatically register
// sub-agents detected from dispatch events in the orchestrator output.
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

func (a *OrchestratorAdapter) Metadata() AdapterMetadata {
	m := a.inner.Metadata()
	m.ID = "orchestrator"
	m.Name = "Orchestrator"
	m.Description = "主 Agent 协调器 — 自动拆解复杂任务、分派子 Agent、聚合结果"
	return m
}

func (a *OrchestratorAdapter) Capabilities() AgentCapabilities {
	c := a.inner.Capabilities()
	c.SubAgentSpawn = true
	return c
}

func (a *OrchestratorAdapter) BuildCommand(ctx RunProcessContext) (string, []string, []string, string) {
	cmdPath, args, env, workDir := a.inner.BuildCommand(ctx)

	// Inject the orchestrator system prompt
	if a.systemPrompt != "" {
		args = append(args, "--system-prompt", a.systemPrompt)
	}

	return cmdPath, args, env, workDir
}

func (a *OrchestratorAdapter) ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) error {
	// Wrap the emitter with dispatch interception if we have a registry or spawner.
	effectiveEmitter := emitter
	if a.agentRegistry != nil || a.spawner != nil {
		effectiveEmitter = &dispatchInterceptor{
			inner:     emitter,
			registry:  a.agentRegistry,
			queue:     a.messageQueue,
			spawner:   a.spawner,
			parentRun: run,
			depth:     a.depth,
		}
	}

	// Delegate to inner Claude Code adapter for proper NDJSON parsing with
	// control handler (permission responses via stdin) and security hooks.
	return a.inner.ParseStream(ctx, stdout, stdin, effectiveEmitter, run)
}

// NeedsStdin returns true — the orchestrator spawns Claude Code internally
// which requires stdin for the control protocol (permission requests, interrupt).
func (a *OrchestratorAdapter) NeedsStdin() bool { return true }

// DefaultOrchestratorPrompt returns the built-in orchestrator system prompt
// instructing Claude Code how to coordinate multiple sub-agents.
func DefaultOrchestratorPrompt(availableAgents []string) string {
	return `You are the Orchestrator — the main coordinator agent in AgentHub.

Your role is to:
1. UNDERSTAND the user's request and decompose it into independent sub-tasks.
2. DISPATCH each sub-task to the most appropriate available agent.
3. AGGREGATE results from all sub-agents into a coherent final response.

Available sub-agents: ` + formatAgentList(availableAgents) + `

Workflow:
- Analyze the user's request. Identify which parts can be done in parallel.
- For each sub-task, clearly state: which agent should handle it, what the task is,
  and any constraints or context that agent needs.
- After all sub-agents respond, synthesize their outputs. Highlight conflicts.
- Present the final result as a unified response.

Rules:
- Do NOT try to do all the work yourself. Delegate to sub-agents whenever possible.
- If a sub-task fails, report the failure and suggest alternatives.
- Preserve the user's chat context — sub-agents receive relevant context only.
- Be concise in coordination messages. Let sub-agents produce the detailed output.
`
}

// --- dispatch interception ---

// dispatchEvent is the expected JSON shape for a sub-agent dispatch from the orchestrator output.
type dispatchEvent struct {
	Action string `json:"action"` // "dispatch"
	Agent  string `json:"agent"`  // target agent name
	Task   string `json:"task"`   // task description
	Role   string `json:"role"`   // optional: "worker" or "specialist"
}

// dispatchInterceptor wraps an EventEmitter to detect dispatch events in text output.
// When a text block/delta contains a dispatch JSON pattern, it registers a sub-agent
// and emits a task_dispatched event.
type dispatchInterceptor struct {
	inner     EventEmitter
	registry  *agents.Registry
	queue     *agents.Queue
	spawner   SubAgentSpawner
	parentRun store.Run
	depth     int
}

func (d *dispatchInterceptor) Emit(eventType string, scope map[string]any, payload any) {
	// Always pass through to the inner emitter.
	d.inner.Emit(eventType, scope, payload)

	// Intercept text events to scan for dispatch instructions.
	switch eventType {
	case BusEventTextBlock, BusEventTextDelta:
		d.scanForDispatch(payload, scope)
	}
}

// scanForDispatch looks for dispatch JSON patterns in text content.
// When found, it creates an AgentInstance, registers it, spawns a run, and emits events.
func (d *dispatchInterceptor) scanForDispatch(payload any, scope map[string]any) {
	text := extractTextContent(payload)
	if text == "" {
		return
	}

	// Scan for lines that look like dispatch JSON.
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

		d.handleDispatch(evt, scope)
	}
}

// handleDispatch processes a detected dispatch event: registers the sub-agent,
// spawns a run, sends a message, and emits events.
func (d *dispatchInterceptor) handleDispatch(evt dispatchEvent, scope map[string]any) {
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

	// Register the agent instance
	if d.registry != nil {
		if err := d.registry.Register(inst); err != nil {
			d.inner.Emit(BusEventTaskNotification, scope, map[string]any{
				"action":  "dispatch_error",
				"agent":   evt.Agent,
				"task":    evt.Task,
				"error":   err.Error(),
				"agentId": agentID,
			})
			return
		}
	}

	// Spawn a sub-agent run if spawner is available
	var runID string
	if d.spawner != nil {
		task := SubAgentTask{
			TaskID:      "task_" + genHexID(),
			Description: evt.Task,
			AgentID:     evt.Agent,
			Prompt:      evt.Task,
			Depth:       d.depth + 1,
			ParentRunID: d.parentRun.ID,
		}
		var err error
		_, runID, err = d.spawner.SpawnSubAgent(d.parentRun, task)
		if err == nil && runID != "" && d.registry != nil {
			d.registry.SetRunID(agentID, runID)
			d.registry.SetStatus(agentID, agents.StatusBusy, "")
		}
	}

	// Send a task message via the queue
	if d.queue != nil {
		d.queue.EnsureAgent(agentID, 64)
		d.queue.Send(agents.Message{
			ID:          "msg_" + genHexID(),
			FromAgentID: d.parentRun.ID,
			ToAgentID:   agentID,
			Type:        agents.MsgTypeTask,
			Payload: map[string]any{
				"task":  evt.Task,
				"agent": evt.Agent,
				"role":  evt.Role,
			},
			Timestamp: now,
		})
	}

	// Emit task_dispatched event so the Edge Server / Desktop UI can react.
	d.inner.Emit(BusEventTaskDispatched, scope, map[string]any{
		"agentId":  agentID,
		"agent":    evt.Agent,
		"task":     evt.Task,
		"role":     inst.Role,
		"runId":    runID,
		"parentId": d.parentRun.ID,
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

// escapePromptLiteral escapes backticks and ${} sequences that could be
// interpreted as template syntax by downstream prompt processing.
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
