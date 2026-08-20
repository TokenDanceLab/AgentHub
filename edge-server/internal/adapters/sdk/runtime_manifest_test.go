package sdk

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/agenthub/edge-server/internal/store"
)

type captureManifestEmitter struct {
	events []capturedManifestEvent
}

type capturedManifestEvent struct {
	eventType string
	scope     map[string]any
	payload   any
}

func (e *captureManifestEmitter) Emit(eventType string, scope map[string]any, payload any) {
	e.events = append(e.events, capturedManifestEvent{eventType: eventType, scope: scope, payload: payload})
}

func TestRuntimeManifestAdapterFixtureFileContract(t *testing.T) {
	dir := t.TempDir()
	fixturePath := filepath.Join(dir, "fixture.json")
	fixture := SDKFixtureStream{
		Provider: "custom-runtime-fixture",
		Events: []SDKFixtureEvent{
			{ID: "evt_status", Type: "status", SessionID: "session_fixture", Status: "running"},
			{ID: "evt_result", Type: "terminal_result", Success: boolPtr(true), Summary: "fixture complete"},
		},
	}
	fixtureBytes, err := json.Marshal(fixture)
	if err != nil {
		t.Fatalf("marshal fixture: %v", err)
	}
	if err := os.WriteFile(fixturePath, fixtureBytes, 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}

	manifestPath := filepath.Join(dir, "runtime.json")
	manifest := runtimeManifestTestJSON(t, map[string]any{
		"schema":   RuntimeManifestV1Schema,
		"id":       "custom-fixture",
		"name":     "Custom Fixture",
		"kind":     "custom",
		"command":  "C:\\Tools\\AgentHub\\custom-fixture.exe",
		"args":     []string{"--fixture", fixturePath, "--api-key=sk-test-secret"},
		"envNames": []string{"OPENAI_API_KEY=sk-test-secret", "AGENTHUB_SAFE_FLAG"},
		"stdin":    true,
		"capabilities": map[string]any{
			"streaming":       true,
			"toolCalls":       true,
			"fileChanges":     true,
			"permissionHooks": true,
			"multiTurn":       true,
		},
		"models": []map[string]any{{
			"id":       "fixture-model",
			"label":    "Fixture Model",
			"provider": "OpenAI",
		}},
		"icons": map[string]any{
			"runtime":  "custom",
			"provider": "openai",
			"fallback": "custom",
		},
		"fixture": map[string]any{
			"type": "fixture-file",
			"path": fixturePath,
		},
	})
	if err := os.WriteFile(manifestPath, []byte(manifest), 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	loaded, err := LoadRuntimeManifestFile(manifestPath)
	if err != nil {
		t.Fatalf("LoadRuntimeManifestFile: %v", err)
	}
	adapter := NewRuntimeManifestAdapter(loaded)
	if adapter == nil {
		t.Fatal("NewRuntimeManifestAdapter returned nil")
	}
	if !adapter.Available() {
		t.Fatal("fixture-file manifest adapter should be available when fixture is readable")
	}
	if adapter.NeedsStdin() {
		t.Fatal("fixture-file manifest adapter should not require stdin")
	}
	if got := adapter.Metadata(); got.ID != "custom-fixture" || got.Name != "Custom Fixture" {
		t.Fatalf("metadata = %#v", got)
	}
	if got := adapter.Capabilities(); !got.Streaming || !got.ToolCalls || !got.FileChanges || !got.PermissionHooks || !got.MultiTurn {
		t.Fatalf("capabilities = %#v", got)
	}
	health := adapter.CapabilityHealthMetadata()
	if health["adapterId"] != "custom-fixture" || health["transport"] != "fixture-file" || health["healthState"] != "available" {
		t.Fatalf("capability health metadata = %#v", health)
	}
	if health["fixtureOnly"] != true || health["noSpendDefault"] != true {
		t.Fatalf("health metadata missing fixture-only/no-spend evidence: %#v", health)
	}
	capabilityMetadata, ok := health["capabilities"].(map[string]bool)
	if !ok || !capabilityMetadata["streaming"] || !capabilityMetadata["toolCalls"] || !capabilityMetadata["permissionHooks"] {
		t.Fatalf("capability metadata = %#v", health["capabilities"])
	}

	cmdPath, args, env, workDir := adapter.BuildCommand(RunProcessContext{Prompt: "secret prompt", WorkDir: "C:\\Users\\Ding\\private\\workspace"})
	currentExecutable, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable: %v", err)
	}
	if cmdPath != currentExecutable {
		t.Fatalf("fixture-file cmdPath = %q, want current executable %q", cmdPath, currentExecutable)
	}
	if cmdPath == "C:\\Tools\\AgentHub\\custom-fixture.exe" {
		t.Fatalf("fixture-file exposed manifest command to ProcessExecutor: %q", cmdPath)
	}
	if len(args) != 1 || args[0] != RuntimeManifestFixtureReplayFlag {
		t.Fatalf("fixture-file args = %#v, want safe replay flag", args)
	}
	if strings.Contains(strings.Join(args, " "), "sk-test-secret") || strings.Contains(strings.Join(args, " "), fixturePath) {
		t.Fatalf("fixture-file replay args leaked manifest data: %#v", args)
	}
	if len(env) != 0 {
		t.Fatalf("fixture-file env = %#v, want no manifest env exposure", env)
	}
	if workDir != "C:\\Users\\Ding\\private\\workspace" {
		t.Fatalf("workDir = %q", workDir)
	}

	emitter := &captureManifestEmitter{}
	run := store.Run{ID: "run_manifest", ProjectID: "project_manifest", ThreadID: "thread_manifest"}
	if err := adapter.ParseStream(context.Background(), bytes.NewReader(nil), nil, emitter, run); err != nil {
		t.Fatalf("ParseStream: %v", err)
	}
	if len(emitter.events) != 3 {
		t.Fatalf("events = %#v, want invocation plan plus two fixture events", emitter.events)
	}
	if emitter.events[0].eventType != BusEventCLIInvocationPlan {
		t.Fatalf("first event = %q, want %q", emitter.events[0].eventType, BusEventCLIInvocationPlan)
	}
	plan, ok := emitter.events[0].payload.(map[string]any)
	if !ok {
		t.Fatalf("plan payload = %#v", emitter.events[0].payload)
	}
	if plan["adapterId"] != "custom-fixture" || plan["commandName"] == "custom-fixture.exe" {
		t.Fatalf("fixture-file plan exposed manifest command: %#v", plan)
	}
	if strings.Contains(string(mustJSON(t, plan)), "sk-test-secret") || strings.Contains(string(mustJSON(t, plan)), "private") {
		t.Fatalf("plan leaked secret/path detail: %#v", plan)
	}
	if plan["realTested"] != false || plan["noSpendDefault"] != true || plan["redactionApplied"] != true {
		t.Fatalf("plan safety fields = %#v", plan)
	}
	if emitter.events[1].eventType != BusEventStatusChange || emitter.events[2].eventType != BusEventResult {
		t.Fatalf("fixture event types = %#v", emitter.events)
	}
}

func TestRuntimeManifestAdapterFixtureSubprocessBuildCommandUsesManifestCommand(t *testing.T) {
	manifest := RuntimeManifestV1{
		Schema:  RuntimeManifestV1Schema,
		ID:      "fixture-subprocess",
		Name:    "Fixture Subprocess",
		Kind:    "custom",
		Command: "fixture-subprocess-runner",
		Args:    []string{"--stream-fixture", "--api-key=sk-test-secret"},
		EnvNames: []string{
			"OPENAI_API_KEY=sk-test-secret",
			"AGENTHUB_SAFE_FLAG",
		},
		Stdin: true,
		Fixture: RuntimeManifestFixture{
			Type: "fixture-subprocess",
		},
	}
	adapter := NewRuntimeManifestAdapter(manifest)
	if !adapter.NeedsStdin() {
		t.Fatal("fixture-subprocess should preserve manifest stdin semantics")
	}

	cmdPath, args, env, workDir := adapter.BuildCommand(RunProcessContext{WorkDir: "fixture-workspace"})
	if cmdPath != "fixture-subprocess-runner" {
		t.Fatalf("cmdPath = %q", cmdPath)
	}
	if strings.Contains(strings.Join(args, " "), "sk-test-secret") {
		t.Fatalf("fixture-subprocess args were not redacted: %#v", args)
	}
	if strings.Join(env, ",") != "OPENAI_API_KEY,AGENTHUB_SAFE_FLAG" {
		t.Fatalf("env = %#v, want env names only", env)
	}
	if workDir != "fixture-workspace" {
		t.Fatalf("workDir = %q", workDir)
	}
}

func TestRuntimeManifestRejectsRealSDKTransports(t *testing.T) {
	for _, transport := range []string{
		"openai-agents-sdk",
		"claude-sdk",
		"http-sse",
		"stdio",
		"websocket",
		"fixture-file;rm",
	} {
		t.Run(transport, func(t *testing.T) {
			dir := t.TempDir()
			manifestPath := filepath.Join(dir, "runtime.json")
			manifest := runtimeManifestTestJSON(t, map[string]any{
				"schema":  RuntimeManifestV1Schema,
				"id":      "real-sdk",
				"name":    "Real SDK",
				"kind":    "sdk",
				"command": "node",
				"fixture": map[string]any{
					"type": transport,
				},
			})
			if err := os.WriteFile(manifestPath, []byte(manifest), 0o600); err != nil {
				t.Fatalf("write manifest: %v", err)
			}

			if _, err := LoadRuntimeManifestFile(manifestPath); err == nil || !strings.Contains(err.Error(), "unsafe or live runtime transport") {
				t.Fatalf("LoadRuntimeManifestFile error = %v, want unsafe transport rejection", err)
			}
		})
	}
}

func TestRuntimeManifestRejectsUnknownFixtureTransport(t *testing.T) {
	dir := t.TempDir()
	manifestPath := filepath.Join(dir, "runtime.json")
	manifest := runtimeManifestTestJSON(t, map[string]any{
		"schema":  RuntimeManifestV1Schema,
		"id":      "unknown-transport",
		"name":    "Unknown Transport",
		"kind":    "custom",
		"command": "fixture-runner",
		"fixture": map[string]any{
			"type": "unknown-fixture-transport",
		},
	})
	if err := os.WriteFile(manifestPath, []byte(manifest), 0o600); err != nil {
		t.Fatalf("write manifest: %v", err)
	}

	if _, err := LoadRuntimeManifestFile(manifestPath); err == nil || !strings.Contains(err.Error(), "fixture-file or fixture-subprocess") {
		t.Fatalf("LoadRuntimeManifestFile error = %v, want unknown transport rejection", err)
	}
}

func TestRuntimeManifestAdapterUnavailableWhenFixtureFileMissing(t *testing.T) {
	manifest := RuntimeManifestV1{
		Schema:  RuntimeManifestV1Schema,
		ID:      "missing-fixture",
		Name:    "Missing Fixture",
		Kind:    "custom",
		Command: "fixture-runner",
		Fixture: RuntimeManifestFixture{
			Type: "fixture-file",
			Path: filepath.Join(t.TempDir(), "missing.json"),
		},
	}
	adapter := NewRuntimeManifestAdapter(manifest)
	if adapter.Available() {
		t.Fatal("missing fixture-file adapter should not be available")
	}
	if health := adapter.CapabilityHealthMetadata(); health["healthState"] != "unavailable" || health["fixtureOnly"] != true || health["noSpendDefault"] != true {
		t.Fatalf("missing fixture health metadata = %#v", health)
	}
}

func runtimeManifestTestJSON(t *testing.T, value map[string]any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	return string(data)
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal value: %v", err)
	}
	return data
}
