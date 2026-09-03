// Package agents provides the Agent Registry and inter-agent message queue
// for the AgentHub Orchestrator. It tracks runtime agent instances, their
// status, and enables communication between orchestrator and sub-agents.
//
// Reference: historical codex-cli AgentTree pattern indexed by docs/history.md.
//
// Residual pure-helper peel #1154: Registry core API stays here; types,
// filtered lookup, status mutators, spawn-slot checks, and shutdown cascade
// live in registry_types / registry_lookup / registry_status / registry_spawn /
// registry_shutdown companions. Zero behavior change — pure move only.
package agents

import (
	"fmt"
	"sync"
	"time"
)

// Registry tracks active agent instances and provides query/status operations.
// It is the runtime counterpart to adapters.Registry (which holds adapter
// definitions, not instances).
type Registry struct {
	mu            sync.RWMutex
	agents        map[string]*AgentInstance
	maxConcurrent int            // max sub-agents per parent; 0 means use DefaultMaxConcurrent
	childrenCount map[string]int // per-parent active child count for MaxChildrenPerAgent enforcement
}

// NewRegistry creates an empty agent registry.
func NewRegistry() *Registry {
	return &Registry{
		agents:        make(map[string]*AgentInstance),
		childrenCount: make(map[string]int),
		maxConcurrent: DefaultMaxConcurrent,
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
// If the instance has a non-empty ParentID, the parent's active child count
// is decremented automatically. Callers that have already called DecrChildCount
// separately should set decrChild=false to avoid double-decrement.
func (r *Registry) Unregister(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	inst, ok := r.agents[id]
	if !ok {
		return false
	}
	if inst.ParentID != "" {
		r.childrenCount[inst.ParentID]--
		if r.childrenCount[inst.ParentID] <= 0 {
			delete(r.childrenCount, inst.ParentID)
		}
	}
	delete(r.agents, id)
	return true
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

// Count returns the total number of registered agents.
func (r *Registry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.agents)
}

// WithMaxConcurrent sets the maximum concurrent sub-agents per parent and
// returns the registry for fluent chaining. Values <= 0 are ignored.
func (r *Registry) WithMaxConcurrent(n int) *Registry {
	if n > 0 {
		r.mu.Lock()
		r.maxConcurrent = n
		r.mu.Unlock()
	}
	return r
}

// MaxConcurrent returns the configured max concurrent sub-agents per parent.
func (r *Registry) MaxConcurrent() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.maxConcurrent <= 0 {
		return DefaultMaxConcurrent
	}
	return r.maxConcurrent
}
