// Package agents provides the Agent Registry and inter-agent message queue
// for the AgentHub Orchestrator. It tracks runtime agent instances, their
// status, and enables communication between orchestrator and sub-agents.
//
// Reference: docs/reference/cross-comparison/03-orchestration.md Layer 2
// Reference: docs/reference/projects/codex-cli/01-overview.md AgentTree pattern
package agents

import (
	"fmt"
	"sync"
	"time"
)

// Status represents the runtime status of an agent instance.
type Status string

const (
	StatusOnline        Status = "online"
	StatusBusy          Status = "busy"
	StatusIdle          Status = "idle"
	StatusError         Status = "error"
	StatusWaitingInput  Status = "waiting_for_input"
	StatusCompleted     Status = "completed"
	StatusDisconnected  Status = "disconnected"
)

// AgentInstance represents a running agent tracked by the registry.
// It corresponds to a spawned agent process or a registered adapter.
type AgentInstance struct {
	ID          string    `json:"id"`
	AdapterID   string    `json:"adapterId"`
	Name        string    `json:"name"`
	Status      Status    `json:"status"`
	RunID       string    `json:"runId,omitempty"`
	ThreadID    string    `json:"threadId,omitempty"`
	ParentID    string    `json:"parentId,omitempty"` // orchestrator that spawned this agent
	Depth       int       `json:"depth"`              // delegation depth (root=0)
	AgentPath   string    `json:"agentPath"`          // tree path like "/orchestrator/reviewer"
	Role        string    `json:"role,omitempty"`     // agent's assigned role
	LastSeen    time.Time `json:"lastSeen"`
	CreatedAt   time.Time `json:"createdAt"`
	Error       string    `json:"error,omitempty"`
}

// Registry tracks active agent instances and provides query/status operations.
// It is the runtime counterpart to adapters.Registry (which holds adapter
// definitions, not instances).
type Registry struct {
	mu       sync.RWMutex
	agents   map[string]*AgentInstance
}

// NewRegistry creates an empty agent registry.
func NewRegistry() *Registry {
	return &Registry{
		agents: make(map[string]*AgentInstance),
	}
}

// Register adds a new agent instance. Returns error if the ID already exists.
func (r *Registry) Register(inst *AgentInstance) error {
	if inst.ID == "" {
		return fmt.Errorf("agent instance ID is required")
	}
	if inst.AdapterID == "" {
		return fmt.Errorf("agent adapter ID is required")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.agents[inst.ID]; ok {
		return fmt.Errorf("agent instance %q already registered", inst.ID)
	}
	now := time.Now()
	if inst.CreatedAt.IsZero() {
		inst.CreatedAt = now
	}
	inst.LastSeen = now
	if inst.Status == "" {
		inst.Status = StatusIdle
	}
	cloned := *inst
	r.agents[inst.ID] = &cloned
	return nil
}

// Unregister removes an agent instance by ID.
func (r *Registry) Unregister(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, ok := r.agents[id]
	if ok {
		delete(r.agents, id)
	}
	return ok
}

// Get returns an agent instance by ID.
func (r *Registry) Get(id string) (*AgentInstance, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	inst, ok := r.agents[id]
	if ok {
		cloned := *inst
		return &cloned, true
	}
	return nil, false
}

// List returns all registered agent instances.
func (r *Registry) List() []AgentInstance {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]AgentInstance, 0, len(r.agents))
	for _, inst := range r.agents {
		result = append(result, *inst)
	}
	return result
}

// ListByParent returns all agent instances spawned by the given parent ID.
func (r *Registry) ListByParent(parentID string) []AgentInstance {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []AgentInstance
	for _, inst := range r.agents {
		if inst.ParentID == parentID {
			result = append(result, *inst)
		}
	}
	return result
}

// ListByStatus returns all agent instances with the given status.
func (r *Registry) ListByStatus(status Status) []AgentInstance {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []AgentInstance
	for _, inst := range r.agents {
		if inst.Status == status {
			result = append(result, *inst)
		}
	}
	return result
}

// ListByAdapter returns all agent instances using the given adapter ID.
func (r *Registry) ListByAdapter(adapterID string) []AgentInstance {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var result []AgentInstance
	for _, inst := range r.agents {
		if inst.AdapterID == adapterID {
			result = append(result, *inst)
		}
	}
	return result
}

// SetStatus updates an agent's status and bumps LastSeen.
func (r *Registry) SetStatus(id string, status Status, errMsg string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	inst, ok := r.agents[id]
	if !ok {
		return false
	}
	inst.Status = status
	inst.LastSeen = time.Now()
	if errMsg != "" {
		inst.Error = errMsg
	}
	if status == StatusError {
		inst.Error = errMsg
	}
	return true
}

// SetRunID associates an agent instance with a run.
func (r *Registry) SetRunID(id, runID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	inst, ok := r.agents[id]
	if !ok {
		return false
	}
	inst.RunID = runID
	inst.LastSeen = time.Now()
	return true
}

// FindByRunID returns the agent instance associated with the given run ID.
// Returns nil if no agent has that run ID.
func (r *Registry) FindByRunID(runID string) *AgentInstance {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, inst := range r.agents {
		if inst.RunID == runID {
			cloned := *inst
			return &cloned
		}
	}
	return nil
}

// SetLastSeenNow updates the LastSeen timestamp for the given agent instance.
func (r *Registry) SetLastSeenNow(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	inst, ok := r.agents[id]
	if !ok {
		return false
	}
	inst.LastSeen = time.Now()
	return true
}

// Count returns the total number of registered agents.
func (r *Registry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.agents)
}

// CountByStatus returns the number of agents with the given status.
func (r *Registry) CountByStatus(status Status) int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	count := 0
	for _, inst := range r.agents {
		if inst.Status == status {
			count++
		}
	}
	return count
}

// GetChildren returns the agent instance IDs that are direct children of the
// given parent, forming the agent tree. This maps to Codex's AgentPath tree
// pattern: /parent/child1, /parent/child2.
func (r *Registry) GetChildren(parentID string) []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var children []string
	for id, inst := range r.agents {
		if inst.ParentID == parentID {
			children = append(children, id)
		}
	}
	return children
}

// AncestorChain returns the full delegation chain for an agent instance,
// walking parent references up to the root. Used for cycle detection
// (Layer 2: Runtime Tracker from 03-orchestration.md).
func (r *Registry) AncestorChain(id string) []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var chain []string
	current := id
	visited := make(map[string]bool)
	for current != "" {
		if visited[current] {
			chain = append(chain, current)
			break // cycle detected
		}
		visited[current] = true
		chain = append(chain, current)
		inst, ok := r.agents[current]
		if !ok || inst.ParentID == "" {
			break
		}
		current = inst.ParentID
	}
	return chain
}

// MaxDepth returns the maximum delegation depth among registered agents.
func (r *Registry) MaxDepth() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	max := 0
	for _, inst := range r.agents {
		if inst.Depth > max {
			max = inst.Depth
		}
	}
	return max
}

// GetByRunID returns the agent instance associated with the given run ID.
// Returns nil if no agent matches.
func (r *Registry) GetByRunID(runID string) *AgentInstance {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, inst := range r.agents {
		if inst.RunID == runID {
			cloned := *inst
			return &cloned
		}
	}
	return nil
}
