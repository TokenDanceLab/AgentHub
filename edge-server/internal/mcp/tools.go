package mcp

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync/atomic"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/security"
	"github.com/agenthub/edge-server/internal/store"
)

// Tool represents an MCP tool definition returned by tools/list.
// Name and Description are displayed to the MCP client.
// InputSchema is a JSON Schema object defining the tool's parameters.
type Tool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"inputSchema"`
}

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

// callTool dispatches to the appropriate tool handler based on the tool name.
//
// Naming:
//   - agenthub_ prefixed names are the canonical tool names and dispatch silently.
//   - Unprefixed names are deprecated aliases; they dispatch to the same handler
//     but log a WARNING urging migration.
//
// Returns an error for unknown tool names (caught by handleToolsCall and wrapped
// as a tool result with isError: true).
func (s *Server) callTool(name string, args json.RawMessage) (json.RawMessage, error) {
	switch name {
	// Canonical agenthub_ prefixed names
	case "agenthub_list_projects":
		return s.toolListProjects(args)
	case "agenthub_list_threads":
		return s.toolListThreads(args)
	case "agenthub_get_thread":
		return s.toolGetThread(args)
	case "agenthub_start_run":
		return s.toolStartRun(args)
	case "agenthub_get_run_status":
		return s.toolGetRunStatus(args)
	case "agenthub_approve_action":
		return s.toolApproveAction(args)
	case "agenthub_cancel_run":
		return s.toolCancelRun(args)
	case "agenthub_send_message":
		return s.toolSendMessage(args)
	// Deprecated unprefixed aliases (backward compatibility)
	case "list_projects":
		slog.Warn("mcp: deprecated tool name 'list_projects' used, migrate to 'agenthub_list_projects'")
		return s.toolListProjects(args)
	case "list_threads":
		slog.Warn("mcp: deprecated tool name 'list_threads' used, migrate to 'agenthub_list_threads'")
		return s.toolListThreads(args)
	case "get_thread":
		slog.Warn("mcp: deprecated tool name 'get_thread' used, migrate to 'agenthub_get_thread'")
		return s.toolGetThread(args)
	case "start_run":
		slog.Warn("mcp: deprecated tool name 'start_run' used, migrate to 'agenthub_start_run'")
		return s.toolStartRun(args)
	case "get_run_status":
		slog.Warn("mcp: deprecated tool name 'get_run_status' used, migrate to 'agenthub_get_run_status'")
		return s.toolGetRunStatus(args)
	case "approve_action":
		slog.Warn("mcp: deprecated tool name 'approve_action' used, migrate to 'agenthub_approve_action'")
		return s.toolApproveAction(args)
	case "cancel_run":
		slog.Warn("mcp: deprecated tool name 'cancel_run' used, migrate to 'agenthub_cancel_run'")
		return s.toolCancelRun(args)
	case "send_message":
		slog.Warn("mcp: deprecated tool name 'send_message' used, migrate to 'agenthub_send_message'")
		return s.toolSendMessage(args)
	default:
		return nil, fmt.Errorf("unknown tool: %s", name)
	}
}

// toolListProjects implements the agenthub_list_projects tool.
// Returns all projects in the Edge workspace with their IDs, names,
// descriptions, and creation timestamps.
func (s *Server) toolListProjects(_ json.RawMessage) (json.RawMessage, error) {
	if s.store == nil {
		return nil, errcode.ErrStoreNotConfigured
	}
	projects := s.store.ListProjects()
	result := map[string]any{
		"projects": projects,
		"count":    len(projects),
	}
	return marshalResult(result)
}

// toolListThreads implements the agenthub_list_threads tool.
// Returns all threads in the given project with their IDs, titles, statuses,
// and creation timestamps. Returns an error if the project does not exist.
func (s *Server) toolListThreads(args json.RawMessage) (json.RawMessage, error) {
	if s.store == nil {
		return nil, errcode.ErrStoreNotConfigured
	}
	var params struct {
		ProjectID string `json:"projectId"`
	}
	if err := json.Unmarshal(args, &params); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	if params.ProjectID == "" {
		return nil, errcode.ErrProjectIDRequired
	}

	// Verify project exists
	if _, ok := s.store.GetProject(params.ProjectID); !ok {
		return nil, fmt.Errorf("project not found: %s", params.ProjectID)
	}

	threads := s.store.ListThreads(params.ProjectID)
	result := map[string]any{
		"threads": threads,
		"count":   len(threads),
	}
	return marshalResult(result)
}

// toolGetThread implements the agenthub_get_thread tool.
// Returns detailed information about a thread: metadata, up to 20 recent items
// (messages, tool calls), the total item count, all associated runs, and
// optionally the active run if one is in progress.
func (s *Server) toolGetThread(args json.RawMessage) (json.RawMessage, error) {
	if s.store == nil {
		return nil, errcode.ErrStoreNotConfigured
	}
	var params struct {
		ThreadID string `json:"threadId"`
	}
	if err := json.Unmarshal(args, &params); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	if params.ThreadID == "" {
		return nil, errcode.ErrThreadIDRequired
	}

	thread, ok := s.store.GetThread(params.ThreadID)
	if !ok {
		return nil, fmt.Errorf("thread not found: %s", params.ThreadID)
	}

	// Get recent items for context
	items := s.store.ListThreadItems(params.ThreadID)
	// Limit to last 20 items for summary
	if len(items) > 20 {
		items = items[len(items)-20:]
	}

	// Get runs for this thread
	runs := s.store.ListRuns(params.ThreadID)
	var activeRun *store.Run
	for i := range runs {
		if runs[i].Status == "queued" || runs[i].Status == "started" {
			activeRun = &runs[i]
			break
		}
	}

	result := map[string]any{
		"thread":      thread,
		"recentItems": items,
		"itemCount":   len(items),
		"runs":        runs,
	}
	if activeRun != nil {
		result["activeRun"] = activeRun
	}
	return marshalResult(result)
}

// toolStartRun implements the agenthub_start_run tool.
//
// Requires non-empty workDir and validates it against the workspace allowlist
// (AH-SR-006 / #854), mirroring REST validateRunWorkDir. Creates a run record,
// publishes run.queued, creates a user message item, and starts the agent
// executor.
//
// Returns an error if:
//   - The thread already has an active run (queued or started)
//   - The project or thread is not found
//   - workDir is missing/empty or outside the configured allowlist
//   - Required fields (projectId, threadId, prompt, workDir) are missing
func (s *Server) toolStartRun(args json.RawMessage) (json.RawMessage, error) {
	if s.store == nil {
		return nil, errcode.ErrStoreNotConfigured
	}
	if s.executor == nil {
		return nil, errcode.ErrExecutorNotConfigured
	}

	var params struct {
		ProjectID string `json:"projectId"`
		ThreadID  string `json:"threadId"`
		Prompt    string `json:"prompt"`
		AgentID   string `json:"agentId"`
		Model     string `json:"model"`
		WorkDir   string `json:"workDir"`
	}
	if err := json.Unmarshal(args, &params); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	if params.ProjectID == "" {
		return nil, errcode.ErrProjectIDRequired
	}
	if params.ThreadID == "" {
		return nil, errcode.ErrThreadIDRequired
	}
	if strings.TrimSpace(params.Prompt) == "" {
		return nil, errcode.ErrPromptRequired
	}

	// Require non-empty workDir for adapter runs (#854), then validate against
	// the shared REST/MCP workspace allowlist policy (AH-SR-006 / #998):
	// EvalSymlinks + IsPathWithin via security.ValidateWorkDirAgainstAllowlist.
	params.WorkDir = strings.TrimSpace(params.WorkDir)
	if params.WorkDir == "" {
		return nil, errcode.ErrWorkDirRequired
	}
	if err := security.ValidateWorkDirAgainstAllowlist(params.WorkDir, s.workspaceAllowlist); err != nil {
		if errors.Is(err, security.ErrWorkspaceAllowlistEmpty) {
			return nil, errcode.ErrWorkspaceAllowlistNotConfigured
		}
		if errors.Is(err, security.ErrWorkspaceOutsideAllowlist) {
			return nil, errcode.ErrWorkspaceNotAllowed
		}
		return nil, fmt.Errorf("invalid workDir: %w", err)
	}

	// Verify project and thread exist
	thread, ok := s.store.GetThread(params.ThreadID)
	if !ok || thread.ProjectID != params.ProjectID {
		return nil, fmt.Errorf("thread not found: %s", params.ThreadID)
	}
	if _, ok := s.store.GetProject(params.ProjectID); !ok {
		return nil, fmt.Errorf("project not found: %s", params.ProjectID)
	}

	// Check for active run
	runs := s.store.ListRuns(params.ThreadID)
	for _, r := range runs {
		if r.Status == "queued" || r.Status == "started" {
			return nil, fmt.Errorf("thread already has an active run: %s", r.ID)
		}
	}

	// Generate run ID and create the run
	runID := generateID("run_")
	run, err := s.store.CreateRun(runID, params.ProjectID, params.ThreadID)
	if err != nil {
		return nil, fmt.Errorf("failed to create run: %w", err)
	}

	// Publish run.queued event
	scope := map[string]any{
		"projectId": run.ProjectID,
		"threadId":  run.ThreadID,
		"runId":     run.ID,
	}
	if s.bus != nil {
		s.bus.Publish("run.queued", scope, run)
	}

	// Create user message item
	if _, err := s.store.CreateItem(store.Item{
		ID:        generateID("item_"),
		ProjectID: run.ProjectID,
		ThreadID:  run.ThreadID,
		RunID:     run.ID,
		Type:      "user_message",
		Role:      "user",
		Status:    "created",
		Content:   params.Prompt,
	}); err == nil {
		if s.bus != nil {
			s.bus.Publish("message.created", scope, map[string]any{
				"content": params.Prompt,
			})
		}
	}

	// Start the executor
	sessionID := "mcp_" + run.ThreadID
	runCtx := lifecycle.RunProcessContext{
		Run:          run,
		Prompt:       params.Prompt,
		AgentID:      params.AgentID,
		Model:        params.Model,
		SessionID:    sessionID,
		ContinueLast: true,
		WorkDir:      params.WorkDir,
	}

	if err := s.executor.Start(run, runCtx); err != nil {
		// Mark run as failed
		if failed, ok := s.store.SetRunStatusIf(run.ID, "failed", "queued"); ok {
			if s.bus != nil {
				s.bus.Publish("run.failed", scope, map[string]any{
					"runId":  failed.ID,
					"status": failed.Status,
					"error":  err.Error(),
				})
			}
		}
		return nil, fmt.Errorf("failed to start run: %w", err)
	}

	result := map[string]any{
		"runId":     run.ID,
		"projectId": run.ProjectID,
		"threadId":  run.ThreadID,
		"status":    "started",
		"message":   "Run started successfully",
	}
	return marshalResult(result)
}

// toolGetRunStatus implements the agenthub_get_run_status tool.
// Returns the current status and lifecycle timestamps (createdAt, startedAt,
// finishedAt) of a run. Use this to poll for completion after starting a run.
func (s *Server) toolGetRunStatus(args json.RawMessage) (json.RawMessage, error) {
	if s.store == nil {
		return nil, errcode.ErrStoreNotConfigured
	}
	var params struct {
		RunID string `json:"runId"`
	}
	if err := json.Unmarshal(args, &params); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	if params.RunID == "" {
		return nil, errcode.ErrRunIDRequired
	}

	run, ok := s.store.GetRun(params.RunID)
	if !ok {
		return nil, fmt.Errorf("run not found: %s", params.RunID)
	}

	result := map[string]any{
		"runId":      run.ID,
		"projectId":  run.ProjectID,
		"threadId":   run.ThreadID,
		"status":     run.Status,
		"createdAt":  run.CreatedAt,
		"startedAt":  run.StartedAt,
		"finishedAt": run.FinishedAt,
	}
	return marshalResult(result)
}

// toolApproveAction implements the agenthub_approve_action tool.
//
// Consumes a pending permission request from the permission registry and
// publishes a BusEventPermissionDecided event with the decision (allow/deny).
// The agent adapter's permission hook listens for this event and resumes or
// aborts the blocked tool call.
//
// Returns an error if:
//   - The permission request is not found (may have expired or already been decided)
//   - The decision is not "allow" or "deny"
//   - The permission registry is not configured
func (s *Server) toolApproveAction(args json.RawMessage) (json.RawMessage, error) {
	if s.permissionRegistry == nil {
		return nil, errcode.ErrPermissionRegistryNotConfigured
	}

	var params struct {
		RunID     string `json:"runId"`
		RequestID string `json:"requestId"`
		Decision  string `json:"decision"`
		Reason    string `json:"reason"`
	}
	if err := json.Unmarshal(args, &params); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	if params.RunID == "" {
		return nil, errcode.ErrRunIDRequired
	}
	if params.RequestID == "" {
		return nil, errcode.ErrRequestIDRequired
	}
	if params.Decision != "allow" && params.Decision != "deny" {
		return nil, errcode.ErrInvalidDecision
	}

	permission, ok := s.permissionRegistry.Consume(params.RunID, params.RequestID)
	if !ok {
		return nil, fmt.Errorf("permission request not found: %s/%s", params.RunID, params.RequestID)
	}

	// Publish the decision event
	scope := map[string]any{"runId": permission.RunID}
	if permission.ProjectID != "" {
		scope["projectId"] = permission.ProjectID
	}
	if permission.ThreadID != "" {
		scope["threadId"] = permission.ThreadID
	}

	if s.bus != nil {
		s.bus.Publish(adapters.BusEventPermissionDecided, scope, map[string]any{
			"runId":     params.RunID,
			"requestId": params.RequestID,
			"toolName":  permission.ToolName,
			"toolUseId": permission.ToolUseID,
			"decision":  params.Decision,
			"reason":    params.Reason,
		})
	}

	result := map[string]any{
		"status":    "ok",
		"decision":  params.Decision,
		"toolName":  permission.ToolName,
		"requestId": params.RequestID,
	}
	return marshalResult(result)
}

// toolCancelRun implements the agenthub_cancel_run tool.
// Safe to call on any run state — returns the resulting status without error
// if the run is already terminal (completed, failed, cancelled).
func (s *Server) toolCancelRun(args json.RawMessage) (json.RawMessage, error) {
	if s.executor == nil {
		return nil, errcode.ErrExecutorNotConfigured
	}

	var params struct {
		RunID string `json:"runId"`
	}
	if err := json.Unmarshal(args, &params); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	if params.RunID == "" {
		return nil, errcode.ErrRunIDRequired
	}

	cancelResult := s.executor.Cancel(params.RunID)
	if !cancelResult.Found {
		return nil, fmt.Errorf("run not found: %s", params.RunID)
	}

	result := map[string]any{
		"runId":  params.RunID,
		"status": cancelResult.Status,
	}
	return marshalResult(result)
}

// toolSendMessage implements the agenthub_send_message tool.
//
// Creates a message item in the thread timeline. For user-role messages, the
// current user profile (senderID, senderName) is looked up from the store.
// Publishes message.created and item.created events on the event bus.
//
// Messages appear in the thread timeline and are visible to the agent on its
// next run, enabling multi-turn conversations.
func (s *Server) toolSendMessage(args json.RawMessage) (json.RawMessage, error) {
	if s.store == nil {
		return nil, errcode.ErrStoreNotConfigured
	}

	var params struct {
		ThreadID string `json:"threadId"`
		Content  string `json:"content"`
		Role     string `json:"role"`
	}
	if err := json.Unmarshal(args, &params); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	if params.ThreadID == "" {
		return nil, errcode.ErrThreadIDRequired
	}
	if strings.TrimSpace(params.Content) == "" {
		return nil, errcode.ErrContentRequired
	}

	// Verify thread exists
	thread, ok := s.store.GetThread(params.ThreadID)
	if !ok {
		return nil, fmt.Errorf("thread not found: %s", params.ThreadID)
	}

	role := strings.TrimSpace(params.Role)
	if role == "" {
		role = "user"
	}
	if role != "user" && role != "system" {
		return nil, errcode.ErrInvalidRole
	}

	itemID := generateID("item_")

	// For user messages, look up the current user profile to set sender info.
	var senderID, senderName string
	if role == "user" {
		if profile, ok := s.store.GetCurrentUser(); ok {
			senderID = profile.ID
			senderName = profile.DisplayName
		}
	}

	item, err := s.store.CreateItem(store.Item{
		ID:         itemID,
		ProjectID:  thread.ProjectID,
		ThreadID:   params.ThreadID,
		Type:       "user_message",
		Role:       role,
		Status:     "created",
		Content:    params.Content,
		SenderID:   senderID,
		SenderName: senderName,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create message: %w", err)
	}

	// Publish event
	if s.bus != nil {
		scope := map[string]any{
			"projectId": thread.ProjectID,
			"threadId":  params.ThreadID,
			"itemId":    item.ID,
		}
		s.bus.Publish("message.created", scope, item)
		s.bus.Publish("item.created", scope, item)
	}

	result := map[string]any{
		"itemId":   item.ID,
		"threadId": params.ThreadID,
		"role":     role,
		"status":   "created",
	}
	return marshalResult(result)
}

// jsonSchema parses a JSON schema string into a json.RawMessage.
// Used at init-time for tool InputSchema definitions.
// If parsing fails, returns an empty object schema {"type": "object"} as a safe
// fallback (malformed schema strings are a compile-time bug, not a runtime error).
func jsonSchema(schema string) json.RawMessage {
	var v any
	if err := json.Unmarshal([]byte(schema), &v); err != nil {
		return json.RawMessage(`{"type":"object"}`)
	}
	result, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage(`{"type":"object"}`)
	}
	return result
}

// marshalResult converts a Go value to json.RawMessage for tool results.
// Returns an error if JSON marshalling fails (should never happen with
// well-formed result types).
func marshalResult(v any) (json.RawMessage, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal result: %w", err)
	}
	return data, nil
}

// generateID creates a unique identifier with the given prefix.
//
// Uses crypto/rand to produce 16-hex-digit collision-resistant IDs (prefix + 16 hex).
// If crypto/rand.Read fails (extremely rare — can happen in constrained
// environments), falls back to a monotonic atomic counter. The counter is
// guaranteed unique within the process lifetime and avoids the collision risk
// of timestamp-based fallbacks.
func generateID(prefix string) string {
	b := make([]byte, 8)
	if _, err := randRead(b); err != nil {
		// Fallback: monotonic counter, not timestamp-based.
		// Timestamps can collide in tight loops; an atomic counter is
		// guaranteed unique within the process lifetime.
		slog.Warn("mcp: crypto/rand.Read failed, falling back to atomic counter", "error", err)
		return prefix + fmt.Sprintf("%d", fallbackCounter.Add(1))
	}
	return prefix + hexEncode(b)
}

// fallbackCounter provides a monotonic unique counter for the rare case
// when crypto/rand.Read fails. It guarantees uniqueness within the
// process lifetime and avoids collision risks of timestamp-based IDs.
// Used only by generateID in the crypto/rand fallback path.
var fallbackCounter atomic.Int64

// randRead is crypto/rand.Read, exposed as a package variable for testing.
// Tests can override this to simulate crypto/rand failures.
var randRead = randReadImpl

func randReadImpl(b []byte) (int, error) {
	return rand.Read(b)
}

// hexEncode encodes a byte slice to a lowercase hex string.
// Uses a precomputed lookup table for performance — avoids fmt.Sprintf
// allocations in the hot path (called on every run/message/item creation).
func hexEncode(b []byte) string {
	const hextable = "0123456789abcdef"
	dst := make([]byte, len(b)*2)
	for i, v := range b {
		dst[i*2] = hextable[v>>4]
		dst[i*2+1] = hextable[v&0x0f]
	}
	return string(dst)
}
