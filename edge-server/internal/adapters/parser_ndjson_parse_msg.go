package adapters

// Residual pure-helper peel #1113: assistant / stream / result parse helpers.

func (p *NDJSONStreamParser) parseAssistantMessage(scope map[string]any, msg *claudeSDKMessage) {
	if msg.Message == nil {
		return
	}
	for _, block := range msg.Message.Content {
		switch block.Type {
		case "text":
			p.emit(scope, BusEventTextBlock, map[string]any{
				"content": block.Text,
			})
		case "tool_use":
			if block.ID != "" {
				p.toolNames[block.ID] = block.Name
			}
			toolCallPayload := map[string]any{
				"callId":   block.ID,
				"toolName": block.Name,
				"input":    block.Input,
				"status":   "pending",
			}
			p.emit(scope, BusEventToolCall, toolCallPayload)
			// Emit dedicated MCP tool call event for MCP-sourced tools.
			// Claude Code MCP tools have names matching "mcp__<server>__<tool>".
			if IsMCPToolCall(block.Name) {
				p.emitter.Emit(BusEventMCPToolCall, scope, toolCallPayload)
			}
		case "thinking":
			p.emit(scope, BusEventThinking, map[string]any{
				"content": block.Thinking,
			})
		}
	}
}

func (p *NDJSONStreamParser) parseStreamEvent(scope map[string]any, msg *claudeSDKMessage) {
	if msg.Event == nil {
		return
	}
	switch msg.Event.Type {
	case "content_block_delta":
		switch msg.Event.Delta.Type {
		case "text_delta":
			p.emit(scope, BusEventTextDelta, map[string]any{
				"content": msg.Event.Delta.Text,
			})
		case "thinking_delta":
			p.emit(scope, BusEventThinking, map[string]any{
				"content": msg.Event.Delta.Thinking,
			})
		}
	case "content_block_start":
		if msg.Event.ContentBlock != nil && msg.Event.ContentBlock.Type == "tool_use" {
			if msg.Event.ContentBlock.ID != "" {
				p.toolNames[msg.Event.ContentBlock.ID] = msg.Event.ContentBlock.Name
			}
			toolCallPayload := map[string]any{
				"callId":   msg.Event.ContentBlock.ID,
				"toolName": msg.Event.ContentBlock.Name,
				"input":    msg.Event.ContentBlock.Input,
				"status":   "started",
			}
			p.emit(scope, BusEventToolCall, toolCallPayload)
			if IsMCPToolCall(msg.Event.ContentBlock.Name) {
				p.emitter.Emit(BusEventMCPToolCall, scope, toolCallPayload)
			}
		}
	case "content_block_stop":
		// End of a content block — no additional info needed
	}
}

func (p *NDJSONStreamParser) parseResult(scope map[string]any, msg *claudeSDKMessage) {
	success := msg.Subtype == "success"
	payload := map[string]any{
		"success":  success,
		"duration": msg.DurationMs,
		"turns":    msg.NumTurns,
	}
	if msg.Usage != nil {
		payload["usage"] = map[string]any{
			"inputTokens":  msg.Usage.InputTokens,
			"outputTokens": msg.Usage.OutputTokens,
		}
		// Track cumulative token consumption for context budget.
		if p.budget != nil {
			p.budget.Track(int(msg.Usage.InputTokens + msg.Usage.OutputTokens))
		}
		// Emit context_usage event for budgeting and dashboards (parity with Codex/OpenCode adapters).
		if success {
			p.emit(scope, BusEventContextUsage, map[string]any{
				"inputTokens":  msg.Usage.InputTokens,
				"outputTokens": msg.Usage.OutputTokens,
			})
		}
	}
	if !success {
		payload["errors"] = msg.Errors
	}
	// Additional result fields from audit Section 5.10
	if msg.DurationAPIMs > 0 {
		payload["durationApi"] = msg.DurationAPIMs
	}
	if msg.TotalCostUSD > 0 {
		payload["totalCostUsd"] = msg.TotalCostUSD
	}
	if msg.StopReason != "" {
		payload["stopReason"] = msg.StopReason
	}
	if msg.ModelUsage != nil {
		payload["modelUsage"] = msg.ModelUsage
	}
	if msg.PermissionDenials != nil {
		payload["permissionDenials"] = msg.PermissionDenials
	}
	if msg.StructuredOutput != nil {
		payload["structuredOutput"] = msg.StructuredOutput
		p.emitRouteDecision(scope, msg.StructuredOutput)
	}
	if msg.SessionID != "" {
		payload["sessionId"] = msg.SessionID
	}
	// Emit session metrics (tokens/cost) for Hub Prometheus consumption.
	// Pure helper keeps the decision testable without parser state.
	if mp, ok := SessionMetricsPayload(msg); ok {
		p.emit(scope, BusEventSessionMetrics, mp)
	}
	p.emit(scope, BusEventResult, payload)
}
