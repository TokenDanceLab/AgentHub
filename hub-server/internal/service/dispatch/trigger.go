package dispatch

import "strings"

// ApplyValidatedTarget maps a validated TargetSnapshot onto trigger task fields.
// When target is nil (no target requested / validation no-op), all returns are empty.
func ApplyValidatedTarget(target *TargetSnapshot) (targetID, targetType, edgeDeviceID string) {
	if target == nil {
		return "", "", ""
	}
	return target.ID, target.TargetType, target.DeviceID
}

// CustomAgentIDValue returns the trimmed non-empty custom agent id pointer value, or "".
func CustomAgentIDValue(customAgentID *string) string {
	if customAgentID == nil {
		return ""
	}
	return strings.TrimSpace(*customAgentID)
}

// NeedsCustomAgentPreload is true when TriggerAgentTask should load the custom
// agent profile before spawning the dispatch goroutine.
func NeedsCustomAgentPreload(customAgentID *string) bool {
	return CustomAgentIDValue(customAgentID) != ""
}

// HasCustomAgentBinding is true when an agent instance is bound to a custom agent.
func HasCustomAgentBinding(customAgentID *string) bool {
	return CustomAgentIDValue(customAgentID) != ""
}
