package runners

import (
	"sync"
)

// RunnerInfo describes a registered runner.
type RunnerInfo struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Status       string   `json:"status"`
	Capabilities []string `json:"capabilities"`
}

// Registry is an in-memory runner registry.
type Registry struct {
	mu      sync.RWMutex
	runners map[string]RunnerInfo
}

// NewRegistry creates a new runner registry and pre-populates it
// with a single mock runner.
func NewRegistry() *Registry {
	r := &Registry{
		runners: make(map[string]RunnerInfo),
	}
	// Pre-populate with one mock runner.
	mock := RunnerInfo{
		ID:           "runner_local_1",
		Name:         "Mock Runner (local)",
		Status:       "online",
		Capabilities: []string{"mock", "shell"},
	}
	r.runners[mock.ID] = mock
	return r
}

// List returns the current list of runners.
func (r *Registry) List() []RunnerInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make([]RunnerInfo, 0, len(r.runners))
	for _, info := range r.runners {
		result = append(result, info)
	}
	return result
}

// Get returns a runner by ID.
func (r *Registry) Get(id string) (RunnerInfo, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	info, ok := r.runners[id]
	return info, ok
}

// Upsert adds or updates a runner.
func (r *Registry) Upsert(info RunnerInfo) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.runners[info.ID] = info
}

// Remove deletes a runner by ID.
func (r *Registry) Remove(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.runners, id)
}
