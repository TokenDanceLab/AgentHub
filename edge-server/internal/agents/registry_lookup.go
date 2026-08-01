package agents

// Residual pure-helper peel #1154: filtered list/find/count and tree-walk
// lookup methods extracted from registry.go. Same package agents; zero
// behavior change.

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

// CountActiveByParent returns the number of non-terminal agents whose ParentID
// matches the given parent. Terminal states (completed, error, disconnected)
// are excluded from the count because they no longer consume a spawn slot.
func (r *Registry) CountActiveByParent(parentID string) int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	count := 0
	for _, inst := range r.agents {
		if inst.ParentID != parentID {
			continue
		}
		switch inst.Status {
		case StatusCompleted, StatusError, StatusDisconnected:
			continue
		case StatusOnline, StatusBusy, StatusIdle, StatusWaitingInput, StatusDraining:
			count++
		}
	}
	return count
}
