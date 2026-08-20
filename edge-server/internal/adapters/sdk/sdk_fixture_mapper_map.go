package sdk

import "github.com/agenthub/edge-server/internal/adapters"

// Residual pure-helper peel #1122: mapSDKFixtureEvent type switch body.

func mapSDKFixtureEvent(event SDKFixtureEvent, provider string, scope map[string]any) []SDKMappedEvent {
	switch normalizeSDKFixtureType(event.Type) {
	case "message", "assistant_message", "text_block":
		return oneSDKMappedEvent(BusEventTextBlock, scope, commonSDKPayload(event, provider, map[string]any{
			"content": firstNonEmpty(event.Content, event.Text, event.Output, event.Summary),
		}))
	case "text_delta", "delta":
		return oneSDKMappedEvent(BusEventTextDelta, scope, commonSDKPayload(event, provider, map[string]any{
			"content": firstNonEmpty(event.Content, event.Text, event.Output),
		}))
	case "invocation_plan", "cli_invocation_plan":
		return oneSDKMappedEvent(BusEventCLIInvocationPlan, scope, commonSDKPayload(event, provider, map[string]any{
			"adapterId":           event.AdapterID,
			"commandName":         adapters.CommandNameOnly(event.CommandName),
			"argFlags":            event.ArgFlags,
			"configKeys":          event.ConfigKeys,
			"positionalArgCount":  event.PositionalArgCount,
			"envNames":            adapters.EnvNamesOnly(event.EnvNames),
			"workDir":             adapters.InvocationPathNameOnly(event.WorkDir),
			"promptRedacted":      event.PromptRedacted,
			"observed":            false,
			"realTested":          false,
			"realTestedReason":    firstNonEmpty(event.RealTestedReason, "fixture plan only; no approved observed CLI chain"),
			"executionMode":       firstNonEmpty(event.ExecutionMode, "fixture"),
			"noSpendDefault":      true,
			"redactionApplied":    true,
			"approvalRequired":    true,
			"approvalEvidenceRef": event.ApprovalEvidenceRef,
		}))
	case "sidecar_session_ready", "session_ready":
		return oneSDKMappedEvent(BusEventSessionInit, scope, commonSDKPayload(event, provider, map[string]any{
			"sessionId":      event.SessionID,
			"model":          event.Model,
			"permissionMode": event.PermissionMode,
			"tools":          event.Tools,
		}))
	case "session_updated", "status", "status_change":
		return oneSDKMappedEvent(BusEventStatusChange, scope, commonSDKPayload(event, provider, map[string]any{
			"sessionId": event.SessionID,
			"status":    event.Status,
			"summary":   event.Summary,
			"reason":    event.Reason,
		}))
	case "runtime_metadata", "capability_health", "capabilities", "health":
		return oneSDKMappedEvent(BusEventStatusChange, scope, commonSDKPayload(event, provider, sdkFixtureCapabilityHealthPayload(event)))
	case "progress", "task_progress":
		return oneSDKMappedEvent(BusEventTaskProgress, scope, commonSDKPayload(event, provider, map[string]any{
			"taskId":       firstNonEmpty(event.TaskID, event.ID),
			"description":  event.Description,
			"status":       event.Status,
			"percent":      event.Percent,
			"lastToolName": event.LastToolName,
			"summary":      event.Summary,
		}))
	case "usage", "context_usage":
		return oneSDKMappedEvent(BusEventContextUsage, scope, commonSDKPayload(event, provider, sdkUsagePayload(event)))
	case "error", "runtime_error":
		payload := commonSDKPayload(event, provider, map[string]any{
			"success":        false,
			"terminalReason": "error",
			"reason":         firstNonEmpty(event.Reason, "error"),
			"error":          sanitizeSDKText(event.Error),
			"sessionId":      event.SessionID,
		})
		return oneSDKMappedEvent(BusEventResult, scope, payload)
	case "cancelled", "canceled", "cancellation":
		payload := commonSDKPayload(event, provider, map[string]any{
			"success":        false,
			"cancelled":      true,
			"terminalReason": "cancelled",
			"reason":         firstNonEmpty(event.Reason, "cancelled"),
			"summary":        event.Summary,
			"sessionId":      event.SessionID,
		})
		return oneSDKMappedEvent(BusEventResult, scope, payload)
	case "tool_state":
		return mapSDKFixtureToolStateEvent(event, provider, scope)
	case "tool_call":
		return oneSDKMappedEvent(BusEventToolCall, scope, commonSDKPayload(event, provider, map[string]any{
			"callId":   firstNonEmpty(event.CallID, event.ToolUseID, event.ID),
			"toolName": event.ToolName,
			"input":    sanitizeSDKValue(event.Input),
			"status":   "pending",
		}))
	case "tool_result":
		return oneSDKMappedEvent(BusEventToolResult, scope, commonSDKPayload(event, provider, map[string]any{
			"callId":      firstNonEmpty(event.CallID, event.ToolUseID, event.ID),
			"toolName":    event.ToolName,
			"content":     event.Output,
			"isError":     event.IsError,
			"attachments": sanitizeSDKValue(event.Attachments),
		}))
	case "permission_request", "guardrail_signal":
		return oneSDKMappedEvent(BusEventPermissionRequested, scope, commonSDKPayload(event, provider, map[string]any{
			"requestId": firstNonEmpty(event.RequestID, event.ID),
			"toolName":  event.ToolName,
			"toolUseId": firstNonEmpty(event.ToolUseID, event.CallID),
			"input":     sanitizeSDKValue(event.Input),
			"riskLevel": firstNonEmpty(event.RiskLevel, "medium"),
			"reason":    event.Reason,
			"guardrail": event.Guardrail,
			"decision":  event.Decision,
		}))
	case "handoff", "handoff_suggestion", "route_suggestion":
		nextWorker := firstNonEmpty(event.NextWorker, event.TargetAgent)
		return oneSDKMappedEvent(BusEventRouteDecision, scope, commonSDKPayload(event, provider, map[string]any{
			"action":       firstNonEmpty(event.Action, "delegate"),
			"next_worker":  nextWorker,
			"targetAgent":  event.TargetAgent,
			"instructions": event.Instructions,
			"reasoning":    event.Reason,
			"summary":      event.Summary,
		}))
	case "file_change", "artifact_file":
		payload := commonSDKPayload(event, provider, map[string]any{
			"callId":   firstNonEmpty(event.CallID, event.ToolUseID),
			"toolName": event.ToolName,
			"path":     normalizeSDKWorkspacePath(event.Path),
			"kind":     firstNonEmpty(event.Kind, "modified"),
			"diff":     event.Diff,
		})
		return oneSDKMappedEvent(BusEventFileChange, scope, payload)
	case "artifact", "artifact_created":
		payload := commonSDKPayload(event, provider, map[string]any{
			"id":         firstNonEmpty(event.ArtifactID, event.ID),
			"artifactId": firstNonEmpty(event.ArtifactID, event.ID),
			"path":       normalizeSDKWorkspacePath(event.Path),
			"kind":       firstNonEmpty(event.Kind, "file"),
			"sizeBytes":  event.SizeBytes,
			"summary":    event.Summary,
		})
		return oneSDKMappedEvent(sdkFixtureEventArtifactCreated, scope, payload)
	case "trace_ref", "result", "run_result", "terminal_result":
		return mapSDKFixtureResultEvent(event, provider, scope)
	default:
		return nil
	}
}

// mapSDKFixtureToolStateEvent maps a tool_state fixture event into the
// tool_call (+ tool_result when the tool has finished) event pair.
func mapSDKFixtureToolStateEvent(event SDKFixtureEvent, provider string, scope map[string]any) []SDKMappedEvent {
	events := []SDKMappedEvent{{
		Type:  BusEventToolCall,
		Scope: cloneSDKScope(scope),
		Payload: commonSDKPayload(event, provider, map[string]any{
			"callId":   firstNonEmpty(event.CallID, event.ToolUseID, event.ID),
			"toolName": event.ToolName,
			"input":    sanitizeSDKValue(event.Input),
			"status":   firstNonEmpty(event.Status, "pending"),
		}),
	}}
	if event.Status == "completed" || event.Status == "error" || event.Output != "" || event.Error != "" {
		events = append(events, SDKMappedEvent{
			Type:  BusEventToolResult,
			Scope: cloneSDKScope(scope),
			Payload: commonSDKPayload(event, provider, map[string]any{
				"callId":      firstNonEmpty(event.CallID, event.ToolUseID, event.ID),
				"toolName":    event.ToolName,
				"content":     firstNonEmpty(event.Output, event.Error),
				"isError":     event.IsError || event.Status == "error",
				"attachments": sanitizeSDKValue(event.Attachments),
			}),
		})
	}
	return events
}

// mapSDKFixtureResultEvent maps a terminal result fixture event into the
// BusEventResult projection.
func mapSDKFixtureResultEvent(event SDKFixtureEvent, provider string, scope map[string]any) []SDKMappedEvent {
	success := true
	if event.Success != nil {
		success = *event.Success
	}
	payload := commonSDKPayload(event, provider, map[string]any{
		"success":        success,
		"summary":        event.Summary,
		"terminalReason": terminalReasonForSDKEvent(event, success),
		"reason":         event.Reason,
		"usage":          sdkUsagePayload(event),
	})
	return oneSDKMappedEvent(BusEventResult, scope, payload)
}
