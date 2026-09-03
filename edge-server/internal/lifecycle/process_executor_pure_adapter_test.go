package lifecycle

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/store"
)

type recordingContextAdapter struct {
	contexts chan adapters.RunProcessContext
}

type fixtureSDKStreamAdapter struct {
	id   string
	mode string
}

func TestProcessExecutorPassesRuntimeContextToAdapter(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)
	adapter := &recordingContextAdapter{contexts: make(chan adapters.RunProcessContext, 1)}

	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: "agenthub-adapter-sentinel",
	}, adapter, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}

	runCtx := RunProcessContext{
		Run:                    run,
		Prompt:                 "coordinate this",
		AgentID:                "recording-agent",
		Model:                  "sonnet",
		SessionID:              "session-1",
		ContinueLast:           true,
		ReasoningEffort:        "high",
		ThinkingMode:           "adaptive",
		PermissionMode:         "plan",
		WorkDir:                t.TempDir(),
		IncludePartial:         true,
		StructuredOutputSchema: `{"type":"object"}`,
		SystemPrompt:           "system",
		AppendSystemPrompt:     "append",
		SkillsPrompt:           "skills",
		AgentDefinitions: map[string]runnerctx.AgentDefinition{
			"reviewer": {Description: "Review", Prompt: "Review code", Tools: []string{"Read"}, Model: "sonnet"},
		},
		MCPConfig:       `{"servers":{"fs":{"command":"node"}}}`,
		AllowedTools:    []string{"Read"},
		HubTaskID:       "task-1",
		ConfigOverrides: map[string]string{"reasoning_summary": "auto"},
		Ephemeral:       true,
	}
	if err := executor.Start(run, runCtx); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	var got adapters.RunProcessContext
	select {
	case got = <-adapter.contexts:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for adapter BuildCommand context")
	}
	for {
		evt := nextEventWithin(t, ch, 20*time.Second)
		if evt.Type == "run.finished" {
			break
		}
		if evt.Type == "run.failed" {
			t.Fatalf("run failed: %#v", evt.Payload)
		}
	}

	if got.StructuredOutputSchema != runCtx.StructuredOutputSchema || got.SkillsPrompt != runCtx.SkillsPrompt {
		t.Fatalf("structured/skills context = %#v", got)
	}
	if got.AgentDefinitions["reviewer"].Prompt != "Review code" || got.MCPConfig != runCtx.MCPConfig {
		t.Fatalf("agent/mcp context = %#v", got)
	}
	if got.HubTaskID != "task-1" || got.ConfigOverrides["reasoning_summary"] != "auto" || !got.Ephemeral {
		t.Fatalf("runtime metadata context = %#v", got)
	}
}

func TestProcessExecutorMapsSDKFixtureJSONEventsAndReplays(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, replay := bus.Subscribe(0)
	if len(replay) != 0 {
		t.Fatalf("initial replay events = %d, want 0", len(replay))
	}

	adapter := &fixtureSDKStreamAdapter{id: "opencode"}
	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: "agenthub-fixture-sdk-json",
	}, adapter, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}

	if err := executor.Start(run, RunProcessContext{AgentID: "opencode"}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	var live []events.EventEnvelope
	for {
		evt := nextEventWithin(t, ch, 10*time.Second)
		live = append(live, evt)
		switch evt.Type {
		case "run.finished":
			goto finished
		case "run.failed":
			t.Fatalf("run failed: %#v", evt.Payload)
		}
	}

finished:
	for _, want := range []string{
		adapters.BusEventSessionInit,
		adapters.BusEventToolCall,
		adapters.BusEventPermissionRequested,
		adapters.BusEventResult,
		"run.finished",
	} {
		if !hasEventType(live, want) {
			t.Fatalf("live events missing %s: %v", want, eventTypeList(live))
		}
	}

	_, _, replay = bus.Subscribe(0)
	for _, want := range []string{
		adapters.BusEventPermissionRequested,
		adapters.BusEventResult,
		"run.finished",
	} {
		if !hasEventType(replay, want) {
			t.Fatalf("replay events missing %s: %v", want, eventTypeList(replay))
		}
	}
}

func TestProcessExecutorMapsFixtureProcessEventStreamContract(t *testing.T) {
	bus := events.NewBus(200)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)

	adapter := &fixtureSDKStreamAdapter{id: "fixture-runner", mode: "sdk-fixture-runner-contract-json"}
	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: "agenthub-fixture-process-json",
	}, adapter, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}

	if err := executor.Start(run, RunProcessContext{
		AgentID:        "fixture-runner",
		PermissionMode: "plan",
		WorkDir:        "D:\\private\\fixture-workspace",
	}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	live := collectEventsUntilRunDone(t, ch)
	for _, want := range []string{
		adapters.BusEventCLIInvocationPlan,
		adapters.BusEventSessionInit,
		adapters.BusEventTextBlock,
		adapters.BusEventTaskProgress,
		adapters.BusEventRouteDecision,
		adapters.BusEventPermissionRequested,
		adapters.BusEventFileChange,
		"artifact.created",
		adapters.BusEventResult,
		"run.finished",
	} {
		if !hasEventType(live, want) {
			t.Fatalf("live events missing %s: %v", want, eventTypeList(live))
		}
	}
	if hasEventType(live, "run.failed") {
		t.Fatalf("fixture process stream failed unexpectedly: %v", eventTypeList(live))
	}

	eventsJSON, err := json.Marshal(live)
	if err != nil {
		t.Fatalf("marshal live events: %v", err)
	}
	for _, leaked := range []string{
		"sk-fixture-runner-123456",
		"Bearer runner-secret-token",
		"D:\\private",
		"C:\\Users\\Example\\private",
		"/home/example/private",
	} {
		if bytes.Contains(eventsJSON, []byte(leaked)) {
			t.Fatalf("fixture process events leaked %q:\n%s", leaked, eventsJSON)
		}
	}

	permission := findEventType(live, adapters.BusEventPermissionRequested)
	if permission == nil {
		t.Fatal("missing permission request event")
	}
	permissionPayload, ok := permission.Payload.(map[string]any)
	if !ok {
		t.Fatalf("permission payload = %T, want map", permission.Payload)
	}
	if permissionPayload["requestId"] != "perm_runner_write" || permissionPayload["riskLevel"] != "high" {
		t.Fatalf("permission payload mismatch: %#v", permissionPayload)
	}
	input, ok := permissionPayload["input"].(map[string]any)
	if !ok || input["api_token"] != "[redacted]" {
		t.Fatalf("permission input was not redacted: %#v", permissionPayload["input"])
	}

	diffFiles := s.ListRunDiffFiles(run.ID)
	if len(diffFiles) != 1 || diffFiles[0].Path != "fixture.patch" || diffFiles[0].Diff == "" {
		t.Fatalf("ListRunDiffFiles = %#v, want redacted basename diff evidence", diffFiles)
	}
	artifacts := s.ListArtifacts(run.ID)
	if len(artifacts) != 1 || artifacts[0].ID != "artifact_runner_report" || artifacts[0].Path != "runner-report.json" {
		t.Fatalf("ListArtifacts = %#v, want redacted artifact evidence", artifacts)
	}
	items := s.ListThreadItems(run.ThreadID)
	if len(items) != 1 || !strings.Contains(items[0].Content, "runner transcript fixture") {
		t.Fatalf("ListThreadItems = %#v, want persisted fixture transcript", items)
	}
	if strings.Contains(items[0].Content, "sk-fixture-runner-123456") || strings.Contains(items[0].Content, "D:\\private") {
		t.Fatalf("transcript leaked secret/path: %q", items[0].Content)
	}
}

func TestProcessExecutorFixtureProcessMalformedAndErrorStreamDoesNotPanic(t *testing.T) {
	t.Run("malformed_stream_finishes_with_warning", func(t *testing.T) {
		bus := events.NewBus(100)
		s := store.New()
		run := newExecutorTestRun(t, s)
		_, ch, _ := bus.Subscribe(0)

		adapter := &fixtureSDKStreamAdapter{id: "fixture-runner", mode: "sdk-fixture-malformed-json"}
		executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
			Command: "agenthub-fixture-process-json",
		}, adapter, nil)
		if err != nil {
			t.Fatalf("NewProcessExecutor returned error: %v", err)
		}
		if err := executor.Start(run, RunProcessContext{AgentID: "fixture-runner"}); err != nil {
			t.Fatalf("Start returned error: %v", err)
		}

		live := collectEventsUntilRunDone(t, ch)
		if hasEventType(live, "run.failed") {
			t.Fatalf("malformed fixture stream failed instead of warning: %v", eventTypeList(live))
		}
		if !hasEventType(live, adapters.BusEventContextWarning) || !hasEventType(live, "run.finished") {
			t.Fatalf("malformed fixture stream events = %v, want warning and finished", eventTypeList(live))
		}
	})

	t.Run("permission_and_error_stream_finishes_without_runner_failure", func(t *testing.T) {
		bus := events.NewBus(100)
		s := store.New()
		run := newExecutorTestRun(t, s)
		_, ch, _ := bus.Subscribe(0)

		adapter := &fixtureSDKStreamAdapter{id: "fixture-runner", mode: "sdk-fixture-error-json"}
		executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
			Command: "agenthub-fixture-process-json",
		}, adapter, nil)
		if err != nil {
			t.Fatalf("NewProcessExecutor returned error: %v", err)
		}
		if err := executor.Start(run, RunProcessContext{AgentID: "fixture-runner"}); err != nil {
			t.Fatalf("Start returned error: %v", err)
		}

		live := collectEventsUntilRunDone(t, ch)
		if hasEventType(live, "run.failed") {
			t.Fatalf("error fixture stream failed runner unexpectedly: %v", eventTypeList(live))
		}
		if !hasEventType(live, adapters.BusEventPermissionRequested) || !hasEventType(live, adapters.BusEventResult) || !hasEventType(live, "run.finished") {
			t.Fatalf("error fixture stream events = %v, want permission, result, finished", eventTypeList(live))
		}
		result := findEventType(live, adapters.BusEventResult)
		payload, ok := result.Payload.(map[string]any)
		if !ok || payload["success"] != false || payload["terminalReason"] != "error" {
			t.Fatalf("error result payload = %#v, want terminal error result", result.Payload)
		}
		payloadJSON, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("marshal error payload: %v", err)
		}
		if bytes.Contains(payloadJSON, []byte("sk-error-fixture-123456")) {
			t.Fatalf("error payload leaked token: %s", payloadJSON)
		}
	})
}

func TestProcessExecutorPublishesCLIInvocationPlanAndReplaysFixtureStatus(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)

	adapter := &fixtureSDKStreamAdapter{id: "opencode"}
	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: "agenthub-fixture-sdk-json",
	}, adapter, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}

	if err := executor.Start(run, RunProcessContext{
		AgentID:        "opencode",
		Prompt:         "SECRET_PROMPT_SHOULD_NOT_APPEAR",
		PermissionMode: "plan",
		WorkDir:        "D:\\private\\fixture-workspace",
	}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	var live []events.EventEnvelope
	for {
		evt := nextEventWithin(t, ch, 10*time.Second)
		live = append(live, evt)
		switch evt.Type {
		case "run.finished":
			goto finished
		case "run.failed":
			t.Fatalf("run failed: %#v", evt.Payload)
		}
	}

finished:
	planEvent := findEventType(live, adapters.BusEventCLIInvocationPlan)
	if planEvent == nil {
		t.Fatalf("live events missing invocation plan: %v", eventTypeList(live))
	}
	planPayload, ok := planEvent.Payload.(map[string]any)
	if !ok {
		t.Fatalf("invocation plan payload = %T, want map", planEvent.Payload)
	}
	if planPayload["adapterId"] != "opencode" || planPayload["observed"] != false || planPayload["realTested"] != false {
		t.Fatalf("invocation plan payload = %#v, want opencode fixture plan without observed/realTested claim", planPayload)
	}
	planJSON, err := json.Marshal(planPayload)
	if err != nil {
		t.Fatalf("marshal invocation plan: %v", err)
	}
	if bytes.Contains(planJSON, []byte("SECRET_PROMPT_SHOULD_NOT_APPEAR")) || bytes.Contains(planJSON, []byte("D:\\private")) {
		t.Fatalf("invocation plan leaked prompt or absolute workdir: %s", planJSON)
	}

	_, _, replay := bus.Subscribe(0)
	for _, want := range []string{
		adapters.BusEventCLIInvocationPlan,
		adapters.BusEventPermissionRequested,
		adapters.BusEventResult,
		"run.finished",
	} {
		if !hasEventType(replay, want) {
			t.Fatalf("replay events missing %s: %v", want, eventTypeList(replay))
		}
	}
}

func TestProcessExecutorFailsUnknownExplicitAdapterWithoutDefaultFallback(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)

	defaultAdapter := &recordingContextAdapter{contexts: make(chan adapters.RunProcessContext, 1)}
	reg := adapters.NewRegistry()
	if err := reg.Register(defaultAdapter); err != nil {
		t.Fatalf("Register default adapter: %v", err)
	}
	reg.SetDefault("default", defaultAdapter.Metadata().ID)

	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: "agenthub-adapter-sentinel",
	}, defaultAdapter, reg)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}

	if err := executor.Start(run, RunProcessContext{AgentID: "unknown-runtime"}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	for {
		evt := nextEventWithin(t, ch, 10*time.Second)
		switch evt.Type {
		case "run.failed":
			payload, ok := evt.Payload.(map[string]any)
			if !ok {
				t.Fatalf("failed payload = %T, want map", evt.Payload)
			}
			if !strings.Contains(fmt.Sprint(payload["error"]), `agent adapter "unknown-runtime" not found`) {
				t.Fatalf("failed payload = %#v, want unknown adapter error", payload)
			}
			select {
			case got := <-defaultAdapter.contexts:
				t.Fatalf("default adapter was invoked for unknown runtime: %#v", got)
			default:
			}
			return
		case "run.finished":
			t.Fatal("unknown runtime fell back to default adapter and finished")
		}
	}
}

func collectEventsUntilRunDone(t *testing.T, ch <-chan events.EventEnvelope) []events.EventEnvelope {
	t.Helper()
	var live []events.EventEnvelope
	for {
		evt := nextEventWithin(t, ch, 10*time.Second)
		live = append(live, evt)
		switch evt.Type {
		case "run.finished", "run.failed", "run.cancelled":
			return live
		}
	}
}

func hasEventType(events []events.EventEnvelope, eventType string) bool {
	for _, evt := range events {
		if evt.Type == eventType {
			return true
		}
	}
	return false
}

func findEventType(events []events.EventEnvelope, eventType string) *events.EventEnvelope {
	for i := range events {
		if events[i].Type == eventType {
			return &events[i]
		}
	}
	return nil
}

func eventTypeList(events []events.EventEnvelope) []string {
	types := make([]string, 0, len(events))
	for _, evt := range events {
		types = append(types, evt.Type)
	}
	return types
}

// needsStdinTestAdapter is a stub adapter that reports NeedsStdin=true and
// uses the test helper binary. Its ParseStream drains stdout and then writes
// a control response via stdin to verify the pipe is still open.
type needsStdinTestAdapter struct {
	cmdPath string
	cmdArgs []string
}

// TestProcessExecutorKeepsStdinOpenForNeedsStdinAdapter verifies that when an
// adapter reports NeedsStdin()==true and no DecisionLoop is configured, the
// executor does NOT close stdin after cmd.Start(). The adapter's ParseStream
// receives a writable stdin pipe, enabling the permission gating protocol to
// function correctly (G03 fix).
func TestProcessExecutorKeepsStdinOpenForNeedsStdinAdapter(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)

	adapter := &needsStdinTestAdapter{
		cmdPath: os.Args[0],
		cmdArgs: []string{processExecutorHelperRunFlag, "--", "stdin-read"},
	}

	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: "agenthub-needs-stdin-test",
	}, adapter, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	// Wait for run.started so we know the close-or-keep section has run.
	for {
		evt := nextEventWithin(t, ch, 10*time.Second)
		switch evt.Type {
		case "run.started":
			goto started
		case "run.failed":
			t.Fatalf("run failed before started: %#v", evt.Payload)
		}
	}
started:

	// After run.started, stdin should still be open (not closed prematurely).
	executor.mu.Lock()
	stdin := executor.stdins[run.ID]
	executor.mu.Unlock()

	if stdin == nil {
		t.Fatal("stdin was nil after run.started — closed prematurely despite NeedsStdin()==true")
	}

	// Write a control response to stdin — the test helper is blocked reading stdin.
	_, err = stdin.Write([]byte("test-control-response\n"))
	if err != nil {
		t.Fatalf("stdin.Write failed: %v — pipe was closed prematurely", err)
	}

	// Wait for the run to finish (the helper should exit after reading stdin).
	for {
		evt := nextEventWithin(t, ch, 10*time.Second)
		switch evt.Type {
		case "run.finished":
			return
		case "run.failed":
			payload, _ := evt.Payload.(map[string]any)
			errInfo := payload["error"]
			t.Fatalf("run failed: %#v", errInfo)
		}
	}
}
