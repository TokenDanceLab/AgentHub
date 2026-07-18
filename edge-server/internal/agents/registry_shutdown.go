package agents

// Residual pure-helper peel #1154: ShutdownCascade tree walk and pure
// dedupe helper extracted from registry.go. Same package agents; zero
// behavior change.

import "time"

// ShutdownCascade recursively marks the agent tree rooted at rootID as
// StatusDisconnected and returns descendant run IDs for process cancellation.
//
// rootID may be either:
//   - a parent run ID (SpawnSubAgent registers children with ParentID=parentRunID
//     under a distinct agentInstanceID), or
//   - an agent instance ID (instance-keyed trees / tests).
//
// The root agent does not need to be registered under rootID: children are
// always discovered by ParentID match. Nested spawns set ParentID to the
// immediate parent's run ID, so recursion follows each child's RunID (and also
// its instance ID for instance-keyed trees).
//
// This implements the Codex AgentTree pattern where closing a parent agent
// terminates the entire subtree (#1001).
func (r *Registry) ShutdownCascade(rootID string) []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return dedupeNonEmpty(r.shutdownTree(rootID, make(map[string]struct{})))
}

// shutdownTree is the recursive worker for ShutdownCascade. Caller must hold
// r.mu write lock. Returns run IDs of disconnected descendants (not the root).
// visited guards against ParentID cycles and dual RunID/instance-ID walks.
func (r *Registry) shutdownTree(id string, visited map[string]struct{}) []string {
	if id == "" {
		return nil
	}
	if _, seen := visited[id]; seen {
		return nil
	}
	visited[id] = struct{}{}

	// Mark the agent registered under this ID when present. Missing root is
	// intentional for parent-run-ID cascade (children key ParentID=runID).
	if inst, ok := r.agents[id]; ok {
		inst.Status = StatusDisconnected
		inst.LastSeen = time.Now()
	}

	// Collect child instance IDs first to avoid modifying the map while iterating.
	var children []string
	for childID, child := range r.agents {
		if child.ParentID == id {
			children = append(children, childID)
		}
	}

	var runIDs []string
	for _, childID := range children {
		child := r.agents[childID]
		child.Status = StatusDisconnected
		child.LastSeen = time.Now()
		if child.RunID != "" {
			runIDs = append(runIDs, child.RunID)
			// Nested SpawnSubAgent sets ParentID to this child's run ID.
			runIDs = append(runIDs, r.shutdownTree(child.RunID, visited)...)
		}
		// Instance-keyed trees (and any ParentID=instanceID linkage).
		runIDs = append(runIDs, r.shutdownTree(childID, visited)...)
	}
	return runIDs
}

// dedupeNonEmpty preserves first-seen order while dropping empty strings and
// duplicates from cascade run-ID collection.
func dedupeNonEmpty(ids []string) []string {
	if len(ids) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(ids))
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}
