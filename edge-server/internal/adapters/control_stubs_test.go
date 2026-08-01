package adapters

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"
)

func TestControlProtocolCapabilitySubtypesReturnExplicitUnsupported(t *testing.T) {
	tests := []struct {
		name       string
		subtype    string
		input      map[string]any
		capability string
	}{
		{
			name:       "context usage",
			subtype:    "get_context_usage",
			input:      map[string]any{"session_id": "session-1"},
			capability: "context_usage",
		},
		{
			name:       "mcp status",
			subtype:    "mcp_status",
			capability: "mcp_status",
		},
		{
			name:    "mcp set servers",
			subtype: "mcp_set_servers",
			input: map[string]any{
				"servers": []any{
					map[string]any{"name": "filesystem", "command": "npx"},
				},
			},
			capability: "mcp_dynamic_servers",
		},
		{
			name:       "settings",
			subtype:    "get_settings",
			capability: "runtime_settings",
		},
		{
			name:    "flag settings",
			subtype: "apply_flag_settings",
			input: map[string]any{
				"flags": map[string]any{"verbose": true},
			},
			capability: "runtime_flag_settings",
		},
		{
			name:    "hook callback",
			subtype: "hook_callback",
			input: map[string]any{
				"hook_name": "PreToolUse",
				"phase":     "pre",
				"tool_name": "Bash",
			},
			capability: "hook_callbacks",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var buf bytes.Buffer
			inner, err := json.Marshal(ControlRequestInner{
				Subtype: tt.subtype,
				Input:   tt.input,
			})
			if err != nil {
				t.Fatalf("marshal request: %v", err)
			}

			handler := &DefaultPermissionHandler{}
			if err := handler.HandleControlRequest(context.Background(), &buf, ControlMessage{
				Type:      "control_request",
				RequestID: "req-" + tt.subtype,
				Request:   inner,
			}); err != nil {
				t.Fatalf("HandleControlRequest: %v", err)
			}

			payload := decodeControlCapabilityPayload(t, buf.Bytes(), "req-"+tt.subtype)
			if payload["requestedSubtype"] != tt.subtype {
				t.Fatalf("requestedSubtype = %q, want %q", payload["requestedSubtype"], tt.subtype)
			}
			if payload["request_id"] != "req-"+tt.subtype {
				t.Fatalf("request_id = %q, want %q", payload["request_id"], "req-"+tt.subtype)
			}
			if payload["subtype"] != tt.subtype {
				t.Fatalf("subtype = %q, want %q", payload["subtype"], tt.subtype)
			}
			if payload["capability"] != tt.capability {
				t.Fatalf("capability = %q, want %q", payload["capability"], tt.capability)
			}
			if supported, _ := payload["supported"].(bool); supported {
				t.Fatal("supported = true, want false for an unwired capability")
			}
			if payload["status"] != "unsupported" {
				t.Fatalf("status = %q, want unsupported", payload["status"])
			}
			if msg, _ := payload["message"].(string); msg == "" {
				t.Fatal("message should explain the unsupported capability")
			}
		})
	}
}

func TestControlProtocolActionSubtypesDoNotClaimAppliedWork(t *testing.T) {
	tests := []struct {
		name    string
		subtype string
		input   map[string]any
	}{
		{
			name:    "mcp set servers",
			subtype: "mcp_set_servers",
			input: map[string]any{
				"servers": []any{map[string]any{"name": "filesystem"}},
			},
		},
		{
			name:    "flag settings",
			subtype: "apply_flag_settings",
			input: map[string]any{
				"flags": map[string]any{"verbose": true, "dry_run": false},
			},
		},
		{
			name:    "hook callback",
			subtype: "hook_callback",
			input: map[string]any{
				"hook_name": "PostToolUse",
				"phase":     "post",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var buf bytes.Buffer
			inner, err := json.Marshal(ControlRequestInner{
				Subtype: tt.subtype,
				Input:   tt.input,
			})
			if err != nil {
				t.Fatalf("marshal request: %v", err)
			}

			handler := &DefaultPermissionHandler{}
			if err := handler.HandleControlRequest(context.Background(), &buf, ControlMessage{
				Type:      "control_request",
				RequestID: "req-action",
				Request:   inner,
			}); err != nil {
				t.Fatalf("HandleControlRequest: %v", err)
			}

			payload := decodeControlCapabilityPayload(t, buf.Bytes(), "req-action")
			if applied, _ := payload["applied"].(bool); applied {
				t.Fatal("applied = true, want false when no backing action is wired")
			}
		})
	}
}

func TestWriteUnsupportedControlResponseWriteError(t *testing.T) {
	err := writeUnsupportedControlResponse(&failingWriter{}, "req-write-error", "get_context_usage", "context_usage")
	if err == nil {
		t.Fatal("expected write error, got nil")
	}
}

func decodeControlCapabilityPayload(t *testing.T, data []byte, requestID string) map[string]any {
	t.Helper()
	if len(data) == 0 {
		t.Fatal("expected control response, got no output")
	}
	if data[len(data)-1] != '\n' {
		t.Fatalf("control response does not end with newline: %q", data)
	}

	var outer ControlMessage
	if err := json.Unmarshal(data, &outer); err != nil {
		t.Fatalf("unmarshal outer response: %v", err)
	}
	if outer.Type != "control_response" {
		t.Fatalf("Type = %q, want control_response", outer.Type)
	}
	if outer.RequestID != requestID {
		t.Fatalf("RequestID = %q, want %q", outer.RequestID, requestID)
	}

	var inner ControlResponseInner
	if err := json.Unmarshal(outer.Response, &inner); err != nil {
		t.Fatalf("unmarshal inner response: %v", err)
	}
	if inner.Subtype != "unsupported" {
		t.Fatalf("inner.Subtype = %q, want unsupported", inner.Subtype)
	}
	if inner.RequestID != requestID {
		t.Fatalf("inner.RequestID = %q, want %q", inner.RequestID, requestID)
	}
	if inner.Error == "" {
		t.Fatal("inner.Error should name the unsupported capability")
	}
	if inner.UpdatedInput == nil {
		t.Fatal("inner.UpdatedInput should carry structured capability status")
	}

	raw, err := json.Marshal(inner.UpdatedInput)
	if err != nil {
		t.Fatalf("marshal inner.UpdatedInput: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("unmarshal capability payload: %v", err)
	}
	return payload
}
