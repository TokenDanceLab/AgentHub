package agentevent

import "encoding/json"

// StampAgentTaskRef records the producing agent task inside an agent message's
// jsonb content as `agent_task: {"task_id": "<task id>"}` (#2274).
//
// That is the exact shape the transcript normalizer parses on the client side
// (app/shared/src/transcript/normalizeHubMessages.ts →
// agentTaskFromRecord → block.agentTaskId).
//
// Contract rules:
//   - only object-shaped content is stamped; arrays/scalars pass through
//     untouched so user-visible payload is never reshaped;
//   - an existing `agent_task` ref is never overwritten;
//   - empty task id or invalid json leaves the content unchanged.
func StampAgentTaskRef(content string, taskID string) string {
	return stampAgentTaskRef(content, taskID, "")
}

// StampAgentTaskFinalRef marks the completed reply, so live deltas can yield
// to the authoritative history message without hiding runtime evidence.
func StampAgentTaskFinalRef(content string, taskID string) string {
	return stampAgentTaskRef(content, taskID, "done")
}

func stampAgentTaskRef(content string, taskID string, status string) string {
	if taskID == "" || content == "" {
		return content
	}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal([]byte(content), &obj); err != nil || obj == nil {
		return content
	}
	if _, exists := obj["agent_task"]; exists {
		return content
	}
	fields := map[string]string{"task_id": taskID}
	if status != "" {
		fields["status"] = status
	}
	ref, err := json.Marshal(fields)
	if err != nil {
		return content
	}
	obj["agent_task"] = ref
	out, err := json.Marshal(obj)
	if err != nil {
		return content
	}
	return string(out)
}
