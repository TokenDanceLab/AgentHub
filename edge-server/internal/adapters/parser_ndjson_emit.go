package adapters

// Residual pure-helper peel #1113: emit helpers + route decision + hook wrapper.

func (p *NDJSONStreamParser) emitRouteDecision(scope map[string]any, structuredOutput any) {
	decision, ok := normalizeRouteDecisionPayload(structuredOutput)
	if !ok {
		return
	}
	p.emit(scope, BusEventRouteDecision, decision)
}

func normalizeRouteDecisionPayload(value any) (map[string]any, bool) {
	payload, ok := value.(map[string]any)
	if !ok {
		return nil, false
	}
	action, _ := payload["action"].(string)
	switch action {
	case "delegate", "review", "approve", "finish":
		return payload, true
	default:
		return nil, false
	}
}

func (p *NDJSONStreamParser) emitSessionInit(scope map[string]any, msg *claudeSDKMessage) {
	payload := map[string]any{
		"model":          msg.Model,
		"tools":          msg.Tools,
		"mcpServers":     msg.MCPServers,
		"permissionMode": msg.PermissionMode,
		"version":        msg.Version,
	}
	// P0: Extract session_id so AgentHub can track sessions for --resume.
	if msg.SessionID != "" {
		payload["sessionId"] = msg.SessionID
	}
	if msg.UUID != "" {
		payload["uuid"] = msg.UUID
	}
	if msg.CWD != "" {
		payload["cwd"] = msg.CWD
	}
	if len(msg.Agents) > 0 {
		payload["agents"] = msg.Agents
	}
	if len(msg.Skills) > 0 {
		payload["skills"] = msg.Skills
	}
	if len(msg.Plugins) > 0 {
		payload["plugins"] = msg.Plugins
	}
	if len(msg.SlashCommands) > 0 {
		payload["slashCommands"] = msg.SlashCommands
	}
	if msg.APIKeySource != "" {
		payload["apiKeySource"] = msg.APIKeySource
	}
	if len(msg.Betas) > 0 {
		payload["betas"] = msg.Betas
	}
	if msg.OutputStyle != "" {
		payload["outputStyle"] = msg.OutputStyle
	}
	p.emit(scope, BusEventSessionInit, payload)
}

func (p *NDJSONStreamParser) emitToolResult(scope map[string]any, msg *claudeSDKMessage) {
	if msg.Message == nil {
		return
	}
	for _, block := range msg.Message.Content {
		if block.Type == "tool_result" {
			toolName := p.toolNames[block.ToolUseID]
			p.emit(scope, BusEventToolResult, map[string]any{
				"callId":   block.ToolUseID,
				"toolName": toolName,
				"content":  block.Content,
				"isError":  block.IsError,
			})
			// Emit file_change for Write/Edit tools
			if isFileModifyingTool(toolName) {
				p.emit(scope, BusEventFileChange, map[string]any{
					"callId":   block.ToolUseID,
					"toolName": toolName,
					"content":  block.Content,
					"isError":  block.IsError,
				})
			}
		}
	}
}

func (p *NDJSONStreamParser) emitCompactBoundary(scope map[string]any, msg *claudeSDKMessage) {
	payload := map[string]any{
		"trigger": msg.CompactTrigger,
	}
	if msg.CompactPreTokens > 0 {
		payload["preTokens"] = msg.CompactPreTokens
	}
	p.emit(scope, BusEventCompactBoundary, payload)
}

func (p *NDJSONStreamParser) emitStatusChange(scope map[string]any, msg *claudeSDKMessage) {
	payload := map[string]any{}
	if msg.StatusField != "" {
		payload["status"] = msg.StatusField
	}
	if msg.PermissionMode != "" {
		payload["permissionMode"] = msg.PermissionMode
	}
	p.emit(scope, BusEventStatusChange, payload)
}

func (p *NDJSONStreamParser) emitAPIRetry(scope map[string]any, msg *claudeSDKMessage) {
	p.emit(scope, BusEventAPIRetry, map[string]any{
		"attempt":      msg.RetryAttempt,
		"maxRetries":   msg.RetryMaxRetries,
		"retryDelayMs": msg.RetryDelayMs,
		"errorStatus":  msg.RetryErrorStatus,
		"error":        msg.AuthErrorMessage,
	})
}

func (p *NDJSONStreamParser) emitTaskStarted(scope map[string]any, msg *claudeSDKMessage) {
	p.emit(scope, BusEventTaskStarted, map[string]any{
		"taskId":      msg.TaskID,
		"toolUseId":   msg.ToolUseID,
		"description": msg.TaskDescription,
		"taskType":    msg.TaskType,
	})
}

func (p *NDJSONStreamParser) emitTaskDispatched(scope map[string]any, msg *claudeSDKMessage) {
	p.emit(scope, BusEventTaskDispatched, map[string]any{
		"taskId":      msg.TaskID,
		"toolUseId":   msg.ToolUseID,
		"description": msg.TaskDescription,
		"taskType":    msg.TaskType,
	})
}

func (p *NDJSONStreamParser) emitTaskProgress(scope map[string]any, msg *claudeSDKMessage) {
	p.emit(scope, BusEventTaskProgress, map[string]any{
		"taskId":       msg.TaskID,
		"description":  msg.TaskDescription,
		"lastToolName": msg.LastToolName,
		"usage":        msg.TaskUsage,
	})
}

func (p *NDJSONStreamParser) emitTaskNotification(scope map[string]any, msg *claudeSDKMessage) {
	p.emit(scope, BusEventTaskNotification, map[string]any{
		"taskId":  msg.TaskID,
		"status":  msg.TaskStatus,
		"summary": msg.TaskSummary,
		"usage":   msg.TaskUsage,
	})
}

func (p *NDJSONStreamParser) emitSessionStateChanged(scope map[string]any, msg *claudeSDKMessage) {
	p.emit(scope, BusEventSessionStateChanged, map[string]any{
		"state": msg.SessionState,
	})
}

func (p *NDJSONStreamParser) emitHookStarted(scope map[string]any, msg *claudeSDKMessage) {
	p.emit(scope, BusEventHookStarted, map[string]any{
		"hookId":    msg.HookID,
		"hookName":  msg.HookName,
		"hookEvent": msg.HookEvent,
	})
}

func (p *NDJSONStreamParser) emitHookProgress(scope map[string]any, msg *claudeSDKMessage) {
	p.emit(scope, BusEventHookProgress, map[string]any{
		"hookId":   msg.HookID,
		"hookName": msg.HookName,
		"stdout":   msg.HookStdout,
		"stderr":   msg.HookStderr,
	})
}

func (p *NDJSONStreamParser) emitHookResponse(scope map[string]any, msg *claudeSDKMessage) {
	p.emit(scope, BusEventHookResponse, map[string]any{
		"hookId":   msg.HookID,
		"hookName": msg.HookName,
		"outcome":  msg.HookOutcome,
		"exitCode": msg.HookExitCode,
		"stdout":   msg.HookStdout,
	})
}

func isFileModifyingTool(name string) bool {
	switch name {
	case "Write", "Edit", "NotebookEdit",
		"write", "edit", "apply_patch":
		return true
	default:
		return false
	}
}

func (p *NDJSONStreamParser) emit(scope map[string]any, eventType string, payload map[string]any) {
	// Run AgentHook PreToolUse before tool calls
	if eventType == BusEventToolCall && len(p.hooks) > 0 {
		toolName, _ := payload["toolName"].(string)
		input, _ := payload["input"].(map[string]any)
		if modified, block, reason := p.hooks.RunPreToolUse(p.ctx, toolName, input); block {
			payload["input"] = modified
			payload["status"] = "blocked"
			payload["blockReason"] = reason
		} else if len(modified) > 0 {
			payload["input"] = modified
		}
	}

	p.emitter.Emit(eventType, scope, payload)

	// Run AgentHook PostToolUse after tool results
	if eventType == BusEventToolResult && len(p.hooks) > 0 {
		toolName, _ := payload["toolName"].(string)
		output, _ := payload["content"].(string)
		payload["content"] = p.hooks.RunPostToolUse(p.ctx, toolName, output)
	}
}
