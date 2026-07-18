package agents

// Residual pure-helper peel #1154: spawn-slot reservation and diagnostic
// CanSpawn checks extracted from registry.go. Same package agents; zero
// behavior change.

// TryReserveSlot atomically checks spawn constraints (concurrent slot limit,
// per-parent child cap, depth limit) and, if all pass, reserves a slot by
// incrementing childrenCount[parentID] under the same write lock.
//
// This replaces the separate CanSpawn + IncrChildCount call pattern which had
// a TOCTOU race: two concurrent goroutines could both pass CanSpawn (seeing
// count=4) and both subsequently increment, exceeding MaxChildrenPerAgent=5.
//
// Returns nil if the slot is reserved. Callers MUST pair a successful
// TryReserveSlot with DecrChildCount when the child terminates, even if
// registration subsequently fails.
func (r *Registry) TryReserveSlot(parentID string, childDepth int) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	maxConc := r.maxConcurrent
	if maxConc <= 0 {
		maxConc = DefaultMaxConcurrent
	}

	active := 0
	for _, inst := range r.agents {
		if inst.ParentID != parentID {
			continue
		}
		switch inst.Status {
		case StatusCompleted, StatusError, StatusDisconnected:
			continue
		default:
			active++
		}
	}
	if active >= maxConc {
		return ErrAgentSlotFull
	}

	// Per-parent spawn limit: prevent a single parent from spawning more than
	// MaxChildrenPerAgent children concurrently, even within global slot limits.
	if r.childrenCount[parentID] >= MaxChildrenPerAgent {
		return ErrMaxChildrenPerAgentReached
	}

	if childDepth >= MaxAgentDepth {
		return ErrAgentDepthExceeded
	}

	// All constraints pass — reserve the slot atomically.
	r.childrenCount[parentID]++
	return nil
}

// CanSpawn checks whether a new child can be spawned under the given parent
// WITHOUT reserving a slot. This is a read-only diagnostic method — it does
// not increment childrenCount and therefore has a TOCTOU race if used for
// slot enforcement. Production code should use TryReserveSlot instead.
//
// Kept for testing and diagnostic use where a side-effect-free check is needed.
func (r *Registry) CanSpawn(parentID string, childDepth int) error {
	r.mu.RLock()
	defer r.mu.RUnlock()

	maxConc := r.maxConcurrent
	if maxConc <= 0 {
		maxConc = DefaultMaxConcurrent
	}

	active := 0
	for _, inst := range r.agents {
		if inst.ParentID != parentID {
			continue
		}
		switch inst.Status {
		case StatusCompleted, StatusError, StatusDisconnected:
			continue
		default:
			active++
		}
	}
	if active >= maxConc {
		return ErrAgentSlotFull
	}

	if r.childrenCount[parentID] >= MaxChildrenPerAgent {
		return ErrMaxChildrenPerAgentReached
	}

	if childDepth >= MaxAgentDepth {
		return ErrAgentDepthExceeded
	}

	return nil
}
