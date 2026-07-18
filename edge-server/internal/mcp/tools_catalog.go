package mcp

// Residual pure-helper peel: MCP tools/list catalog (#1104).
// listTools tool definitions (canonical + deprecated aliases).

// listTools returns all available MCP tools for discovery.
//
// Two naming schemes exist:
//   - Canonical: agenthub_ prefixed names (e.g. agenthub_list_projects) — the
//     authoritative names that should be used by all new integrations.
//   - Deprecated: unprefixed aliases (e.g. list_projects) — kept for backward
//     compatibility during migration. Each lists [DEPRECATED] in its description.
//     These will be removed in a future release.
//
// Both sets are listed during discovery so MCP clients can see the full
// migration path during tools/list.
func (s *Server) listTools() []Tool {
	return []Tool{
		// === Canonical agenthub_ prefixed names ===
		{
			Name:        "agenthub_list_projects",
			Description: "List all projects in the AgentHub Edge workspace.\nExample: {\"name\": \"agenthub_list_projects\"}\nOutput: JSON object with \"projects\" array (each has id, name, description, createdAt) and \"count\" integer.\nErrors: Returns an error if the store is not configured.",
			InputSchema: jsonSchema(`{
				"type": "object",
				"properties": {},
				"required": []
			}`),
		},
		{
			Name:        "agenthub_list_threads",
			Description: "List all threads in an AgentHub Edge project, with their ID, title, and status.\nExample: {\"name\": \"agenthub_list_threads\", \"arguments\": {\"projectId\": \"proj_abc123\"}}\nOutput: JSON object with \"threads\" array (each has threadId, title, status, createdAt) and \"count\" integer.\nErrors: Returns an error if the project does not exist or projectId is missing.",
			InputSchema: jsonSchema(`{
				"type": "object",
				"properties": {
					"projectId": {
						"type": "string",
						"description": "The project ID to list threads for."
					}
				},
				"required": ["projectId"]
			}`),
		},
		{
			Name:        "agenthub_get_thread",
			Description: "Get detailed information about an AgentHub Edge thread, including recent messages, runs, and any active run.\nExample: {\"name\": \"agenthub_get_thread\", \"arguments\": {\"threadId\": \"thread_xyz\"}}\nOutput: JSON object with \"thread\" details, \"recentItems\" (up to 20 most recent items), \"itemCount\", \"runs\" array, and optionally \"activeRun\" if one is in progress.\nErrors: Returns an error if the thread does not exist or threadId is missing.",
			InputSchema: jsonSchema(`{
				"type": "object",
				"properties": {
					"threadId": {
						"type": "string",
						"description": "The thread ID to retrieve."
					}
				},
				"required": ["threadId"]
			}`),
		},
		{
			Name:        "agenthub_start_run",
			Description: "Start a new agent run on an AgentHub Edge thread. The configured agent will execute the given prompt and produce streaming events.\nExample: {\"name\": \"agenthub_start_run\", \"arguments\": {\"projectId\": \"proj_abc\", \"threadId\": \"thread_xyz\", \"prompt\": \"Fix the N+1 query in user list\", \"agentId\": \"claude-code\", \"model\": \"claude-sonnet-4-20250514\", \"workDir\": \"/path/to/workspace\"}}\nOutput: JSON object with \"runId\", \"projectId\", \"threadId\", \"status\" (\"started\"), and \"message\".\nErrors: Returns an error if workDir is missing/empty, the thread already has an active run, the project or thread is not found, workDir is outside the configured allowlist, required fields are missing, or the executor failed to start the run.",
			InputSchema: jsonSchema(`{
				"type": "object",
				"properties": {
					"projectId": {
						"type": "string",
						"description": "The project ID."
					},
					"threadId": {
						"type": "string",
						"description": "The thread ID to run in."
					},
					"prompt": {
						"type": "string",
						"description": "The user prompt/message to send to the agent."
					},
					"agentId": {
						"type": "string",
						"description": "Optional agent adapter ID (e.g., 'claude-code', 'codex')."
					},
					"model": {
						"type": "string",
						"description": "Optional model override."
					},
					"workDir": {
						"type": "string",
						"description": "Required working directory for the agent run; must be non-empty and inside the Edge workspace allowlist."
					}
				},
				"required": ["projectId", "threadId", "prompt", "workDir"]
			}`),
		},
		{
			Name:        "agenthub_get_run_status",
			Description: "Query the current status and lifecycle timestamps of an AgentHub Edge agent run. Use this to poll for completion after starting a run.\nExample: {\"name\": \"agenthub_get_run_status\", \"arguments\": {\"runId\": \"run_abc123\"}}\nOutput: JSON object with \"runId\", \"projectId\", \"threadId\", \"status\" (one of queued/started/completed/failed/cancelled), \"createdAt\", \"startedAt\", \"finishedAt\".\nErrors: Returns an error if the run is not found or runId is missing.",
			InputSchema: jsonSchema(`{
				"type": "object",
				"properties": {
					"runId": {
						"type": "string",
						"description": "The run ID to query."
					}
				},
				"required": ["runId"]
			}`),
		},
		{
			Name:        "agenthub_approve_action",
			Description: "Approve or deny a pending permission request from an AgentHub Edge agent run. Use this when an agent run is blocked waiting for human approval to execute a tool or action.\nExample: {\"name\": \"agenthub_approve_action\", \"arguments\": {\"runId\": \"run_abc\", \"requestId\": \"perm_123\", \"decision\": \"allow\", \"reason\": \"Safe operation on known file\"}}\nOutput: JSON object with \"status\" (\"ok\"), \"decision\", \"toolName\", and \"requestId\".\nErrors: Returns an error if the permission request is not found (may have expired or already been decided), the decision is not \"allow\" or \"deny\", required fields are missing, or the permission registry is not configured.",
			InputSchema: jsonSchema(`{
				"type": "object",
				"properties": {
					"runId": {
						"type": "string",
						"description": "The run ID that has the pending permission request."
					},
					"requestId": {
						"type": "string",
						"description": "The permission request ID."
					},
					"decision": {
						"type": "string",
						"enum": ["allow", "deny"],
						"description": "Whether to allow or deny the action."
					},
					"reason": {
						"type": "string",
						"description": "Optional reason for the decision."
					}
				},
				"required": ["runId", "requestId", "decision"]
			}`),
		},
		{
			Name:        "agenthub_cancel_run",
			Description: "Cancel a running AgentHub Edge agent run. Safe to call on any run state — returns the resulting status without error if the run is already terminal.\nExample: {\"name\": \"agenthub_cancel_run\", \"arguments\": {\"runId\": \"run_abc123\"}}\nOutput: JSON object with \"runId\" and \"status\" (e.g. \"cancelling\", \"cancelled\", \"failed\", or unchanged if already terminal).\nErrors: Returns an error if the run is not found, the executor is not configured, or runId is missing.",
			InputSchema: jsonSchema(`{
				"type": "object",
				"properties": {
					"runId": {
						"type": "string",
						"description": "The run ID to cancel."
					}
				},
				"required": ["runId"]
			}`),
		},
		{
			Name:        "agenthub_send_message",
			Description: "Send a message to an AgentHub Edge thread for multi-turn conversations with an agent. Messages appear in the thread timeline and are visible to the agent on its next run.\nExample: {\"name\": \"agenthub_send_message\", \"arguments\": {\"threadId\": \"thread_xyz\", \"content\": \"Please also add unit tests for the new endpoint.\", \"role\": \"user\"}}\nOutput: JSON object with \"itemId\", \"threadId\", \"role\", and \"status\" (\"created\").\nErrors: Returns an error if the thread is not found, content is empty, role is invalid (must be \"user\" or \"system\"), or the store is not configured.",
			InputSchema: jsonSchema(`{
				"type": "object",
				"properties": {
					"threadId": {
						"type": "string",
						"description": "The thread ID to send the message to."
					},
					"content": {
						"type": "string",
						"description": "The message content."
					},
					"role": {
						"type": "string",
						"enum": ["user", "system"],
						"description": "The message role (default: user)."
					}
				},
				"required": ["threadId", "content"]
			}`),
		},
		// === Deprecated unprefixed aliases (for migration visibility) ===
		{
			Name:        "list_projects",
			Description: "[DEPRECATED] Use agenthub_list_projects instead. This alias will be removed in a future release.\nList all projects in the AgentHub Edge workspace.",
			InputSchema: jsonSchema(`{
				"type": "object",
				"properties": {},
				"required": []
			}`),
		},
		{
			Name:        "list_threads",
			Description: "[DEPRECATED] Use agenthub_list_threads instead. This alias will be removed in a future release.\nList all threads in an AgentHub Edge project.",
			InputSchema: jsonSchema(`{
				"type": "object",
				"properties": {
					"projectId": {
						"type": "string",
						"description": "The project ID to list threads for."
					}
				},
				"required": ["projectId"]
			}`),
		},
		{
			Name:        "get_thread",
			Description: "[DEPRECATED] Use agenthub_get_thread instead. This alias will be removed in a future release.\nGet detailed information about an AgentHub Edge thread.",
			InputSchema: jsonSchema(`{
				"type": "object",
				"properties": {
					"threadId": {
						"type": "string",
						"description": "The thread ID to retrieve."
					}
				},
				"required": ["threadId"]
			}`),
		},
		{
			Name:        "start_run",
			Description: "[DEPRECATED] Use agenthub_start_run instead. This alias will be removed in a future release.\nStart a new agent run on an AgentHub Edge thread.",
			InputSchema: jsonSchema(`{
				"type": "object",
				"properties": {
					"projectId": {"type": "string", "description": "The project ID."},
					"threadId": {"type": "string", "description": "The thread ID to run in."},
					"prompt": {"type": "string", "description": "The user prompt/message."},
					"agentId": {"type": "string", "description": "Optional agent adapter ID."},
					"model": {"type": "string", "description": "Optional model override."},
					"workDir": {"type": "string", "description": "Required working directory for the agent run."}
				},
				"required": ["projectId", "threadId", "prompt", "workDir"]
			}`),
		},
		{
			Name:        "get_run_status",
			Description: "[DEPRECATED] Use agenthub_get_run_status instead. This alias will be removed in a future release.\nQuery the current status of an AgentHub Edge agent run.",
			InputSchema: jsonSchema(`{
				"type": "object",
				"properties": {
					"runId": {"type": "string", "description": "The run ID to query."}
				},
				"required": ["runId"]
			}`),
		},
		{
			Name:        "approve_action",
			Description: "[DEPRECATED] Use agenthub_approve_action instead. This alias will be removed in a future release.\nApprove or deny a pending permission request from an agent run.",
			InputSchema: jsonSchema(`{
				"type": "object",
				"properties": {
					"runId": {"type": "string", "description": "The run ID."},
					"requestId": {"type": "string", "description": "The permission request ID."},
					"decision": {"type": "string", "enum": ["allow", "deny"], "description": "allow or deny."},
					"reason": {"type": "string", "description": "Optional reason."}
				},
				"required": ["runId", "requestId", "decision"]
			}`),
		},
		{
			Name:        "cancel_run",
			Description: "[DEPRECATED] Use agenthub_cancel_run instead. This alias will be removed in a future release.\nCancel a running AgentHub Edge agent run.",
			InputSchema: jsonSchema(`{
				"type": "object",
				"properties": {
					"runId": {"type": "string", "description": "The run ID to cancel."}
				},
				"required": ["runId"]
			}`),
		},
		{
			Name:        "send_message",
			Description: "[DEPRECATED] Use agenthub_send_message instead. This alias will be removed in a future release.\nSend a message to an AgentHub Edge thread.",
			InputSchema: jsonSchema(`{
				"type": "object",
				"properties": {
					"threadId": {"type": "string", "description": "The thread ID."},
					"content": {"type": "string", "description": "The message content."},
					"role": {"type": "string", "enum": ["user", "system"], "description": "Message role (default: user)."}
				},
				"required": ["threadId", "content"]
			}`),
		},
	}
}
