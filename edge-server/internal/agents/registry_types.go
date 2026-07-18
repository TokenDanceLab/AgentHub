package agents

// Residual pure-helper peel #1154: sentinel errors, limits, Status, and
// AgentInstance types extracted from registry.go. Same package agents;
// zero behavior change.

import (
	"errors"
	"time"
)

// Sentinel errors for spawn slot enforcement (Codex AgentTree parity).
var (
	ErrAgentSlotFull              = errors.New("agent slot full: max concurrent sub-agents reached for parent")
	ErrAgentDepthExceeded         = errors.New("agent depth exceeded: max delegation depth reached")
	ErrMaxChildrenPerAgentReached = errors.New("per-parent child limit reached: max children spawned for this parent")
	ErrAgentNotFound              = errors.New("agent instance not found")
)

const (
	// DefaultMaxConcurrent is the default GLOBAL maximum number of concurrent
	// sub-agents across all parents. It is the configurable system-wide default
	// (override per-registry via WithMaxConcurrent) that limits how many sub-agents
	// can be in non-terminal (active) state simultaneously across the entire
	// registry.
	//
	// The value 6 is intentionally one higher than MaxChildrenPerAgent (5).
	// This reserves one slot for orchestrator self-dispatch: when the orchestrator
	// delegates work back to itself, it occupies a concurrent slot without
	// consuming a per-parent child slot, leaving 5 slots for real sub-agents.
	DefaultMaxConcurrent = 6
	// MaxAgentDepth is the hard limit on delegation depth. Depth 0 = root,
	// depth 1 = direct child, depth 2 = grandchild. Depth >= MaxAgentDepth
	// is rejected to prevent runaway recursion.
	MaxAgentDepth = 3
	// MaxChildrenPerAgent is the PER-PARENT hard cap on the number of sub-agents
	// a single parent can have active concurrently. Unlike DefaultMaxConcurrent
	// (which is global and configurable), this is a non-configurable safety
	// ceiling that prevents a compromised or buggy orchestrator from spawning
	// unlimited children even within the global slot limit.
	//
	// DefaultMaxConcurrent (6) > MaxChildrenPerAgent (5) is intentional:
	// the global pool has one reserved slot beyond the per-parent cap, allowing
	// the orchestrator to self-dispatch without reducing the effective per-parent
	// budget.
	MaxChildrenPerAgent = 5
)

// Status represents the runtime status of an agent instance.
type Status string

const (
	StatusOnline       Status = "online"
	StatusBusy         Status = "busy"
	StatusIdle         Status = "idle"
	StatusError        Status = "error"
	StatusWaitingInput Status = "waiting_for_input"
	StatusDraining     Status = "draining"
	StatusCompleted    Status = "completed"
	StatusDisconnected Status = "disconnected"
)

// AgentInstance represents a running agent tracked by the registry.
// It corresponds to a spawned agent process or a registered adapter.
type AgentInstance struct {
	ID        string    `json:"id"`
	AdapterID string    `json:"adapterId"`
	Name      string    `json:"name"`
	Status    Status    `json:"status"`
	RunID     string    `json:"runId,omitempty"`
	ThreadID  string    `json:"threadId,omitempty"`
	ParentID  string    `json:"parentId,omitempty"` // orchestrator that spawned this agent
	Depth     int       `json:"depth"`              // delegation depth (root=0)
	AgentPath string    `json:"agentPath"`          // tree path like "/orchestrator/reviewer"
	Role      string    `json:"role,omitempty"`     // agent's assigned role
	LastSeen  time.Time `json:"lastSeen"`
	CreatedAt time.Time `json:"createdAt"`
	Error     string    `json:"error,omitempty"`
}
