package agents

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
