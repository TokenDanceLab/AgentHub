package mcp

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/store"
)

// Tool represents an MCP tool definition.
type Tool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"inputSchema"`
}

// listTools returns all available MCP tools.
func (s *Server) listTools() []Tool {
	return []Tool{
		{
			Name:        "list_projects",
			Description: "List all projects in AgentHub.",
			InputSchema: jsonSchema(`{
				"type": "object",
				"properties": {},
				"required": []
			}`),
		},
		{
			Name:        "list_threads",
			Description: "List all threads in a project. Returns threads with their ID, title, and status.",
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
			Description: "Get thread details including recent messages summary.",
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
			Description: "Start a new agent run on a thread. The run will execute the given prompt using the configured agent.",
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
						"description": "Optional working directory for the agent."
					}
				},
				"required": ["projectId", "threadId", "prompt"]
			}`),
		},
		{
			Name:        "get_run_status",
			Description: "Get the current status of a run.",
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
			Name:        "approve_action",
			Description: "Approve or deny a pending permission request from an agent run. Use this when the agent is waiting for approval to execute a tool or action.",
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
			Name:        "cancel_run",
			Description: "Cancel a running agent run.",
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
			Name:        "send_message",
			Description: "Send a message to a thread (for multi-turn conversations with an agent).",
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
	}
}

// callTool dispatches to the appropriate tool handler.
func (s *Server) callTool(name string, args json.RawMessage) (json.RawMessage, error) {
	switch name {
	case "list_projects":
		return s.toolListProjects(args)
	case "list_threads":
		return s.toolListThreads(args)
	case "get_thread":
		return s.toolGetThread(args)
	case "start_run":
		return s.toolStartRun(args)
	case "get_run_status":
		return s.toolGetRunStatus(args)
	case "approve_action":
		return s.toolApproveAction(args)
	case "cancel_run":
		return s.toolCancelRun(args)
	case "send_message":
		return s.toolSendMessage(args)
	default:
		return nil, fmt.Errorf("unknown tool: %s", name)
	}
}

// toolListProjects implements the list_projects tool.
func (s *Server) toolListProjects(_ json.RawMessage) (json.RawMessage, error) {
	if s.store == nil {
		return nil, errors.New("store not configured")
	}
	projects := s.store.ListProjects()
	result := map[string]any{
		"projects": projects,
		"count":    len(projects),
	}
	return marshalResult(result)
}

// toolListThreads implements the list_threads tool.
func (s *Server) toolListThreads(args json.RawMessage) (json.RawMessage, error) {
	if s.store == nil {
		return nil, errors.New("store not configured")
	}
	var params struct {
		ProjectID string `json:"projectId"`
	}
	if err := json.Unmarshal(args, &params); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	if params.ProjectID == "" {
		return nil, errors.New("projectId is required")
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

// toolGetThread implements the get_thread tool.
func (s *Server) toolGetThread(args json.RawMessage) (json.RawMessage, error) {
	if s.store == nil {
		return nil, errors.New("store not configured")
	}
	var params struct {
		ThreadID string `json:"threadId"`
	}
	if err := json.Unmarshal(args, &params); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	if params.ThreadID == "" {
		return nil, errors.New("threadId is required")
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

// toolStartRun implements the start_run tool.
func (s *Server) toolStartRun(args json.RawMessage) (json.RawMessage, error) {
	if s.store == nil {
		return nil, errors.New("store not configured")
	}
	if s.executor == nil {
		return nil, errors.New("executor not configured")
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
		return nil, errors.New("projectId is required")
	}
	if params.ThreadID == "" {
		return nil, errors.New("threadId is required")
	}
	if strings.TrimSpace(params.Prompt) == "" {
		return nil, errors.New("prompt is required")
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

// toolGetRunStatus implements the get_run_status tool.
func (s *Server) toolGetRunStatus(args json.RawMessage) (json.RawMessage, error) {
	if s.store == nil {
		return nil, errors.New("store not configured")
	}
	var params struct {
		RunID string `json:"runId"`
	}
	if err := json.Unmarshal(args, &params); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	if params.RunID == "" {
		return nil, errors.New("runId is required")
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

// toolApproveAction implements the approve_action tool.
func (s *Server) toolApproveAction(args json.RawMessage) (json.RawMessage, error) {
	if s.permissionRegistry == nil {
		return nil, errors.New("permission registry not configured")
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
		return nil, errors.New("runId is required")
	}
	if params.RequestID == "" {
		return nil, errors.New("requestId is required")
	}
	if params.Decision != "allow" && params.Decision != "deny" {
		return nil, errors.New("decision must be 'allow' or 'deny'")
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

// toolCancelRun implements the cancel_run tool.
func (s *Server) toolCancelRun(args json.RawMessage) (json.RawMessage, error) {
	if s.executor == nil {
		return nil, errors.New("executor not configured")
	}

	var params struct {
		RunID string `json:"runId"`
	}
	if err := json.Unmarshal(args, &params); err != nil {
		return nil, fmt.Errorf("invalid arguments: %w", err)
	}
	if params.RunID == "" {
		return nil, errors.New("runId is required")
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

// toolSendMessage implements the send_message tool.
func (s *Server) toolSendMessage(args json.RawMessage) (json.RawMessage, error) {
	if s.store == nil {
		return nil, errors.New("store not configured")
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
		return nil, errors.New("threadId is required")
	}
	if strings.TrimSpace(params.Content) == "" {
		return nil, errors.New("content is required")
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
		return nil, errors.New("role must be 'user' or 'system'")
	}

	itemID := generateID("item_")
	item, err := s.store.CreateThreadMessage(itemID, params.ThreadID, role, params.Content)
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
// If parsing fails, returns an empty object schema.
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

// marshalResult converts a value to json.RawMessage for tool results.
func marshalResult(v any) (json.RawMessage, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal result: %w", err)
	}
	return data, nil
}

// generateID creates a unique identifier with the given prefix.
func generateID(prefix string) string {
	b := make([]byte, 8)
	if _, err := randRead(b); err != nil {
		// Fallback to timestamp-based ID
		return prefix + fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return prefix + hexEncode(b)
}

// randRead is crypto/rand.Read, exposed as a variable for testing.
var randRead = randReadImpl

func randReadImpl(b []byte) (int, error) {
	return rand.Read(b)
}

// hexEncode encodes bytes to hex string.
func hexEncode(b []byte) string {
	const hextable = "0123456789abcdef"
	dst := make([]byte, len(b)*2)
	for i, v := range b {
		dst[i*2] = hextable[v>>4]
		dst[i*2+1] = hextable[v&0x0f]
	}
	return string(dst)
}
