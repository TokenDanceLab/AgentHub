package api

import (
	"strings"
	"sync"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/events"
)

const defaultPendingPermissionTTL = 10 * time.Minute

type permissionKey struct {
	runID     string
	requestID string
}

// PendingPermission records a permission request emitted by a live run.
type PendingPermission struct {
	ProjectID string
	ThreadID  string
	RunID     string
	RequestID string
	ToolName  string
	ToolUseID string
	CreatedAt time.Time
}

// PermissionRegistry tracks permission requests that can still accept a
// decision from the Desktop approval UI.
type PermissionRegistry struct {
	mu      sync.Mutex
	pending map[permissionKey]PendingPermission
	ttl     time.Duration
	now     func() time.Time
}

func NewPermissionRegistry(ttl time.Duration) *PermissionRegistry {
	if ttl <= 0 {
		ttl = defaultPendingPermissionTTL
	}
	return &PermissionRegistry{
		pending: make(map[permissionKey]PendingPermission),
		ttl:     ttl,
		now:     time.Now,
	}
}

func (r *PermissionRegistry) Register(permission PendingPermission) bool {
	permission.RunID = strings.TrimSpace(permission.RunID)
	permission.RequestID = strings.TrimSpace(permission.RequestID)
	if permission.RunID == "" || permission.RequestID == "" {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.cleanupExpiredLocked()
	if permission.CreatedAt.IsZero() {
		permission.CreatedAt = r.now()
	}
	r.pending[permissionKey{runID: permission.RunID, requestID: permission.RequestID}] = permission
	return true
}

func (r *PermissionRegistry) Consume(runID, requestID string) (PendingPermission, bool) {
	runID = strings.TrimSpace(runID)
	requestID = strings.TrimSpace(requestID)
	if runID == "" || requestID == "" {
		return PendingPermission{}, false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.cleanupExpiredLocked()
	key := permissionKey{runID: runID, requestID: requestID}
	permission, ok := r.pending[key]
	if !ok {
		return PendingPermission{}, false
	}
	delete(r.pending, key)
	return permission, true
}

func (r *PermissionRegistry) ObserveEvent(evt events.EventEnvelope) {
	switch evt.Type {
	case adapters.BusEventPermissionRequested:
		permission := PendingPermission{
			ProjectID: valueString(evt.Payload, evt.Scope, "projectId"),
			ThreadID:  valueString(evt.Payload, evt.Scope, "threadId"),
			RunID:     valueString(evt.Payload, evt.Scope, "runId"),
			RequestID: valueString(evt.Payload, nil, "requestId"),
			ToolName:  valueString(evt.Payload, nil, "toolName"),
			ToolUseID: valueString(evt.Payload, nil, "toolUseId"),
		}
		r.Register(permission)
	case adapters.BusEventPermissionDecided:
		runID := valueString(evt.Payload, evt.Scope, "runId")
		requestID := valueString(evt.Payload, nil, "requestId")
		_, _ = r.Consume(runID, requestID)
	}
}

func (r *PermissionRegistry) cleanupExpiredLocked() {
	if r.ttl <= 0 {
		return
	}
	cutoff := r.now().Add(-r.ttl)
	for key, permission := range r.pending {
		if !permission.CreatedAt.IsZero() && permission.CreatedAt.Before(cutoff) {
			delete(r.pending, key)
		}
	}
}

func valueString(payload any, scope map[string]any, key string) string {
	if payloadMap, ok := payload.(map[string]any); ok {
		if value, ok := payloadMap[key].(string); ok {
			return strings.TrimSpace(value)
		}
	}
	if value, ok := scope[key].(string); ok {
		return strings.TrimSpace(value)
	}
	return ""
}
