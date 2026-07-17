package dispatch

// Domain event type strings published by DispatchService cancel / regenerate.
const (
	EventTypeAgentCancel     = "agent.cancel"
	EventTypeAgentRegenerate = "agent.regenerate"
)

// CancelEventPayload builds the agent.cancel bus payload map.
func CancelEventPayload(taskID, agentInstanceID, sessionID, triggeredBy string) map[string]string {
	return map[string]string{
		"task_id":           taskID,
		"agent_instance_id": agentInstanceID,
		"session_id":        sessionID,
		"triggered_by":      triggeredBy,
	}
}

// RegenerateEventPayload builds the agent.regenerate bus payload map.
func RegenerateEventPayload(originalTaskID, newTaskID, agentInstanceID, sessionID, triggerMessageID string) map[string]string {
	return map[string]string{
		"original_task_id":   originalTaskID,
		"new_task_id":        newTaskID,
		"agent_instance_id":  agentInstanceID,
		"session_id":         sessionID,
		"trigger_message_id": triggerMessageID,
	}
}
