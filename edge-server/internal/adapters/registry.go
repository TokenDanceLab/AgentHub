package adapters

import (
	"fmt"
	"sync"
)

var cliAdapterIDs = map[string]struct{}{
	"claude-code":   {},
	"codex":         {},
	"codex-acp":     {}, // official @agentclientprotocol/codex-acp (ACP migration, first target)
	"opencode":      {},
	"opencode-acp":  {}, // native `opencode acp` subcommand (ACP migration, second target)
	"claude-acp":    {}, // official @agentclientprotocol/claude-agent-acp (ACP migration, third target)
	"anthropic-sdk": {},
	"openai-sdk":    {},
}

// sdkAdapterIDs tracks adapters that use direct HTTP API calls instead of CLI subprocesses.
var sdkAdapterIDs = map[string]struct{}{
	"anthropic-sdk": {},
	"openai-sdk":    {},
}

// IsSDKAdapter reports whether an adapter ID belongs to an SDK adapter that
// uses direct HTTP calls rather than spawning a CLI subprocess.
func IsSDKAdapter(id string) bool {
	_, ok := sdkAdapterIDs[id]
	return ok
}

// ValidateCLIAdapterID checks the runtime IDs that Edge may expose as real CLI
// adapter targets. The mock runner and orchestrator are separate execution
// modes, not direct CLI adapter IDs for real CLI smoke readiness.
func ValidateCLIAdapterID(id string) error {
	if _, ok := cliAdapterIDs[id]; ok {
		return nil
	}
	return fmt.Errorf("unsupported CLI adapter %q; supported values: claude-code, codex, codex-acp, opencode, opencode-acp, claude-acp, anthropic-sdk, openai-sdk", id)
}

// Registry manages available agent adapters.
type Registry struct {
	mu       sync.RWMutex
	adapters map[string]AgentAdapter
	defaults map[string]string // role -> adapterID
}

// NewRegistry creates an empty adapter registry.
func NewRegistry() *Registry {
	return &Registry{
		adapters: make(map[string]AgentAdapter),
		defaults: make(map[string]string),
	}
}

// Register adds an adapter. Returns an error if the ID is already registered.
func (r *Registry) Register(a AgentAdapter) error {
	id := a.Metadata().ID
	if id == "" {
		return fmt.Errorf("adapter metadata ID is required")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.adapters[id]; ok {
		return fmt.Errorf("adapter %q already registered", id)
	}
	r.adapters[id] = a
	return nil
}

// Get returns an adapter by ID.
func (r *Registry) Get(id string) (AgentAdapter, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	a, ok := r.adapters[id]
	return a, ok
}

// List returns metadata for all registered adapters.
func (r *Registry) List() []AdapterMetadata {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]AdapterMetadata, 0, len(r.adapters))
	for _, a := range r.adapters {
		result = append(result, a.Metadata())
	}
	return result
}

// ListIDs returns the IDs of all registered adapters.
func (r *Registry) ListIDs() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	ids := make([]string, 0, len(r.adapters))
	for id := range r.adapters {
		ids = append(ids, id)
	}
	return ids
}

// SetDefault sets the default adapter for a role.
// Common roles: "default" (1v1 chat), "orchestrator" (group chat coordinator).
func (r *Registry) SetDefault(role, adapterID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.defaults[role] = adapterID
}

// Default returns the default adapter for a role.
func (r *Registry) Default(role string) (AgentAdapter, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	id, ok := r.defaults[role]
	if !ok {
		return nil, false
	}
	return r.Get(id)
}

// Resolve returns the adapter for the given agentID, falling back to the
// "default" role if agentID is empty.
func (r *Registry) Resolve(agentID string) (AgentAdapter, error) {
	if agentID != "" {
		a, ok := r.Get(agentID)
		if !ok {
			return nil, fmt.Errorf("agent adapter %q not found", agentID)
		}
		return a, nil
	}
	a, ok := r.Default("default")
	if !ok {
		return nil, fmt.Errorf("no default agent adapter configured")
	}
	return a, nil
}
