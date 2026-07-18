package dispatch

import "github.com/agenthub/hub-server/internal/model"

// IsTerminalTaskStatus reports whether a pending agent task is in a terminal
// status (done / failed / cancelled / timeout). Used by CancelTask guards.
func IsTerminalTaskStatus(status string) bool {
	switch status {
	case model.TaskStatusDone, model.TaskStatusFailed, model.TaskStatusCancelled, model.TaskStatusTimeout:
		return true
	default:
		return false
	}
}

// IsCancelledTaskStatus is true only for cancelled terminal tasks.
func IsCancelledTaskStatus(status string) bool {
	return status == model.TaskStatusCancelled
}

// CanRegenerateTaskStatus reports whether RegenerateAgentTask may create a new
// task from this status (terminal only).
func CanRegenerateTaskStatus(status string) bool {
	return IsTerminalTaskStatus(status)
}

// IsRetryableTaskStatus reports whether redispatch may retry a delivery for
// this pending-task status (queued / dispatched only).
// Running is excluded (#1000): Edge is already executing — redispatch would
// duplicate work. Stream/done auto-ack the outbox; this is the safety net.
func IsRetryableTaskStatus(status string) bool {
	switch status {
	case model.TaskStatusQueued, model.TaskStatusDispatched:
		return true
	default:
		return false
	}
}
