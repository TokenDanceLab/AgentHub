package adapters

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"sync"
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
	Type      string          `json:"type"`                // "control_request", "control_response", "control_cancel_request"
	RequestID string          `json:"request_id,omitempty"`
	Request   json.RawMessage `json:"request,omitempty"`
	Response  json.RawMessage `json:"response,omitempty"`
}

// ControlRequestInner is the inner request payload.
type ControlRequestInner struct {
	Subtype          string           `json:"subtype"`
	ToolName         string           `json:"tool_name,omitempty"`
	Input            any              `json:"input,omitempty"`
	ToolUseID        string           `json:"tool_use_id,omitempty"`
	PermissionSuggestions []any       `json:"permission_suggestions,omitempty"`
	AgentID          string           `json:"agent_id,omitempty"`
	Description      string           `json:"description,omitempty"`
	TaskID           string           `json:"task_id,omitempty"`
	Mode             string           `json:"mode,omitempty"`
	Model            string           `json:"model,omitempty"`
	MaxThinkingTokens *int            `json:"max_thinking_tokens,omitempty"`
}

// ControlResponseInner is the response to a control_request.
type ControlResponseInner struct {
	Subtype            string `json:"subtype"`
	RequestID          string `json:"request_id,omitempty"`
	Behavior           string `json:"behavior,omitempty"`           // "allow", "deny"
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
	Behavior string // "allow" or "deny"
	Message  string // explanation for deny
}

// DefaultPermissionHandler auto-approves all tool use (bypassPermissions equivalent).
// Replace with a proper approval engine for production use.
type DefaultPermissionHandler struct {
	mu sync.Mutex
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
	resp := ControlMessage{
		Type:      "control_response",
		RequestID: requestID,
	}
	innerResp := ControlResponseInner{
		Subtype:   "success",
		RequestID: requestID,
		Behavior:  "allow",
		ToolUseID: inner.ToolUseID,
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
	slog.Debug("control: auto-allowed tool", "tool", inner.ToolName, "toolUseId", inner.ToolUseID)
	return nil
}

// WriteInterrupt sends an interrupt control_request to the CLI via stdin.
func WriteInterrupt(stdin io.Writer, requestID string) error {
	inner, _ := json.Marshal(ControlRequestInner{Subtype: "interrupt"})
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
	inner, _ := json.Marshal(ControlRequestInner{Subtype: "set_model", Model: model})
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
	inner, _ := json.Marshal(ControlRequestInner{Subtype: "set_permission_mode", Mode: mode})
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
	inner, _ := json.Marshal(ControlRequestInner{Subtype: "stop_task", TaskID: taskID})
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
