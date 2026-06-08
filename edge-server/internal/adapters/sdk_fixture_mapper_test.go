package adapters

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSDKFixtureMapperClaudeGolden(t *testing.T) {
	assertSDKFixtureGolden(t, "claude")
}

func TestSDKFixtureMapperOpenAIGolden(t *testing.T) {
	assertSDKFixtureGolden(t, "openai")
}

func TestSDKFixtureMapperKeepsOutputWorkspaceRelativeAndRedacted(t *testing.T) {
	stream := SDKFixtureStream{
		Provider: SDKFixtureProviderClaude,
		Events: []SDKFixtureEvent{
			{
				ID:        "evt_secret_path",
				Type:      "tool_call",
				ToolName:  "Write",
				ToolUseID: "toolu_secret",
				Input: map[string]any{
					"file_path":  "C:\\Users\\Ding\\server\\secret.env",
					"api_key":    "sk-live-secret",
					"nested":     map[string]any{"authorization": "Bearer secret", "path": "../outside.txt"},
					"safe_value": "kept",
				},
			},
			{
				ID:   "artifact_secret_path",
				Type: "artifact",
				Path: "/home/ding/private/report.md",
			},
		},
	}

	mapped := MapSDKFixtureStream(stream, testSDKFixtureScope())
	if len(mapped) != 2 {
		t.Fatalf("expected 2 mapped events, got %d", len(mapped))
	}

	input, ok := mapped[0].Payload["input"].(map[string]any)
	if !ok {
		t.Fatalf("expected sanitized input map, got %#v", mapped[0].Payload["input"])
	}
	if input["file_path"] != "secret.env" {
		t.Fatalf("file_path was not basename-only: %#v", input["file_path"])
	}
	if input["api_key"] != "[redacted]" {
		t.Fatalf("api_key was not redacted: %#v", input["api_key"])
	}
	nested, ok := input["nested"].(map[string]any)
	if !ok {
		t.Fatalf("expected nested map, got %#v", input["nested"])
	}
	if nested["authorization"] != "[redacted]" || nested["path"] != "outside.txt" {
		t.Fatalf("nested fields were not sanitized: %#v", nested)
	}
	if input["safe_value"] != "kept" {
		t.Fatalf("safe value changed: %#v", input["safe_value"])
	}

	if mapped[1].Payload["path"] != "report.md" {
		t.Fatalf("artifact path was not basename-only: %#v", mapped[1].Payload["path"])
	}
}

func assertSDKFixtureGolden(t *testing.T, name string) {
	t.Helper()

	streamData := readSDKFixtureTestdata(t, name+"_fixture.json")
	stream, err := DecodeSDKFixtureStream(streamData)
	if err != nil {
		t.Fatalf("decode fixture: %v", err)
	}

	mapped := MapSDKFixtureStream(stream, testSDKFixtureScope())
	actual := marshalSDKFixtureGolden(t, mapped)
	expected := normalizeSDKFixtureGoldenLineEndings(string(readSDKFixtureTestdata(t, name+"_golden.json")))
	if actual != expected {
		t.Fatalf("%s golden mismatch\nexpected:\n%s\nactual:\n%s", name, expected, actual)
	}
}

func readSDKFixtureTestdata(t *testing.T, filename string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("testdata", "sdk_fixture_mapper", filename))
	if err != nil {
		t.Fatalf("read %s: %v", filename, err)
	}
	return data
}

func marshalSDKFixtureGolden(t *testing.T, mapped []SDKMappedEvent) string {
	t.Helper()
	data, err := json.MarshalIndent(mapped, "", "  ")
	if err != nil {
		t.Fatalf("marshal mapped events: %v", err)
	}
	return string(data) + "\n"
}

func normalizeSDKFixtureGoldenLineEndings(value string) string {
	return strings.ReplaceAll(value, "\r\n", "\n")
}

func testSDKFixtureScope() map[string]any {
	return map[string]any{
		"projectId": "proj_fixture",
		"threadId":  "thread_fixture",
		"runId":     "run_fixture",
	}
}
