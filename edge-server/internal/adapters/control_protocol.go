package adapters

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
)

// ControlHandler receives control messages from the CLI's stdout and can respond on stdin.
// It is called by the NDJSON parser when it encounters control_request messages.
type ControlHandler interface {
	// HandleControlRequest is called when the CLI sends a control_request on stdout.
	// The handler can write a response to stdin via the provided writer.
	HandleControlRequest(ctx context.Context, stdin io.Writer, msg ControlMessage) error
}

// ControlMessage represents a control_request or control_response on stdout.
type ControlMessage struct {
	Type      string          `json:"type"` // "control_request", "control_response", "control_cancel_request"
	RequestID string          `json:"request_id,omitempty"`
	Request   json.RawMessage `json:"request,omitempty"`
	Response  json.RawMessage `json:"response,omitempty"`
}

// ControlRequestInner is the inner request payload.
type ControlRequestInner struct {
	Subtype               string `json:"subtype"`
	ToolName              string `json:"tool_name,omitempty"`
	Input                 any    `json:"input,omitempty"`
	ToolUseID             string `json:"tool_use_id,omitempty"`
	PermissionSuggestions []any  `json:"permission_suggestions,omitempty"`
	AgentID               string `json:"agent_id,omitempty"`
	Description           string `json:"description,omitempty"`
	TaskID                string `json:"task_id,omitempty"`
	Mode                  string `json:"mode,omitempty"`
	Model                 string `json:"model,omitempty"`
	MaxThinkingTokens     *int   `json:"max_thinking_tokens,omitempty"`
}

// ControlResponseInner is the response to a control_request.
type ControlResponseInner struct {
	Subtype            string `json:"subtype"`
	RequestID          string `json:"request_id,omitempty"`
	Behavior           string `json:"behavior,omitempty"` // "allow", "deny"
	UpdatedInput       any    `json:"updatedInput,omitempty"`
	Message            string `json:"message,omitempty"`
	Interrupt          bool   `json:"interrupt,omitempty"`
	ToolUseID          string `json:"toolUseID,omitempty"`
	DecisionClass      string `json:"decisionClassification,omitempty"`
	UpdatedPermissions []any  `json:"updatedPermissions,omitempty"`
	Error              string `json:"error,omitempty"`
}

// PermissionRequest carries a can_use_tool request from the CLI.
type PermissionRequest struct {
	RequestID string
	ToolName  string
	ToolUseID string
	Input     any
}

// PermissionDecision is the response to a permission request.
type PermissionDecision struct {
	Behavior      string // "allow" or "deny"
	UpdatedInput  any    // modified tool input (optional)
	Message       string // explanation for deny
	DecisionClass string // optional classification (e.g. "user_approved")
}

// PermissionDecider is a callback invoked when the CLI requests tool permission.
// The handler blocks until the decider returns a decision, then writes the
// control_response back to the CLI. This enables bridging to Desktop's approval UI.
//
// When decider is nil, the DefaultPermissionHandler falls back to auto-approve.
type PermissionDecider func(ctx context.Context, req PermissionRequest) PermissionDecision

// DefaultPermissionHandler auto-approves all tool use (bypassPermissions equivalent).
// For production use, supply a PermissionDecider via NewBridgedPermissionHandler
// to bridge to Desktop's approval UI.
type DefaultPermissionHandler struct {
	emitter EventEmitter    // nil = silent auto-approve; non-nil = emit permission events
	decider PermissionDecider // nil = auto-approve all; non-nil = block until decision
}

func (h *DefaultPermissionHandler) HandleControlRequest(ctx context.Context, stdin io.Writer, msg ControlMessage) error {
	var inner ControlRequestInner
	if err := json.Unmarshal(msg.Request, &inner); err != nil {
		return fmt.Errorf("parse control request: %w", err)
	}

	switch inner.Subtype {
	case "can_use_tool":
		return h.handleCanUseTool(stdin, msg.RequestID, &inner)
	case "initialize":
		// CLI requesting session init — acknowledge
		return nil
	default:
		slog.Debug("control: unhandled request subtype", "subtype", inner.Subtype)
		return nil
	}
}

func (h *DefaultPermissionHandler) handleCanUseTool(stdin io.Writer, requestID string, inner *ControlRequestInner) error {
	// Emit permission_requested so Desktop can display approval UI
	if h.emitter != nil {
		h.emitter.Emit("run.agent.permission_requested", nil, map[string]any{
			"requestId": requestID,
			"toolName":  inner.ToolName,
			"toolUseId": inner.ToolUseID,
			"input":     inner.Input,
		})
	}

	// Wait for decision: if a decider is configured, block until Desktop responds.
	// Otherwise fall back to auto-approve.
	var decision PermissionDecision
	if h.decider != nil {
		decision = h.decider(context.Background(), PermissionRequest{
			RequestID: requestID,
			ToolName:  inner.ToolName,
			ToolUseID: inner.ToolUseID,
			Input:     inner.Input,
		})
	} else {
		decision = PermissionDecision{Behavior: "allow"}
	}

	resp := ControlMessage{
		Type:      "control_response",
		RequestID: requestID,
	}
	innerResp := ControlResponseInner{
		Subtype:       "success",
		RequestID:     requestID,
		Behavior:      decision.Behavior,
		ToolUseID:     inner.ToolUseID,
		UpdatedInput:  decision.UpdatedInput,
		Message:       decision.Message,
		DecisionClass: decision.DecisionClass,
	}
	raw, err := json.Marshal(innerResp)
	if err != nil {
		return err
	}
	resp.Response = raw

	data, err := json.Marshal(resp)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if _, err := stdin.Write(data); err != nil {
		return fmt.Errorf("write control_response: %w", err)
	}

	// Emit permission_decided after decision
	if h.emitter != nil {
		h.emitter.Emit("run.agent.permission_decided", nil, map[string]any{
			"requestId": requestID,
			"toolName":  inner.ToolName,
			"toolUseId": inner.ToolUseID,
			"decision":  decision.Behavior,
		})
	}

	slog.Debug("control: permission decided", "tool", inner.ToolName, "toolUseId", inner.ToolUseID, "decision", decision.Behavior)
	return nil
}

// NewEventEmittingPermissionHandler creates a handler that emits permission events
// to the EventEmitter while auto-approving all tools (no decider = auto-approve).
// This allows Desktop to observe permission activity without blocking execution.
func NewEventEmittingPermissionHandler(emitter EventEmitter) *DefaultPermissionHandler {
	return &DefaultPermissionHandler{emitter: emitter}
}

// NewBridgedPermissionHandler creates a handler that blocks on the provided
// PermissionDecider for each can_use_tool request. Desktop should bridge the
// approval UI through the decider callback. The emitter is used to publish
// permission_requested/permission_decided events for observability.
func NewBridgedPermissionHandler(emitter EventEmitter, decider PermissionDecider) *DefaultPermissionHandler {
	return &DefaultPermissionHandler{emitter: emitter, decider: decider}
}

// WriteInterrupt sends an interrupt control_request to the CLI via stdin.
func WriteInterrupt(stdin io.Writer, requestID string) error {
	inner, err := json.Marshal(ControlRequestInner{Subtype: "interrupt"})
	if err != nil {
		slog.Debug("control: marshal interrupt inner failed", "err", err)
		return err
	}
	msg := ControlMessage{
		Type:      "control_request",
		RequestID: requestID,
		Request:   inner,
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	_, err = stdin.Write(data)
	return err
}

// WriteSetModel sends a set_model control_request.
func WriteSetModel(stdin io.Writer, requestID, model string) error {
	inner, err := json.Marshal(ControlRequestInner{Subtype: "set_model", Model: model})
	if err != nil {
		slog.Debug("control: marshal set_model inner failed", "err", err)
		return err
	}
	msg := ControlMessage{
		Type:      "control_request",
		RequestID: requestID,
		Request:   inner,
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	_, err = stdin.Write(data)
	return err
}

// WriteSetPermissionMode sends a set_permission_mode control_request.
func WriteSetPermissionMode(stdin io.Writer, requestID, mode string) error {
	inner, err := json.Marshal(ControlRequestInner{Subtype: "set_permission_mode", Mode: mode})
	if err != nil {
		slog.Debug("control: marshal set_permission_mode inner failed", "err", err)
		return err
	}
	msg := ControlMessage{
		Type:      "control_request",
		RequestID: requestID,
		Request:   inner,
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	_, err = stdin.Write(data)
	return err
}

// WriteStopTask sends a stop_task control_request for a sub-agent.
func WriteStopTask(stdin io.Writer, requestID, taskID string) error {
	inner, err := json.Marshal(ControlRequestInner{Subtype: "stop_task", TaskID: taskID})
	if err != nil {
		slog.Debug("control: marshal stop_task inner failed", "err", err)
		return err
	}
	msg := ControlMessage{
		Type:      "control_request",
		RequestID: requestID,
		Request:   inner,
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	_, err = stdin.Write(data)
	return err
}
