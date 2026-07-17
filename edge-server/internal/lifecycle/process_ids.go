package lifecycle

// subAgentRunID builds the stable run ID for a dispatched sub-agent task.
func subAgentRunID(taskID string) string {
	return "run_" + taskID
}

// subAgentInstanceID builds the stable agent instance ID for a dispatched sub-agent task.
func subAgentInstanceID(taskID string) string {
	return "agent_" + taskID
}

// subAgentMessageID builds the inter-agent message ID for a completed sub-agent run.
func subAgentMessageID(runID string) string {
	return "msg_" + runID
}

// resolveSubAgentThreadID returns the task-provided ThreadID when set; otherwise
// a hierarchical child thread ID derived from the parent so context stays isolated.
func resolveSubAgentThreadID(parentThreadID, runID, taskThreadID string) string {
	if taskThreadID != "" {
		return taskThreadID
	}
	return parentThreadID + "/sub/" + runID
}

// subAgentPath builds the hierarchical agent path for registry registration.
func subAgentPath(parentRunID, agentInstanceID string) string {
	return "/" + parentRunID + "/" + agentInstanceID
}

// appendSystemPromptPrefix prepends prefix to an existing system prompt with a
// blank-line separator when both are non-empty.
func appendSystemPromptPrefix(existing, prefix string) string {
	if prefix == "" {
		return existing
	}
	if existing != "" {
		return prefix + "\n\n" + existing
	}
	return prefix
}
