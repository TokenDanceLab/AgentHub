package lifecycle

import "github.com/agenthub/edge-server/internal/agents"

// subAgentResultMsgType maps a terminal run status to the inter-agent message type.
func subAgentResultMsgType(status string) string {
	switch status {
	case "failed", "cancelled":
		return agents.MsgTypeError
	default:
		return agents.MsgTypeResult
	}
}

// subAgentRegistryTerminalStatus returns the agent registry status to apply when
// a sub-agent run ends, and whether the registry should be updated.
//
// completed_with_issues is terminal for the evidence gate but still a result, so
// the registry is set to StatusCompleted (not left running indefinitely).
func subAgentRegistryTerminalStatus(status string) (registryStatus agents.Status, update bool) {
	switch status {
	case "failed", "cancelled":
		return agents.StatusError, true
	case "finished", "completed_with_issues":
		return agents.StatusCompleted, true
	default:
		return "", false
	}
}
