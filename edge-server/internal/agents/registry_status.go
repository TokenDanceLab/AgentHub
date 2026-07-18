package agents

// Residual pure-helper peel #1154: status/run binding and per-parent child
// count mutators extracted from registry.go. Same package agents; zero
// behavior change.

import "time"

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

// IncrChildCount increments the active child count for the given parent.
// It must only be called after a child agent is successfully registered.
func (r *Registry) IncrChildCount(parentID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.childrenCount[parentID]++
}

// DecrChildCount decrements the active child count for the given parent.
// It must be called when a child agent completes, fails, or is cancelled.
func (r *Registry) DecrChildCount(parentID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.childrenCount[parentID]--
	if r.childrenCount[parentID] <= 0 {
		delete(r.childrenCount, parentID)
	}
}
