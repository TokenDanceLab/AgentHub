package acp

import (
	"context"
	"strings"
	"testing"

	"github.com/agenthub/edge-server/internal/adapters"
	acpsdk "github.com/coder/acp-go-sdk"
)

func TestACPSessionUpdateToolCallBlockedBySecureEmitterAllowlist(t *testing.T) {
	scope := map[string]any{
		"projectId": "project-contract",
		"threadId":  "thread-contract",
		"runId":     "run-contract",
	}
	inner := &recordingEmitter{}
	allowlist := adapters.NewToolAllowlistHook([]string{"Read"}, inner, scope)
	secure := adapters.NewSecureEmitter(
		context.Background(),
		inner,
		adapters.HookChain{allowlist},
	)

	update := acpsdk.StartToolCall(
		"tc_blocked",
		"Bash",
		acpsdk.WithStartKind(acpsdk.ToolKindExecute),
		acpsdk.WithStartStatus(acpsdk.ToolCallStatusInProgress),
		acpsdk.WithStartRawInput(map[string]any{"command": "echo contract"}),
	)
	for _, event := range mapACPSessionUpdate(update) {
		secure.Emit(event.EventType, scope, event.Payload)
	}

	toolCalls := inner.eventsByType(BusEventToolCall)
	if len(toolCalls) != 1 {
		t.Fatalf("expected one mapped tool_call event, got %d", len(toolCalls))
	}
	payload, ok := toolCalls[0].payload.(map[string]any)
	if !ok {
		t.Fatalf("tool_call payload type = %T, want map[string]any", toolCalls[0].payload)
	}
	if payload["toolName"] != "Bash" {
		t.Fatalf("toolName = %v, want Bash from the ACP title field", payload["toolName"])
	}
	input, ok := payload["input"].(map[string]any)
	if !ok || input["command"] != "echo contract" {
		t.Fatalf("input = %#v, want ACP rawInput command", payload["input"])
	}
	if payload["status"] != "blocked" {
		t.Fatalf("status = %v, want blocked after ToolAllowlistHook", payload["status"])
	}
	blockReason, _ := payload["blockReason"].(string)
	if !strings.Contains(blockReason, `tool "Bash" rejected`) {
		t.Fatalf("blockReason = %q, want Bash allowlist rejection", blockReason)
	}

	rejections := inner.eventsByType(adapters.BusEventToolRejected)
	if len(rejections) != 1 {
		t.Fatalf("expected one tool_rejected event, got %d", len(rejections))
	}
	rejection, ok := rejections[0].payload.(map[string]any)
	if !ok {
		t.Fatalf("tool_rejected payload type = %T, want map[string]any", rejections[0].payload)
	}
	if rejection["toolName"] != "Bash" || rejection["status"] != "rejected" {
		t.Fatalf("tool_rejected payload = %#v, want Bash/rejected", rejection)
	}
	if rejections[0].scope["runId"] != scope["runId"] {
		t.Fatalf("tool_rejected scope = %#v, want runId %v", rejections[0].scope, scope["runId"])
	}
}
