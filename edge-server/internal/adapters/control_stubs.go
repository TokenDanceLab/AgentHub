package adapters

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
)

type contextUsageControlRequest struct {
	SessionID string `json:"session_id,omitempty"`
}

type mcpSetServersControlRequest struct {
	Servers []mcpServerControlConfig `json:"servers,omitempty"`
}

type mcpServerControlConfig struct {
	Name    string            `json:"name,omitempty"`
	Command string            `json:"command,omitempty"`
	URL     string            `json:"url,omitempty"`
	Args    []string          `json:"args,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
}

type applyFlagSettingsControlRequest struct {
	Flags map[string]any `json:"flags,omitempty"`
}

type hookCallbackControlRequest struct {
	HookName string         `json:"hook_name,omitempty"`
	Phase    string         `json:"phase,omitempty"`
	ToolName string         `json:"tool_name,omitempty"`
	Result   string         `json:"result,omitempty"`
	Data     map[string]any `json:"data,omitempty"`
}

// ControlCapabilityResponse reports that a known control-protocol subtype was
// routed but cannot be fulfilled by this adapter yet.
type ControlCapabilityResponse struct {
	RequestID        string `json:"request_id"`
	Subtype          string `json:"subtype"`
	RequestedSubtype string `json:"requestedSubtype"`
	Capability       string `json:"capability"`
	Supported        bool   `json:"supported"`
	Status           string `json:"status"`
	Applied          bool   `json:"applied"`
	Message          string `json:"message"`
}

func (h *DefaultPermissionHandler) handleGetContextUsage(ctx context.Context, stdin io.Writer, requestID string, inner *ControlRequestInner) error {
	_ = ctx
	var req contextUsageControlRequest
	decodeControlInput(inner.Input, &req)
	slog.Debug("control: get_context_usage unsupported", "sessionId", req.SessionID)
	return writeUnsupportedControlResponse(stdin, requestID, inner.Subtype, "context_usage", nil)
}

func (h *DefaultPermissionHandler) handleMCPStatus(ctx context.Context, stdin io.Writer, requestID string, inner *ControlRequestInner) error {
	_ = ctx
	slog.Debug("control: mcp_status unsupported")
	return writeUnsupportedControlResponse(stdin, requestID, inner.Subtype, "mcp_status", nil)
}

func (h *DefaultPermissionHandler) handleMCPSetServers(ctx context.Context, stdin io.Writer, requestID string, inner *ControlRequestInner) error {
	_ = ctx
	var req mcpSetServersControlRequest
	decodeControlInput(inner.Input, &req)
	slog.Debug("control: mcp_set_servers unsupported", "serverCount", len(req.Servers))
	return writeUnsupportedControlResponse(stdin, requestID, inner.Subtype, "mcp_dynamic_servers", nil)
}

func (h *DefaultPermissionHandler) handleGetSettings(ctx context.Context, stdin io.Writer, requestID string, inner *ControlRequestInner) error {
	_ = ctx
	slog.Debug("control: get_settings unsupported")
	return writeUnsupportedControlResponse(stdin, requestID, inner.Subtype, "runtime_settings", nil)
}

func (h *DefaultPermissionHandler) handleApplyFlagSettings(ctx context.Context, stdin io.Writer, requestID string, inner *ControlRequestInner) error {
	_ = ctx
	var req applyFlagSettingsControlRequest
	decodeControlInput(inner.Input, &req)
	slog.Debug("control: apply_flag_settings unsupported", "flagCount", len(req.Flags))
	return writeUnsupportedControlResponse(stdin, requestID, inner.Subtype, "runtime_flag_settings", nil)
}

func (h *DefaultPermissionHandler) handleHookCallback(ctx context.Context, stdin io.Writer, requestID string, inner *ControlRequestInner) error {
	_ = ctx
	var req hookCallbackControlRequest
	decodeControlInput(inner.Input, &req)
	slog.Debug("control: hook_callback unsupported", "hookName", req.HookName, "phase", req.Phase, "toolName", req.ToolName)
	return writeUnsupportedControlResponse(stdin, requestID, inner.Subtype, "hook_callbacks", nil)
}

func decodeControlInput(input any, out any) {
	if input == nil {
		return
	}
	raw, err := json.Marshal(input)
	if err != nil {
		return
	}
	_ = json.Unmarshal(raw, out)
}

func writeUnsupportedControlResponse(stdin io.Writer, requestID, requestedSubtype, capability string, details map[string]any) error {
	message := fmt.Sprintf("control subtype %q is recognized but %q is not wired in the Edge adapter", requestedSubtype, capability)
	payload := map[string]any{
		"request_id":       requestID,
		"subtype":          requestedSubtype,
		"requestedSubtype": requestedSubtype,
		"capability":       capability,
		"supported":        false,
		"status":           "unsupported",
		"applied":          false,
		"message":          message,
	}
	for key, value := range details {
		payload[key] = value
	}

	innerResp := ControlResponseInner{
		Subtype:      "unsupported",
		RequestID:    requestID,
		Message:      message,
		Error:        "unsupported_control_capability",
		UpdatedInput: payload,
	}
	raw, err := json.Marshal(innerResp)
	if err != nil {
		return err
	}

	resp := ControlMessage{
		Type:      "control_response",
		RequestID: requestID,
		Response:  raw,
	}
	data, err := json.Marshal(resp)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if _, err := stdin.Write(data); err != nil {
		return fmt.Errorf("write control_response: %w", err)
	}
	return nil
}
