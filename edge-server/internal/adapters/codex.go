package adapters

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"os/exec"
	slashpath "path"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/store"
)

// CodexAdapter integrates the codex CLI.
//
// Phase 1: codex exec "prompt" -- batch mode, JSONL output (simple, reliable).
// Phase 2: codex app-server --listen stdio:// -- JSON-RPC full streaming.
type CodexAdapter struct {
	binaryPath string
	argPrefix  []string
	model      string
	available  bool                     // #177: true if the CLI binary exists and is executable
	budget     *runnerctx.ContextBudget // extracted from ctx in ParseStream; nil = no tracking
}

// NewCodexAdapter creates a Codex adapter.
func NewCodexAdapter(binaryPath, model string) *CodexAdapter {
	cmdPath, argPrefix, available := resolveCodexCommand(binaryPath, exec.LookPath, os.Stat, runtime.GOOS)
	return &CodexAdapter{binaryPath: cmdPath, argPrefix: argPrefix, model: model, available: available}
}

type fileStatFunc func(string) (os.FileInfo, error)
type lookPathFunc func(string) (string, error)

func resolveCodexCommand(binaryPath string, lookPath lookPathFunc, stat fileStatFunc, goos string) (string, []string, bool) {
	resolved, err := lookPath(binaryPath)
	if err != nil {
		return binaryPath, nil, false
	}

	if goos != "windows" || !strings.EqualFold(filepath.Ext(resolved), ".cmd") {
		return resolved, nil, true
	}

	// The npm codex.cmd shim forwards args through %*, which corrupts multiline
	// prompts when Edge launches it via os/exec. Call the Node entrypoint
	// directly so prompts are passed as real argv values.
	script := filepath.Join(filepath.Dir(resolved), "node_modules", "@openai", "codex", "bin", "codex.js")
	info, err := stat(script)
	if err != nil || info.IsDir() {
		return resolved, nil, true
	}
	nodePath, err := lookPath("node")
	if err != nil {
		return resolved, nil, true
	}
	return nodePath, []string{script}, true
}

func (a *CodexAdapter) Metadata() AdapterMetadata {
	return AdapterMetadata{
		ID:          "codex",
		Name:        "Codex",
		Description: "OpenAI Codex CLI — 代码生成、审查、沙箱执行",
	}
}

func (a *CodexAdapter) Capabilities() AgentCapabilities {
	return AgentCapabilities{
		Streaming:       false, // Phase 1: batch only; P1: streaming via app-server
		ToolCalls:       true,
		FileChanges:     true,
		ThinkingVisible: true, // reasoning items are emitted via item.completed
		MultiTurn:       true,
		MCPIntegration:  true, // mcp_tool_call items are fully handled
		SubAgentSpawn:   true, // collab_tool_call items map to BusEventTaskStarted/Notification
	}
}

func (a *CodexAdapter) BuildCommand(ctx RunProcessContext) (string, []string, []string, string) {
	prompt := ctx.Prompt
	if prompt == "" {
		prompt = "Continue."
	}

	model := ResolveModel("codex", ctx.Model)
	if model == "" {
		model = a.model
	}

	args := append([]string(nil), a.argPrefix...)
	args = append(args, "exec")
	if model != "" {
		args = append(args, "-c", "model="+model)
	}

	// Reasoning effort
	if ctx.ReasoningEffort != "" {
		effort := ResolveReasoningEffort("codex", ctx.ReasoningEffort)
		args = append(args, "-c", "model_reasoning_effort="+effort)
	}

	// Sandbox based on permission mode
	if ctx.PermissionMode != "" {
		sandbox := sandboxForPermissionMode(ctx.PermissionMode)
		if sandbox != "" {
			args = append(args, "--sandbox", sandbox)
		}
	}

	// Generic config overrides (-c key=value)
	for key, value := range ctx.ConfigOverrides {
		args = append(args, "-c", key+"="+value)
	}

	// Ephemeral mode: no session persistence
	if ctx.Ephemeral {
		args = append(args, "--ephemeral")
	}

	// Image input (--image / -i)
	if image, ok := ctx.ConfigOverrides["image"]; ok && image != "" {
		args = append(args, "--image", image)
	}

	// Set Codex's main working directory. Extra writable roots should be passed
	// through a separate config field; do not mirror Claude Code --add-dir here.
	if ctx.WorkDir != "" {
		args = append(args, "--cd", ctx.WorkDir)
	}

	// Edge runs often use temporary workspaces that are not Git repositories.
	args = append(args, "--skip-git-repo-check")

	// Structured JSON output
	args = append(args, "--json")

	// Skills prompt: prepend to the prompt text since Codex has no --append-system-prompt.
	if ctx.SkillsPrompt != "" {
		prompt = ctx.SkillsPrompt + "\n\n---\n\n" + prompt
	}

	// Context continuity: prepend thread history + pinned messages so Codex
	// has full Hub conversation context (not just the trigger message).
	if contextPreface := runnerctx.BuildContextPreface(ctx.Messages, ctx.PinnedMessages); contextPreface != "" {
		prompt = contextPreface + "\n---\n\n" + prompt
	}

	args = append(args, "--", prompt)

	workDir := ctx.WorkDir
	if workDir == "" {
		workDir = "."
	}

	var env []string // runtime vars set by process executor

	return a.binaryPath, args, env, workDir
}

// sandboxForPermissionMode maps Claude Code permission modes to Codex sandbox levels.
func sandboxForPermissionMode(mode string) string {
	switch mode {
	case "plan":
		return "read-only"
	case "default":
		return "" // Codex has no "default" sandbox — let Codex decide
	case "acceptEdits", "dontAsk":
		return "workspace-write"
	case "bypassPermissions":
		return "danger-full-access"
	default:
		return ""
	}
}

func (a *CodexAdapter) ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter EventEmitter, run store.Run) error {
	scope := map[string]any{
		"projectId": run.ProjectID,
		"threadId":  run.ThreadID,
		"runId":     run.ID,
	}

	// Extract budget from context for token tracking (nil = no tracking).
	if budget, ok := ctx.Value(CtxBudgetKey).(*runnerctx.ContextBudget); ok {
		a.budget = budget
	}

	workDir, _ := ctx.Value(CtxWorkDir).(string)
	jsonlMode := false
	offset := 0

	return ScanLines(ctx, stdout, func(line []byte) (err error) {
		defer func() {
			if r := recover(); r != nil {
				slog.Error("codex: panic in stream handler, recovering to keep stream alive",
					"runId", run.ID, "panic", r)
				err = nil // allow ScanLines to continue
			}
		}()

		if !jsonlMode {
			var probe json.RawMessage
			if json.Unmarshal(line, &probe) == nil {
				jsonlMode = true
			}
		}

		if jsonlMode {
			var evt codexExecEvent
			if err := json.Unmarshal(line, &evt); err != nil {
				slog.Debug("codex: JSON parse error in stream, falling back to raw text", "err", err)
				emitter.Emit(BusEventTextDelta, scope, map[string]any{
					"content": string(line),
					"offset":  offset,
				})
				offset += len(line)
				return nil
			}
			a.dispatchCodexEvent(scope, emitter, &evt, workDir)
		} else {
			text := string(line)
			emitter.Emit(BusEventTextDelta, scope, map[string]any{
				"content": text,
				"offset":  offset,
			})
			offset += len(line)
		}
		return nil
	})
}

// NeedsStdin returns false — Codex uses JSONL output via --json flag
// and does NOT require bidirectional stdin communication.
func (a *CodexAdapter) NeedsStdin() bool { return false }

// Available reports whether the codex CLI binary was found at startup.
// #177: check binary at startup, report unavailable if missing.
func (a *CodexAdapter) Available() bool { return a.available }

// --- Event types ---

type codexExecEvent struct {
	Type     string          `json:"type"`
	ThreadID string          `json:"thread_id,omitempty"`
	Usage    *codexUsage     `json:"usage,omitempty"`
	Item     json.RawMessage `json:"item,omitempty"`
	Message  string          `json:"message,omitempty"`
	Error    *codexError     `json:"error,omitempty"`
}

type codexError struct {
	Message string `json:"message"`
}

// codexUsage mirrors exec_events::Usage. The exec-level Usage struct only
// contains input_tokens, cached_input_tokens, and output_tokens. The
// reasoning_output_tokens and total_tokens fields are protocol-level
// TokenUsage fields included here for forward compatibility — they will be
// zero when Codex does not emit them.
type codexUsage struct {
	InputTokens           int64 `json:"input_tokens"`
	CachedInputTokens     int64 `json:"cached_input_tokens"`
	OutputTokens          int64 `json:"output_tokens"`
	ReasoningOutputTokens int64 `json:"reasoning_output_tokens,omitempty"`
	TotalTokens           int64 `json:"total_tokens,omitempty"`
}

// itemBase is used to probe the item's "type" field before decoding the full payload.
type itemBase struct {
	ID   string `json:"id"`
	Type string `json:"type"`
}

// codexItemError is the nested error in MCP tool call items.
type codexItemError struct {
	Message string `json:"message"`
}

// --- Event dispatch ---

func (a *CodexAdapter) dispatchCodexEvent(scope map[string]any, emitter EventEmitter, evt *codexExecEvent, workDir string) {
	switch evt.Type {
	case "thread.started":
		emitter.Emit(BusEventSessionInit, scope, map[string]any{
			"threadId": evt.ThreadID,
		})

	case "turn.started":
		emitter.Emit(BusEventSessionStateChanged, scope, map[string]any{
			"state": "busy",
		})

	case "turn.completed":
		payload := map[string]any{"success": true}
		if evt.Usage != nil {
			usageMap := map[string]any{
				"inputTokens":           evt.Usage.InputTokens,
				"cachedInputTokens":     evt.Usage.CachedInputTokens,
				"outputTokens":          evt.Usage.OutputTokens,
				"reasoningOutputTokens": evt.Usage.ReasoningOutputTokens,
			}
			payload["usage"] = usageMap
			// Emit context usage metrics so budgeting and dashboards can track token burn.
			emitter.Emit(BusEventContextUsage, scope, usageMap)
			// Track cumulative token consumption for context budget.
			if a.budget != nil {
				a.budget.Track(int(evt.Usage.InputTokens + evt.Usage.OutputTokens))
			}
		}
		emitter.Emit(BusEventResult, scope, payload)
		emitter.Emit(BusEventSessionStateChanged, scope, map[string]any{
			"state": "idle",
		})

	case "turn.failed":
		msg := "turn failed"
		if evt.Error != nil && evt.Error.Message != "" {
			msg = evt.Error.Message
		}
		emitter.Emit(BusEventResult, scope, map[string]any{
			"success": false,
			"error":   msg,
		})
		emitter.Emit(BusEventSessionStateChanged, scope, map[string]any{
			"state": "idle",
		})

	case "item.started":
		a.dispatchItemStarted(scope, emitter, evt.Item, workDir)

	case "item.completed":
		a.dispatchItemCompleted(scope, emitter, evt.Item, workDir)

	case "item.updated":
		a.dispatchItemUpdated(scope, emitter, evt.Item, workDir)

	case "error":
		emitter.Emit(BusEventResult, scope, map[string]any{
			"success": false,
			"error":   evt.Message,
		})
	}
}

// --- Item dispatch (two-phase: probe type then decode) ---

func (a *CodexAdapter) dispatchItemStarted(scope map[string]any, emitter EventEmitter, raw json.RawMessage, workDir string) {
	if raw == nil {
		return
	}
	var base itemBase
	if err := json.Unmarshal(raw, &base); err != nil {
		slog.Debug("codex: item.started base unmarshal failed", "err", err)
		return
	}
	switch base.Type {
	case "command_execution":
		a.emitToolCallFromItem(raw, scope, emitter, "started")
	case "mcp_tool_call":
		a.emitToolCallFromItem(raw, scope, emitter, "started")
	case "web_search":
		a.emitToolCallFromItem(raw, scope, emitter, "started")
	case "collab_tool_call":
		a.emitTaskStarted(raw, scope, emitter)
	case "file_change":
		// Note: Codex currently emits file_change only as item.completed.
		// We handle item.started defensively in case the protocol evolves.
		a.emitFileChange(raw, scope, emitter, workDir)
	case "todo_list":
		a.emitTodoList(raw, scope, emitter)
	}
}

func (a *CodexAdapter) dispatchItemCompleted(scope map[string]any, emitter EventEmitter, raw json.RawMessage, workDir string) {
	if raw == nil {
		return
	}
	var base itemBase
	if err := json.Unmarshal(raw, &base); err != nil {
		slog.Debug("codex: item.completed base unmarshal failed", "err", err)
		return
	}
	switch base.Type {
	case "agent_message":
		a.emitTextBlock(raw, scope, emitter)
	case "reasoning":
		a.emitThinking(raw, scope, emitter)
	case "command_execution":
		a.emitToolResultFromItem(raw, scope, emitter)
	case "mcp_tool_call":
		a.emitToolResultFromItem(raw, scope, emitter)
	case "web_search":
		a.emitToolResultFromItem(raw, scope, emitter)
	case "collab_tool_call":
		a.emitTaskNotification(raw, scope, emitter)
	case "file_change":
		a.emitFileChange(raw, scope, emitter, workDir)
	case "error":
		a.emitErrorItem(raw, scope, emitter)
	case "todo_list":
		a.emitTodoList(raw, scope, emitter)
	}
}

// dispatchItemUpdated handles item.updated events. Note that per the Codex
// exec protocol, file_change items are only emitted as item.completed — the
// file_change case here is defensive. collab_tool_call on item.updated is
// valid (sub-agent state transitions).
func (a *CodexAdapter) dispatchItemUpdated(scope map[string]any, emitter EventEmitter, raw json.RawMessage, workDir string) {
	if raw == nil {
		return
	}
	var base itemBase
	if err := json.Unmarshal(raw, &base); err != nil {
		slog.Debug("codex: item.updated base unmarshal failed", "err", err)
		return
	}
	switch base.Type {
	case "command_execution":
		a.emitToolProgress(raw, scope, emitter)
	case "mcp_tool_call":
		a.emitToolProgress(raw, scope, emitter)
	case "web_search":
		a.emitToolProgress(raw, scope, emitter)
	case "collab_tool_call":
		a.emitTaskNotification(raw, scope, emitter)
	case "todo_list":
		a.emitTodoList(raw, scope, emitter)
	case "file_change":
		// Defensive: Codex currently only emits file_change as item.completed.
		a.emitFileChange(raw, scope, emitter, workDir)
	}
}

// --- Item type handler helpers ---

func (a *CodexAdapter) emitTextBlock(raw json.RawMessage, scope map[string]any, emitter EventEmitter) {
	var item struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &item); err != nil {
		slog.Debug("codex: emitTextBlock unmarshal failed", "err", err)
		return
	}
	if item.Text != "" {
		emitter.Emit(BusEventTextBlock, scope, map[string]any{
			"content": item.Text,
		})
	}
}

func (a *CodexAdapter) emitThinking(raw json.RawMessage, scope map[string]any, emitter EventEmitter) {
	var item struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(raw, &item); err != nil {
		slog.Debug("codex: emitThinking unmarshal failed", "err", err)
		return
	}
	if item.Text != "" {
		emitter.Emit(BusEventThinking, scope, map[string]any{
			"content": item.Text,
		})
	}
}

func (a *CodexAdapter) emitToolCallFromItem(raw json.RawMessage, scope map[string]any, emitter EventEmitter, status string) {
	payload := map[string]any{"status": status}
	var base itemBase
	if err := json.Unmarshal(raw, &base); err != nil {
		slog.Debug("codex: emitToolCallFromItem base unmarshal failed", "err", err)
	}
	payload["callId"] = base.ID

	switch base.Type {
	case "command_execution":
		var item struct {
			Command string `json:"command"`
		}
		if err := json.Unmarshal(raw, &item); err != nil {
			slog.Debug("codex: emitToolCallFromItem command_execution unmarshal failed", "err", err)
		}
		payload["toolName"] = "shell_command"
		payload["input"] = map[string]any{"command": item.Command}
	case "mcp_tool_call":
		var item struct {
			Server    string          `json:"server"`
			Tool      string          `json:"tool"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(raw, &item); err != nil {
			slog.Debug("codex: emitToolCallFromItem mcp_tool_call unmarshal failed", "err", err)
		}
		payload["toolName"] = "mcp__" + item.Server + "__" + item.Tool
		if item.Arguments != nil {
			var args any
			if err := json.Unmarshal(item.Arguments, &args); err == nil {
				payload["input"] = args
			}
		}
	case "web_search":
		var item struct {
			Query  string `json:"query"`
			Action string `json:"action"`
		}
		if err := json.Unmarshal(raw, &item); err != nil {
			slog.Debug("codex: emitToolCallFromItem web_search unmarshal failed", "err", err)
		}
		payload["toolName"] = "web_search"
		payload["input"] = map[string]any{"query": item.Query, "action": item.Action}
		payload["kind"] = "web_search"
	}
	emitter.Emit(BusEventToolCall, scope, payload)
}

func (a *CodexAdapter) emitToolResultFromItem(raw json.RawMessage, scope map[string]any, emitter EventEmitter) {
	payload := map[string]any{}
	var base itemBase
	if err := json.Unmarshal(raw, &base); err != nil {
		slog.Debug("codex: emitToolResultFromItem base unmarshal failed", "err", err)
	}
	payload["callId"] = base.ID

	switch base.Type {
	case "command_execution":
		var item struct {
			Command          string `json:"command"`
			ExitCode         *int   `json:"exit_code"`
			AggregatedOutput string `json:"aggregated_output"`
			Status           string `json:"status"`
		}
		if err := json.Unmarshal(raw, &item); err != nil {
			slog.Debug("codex: emitToolResultFromItem command_execution unmarshal failed", "err", err)
		}
		payload["toolName"] = "shell_command"
		payload["output"] = item.AggregatedOutput
		if item.ExitCode != nil {
			payload["exitCode"] = *item.ExitCode
		}
		payload["status"] = item.Status
	case "mcp_tool_call":
		var item struct {
			Server    string          `json:"server"`
			Tool      string          `json:"tool"`
			Status    string          `json:"status"`
			Result    json.RawMessage `json:"result"`
			ItemError *codexItemError `json:"error"`
		}
		if err := json.Unmarshal(raw, &item); err != nil {
			slog.Debug("codex: emitToolResultFromItem mcp_tool_call unmarshal failed", "err", err)
		}
		payload["toolName"] = "mcp__" + item.Server + "__" + item.Tool
		payload["status"] = item.Status
		if item.Result != nil {
			var result any
			if err := json.Unmarshal(item.Result, &result); err == nil {
				payload["output"] = result
			}
		}
		if item.ItemError != nil {
			payload["error"] = item.ItemError.Message
		}
	case "web_search":
		var item struct {
			Query  string `json:"query"`
			Action string `json:"action"`
		}
		if err := json.Unmarshal(raw, &item); err != nil {
			slog.Debug("codex: emitToolResultFromItem web_search unmarshal failed", "err", err)
		}
		payload["toolName"] = "web_search"
		payload["kind"] = "web_search"
		payload["output"] = map[string]any{"query": item.Query, "action": item.Action}
	}
	emitter.Emit(BusEventToolResult, scope, payload)
}

// emitFileChange handles file_change items. Per the Codex exec protocol
// (codex-rs/exec/src/exec_events.rs), this item is only emitted as
// item.completed once the patch succeeds or fails. The handler is also
// wired to item.started/updated defensively.
func (a *CodexAdapter) emitFileChange(raw json.RawMessage, scope map[string]any, emitter EventEmitter, workDir string) {
	var item struct {
		ID      string `json:"id"`
		Status  string `json:"status"`
		Changes []struct {
			Path string `json:"path"`
			Kind string `json:"kind"`
		} `json:"changes"`
	}
	if err := json.Unmarshal(raw, &item); err != nil {
		slog.Debug("codex: emitFileChange unmarshal failed", "err", err)
		return
	}
	files := make([]map[string]any, 0, len(item.Changes))
	for _, ch := range item.Changes {
		path, outsideWorkspace := safeCodexFileChangePath(ch.Path, workDir)
		kind, action := codexFileChangeKindAction(ch.Kind)
		files = append(files, map[string]any{
			"path":    path,
			"kind":    kind,
			"action":  action,
			"rawKind": ch.Kind,
		})
		if outsideWorkspace {
			files[len(files)-1]["outsideWorkspace"] = true
		}
	}
	for _, file := range files {
		payload := map[string]any{
			"callId":   item.ID,
			"toolName": "apply_patch",
			"status":   item.Status,
			"path":     file["path"],
			"kind":     file["kind"],
			"action":   file["action"],
			"rawKind":  file["rawKind"],
		}
		if file["outsideWorkspace"] == true {
			payload["outsideWorkspace"] = true
		}
		emitter.Emit(BusEventFileChange, scope, payload)
	}
}

func codexFileChangeKindAction(rawKind string) (string, string) {
	switch rawKind {
	case "add":
		return "created", "created"
	case "delete":
		return "deleted", "deleted"
	default:
		return "modified", "modified"
	}
}

func safeCodexFileChangePath(rawPath string, workDir string) (string, bool) {
	path := strings.ReplaceAll(rawPath, "\\", "/")
	path = slashpath.Clean(path)
	if path == "." || path == "" {
		return slashpath.Base(strings.ReplaceAll(rawPath, "\\", "/")), true
	}

	if workDir != "" {
		if rel, ok := codexRelPathInWorkspace(path, workDir); ok {
			return filepath.ToSlash(rel), false
		}
	}

	if codexPathIsAbs(path) {
		return "<outside-workspace>/" + slashpath.Base(path), true
	}

	if path == ".." || strings.HasPrefix(path, "../") {
		return slashpath.Base(path), true
	}

	return path, false
}

func codexRelPathInWorkspace(path string, workDir string) (string, bool) {
	normalizedPath := strings.ReplaceAll(path, "\\", "/")
	normalizedWorkDir := slashpath.Clean(strings.ReplaceAll(workDir, "\\", "/"))
	pathVolume := codexPathVolumeName(normalizedPath)
	workDirVolume := codexPathVolumeName(normalizedWorkDir)
	if pathVolume != "" || workDirVolume != "" {
		if !strings.EqualFold(pathVolume, workDirVolume) {
			return "", false
		}
		if pathVolume != "" {
			normalizedPath = strings.TrimPrefix(normalizedPath, pathVolume)
			normalizedWorkDir = strings.TrimPrefix(normalizedWorkDir, workDirVolume)
		}
	}
	if !strings.HasSuffix(normalizedWorkDir, "/") {
		normalizedWorkDir += "/"
	}
	if strings.EqualFold(normalizedPath, strings.TrimSuffix(normalizedWorkDir, "/")) {
		return ".", true
	}
	if !strings.HasPrefix(strings.ToLower(normalizedPath), strings.ToLower(normalizedWorkDir)) {
		return "", false
	}
	rel := strings.TrimPrefix(normalizedPath, normalizedWorkDir)
	if rel == "" || rel == "." || strings.HasPrefix(rel, "../") || rel == ".." {
		return "", false
	}
	return rel, true
}

func codexPathIsAbs(path string) bool {
	return filepath.IsAbs(path) || strings.HasPrefix(path, "/") || codexPathVolumeName(path) != ""
}

func codexPathVolumeName(path string) string {
	if len(path) >= 2 && path[1] == ':' && ((path[0] >= 'A' && path[0] <= 'Z') || (path[0] >= 'a' && path[0] <= 'z')) {
		return path[:2]
	}
	return ""
}

func (a *CodexAdapter) emitToolProgress(raw json.RawMessage, scope map[string]any, emitter EventEmitter) {
	var base itemBase
	if err := json.Unmarshal(raw, &base); err != nil {
		slog.Debug("codex: emitToolProgress base unmarshal failed", "err", err)
	}

	payload := map[string]any{
		"callId":    base.ID,
		"toolUseId": base.ID,
		"status":    "in_progress",
	}

	switch base.Type {
	case "command_execution":
		var item struct {
			Command          string `json:"command"`
			AggregatedOutput string `json:"aggregated_output"`
		}
		if err := json.Unmarshal(raw, &item); err != nil {
			slog.Debug("codex: emitToolProgress command_execution unmarshal failed", "err", err)
		}
		payload["toolName"] = "shell_command"
		payload["output"] = item.AggregatedOutput
	case "mcp_tool_call":
		var item struct {
			Server string `json:"server"`
			Tool   string `json:"tool"`
		}
		if err := json.Unmarshal(raw, &item); err != nil {
			slog.Debug("codex: emitToolProgress mcp_tool_call unmarshal failed", "err", err)
		}
		payload["toolName"] = "mcp__" + item.Server + "__" + item.Tool
	case "web_search":
		var item struct {
			Query  string `json:"query"`
			Action string `json:"action"`
		}
		if err := json.Unmarshal(raw, &item); err != nil {
			slog.Debug("codex: emitToolProgress web_search unmarshal failed", "err", err)
		}
		payload["toolName"] = "web_search"
		payload["kind"] = "web_search"
		payload["input"] = map[string]any{"query": item.Query, "action": item.Action}
	}
	emitter.Emit(BusEventToolCall, scope, payload)
}

func (a *CodexAdapter) emitTaskStarted(raw json.RawMessage, scope map[string]any, emitter EventEmitter) {
	var item struct {
		ID                string                     `json:"id"`
		Tool              string                     `json:"tool"`
		SenderThreadID    string                     `json:"sender_thread_id"`
		ReceiverThreadIDs []string                   `json:"receiver_thread_ids"`
		Prompt            string                     `json:"prompt"`
		AgentsStates      map[string]json.RawMessage `json:"agents_states"`
		Status            string                     `json:"status"`
	}
	if err := json.Unmarshal(raw, &item); err != nil {
		slog.Debug("codex: emitTaskStarted unmarshal failed", "err", err)
		return
	}
	emitter.Emit(BusEventTaskStarted, scope, map[string]any{
		"taskId":            item.ID,
		"tool":              item.Tool,
		"senderThreadId":    item.SenderThreadID,
		"receiverThreadIds": item.ReceiverThreadIDs,
		"description":       item.Prompt,
		"status":            item.Status,
	})
}

func (a *CodexAdapter) emitTaskNotification(raw json.RawMessage, scope map[string]any, emitter EventEmitter) {
	var item struct {
		ID                string                     `json:"id"`
		Tool              string                     `json:"tool"`
		SenderThreadID    string                     `json:"sender_thread_id"`
		ReceiverThreadIDs []string                   `json:"receiver_thread_ids"`
		Prompt            string                     `json:"prompt"`
		AgentsStates      map[string]json.RawMessage `json:"agents_states"`
		Status            string                     `json:"status"`
	}
	if err := json.Unmarshal(raw, &item); err != nil {
		slog.Debug("codex: emitTaskNotification unmarshal failed", "err", err)
		return
	}
	notification := map[string]any{
		"taskId": item.ID,
		"tool":   item.Tool,
		"status": item.Status,
	}
	if len(item.AgentsStates) > 0 {
		states := make(map[string]any, len(item.AgentsStates))
		for threadID, rawState := range item.AgentsStates {
			var state map[string]any
			if json.Unmarshal(rawState, &state) == nil {
				states[threadID] = state
			} else {
				slog.Debug("codex: emitTaskNotification agent state unmarshal failed", "threadId", threadID)
			}
		}
		notification["agentsStates"] = states
	}
	emitter.Emit(BusEventTaskNotification, scope, notification)
}

func (a *CodexAdapter) emitErrorItem(raw json.RawMessage, scope map[string]any, emitter EventEmitter) {
	var item struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(raw, &item); err != nil {
		slog.Debug("codex: emitErrorItem unmarshal failed", "err", err)
		return
	}
	emitter.Emit(BusEventResult, scope, map[string]any{
		"success": false,
		"error":   item.Message,
	})
}

func (a *CodexAdapter) emitTodoList(raw json.RawMessage, scope map[string]any, emitter EventEmitter) {
	var item struct {
		ID    string `json:"id"`
		Items []struct {
			Text      string `json:"text"`
			Completed bool   `json:"completed"`
		} `json:"items"`
	}
	if err := json.Unmarshal(raw, &item); err != nil {
		slog.Debug("codex: emitTodoList unmarshal failed", "err", err)
		return
	}
	tasks := make([]map[string]any, 0, len(item.Items))
	for _, t := range item.Items {
		tasks = append(tasks, map[string]any{
			"text":      t.Text,
			"completed": t.Completed,
		})
	}
	emitter.Emit(BusEventToolCall, scope, map[string]any{
		"callId":   item.ID,
		"toolName": "plan",
		"input":    map[string]any{"tasks": tasks},
		"kind":     "plan",
	})
}
