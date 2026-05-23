package adapters

import (
	"context"
	"io"
	"strings"

	"github.com/agenthub/edge-server/internal/store"
)

// OrchestratorAdapter wraps a ClaudeCodeAdapter with an orchestrator system prompt.
// It is used in group-chat mode to decompose complex tasks and dispatch sub-agents.
//
// The orchestrator is Claude Code with a specialized system prompt that instructs
// it to break down user requests, identify sub-tasks, and coordinate other agents.
// Edge listens for orchestrator events to spawn sub-agent runs.
type OrchestratorAdapter struct {
	inner        *ClaudeCodeAdapter
	systemPrompt string
}

// NewOrchestratorAdapter creates an orchestrator wrapping a Claude Code instance.
// systemPrompt is the orchestrator instruction text.
// subAgents lists agent IDs available for dispatch (used only in prompt construction).
func NewOrchestratorAdapter(claudePath, model, systemPrompt string, subAgents []string) *OrchestratorAdapter {
	_ = subAgents // reserved for future sub-agent dispatch interception
	return &OrchestratorAdapter{
		inner:        NewClaudeCodeAdapter(claudePath, model, "bypassPermissions"),
		systemPrompt: systemPrompt,
	}
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
	// Same NDJSON parsing as Claude Code, with additional event interception
	// for sub-agent spawning requests.
	parser := NewNDJSONStreamParser(emitter, run)
	return parser.Parse(ctx, stdout)
}

// NeedsStdin returns true because the wrapped Claude Code adapter requires
// stdin for the control protocol (permission requests, interrupts, etc.).
func (a *OrchestratorAdapter) NeedsStdin() bool {
	if a.inner != nil {
		return a.inner.NeedsStdin()
	}
	return false
}

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

func formatAgentList(agents []string) string {
	if len(agents) == 0 {
		return "none"
	}
	return strings.Join(agents, ", ")
}
