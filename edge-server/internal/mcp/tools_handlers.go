package mcp

// Residual pure-helper peel: MCP tool handlers (#1104).
// Read/write tool implementations for callTool dispatch.

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/errcode"
	"github.com/agenthub/edge-server/internal/lifecycle"
	"github.com/agenthub/edge-server/internal/security"
	"github.com/agenthub/edge-server/internal/store"
)

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
