package dispatch

import "github.com/agenthub/hub-server/internal/errcode"

// IsTaskOwner reports whether the caller owns the pending task.
func IsTaskOwner(triggeredByUserID, userID string) bool {
	return triggeredByUserID == userID
}

// CancelTaskTerminalError returns the historical CancelTask error for a terminal
// task status: AgentTaskCancelled for cancelled, AgentTaskTimeout otherwise.
// Non-terminal status returns nil (caller proceeds with cancel).
func CancelTaskTerminalError(status string) error {
	if !IsTerminalTaskStatus(status) {
		return nil
	}
	if IsCancelledTaskStatus(status) {
		return errcode.AgentTaskCancelled
	}
	return errcode.AgentTaskTimeout
}

// RegenerateTaskStatusError returns ErrBadRequest when status is not regenerable.
// Terminal statuses return nil.
func RegenerateTaskStatusError(status string) error {
	if CanRegenerateTaskStatus(status) {
		return nil
	}
	return errcode.ErrBadRequest.WithMessage("can only regenerate completed or failed tasks")
}

// TaskNotFoundIfNotOwner returns AgentTaskNotFound when the caller does not own
// the task; nil when ownership matches.
func TaskNotFoundIfNotOwner(triggeredByUserID, userID string) error {
	if IsTaskOwner(triggeredByUserID, userID) {
		return nil
	}
	return errcode.AgentTaskNotFound
}

// NewPendingTaskSnapshot builds a PendingTaskSnapshot from column values.
func NewPendingTaskSnapshot(
	id, agentInstanceID, triggeredByUserID, status, edgeDeviceID, edgeRunID, targetID string,
) PendingTaskSnapshot {
	return PendingTaskSnapshot{
		ID:                id,
		AgentInstanceID:   agentInstanceID,
		TriggeredByUserID: triggeredByUserID,
		Status:            status,
		EdgeDeviceID:      edgeDeviceID,
		EdgeRunID:         edgeRunID,
		TargetID:          targetID,
	}
}
