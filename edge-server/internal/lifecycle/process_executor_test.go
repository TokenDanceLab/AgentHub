package lifecycle

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/agenthub/edge-server/internal/adapters/sdk"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/agenthub/edge-server/internal/adapters"
	"github.com/agenthub/edge-server/internal/agents"
	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/runnerctx"
	"github.com/agenthub/edge-server/internal/store"
	"github.com/agenthub/edge-server/internal/testkit"
)

const processExecutorHelperRunFlag = "-test.run=^TestProcessExecutorHelper$"

const (
	// processTrackedWaitTimeout is the Eventually budget for waiting until the
	// executor tracks a started process; Cancel needs the tracked handle to
	// arm the grace path (#2038).
	processTrackedWaitTimeout = 5 * time.Second

	// childCancelSettleWaitTimeout is the Eventually budget for a cascaded
	// child run's store status to settle on cancelled (#2038).
	childCancelSettleWaitTimeout = 3 * time.Second
)

func TestProcessExecutorRequiresCommand(t *testing.T) {
	_, err := NewProcessExecutor(events.NewBus(10), store.New(), ProcessExecutorConfig{}, nil, nil)
	if !errors.Is(err, ErrProcessCommandRequired) {
		t.Fatalf("NewProcessExecutor error = %v, want ErrProcessCommandRequired", err)
	}
}

func TestProcessExecutorRequiresDependencies(t *testing.T) {
	_, err := NewProcessExecutor(nil, store.New(), ProcessExecutorConfig{Command: os.Args[0]}, nil, nil)
	if !errors.Is(err, ErrProcessBusRequired) {
		t.Fatalf("NewProcessExecutor nil bus error = %v, want ErrProcessBusRequired", err)
	}
	_, err = NewProcessExecutor(events.NewBus(10), nil, ProcessExecutorConfig{Command: os.Args[0]}, nil, nil)
	if !errors.Is(err, ErrProcessStoreRequired) {
		t.Fatalf("NewProcessExecutor nil store error = %v, want ErrProcessStoreRequired", err)
	}
}

func TestProcessExecutorRejectsInvalidWorkDir(t *testing.T) {
	tempDir := t.TempDir()
	filePath := filepath.Join(tempDir, "not-a-directory")
	if err := os.WriteFile(filePath, []byte("test"), 0o644); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}

	tests := []struct {
		name    string
		workDir string
		want    string
	}{
		{
			name:    "missing",
			workDir: filepath.Join(tempDir, "missing"),
			want:    "is not accessible",
		},
		{
			name:    "file",
			workDir: filePath,
			want:    "is not a directory",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := NewProcessExecutor(events.NewBus(10), store.New(), ProcessExecutorConfig{
				Command: os.Args[0],
				WorkDir: tt.workDir,
			}, nil, nil)
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("NewProcessExecutor error = %v, want containing %q", err, tt.want)
			}
		})
	}
}

func TestProcessExecutorRejectsMissingRun(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := store.Run{
		ID:        "run_missing",
		ProjectID: "proj_missing",
		ThreadID:  "thread_missing",
		Status:    "queued",
	}
	_, ch, _ := bus.Subscribe(0)
	executor := newTestProcessExecutor(t, bus, s, "success")

	if err := executor.Start(run, RunProcessContext{}); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("Start missing run error = %v, want store.ErrNotFound", err)
	}
	select {
	case evt := <-ch:
		t.Fatalf("unexpected event after missing run start: %s", evt.Type)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestProcessExecutorPublishesOutputAndFinished(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)
	executor := newTestProcessExecutor(t, bus, s, "success")

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	seenOutput := map[string]bool{}
	var stdoutText string
	for {
		evt := nextEvent(t, ch)
		if evt.Scope["runId"] != run.ID {
			t.Fatalf("event scope runId = %#v, want %q", evt.Scope["runId"], run.ID)
		}
		switch evt.Type {
		case "run.started":
		case "run.output.batch":
			payload, ok := evt.Payload.(map[string]any)
			if !ok {
				t.Fatalf("output payload = %T, want map", evt.Payload)
			}
			stream, _ := payload["stream"].(string)
			seenOutput[stream] = true
			if stream == "stdout" {
				chunks, ok := payload["chunks"].([]map[string]any)
				if !ok || len(chunks) == 0 {
					t.Fatalf("output chunks = %#v, want non-empty []map[string]any", payload["chunks"])
				}
				stdoutText += outputChunksText(chunks)
			}
		case "run.finished":
			if !seenOutput["stdout"] || !seenOutput["stderr"] {
				t.Fatalf("seen output streams = %#v, want stdout and stderr", seenOutput)
			}
			for _, want := range []string{
				"run=" + run.ID,
				"project=" + run.ProjectID,
				"thread=" + run.ThreadID,
			} {
				if !strings.Contains(stdoutText, want) {
					t.Fatalf("stdout text = %q, want %q", stdoutText, want)
				}
			}
			stored, ok := s.GetRun(run.ID)
			if !ok {
				t.Fatalf("run %q was not stored", run.ID)
			}
			if stored.Status != "finished" || stored.StartedAt == "" || stored.FinishedAt == "" {
				t.Fatalf("stored run = %#v, want finished with timestamps", stored)
			}
			return
		default:
			t.Fatalf("unexpected event type %q", evt.Type)
		}
	}
}

type recordingLifecycleEmitter struct {
	events []string
}

func (e *recordingLifecycleEmitter) Emit(eventType string, _ map[string]any, _ any) {
	e.events = append(e.events, eventType)
}

type recordingContextAdapter struct {
	contexts chan adapters.RunProcessContext
}

func (a *recordingContextAdapter) Metadata() adapters.AdapterMetadata {
	return adapters.AdapterMetadata{ID: "recording-agent", Name: "Recording Agent"}
}

func (a *recordingContextAdapter) Capabilities() adapters.AgentCapabilities {
	return adapters.AgentCapabilities{Streaming: true, MultiTurn: true}
}

func (a *recordingContextAdapter) BuildCommand(ctx adapters.RunProcessContext) (string, []string, []string, string) {
	a.contexts <- ctx
	return os.Args[0], []string{processExecutorHelperRunFlag, "--", "success"}, append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"), ""
}

func (a *recordingContextAdapter) ParseStream(ctx context.Context, stdout io.Reader, _ io.Writer, emitter adapters.EventEmitter, run store.Run) error {
	_, err := io.Copy(io.Discard, stdout)
	if err != nil {
		return err
	}
	emitter.Emit(adapters.BusEventResult, map[string]any{
		"projectId": run.ProjectID,
		"threadId":  run.ThreadID,
		"runId":     run.ID,
	}, map[string]any{"success": true})
	return ctx.Err()
}

func (a *recordingContextAdapter) NeedsStdin() bool { return false }

func (a *recordingContextAdapter) Available() bool { return true }

type fixtureSDKStreamAdapter struct {
	id   string
	mode string
}

func (a *fixtureSDKStreamAdapter) Metadata() adapters.AdapterMetadata {
	return adapters.AdapterMetadata{ID: a.id, Name: "Fixture SDK Stream"}
}

func (a *fixtureSDKStreamAdapter) Capabilities() adapters.AgentCapabilities {
	return adapters.AgentCapabilities{
		Streaming:       true,
		ToolCalls:       true,
		PermissionHooks: true,
		MultiTurn:       true,
	}
}

func (a *fixtureSDKStreamAdapter) BuildCommand(ctx adapters.RunProcessContext) (string, []string, []string, string) {
	mode := a.mode
	if mode == "" {
		mode = "sdk-fixture-json"
	}
	return os.Args[0], []string{processExecutorHelperRunFlag, "--", mode}, append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"), ""
}

func (a *fixtureSDKStreamAdapter) ParseStream(ctx context.Context, stdout io.Reader, _ io.Writer, emitter adapters.EventEmitter, run store.Run) error {
	data, err := io.ReadAll(stdout)
	if err != nil {
		return err
	}
	stream, err := sdk.DecodeSDKFixtureStream(data)
	if err != nil {
		return adapters.NewRecoverableParseError(err)
	}
	scope := map[string]any{
		"projectId": run.ProjectID,
		"threadId":  run.ThreadID,
		"runId":     run.ID,
	}
	for _, mapped := range sdk.MapSDKFixtureStream(stream, scope) {
		emitter.Emit(mapped.Type, mapped.Scope, mapped.Payload)
	}
	return nil
}

func (a *fixtureSDKStreamAdapter) NeedsStdin() bool { return false }

func (a *fixtureSDKStreamAdapter) Available() bool { return true }

func TestThreadTranscriptEmitterPersistsAssistantMessage(t *testing.T) {
	s := store.New()
	run := newExecutorTestRun(t, s)
	inner := &recordingLifecycleEmitter{}
	emitter := newThreadTranscriptEmitter(s, run, inner)
	if emitter == nil {
		t.Fatal("newThreadTranscriptEmitter returned nil")
	}

	emitter.Emit(adapters.BusEventTextDelta, nil, map[string]any{"content": "OK"})
	emitter.Emit(adapters.BusEventTextBlock, nil, map[string]any{"content": "-OUTPUT"})
	emitter.Flush()
	emitter.Flush()

	items := s.ListThreadItems(run.ThreadID)
	var assistantItems []store.Item
	for _, item := range items {
		if item.Type == "agent_message" {
			assistantItems = append(assistantItems, item)
		}
	}
	if len(assistantItems) != 1 {
		t.Fatalf("assistant items = %#v, want exactly one persisted assistant message", assistantItems)
	}
	if assistantItems[0].Role != "agent" || assistantItems[0].RunID != run.ID || assistantItems[0].Content != "OK-OUTPUT" {
		t.Fatalf("assistant item = %#v, want persisted agent transcript", assistantItems[0])
	}
	if len(inner.events) != 2 {
		t.Fatalf("inner events = %#v, want passthrough events", inner.events)
	}
}

func TestRuntimeEvidenceEmitterPersistsArtifactDiffPreviewEvidence(t *testing.T) {
	s := store.New()
	run := newExecutorTestRun(t, s)
	inner := &recordingLifecycleEmitter{}
	emitter := newRuntimeEvidenceEmitter(s, run, inner)
	if emitter == nil {
		t.Fatal("newRuntimeEvidenceEmitter returned nil")
	}

	emitter.Emit(adapters.BusEventFileChange, nil, map[string]any{
		"path":   "src/app.ts",
		"kind":   "modified",
		"status": "completed",
		"diff":   "@@ -1 +1 @@\n-old\n+new",
	})
	emitter.Emit("artifact.created", nil, map[string]any{
		"id":        "artifact_1",
		"kind":      "file",
		"path":      "dist/report.md",
		"sizeBytes": int64(128),
	})
	emitter.Emit("preview.ready", nil, map[string]any{
		"id":     "preview_1",
		"url":    "http://127.0.0.1:4173",
		"status": "ready",
	})
	emitter.Emit("preview.stopped", nil, map[string]any{
		"id": "preview_1",
	})

	diffFiles := s.ListRunDiffFiles(run.ID)
	if len(diffFiles) != 1 || diffFiles[0].Path != "src/app.ts" || diffFiles[0].Diff == "" || diffFiles[0].Status != "modified" {
		t.Fatalf("ListRunDiffFiles = %#v, want persisted runtime diff evidence", diffFiles)
	}
	artifacts := s.ListArtifacts(run.ID)
	if len(artifacts) != 1 || artifacts[0].ID != "artifact_1" || artifacts[0].ThreadID != run.ThreadID || artifacts[0].SizeBytes != 128 {
		t.Fatalf("ListArtifacts = %#v, want persisted runtime artifact evidence", artifacts)
	}
	if artifacts[0].ContentSource == nil || artifacts[0].ContentSource.Kind != store.ArtifactContentSourceWorkspaceRelative || artifacts[0].ContentSource.Path != "dist/report.md" || !artifacts[0].ContentSource.Readable {
		t.Fatalf("artifact content source = %#v, want safe workspace-relative source", artifacts[0].ContentSource)
	}
	previews := s.ListPreviews(run.ID)
	if len(previews) != 1 || previews[0].ID != "preview_1" || previews[0].URL != "" || previews[0].Status != "stopped" {
		t.Fatalf("ListPreviews = %#v, want persisted runtime preview evidence", previews)
	}
	if len(inner.events) != 4 {
		t.Fatalf("inner events = %#v, want all runtime evidence events passed through", inner.events)
	}
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
		"C:\\Users\\Ding\\private",
		"/home/ding/private",
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

func TestProcessExecutorRunsCommandWithInjectedContext(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)

	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{processExecutorHelperRunFlag, "--", "success"},
		Env:     append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"),
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	var sawStarted bool
	var sawStdoutBatch bool
	var stdoutText string
	for {
		evt := nextEventWithin(t, ch, 20*time.Second)
		if evt.Scope["runId"] != run.ID {
			t.Fatalf("event scope runId = %#v, want %q", evt.Scope["runId"], run.ID)
		}
		switch evt.Type {
		case "run.started":
			sawStarted = true
		case "run.output.batch":
			payload, ok := evt.Payload.(map[string]any)
			if !ok {
				t.Fatalf("output payload = %T, want map", evt.Payload)
			}
			if payload["runId"] != run.ID {
				t.Fatalf("output payload runId = %#v, want %q", payload["runId"], run.ID)
			}
			if payload["stream"] != "stdout" {
				continue
			}
			chunks, ok := payload["chunks"].([]map[string]any)
			if !ok || len(chunks) == 0 {
				t.Fatalf("output chunks = %#v, want non-empty []map[string]any", payload["chunks"])
			}
			sawStdoutBatch = true
			stdoutText += outputChunksText(chunks)
		case "run.finished":
			if !sawStarted {
				t.Fatal("run.finished arrived before run.started")
			}
			if !sawStdoutBatch {
				t.Fatal("run.finished arrived without stdout run.output.batch")
			}
			for _, want := range []string{
				"run=" + run.ID,
				"project=" + run.ProjectID,
				"thread=" + run.ThreadID,
			} {
				if !strings.Contains(stdoutText, want) {
					t.Fatalf("stdout text = %q, want %q", stdoutText, want)
				}
			}
			return
		case "run.failed":
			t.Fatalf("repository mock runner failed: %#v", evt.Payload)
		case "run.cancelled":
			t.Fatalf("repository mock runner was cancelled: %#v", evt.Payload)
		default:
			t.Fatalf("unexpected event type %q", evt.Type)
		}
	}
}

func TestSummarizeProcessArgsForLogRedactsValueLikeArgs(t *testing.T) {
	tests := []struct {
		name                    string
		args                    []string
		secrets                 []string
		wantFlags               []string
		wantConfigKeys          []string
		wantUnknownFlagCount    int
		wantRedactedConfigCount int
	}{
		{
			name:                 "codex prompt starting with dash",
			args:                 []string{"exec", "--json", "-SECRET_PROMPT_SHOULD_NOT_APPEAR"},
			secrets:              []string{"SECRET_PROMPT_SHOULD_NOT_APPEAR"},
			wantFlags:            []string{"--json"},
			wantUnknownFlagCount: 1,
		},
		{
			name:      "separator treats later dash tokens as positional",
			args:      []string{"-test.run=^TestProcessExecutorHelper$", "--", "-SECRET_AFTER_SEPARATOR_SHOULD_NOT_APPEAR"},
			secrets:   []string{"SECRET_AFTER_SEPARATOR_SHOULD_NOT_APPEAR"},
			wantFlags: []string{"-test.run"},
		},
		{
			name: "opencode value flags and dash prompt",
			args: []string{
				"run",
				"--thinking",
				"--title", "-SECRET_TITLE_SHOULD_NOT_APPEAR",
				"--session", "-SECRET_SESSION_SHOULD_NOT_APPEAR",
				"-m", "provider/model",
				"-SECRET_PROMPT_SHOULD_NOT_APPEAR",
			},
			secrets:              []string{"SECRET_TITLE_SHOULD_NOT_APPEAR", "SECRET_SESSION_SHOULD_NOT_APPEAR", "SECRET_PROMPT_SHOULD_NOT_APPEAR"},
			wantFlags:            []string{"--thinking", "--title", "--session", "-m"},
			wantUnknownFlagCount: 1,
		},
		{
			name: "codex flags with paths and thinking value",
			args: []string{
				"exec",
				"--skip-git-repo-check",
				"--cd", "C:\\Users\\Example\\secret-workspace",
				"--mcp-config=SECRET_INLINE_MCP_SHOULD_NOT_APPEAR",
				"--thinking", "SECRET_THINKING_SHOULD_NOT_APPEAR",
				"--", "SECRET_PROMPT_SHOULD_NOT_APPEAR",
			},
			secrets:   []string{"SECRET_INLINE_MCP_SHOULD_NOT_APPEAR", "SECRET_THINKING_SHOULD_NOT_APPEAR", "SECRET_PROMPT_SHOULD_NOT_APPEAR"},
			wantFlags: []string{"--skip-git-repo-check", "--cd", "--mcp-config", "--thinking"},
		},
		{
			name: "codex config key only",
			args: []string{
				"exec",
				"-c", "api_key=SECRET_CONFIG_SHOULD_NOT_APPEAR",
				"-c", "SECRET_CONFIG_WITHOUT_EQUALS_SHOULD_NOT_APPEAR",
				"-c", "bad key=SECRET_BAD_KEY_SHOULD_NOT_APPEAR",
			},
			secrets:                 []string{"SECRET_CONFIG_SHOULD_NOT_APPEAR", "SECRET_CONFIG_WITHOUT_EQUALS_SHOULD_NOT_APPEAR", "SECRET_BAD_KEY_SHOULD_NOT_APPEAR"},
			wantFlags:               []string{"-c"},
			wantConfigKeys:          []string{"api_key"},
			wantRedactedConfigCount: 2,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			summary := summarizeProcessArgsForLog(tt.args)
			rendered := fmt.Sprintf("%#v", summary)
			for _, secret := range tt.secrets {
				if strings.Contains(rendered, secret) {
					t.Fatalf("summary leaked %q: %#v", secret, summary)
				}
			}
			for _, flag := range tt.wantFlags {
				if !stringSliceContains(summary.ArgFlags, flag) {
					t.Fatalf("arg flags = %#v, want %q", summary.ArgFlags, flag)
				}
			}
			for _, key := range tt.wantConfigKeys {
				if !stringSliceContains(summary.ConfigKeys, key) {
					t.Fatalf("config keys = %#v, want %q", summary.ConfigKeys, key)
				}
			}
			if summary.UnknownFlagCount != tt.wantUnknownFlagCount {
				t.Fatalf("unknown flag count = %d, want %d (summary %#v)", summary.UnknownFlagCount, tt.wantUnknownFlagCount, summary)
			}
			if summary.RedactedConfigKeyCount != tt.wantRedactedConfigCount {
				t.Fatalf("redacted config key count = %d, want %d (summary %#v)", summary.RedactedConfigKeyCount, tt.wantRedactedConfigCount, summary)
			}
		})
	}
}

func TestProcessExecutorStartLogRedactsRuntimeArgs(t *testing.T) {
	var logs bytes.Buffer
	previousLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() {
		slog.SetDefault(previousLogger)
	})

	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)

	secretPrompt := "-SECRET_PROMPT_SHOULD_NOT_APPEAR"
	secretMCP := `{"servers":{"private":{"command":"node","token":"SECRET_MCP_SHOULD_NOT_APPEAR"}}}`
	secretConfig := "api_key=SECRET_CONFIG_SHOULD_NOT_APPEAR"
	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args: []string{
			processExecutorHelperRunFlag,
			"--",
			"-p", secretPrompt,
			"--mcp-config", secretMCP,
			"-c", secretConfig,
			"success",
		},
		Env: append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"),
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}
	_ = collectStdoutUntilFinished(t, ch)

	logText := logs.String()
	for _, secret := range []string{secretPrompt, secretMCP, secretConfig} {
		if strings.Contains(logText, secret) {
			t.Fatalf("subprocess start log leaked runtime arg %q in %s", secret, logText)
		}
	}
	if strings.Contains(logText, os.Args[0]) {
		t.Fatalf("subprocess start log leaked command path %q in %s", os.Args[0], logText)
	}
	if strings.Contains(logText, `"args"`) {
		t.Fatalf("subprocess start log must not include full args field: %s", logText)
	}
	record := parseSlogRecordByMessage(t, logText, "executor.subprocess.starting")
	if _, ok := record["args"]; ok {
		t.Fatalf("subprocess start log must not include full args field: %#v", record)
	}
	if _, ok := record["command"]; ok {
		t.Fatalf("subprocess start log must not include full command path field: %#v", record)
	}
	if got := record["argsRedacted"]; got != true {
		t.Fatalf("argsRedacted = %#v, want true in %#v", got, record)
	}
	if got := record["commandName"]; got != filepath.Base(os.Args[0]) {
		t.Fatalf("commandName = %#v, want %q in %#v", got, filepath.Base(os.Args[0]), record)
	}
	if got := record["commandRedacted"]; got != true {
		t.Fatalf("commandRedacted = %#v, want true in %#v", got, record)
	}
	for _, key := range []string{"argCount", "argFlags", "configKeys", "positionalArgCount", "unknownFlagCount", "redactedConfigKeyCount"} {
		if _, ok := record[key]; !ok {
			t.Fatalf("subprocess start log missing %q in %#v", key, record)
		}
	}
}

func parseSlogRecordByMessage(t *testing.T, text, message string) map[string]any {
	t.Helper()

	for _, line := range strings.Split(strings.TrimSpace(text), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var record map[string]any
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatalf("parse slog JSON line %q: %v", line, err)
		}
		if record["msg"] == message {
			return record
		}
	}
	t.Fatalf("log message %q not found in %s", message, text)
	return nil
}

func stringSliceContains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func TestProcessExecutorRunsCommandInConfiguredWorkDir(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	workDir := filepath.Join(t.TempDir(), "workspace")
	if err := os.Mkdir(workDir, 0o755); err != nil {
		t.Fatalf("Mkdir returned error: %v", err)
	}
	_, ch, _ := bus.Subscribe(0)
	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{processExecutorHelperRunFlag, "--", "pwd"},
		Env:     append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"),
		WorkDir: workDir,
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	var stdoutText string
	for {
		evt := nextEvent(t, ch)
		switch evt.Type {
		case "run.checkpoint":
			// Pre-run checkpoint evidence precedes run.started (#1968).
		case "run.started":
		case "run.output.batch":
			payload, ok := evt.Payload.(map[string]any)
			if !ok {
				t.Fatalf("output payload = %T, want map", evt.Payload)
			}
			if payload["stream"] != "stdout" {
				continue
			}
			chunks, ok := payload["chunks"].([]map[string]any)
			if !ok || len(chunks) == 0 {
				t.Fatalf("output chunks = %#v, want non-empty []map[string]any", payload["chunks"])
			}
			stdoutText += outputChunksText(chunks)
		case "run.finished":
			want := "cwd=" + filepath.Clean(workDir)
			if !strings.Contains(stdoutText, want) {
				t.Fatalf("stdout text = %q, want %q", stdoutText, want)
			}
			return
		default:
			t.Fatalf("unexpected event type %q", evt.Type)
		}
	}
}

func TestProcessExecutorExpandsRunPlaceholdersInArgs(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)
	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args: []string{
			processExecutorHelperRunFlag,
			"--",
			"--run={{run.id}}",
			"--project={{ run.projectId }}",
			"--thread={{run.threadId}}",
			"args",
		},
		Env: append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"),
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	stdoutText := collectStdoutUntilFinished(t, ch)
	for _, want := range []string{
		"--run=" + run.ID,
		"--project=" + run.ProjectID,
		"--thread=" + run.ThreadID,
	} {
		if !strings.Contains(stdoutText, want) {
			t.Fatalf("stdout text = %q, want %q", stdoutText, want)
		}
	}
}

func TestProcessExecutorExpandsRunPlaceholdersInEnv(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)
	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{processExecutorHelperRunFlag, "--", "env"},
		Env: append(os.Environ(),
			"AGENTHUB_PROCESS_EXECUTOR_HELPER=1",
			"PROFILE_RUN={{run.id}}",
			"PROFILE_PROJECT={{run.projectId}}",
			"PROFILE_THREAD={{run.threadId}}",
		),
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	stdoutText := collectStdoutUntilFinished(t, ch)
	for _, want := range []string{
		"profileRun=" + run.ID,
		"profileProject=" + run.ProjectID,
		"profileThread=" + run.ThreadID,
	} {
		if !strings.Contains(stdoutText, want) {
			t.Fatalf("stdout text = %q, want %q", stdoutText, want)
		}
	}
}

func TestProcessExecutorExpandsRunPlaceholdersInExtraEnv(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)
	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{processExecutorHelperRunFlag, "--", "env"},
		Env:     nil,
		ExtraEnv: []string{
			"AGENTHUB_PROCESS_EXECUTOR_HELPER=1",
			"PROFILE_RUN={{run.id}}",
			"PROFILE_PROJECT={{run.projectId}}",
			"PROFILE_THREAD={{run.threadId}}",
		},
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	stdoutText := collectStdoutUntilFinished(t, ch)
	for _, want := range []string{
		"profileRun=" + run.ID,
		"profileProject=" + run.ProjectID,
		"profileThread=" + run.ThreadID,
	} {
		if !strings.Contains(stdoutText, want) {
			t.Fatalf("stdout text = %q, want %q", stdoutText, want)
		}
	}
}

func TestProcessExecutorExtraEnvDoesNotTemplateParentEnvironment(t *testing.T) {
	t.Setenv("AGENTHUB_PARENT_ENV_WITH_BRACES", "{{not.a.template")

	_, err := NewProcessExecutor(events.NewBus(10), store.New(), ProcessExecutorConfig{
		Command:  os.Args[0],
		Args:     []string{processExecutorHelperRunFlag, "--", "env"},
		Env:      nil,
		ExtraEnv: []string{"PROFILE_RUN={{run.id}}"},
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}
}

func TestProcessExecutorNilEnvSanitizesParentEnvironment(t *testing.T) {
	// Set a non-whitelisted var in the parent — it must NOT leak to the child.
	t.Setenv("RANDOM_TEST_SECRET_TOKEN", "must-not-leak")
	t.Setenv("AGENTHUB_EDGE_AUTH_TOKEN", "edge-token")
	t.Setenv("AGENTHUB_JWT_SECRET", "jwt-secret")
	t.Setenv("AGENTHUB_DB_PASSWORD", "db-password")
	// PATH is whitelisted — it SHOULD be visible to the child.
	t.Setenv("PATH", "/usr/bin:/bin")
	parentPath := os.Getenv("PATH")

	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)
	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{processExecutorHelperRunFlag, "--", "sanitized-env"},
		Env:     nil,
		ExtraEnv: []string{
			"AGENTHUB_TEST_EXTRA_ENV=1",
			"AGENTHUB_PARENT_PATH=" + parentPath,
		},
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	stdoutText := collectStdoutUntilFinished(t, ch)
	// The random secret must NOT appear in the child environment.
	if strings.Contains(stdoutText, "randomSecret=must-not-leak") {
		t.Fatalf("stdout text = %q, must NOT contain leaked env value", stdoutText)
	}
	for _, leaked := range []string{
		"edgeAuthToken=edge-token",
		"jwtSecret=jwt-secret",
		"dbPassword=db-password",
	} {
		if strings.Contains(stdoutText, leaked) {
			t.Fatalf("stdout text = %q, must NOT contain leaked AGENTHUB_* secret", stdoutText)
		}
	}
	if !strings.Contains(stdoutText, "testExtraEnv=1") {
		t.Fatalf("stdout text = %q, want explicit ExtraEnv var to pass through", stdoutText)
	}
	// PATH must be present in the child.
	if !strings.Contains(stdoutText, "sanitizedPath=") {
		t.Fatalf("stdout text = %q, want PATH to be inherited (whitelisted)", stdoutText)
	}
}

func TestProcessExecutorRejectsUnknownPlaceholder(t *testing.T) {
	_, err := NewProcessExecutor(events.NewBus(10), store.New(), ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{"--bad={{run.workspaceId}}"},
	}, nil, nil)
	if err == nil || !strings.Contains(err.Error(), "unknown placeholder") {
		t.Fatalf("NewProcessExecutor error = %v, want unknown placeholder", err)
	}
}

func TestProcessExecutorRejectsInvalidEnvTemplate(t *testing.T) {
	tests := []struct {
		name string
		env  []string
		want string
	}{
		{name: "missing equals", env: []string{"PROFILE_RUN"}, want: "KEY=VALUE"},
		{name: "empty key", env: []string{"=value"}, want: "key is required"},
		{name: "whitespace in key", env: []string{"PROFILE RUN=value"}, want: "invalid whitespace"},
		{name: "unknown placeholder", env: []string{"PROFILE_RUN={{run.workspaceId}}"}, want: "unknown placeholder"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := NewProcessExecutor(events.NewBus(10), store.New(), ProcessExecutorConfig{
				Command: os.Args[0],
				Env:     tt.env,
			}, nil, nil)
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("NewProcessExecutor error = %v, want containing %q", err, tt.want)
			}
		})
	}
}

func TestProcessExecutorRedactsEnvTemplateValueInErrors(t *testing.T) {
	secretValue := "token-secret-should-not-appear"
	_, err := NewProcessExecutor(events.NewBus(10), store.New(), ProcessExecutorConfig{
		Command: os.Args[0],
		Env:     []string{"PROFILE_TOKEN=" + secretValue + "{{run.workspaceId}}"},
	}, nil, nil)
	if err == nil {
		t.Fatal("NewProcessExecutor returned nil error for invalid env placeholder")
	}
	if strings.Contains(err.Error(), secretValue) {
		t.Fatalf("NewProcessExecutor error = %q, must not include env value", err.Error())
	}
	if !strings.Contains(err.Error(), "PROFILE_TOKEN") || !strings.Contains(err.Error(), "unknown placeholder") {
		t.Fatalf("NewProcessExecutor error = %q, want key and placeholder error", err.Error())
	}
}

func TestProcessExecutorPublishesFailedForNonZeroExit(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)
	executor := newTestProcessExecutor(t, bus, s, "fail")

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	var sawStarted bool
	for {
		evt := nextEvent(t, ch)
		switch evt.Type {
		case "run.started":
			sawStarted = true
		case "run.output.batch":
		case "message.created", "item.created":
		case "run.failed":
			if !sawStarted {
				t.Fatal("run.failed arrived before run.started")
			}
			payload, ok := evt.Payload.(map[string]any)
			if !ok {
				t.Fatalf("failed payload = %T, want map", evt.Payload)
			}
			if payload["status"] != "failed" || payload["error"] == "" {
				t.Fatalf("failed payload = %#v, want failed status and error", payload)
			}
			items := s.ListThreadItems(run.ThreadID)
			var failureItem *store.Item
			for i := range items {
				if items[i].RunID == run.ID && items[i].Type == "agent_message" {
					failureItem = &items[i]
					break
				}
			}
			if failureItem == nil {
				t.Fatalf("thread items = %#v, want failed agent_message", items)
			}
			if failureItem.Status != "failed" || !strings.Contains(failureItem.Content, "failure chunk") {
				t.Fatalf("failure item = %#v, want stderr-backed failed message", *failureItem)
			}
			return
		default:
			t.Fatalf("unexpected event type %q", evt.Type)
		}
	}
}

func TestProcessExecutorPublishesFailedWhenCommandCannotStart(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)
	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{Command: "agenthub-missing-command-for-test"}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	var evt events.EventEnvelope
	for {
		evt = nextEvent(t, ch)
		if evt.Type == "message.created" || evt.Type == "item.created" {
			continue
		}
		break
	}
	if evt.Type != "run.failed" {
		t.Fatalf("event type = %q, want run.failed", evt.Type)
	}
	payload, ok := evt.Payload.(map[string]any)
	if !ok {
		t.Fatalf("failed payload = %T, want map", evt.Payload)
	}
	if payload["status"] != "failed" || payload["error"] == "" {
		t.Fatalf("failed payload = %#v, want failed status and error", payload)
	}
	stored, ok := s.GetRun(run.ID)
	if !ok {
		t.Fatalf("run %q was not stored", run.ID)
	}
	if stored.Status != "failed" {
		t.Fatalf("stored run status = %q, want failed", stored.Status)
	}
}

func TestProcessExecutorRejectsDuplicateStart(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	executor := newTestProcessExecutor(t, bus, s, "sleep")

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("first Start returned error: %v", err)
	}
	if err := executor.Start(run, RunProcessContext{}); !errors.Is(err, ErrRunAlreadyStarted) {
		t.Fatalf("second Start error = %v, want ErrRunAlreadyStarted", err)
	}
	_ = executor.Cancel(run.ID)
}

func TestProcessExecutorCancelPublishesCancelledEvent(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)
	executor := newTestProcessExecutor(t, bus, s, "sleep")

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	result := executor.Cancel(run.ID)
	if !result.Found || result.Status != "cancelling" {
		t.Fatalf("Cancel result = %#v, want found cancelling", result)
	}

	for {
		evt := nextEvent(t, ch)
		if evt.Type == "run.cancelled" {
			stored, ok := s.GetRun(run.ID)
			if !ok {
				t.Fatalf("run %q was not stored", run.ID)
			}
			if stored.Status != "cancelled" {
				t.Fatalf("stored run status = %q, want cancelled", stored.Status)
			}
			return
		}
	}
}

// TestProcessExecutorCancelGraceNotImmediateKill verifies #988: Cancel must
// not immediately kill the child via CommandContext. With a positive grace
// period the process should survive until escalation, so the wall time from
// Cancel() to run.cancelled is at least the configured grace period.
func TestProcessExecutorCancelGraceNotImmediateKill(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)

	const grace = 400 * time.Millisecond
	const force = 100 * time.Millisecond

	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command:              os.Args[0],
		Args:                 []string{processExecutorHelperRunFlag, "--", "sleep"},
		Env:                  append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"),
		ShutdownGracePeriod:  grace,
		ShutdownForceTimeout: force,
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor: %v", err)
	}
	executor.faultEscalationCfg = FaultEscalationConfig{Enabled: false}

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start: %v", err)
	}

	// Wait until the child is tracked so Cancel arms the grace path (not just
	// context cancel before Start).
	testkit.Eventually(t, processTrackedWaitTimeout, func() bool {
		executor.mu.Lock()
		defer executor.mu.Unlock()
		return executor.processes[run.ID] != nil
	}, "started process should be tracked", func() string {
		executor.mu.Lock()
		defer executor.mu.Unlock()
		return fmt.Sprintf("tracked processes=%d", len(executor.processes))
	})

	// Confirm grace path is armed and cancelDone is registered before the
	// run context is cancelled (unit-level proof for #988).
	cancelAt := time.Now()
	result := executor.Cancel(run.ID)
	if !result.Found || result.Status != "cancelling" {
		t.Fatalf("Cancel result = %#v, want found cancelling", result)
	}

	executor.mu.Lock()
	_, graceArmed := executor.cancelDone[run.ID]
	procAfter := executor.processes[run.ID]
	executor.mu.Unlock()
	if !graceArmed {
		t.Fatal("cancelDone not registered; grace path was not armed")
	}
	if procAfter == nil {
		t.Fatal("process handle cleared immediately on Cancel")
	}

	// Immediately after Cancel the child must still be alive. If CommandContext
	// were wired to the same ctx, Go would already have SIGKILLed it.
	time.Sleep(80 * time.Millisecond)
	if !processLikelyAlive(procAfter) {
		t.Fatal("process died immediately after Cancel; grace period was defeated")
	}

	for {
		evt := nextEventWithin(t, ch, 10*time.Second)
		switch evt.Type {
		case "run.cancelled":
			elapsed := time.Since(cancelAt)
			// Allow a little scheduling slack under the grace floor, but require
			// that cancellation was not an immediate CommandContext kill.
			if elapsed < grace-50*time.Millisecond {
				t.Fatalf("run.cancelled after %v, want at least ~%v grace (CommandContext may still be killing immediately)", elapsed, grace)
			}
			return
		case "run.started", "run.output.batch":
		case "run.failed":
			t.Fatal("run failed instead of cancelling")
		default:
			// ignore other bus noise
		}
	}
}

func TestProcessExecutorCancelMissingRun(t *testing.T) {
	executor := newTestProcessExecutor(t, events.NewBus(10), store.New(), "success")

	result := executor.Cancel("run_missing")
	if result.Found || result.Status != "not_found" {
		t.Fatalf("Cancel missing result = %#v, want not_found", result)
	}
}

// TestProcessExecutorStartCancelRace verifies that concurrent Start and Cancel
// calls do not suffer from a TOCTOU race where Start reads the store as "queued"
// but Cancel modifies it before Start enters the running map. Run with -race.
func TestProcessExecutorStartCancelRace(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	executor := newTestProcessExecutor(t, bus, s, "sleep")

	// Start one run to consume a slot, then set max to 1 so any additional Start
	// is blocked by concurrency limit (ensures Start must wait without panicking).
	executor.mu.Lock()
	executor.maxConcurrentRuns = 1
	executor.mu.Unlock()

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		// Cancel immediately after Start so the two races are maximized.
		time.Sleep(10 * time.Millisecond)
		executor.Cancel(run.ID)
	}()

	err := executor.Start(run, RunProcessContext{})
	// Either Start succeeds (run was "queued") or it fails (already started/cancelling).
	// Both outcomes are valid given the Cancel may have changed state. We just assert
	// no panic and no data race under the lock-ordering fix.
	_ = err
	wg.Wait()
}

// TestProcessExecutorFaultEscalationRetryKeepsRunRegistered verifies #867:
// on fault-escalation auto-retry the concurrency slot remains registered for the
// successor attempt (deferred finish must not tear it down between attempts).
func TestProcessExecutorFaultEscalationRetryKeepsRunRegistered(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)
	executor := newTestProcessExecutor(t, bus, s, "fail")
	executor.faultEscalationCfg = FaultEscalationConfig{
		Enabled:    true,
		MaxRetries: 1,
	}

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	var sawRetry bool
	var sawFailed bool
	deadline := time.After(15 * time.Second)
	for !sawFailed {
		select {
		case evt := <-ch:
			switch evt.Type {
			case "run.started", "run.output.batch", "message.created", "item.created":
			case "run.fault_escalation.retry":
				sawRetry = true
				// Immediately after the handoff event the run must still occupy
				// the concurrency slot so Cancel / max-concurrent accounting work.
				executor.mu.Lock()
				_, registered := executor.running[run.ID]
				executor.mu.Unlock()
				if !registered {
					t.Fatal("run not registered in executor.running after fault-escalation retry handoff")
				}
				stored, ok := s.GetRun(run.ID)
				if !ok {
					t.Fatal("run missing from store after retry handoff")
				}
				if stored.RetryCount != 1 {
					t.Fatalf("RetryCount = %d, want 1 after first escalation retry", stored.RetryCount)
				}
				if stored.Status != "queued" && stored.Status != "started" {
					t.Fatalf("status after retry handoff = %q, want queued or started", stored.Status)
				}
			case "run.fault_escalation.exhausted":
			case "run.failed":
				sawFailed = true
			default:
				t.Fatalf("unexpected event type %q", evt.Type)
			}
		case <-deadline:
			t.Fatal("timed out waiting for terminal run.failed after fault escalation")
		}
	}
	if !sawRetry {
		t.Fatal("expected run.fault_escalation.retry before terminal failure")
	}

	// Terminal finish must clear the slot exactly once.
	deadline2 := time.After(2 * time.Second)
	for {
		executor.mu.Lock()
		_, registered := executor.running[run.ID]
		executor.mu.Unlock()
		if !registered {
			break
		}
		select {
		case <-deadline2:
			t.Fatal("run still registered after terminal failure finish")
		case <-time.After(10 * time.Millisecond):
		}
	}

	// finish is idempotent: a second call must not panic or re-introduce state.
	executor.finish(run.ID)
	executor.mu.Lock()
	_, registered := executor.running[run.ID]
	executor.mu.Unlock()
	if registered {
		t.Fatal("run reappeared in running map after idempotent finish")
	}
}

// TestProcessExecutorFaultEscalationExhaustedSingleFinish verifies that when
// retries are exhausted (or disabled), terminal finish runs once and the slot
// is released.
func TestProcessExecutorFaultEscalationExhaustedSingleFinish(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)
	executor := newTestProcessExecutor(t, bus, s, "fail")
	// MaxRetries=0: escalation enabled but no auto-retry budget → single finish.
	executor.faultEscalationCfg = FaultEscalationConfig{
		Enabled:    true,
		MaxRetries: 0,
	}

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	var sawRetry bool
	var sawFailed bool
	deadline := time.After(10 * time.Second)
	for !sawFailed {
		select {
		case evt := <-ch:
			switch evt.Type {
			case "run.started", "run.output.batch", "message.created", "item.created":
			case "run.fault_escalation.retry":
				sawRetry = true
			case "run.fault_escalation.exhausted":
			case "run.failed":
				sawFailed = true
			default:
				t.Fatalf("unexpected event type %q", evt.Type)
			}
		case <-deadline:
			t.Fatal("timed out waiting for run.failed")
		}
	}
	if sawRetry {
		t.Fatal("did not expect fault-escalation retry when MaxRetries=0")
	}

	deadline2 := time.After(2 * time.Second)
	for {
		executor.mu.Lock()
		_, registered := executor.running[run.ID]
		n := len(executor.running)
		executor.mu.Unlock()
		if !registered {
			if n != 0 {
				t.Fatalf("running map size = %d after terminal finish, want 0", n)
			}
			break
		}
		select {
		case <-deadline2:
			t.Fatal("run still registered after exhausted terminal finish")
		case <-time.After(10 * time.Millisecond):
		}
	}

	// Second finish is a no-op (idempotent teardown).
	executor.finish(run.ID)
	executor.mu.Lock()
	n := len(executor.running)
	executor.mu.Unlock()
	if n != 0 {
		t.Fatalf("running map size = %d after second finish, want 0", n)
	}
}

func TestProcessExecutorRunStartedCarriesWorkDir(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	workDir := t.TempDir()
	_, ch, _ := bus.Subscribe(0)

	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{processExecutorHelperRunFlag, "--", "success"},
		Env:     append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"),
		WorkDir: workDir,
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}
	executor.faultEscalationCfg = FaultEscalationConfig{Enabled: false}

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	sawWorkDir := false
	for {
		evt := nextEvent(t, ch)
		switch evt.Type {
		case "run.started":
			payload, ok := evt.Payload.(map[string]any)
			if !ok {
				t.Fatalf("run.started payload = %T, want map", evt.Payload)
			}
			if got, _ := payload["workDir"].(string); got != workDir {
				t.Fatalf("run.started workDir = %#v, want %q", payload["workDir"], workDir)
			}
			sawWorkDir = true
		case "run.output.batch":
		case "run.finished":
			if !sawWorkDir {
				t.Fatal("run finished without run.started carrying workDir")
			}
			stored, ok := s.GetRun(run.ID)
			if !ok {
				t.Fatalf("run %q was not stored", run.ID)
			}
			if stored.WorkDir != workDir {
				t.Fatalf("stored run workDir = %q, want %q", stored.WorkDir, workDir)
			}
			return
		default:
			// Other lifecycle events are not part of this contract.
		}
	}
}

func TestProcessExecutorEmitsRunCheckpointBeforeStart(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	workDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(workDir, "pre.txt"), []byte("pre-run content"), 0o600); err != nil {
		t.Fatalf("seed checkpoint file: %v", err)
	}
	_, ch, _ := bus.Subscribe(0)

	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{processExecutorHelperRunFlag, "--", "success"},
		Env:     append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"),
		WorkDir: workDir,
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}
	executor.faultEscalationCfg = FaultEscalationConfig{Enabled: false}

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	sawCheckpointBeforeStart := false
	sawStarted := false
	for {
		evt := nextEvent(t, ch)
		switch evt.Type {
		case "run.checkpoint":
			if sawStarted {
				t.Fatal("run.checkpoint must precede run.started in the timeline")
			}
			payload, ok := evt.Payload.(map[string]any)
			if !ok {
				t.Fatalf("checkpoint payload = %T, want map", evt.Payload)
			}
			if got, _ := payload["checkpointId"].(string); got != "cp-"+run.ID {
				t.Fatalf("checkpointId = %#v, want cp-%s", payload["checkpointId"], run.ID)
			}
			if got, _ := payload["workDir"].(string); got != workDir {
				t.Fatalf("checkpoint workDir = %#v, want %q", payload["workDir"], workDir)
			}
			if got, _ := payload["fileCount"].(int); got != 1 {
				t.Fatalf("checkpoint fileCount = %#v, want 1", payload["fileCount"])
			}
			sawCheckpointBeforeStart = true
		case "run.started":
			sawStarted = true
		case "run.output.batch":
		case "run.finished":
			if !sawCheckpointBeforeStart {
				t.Fatal("run finished without a checkpoint event")
			}
			cp, ok := s.GetRunCheckpoint(run.ID)
			if !ok {
				t.Fatalf("checkpoint for run %q was not persisted", run.ID)
			}
			if len(cp.Files) != 1 || cp.Files[0].Path != "pre.txt" || cp.Files[0].Content != "pre-run content" {
				t.Fatalf("persisted checkpoint files = %#v", cp.Files)
			}
			return
		default:
			// Other lifecycle events are not part of this contract.
		}
	}
}

func TestProcessExecutorNoCheckpointWithoutWorkDir(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)
	executor := newTestProcessExecutor(t, bus, s, "success")

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}
	for {
		evt := nextEvent(t, ch)
		switch evt.Type {
		case "run.checkpoint":
			t.Fatal("run without workDir must not emit a checkpoint (honest absence)")
		case "run.output.batch":
		case "run.finished":
			if _, ok := s.GetRunCheckpoint(run.ID); ok {
				t.Fatal("run without workDir must not persist a checkpoint")
			}
			return
		default:
		}
	}
}

func newTestProcessExecutor(t *testing.T, bus *events.Bus, s store.RunLifecycleStore, mode string) *ProcessExecutor {
	t.Helper()

	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{processExecutorHelperRunFlag, "--", mode},
		Env:     append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"),
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}
	// Disable fault-escalation by default so existing unit tests observe a single
	// terminal attempt. Escalation-specific tests re-enable it explicitly.
	executor.faultEscalationCfg = FaultEscalationConfig{Enabled: false}
	return executor
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

func outputChunksText(chunks []map[string]any) string {
	var text strings.Builder
	for _, chunk := range chunks {
		if value, ok := chunk["text"].(string); ok {
			text.WriteString(value)
		}
	}
	return text.String()
}

func TestProcessExecutorHelperRunsFromModeArgument(t *testing.T) {
	cmd := exec.Command(os.Args[0], processExecutorHelperRunFlag, "--", "success")
	cmd.Env = withoutEnvKey(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER")
	cmd.Env = append(cmd.Env,
		"AGENTHUB_RUN_ID=run_helper",
		"AGENTHUB_PROJECT_ID=proj_helper",
		"AGENTHUB_THREAD_ID=thread_helper",
	)

	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("helper command returned error: %v\n%s", err, output)
	}
	text := string(output)
	for _, want := range []string{
		"stdout chunk",
		"stderr chunk",
		"run=run_helper",
		"project=proj_helper",
		"thread=thread_helper",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("helper output = %q, want %q", text, want)
		}
	}
}

func withoutEnvKey(env []string, key string) []string {
	filtered := make([]string, 0, len(env))
	for _, kv := range env {
		name, _, _ := strings.Cut(kv, "=")
		if strings.EqualFold(name, key) {
			continue
		}
		filtered = append(filtered, kv)
	}
	return filtered
}

func TestProcessExecutorHelper(t *testing.T) {
	mode, ok := processExecutorHelperMode()
	if !ok {
		return
	}
	switch mode {
	case "success":
		fmt.Fprintf(
			os.Stdout,
			"stdout chunk\nrun=%s\nproject=%s\nthread=%s\n",
			os.Getenv("AGENTHUB_RUN_ID"),
			os.Getenv("AGENTHUB_PROJECT_ID"),
			os.Getenv("AGENTHUB_THREAD_ID"),
		)
		fmt.Fprint(os.Stderr, "stderr chunk\n")
	case "fail":
		fmt.Fprint(os.Stderr, "failure chunk\n")
		os.Exit(7)
	case "sleep":
		time.Sleep(5 * time.Second)
	case "stdin-read":
		buf := make([]byte, 1024)
		_, err := os.Stdin.Read(buf)
		if err != nil {
			fmt.Fprintf(os.Stderr, "stdin read error: %v\n", err)
			os.Exit(1)
		}
		fmt.Fprintf(os.Stdout, "stdin-ok\n")
	case "pwd":
		cwd, err := os.Getwd()
		if err != nil {
			fmt.Fprintf(os.Stderr, "getwd: %v\n", err)
			os.Exit(3)
		}
		fmt.Fprintf(os.Stdout, "cwd=%s\n", filepath.Clean(cwd))
	case "args":
		fmt.Fprintf(os.Stdout, "args=%s\n", strings.Join(os.Args, "\n"))
	case "env":
		fmt.Fprintf(
			os.Stdout,
			"profileRun=%s\nprofileProject=%s\nprofileThread=%s\n",
			os.Getenv("PROFILE_RUN"),
			os.Getenv("PROFILE_PROJECT"),
			os.Getenv("PROFILE_THREAD"),
		)
	case "inherited-env":
		fmt.Fprintf(os.Stdout, "inherited=%s\n", os.Getenv("AGENTHUB_INHERITED_ENV_FOR_TEST"))
	case "sanitized-env":
		path := os.Getenv("PATH")
		if path == "" {
			fmt.Fprint(os.Stderr, "PATH not inherited (whitelisted var missing)\n")
			os.Exit(1)
		}
		fmt.Fprintf(os.Stdout, "sanitizedPath=%s\n", path)
		randomSecret := os.Getenv("RANDOM_TEST_SECRET_TOKEN")
		if randomSecret != "" {
			fmt.Fprintf(os.Stdout, "randomSecret=%s\n", randomSecret)
		}
		if helper := os.Getenv("AGENTHUB_TEST_EXTRA_ENV"); helper != "" {
			fmt.Fprintf(os.Stdout, "testExtraEnv=%s\n", helper)
		}
		if token := os.Getenv("AGENTHUB_EDGE_AUTH_TOKEN"); token != "" {
			fmt.Fprintf(os.Stdout, "edgeAuthToken=%s\n", token)
		}
		if secret := os.Getenv("AGENTHUB_JWT_SECRET"); secret != "" {
			fmt.Fprintf(os.Stdout, "jwtSecret=%s\n", secret)
		}
		if password := os.Getenv("AGENTHUB_DB_PASSWORD"); password != "" {
			fmt.Fprintf(os.Stdout, "dbPassword=%s\n", password)
		}
	case "sdk-fixture-json":
		success := true
		stream := sdk.SDKFixtureStream{
			Provider: "opencode-agent-sdk-fixture",
			Events: []sdk.SDKFixtureEvent{
				{
					ID:             "fixture_session_1",
					Type:           "sidecar_session_ready",
					SessionID:      "fixture_session_1",
					Model:          "opencode/gpt-5.1-fixture",
					PermissionMode: "approval-required",
					Tools:          []string{"read", "bash"},
				},
				{
					ID:        "fixture_tool_1",
					Type:      "tool_state",
					SessionID: "fixture_session_1",
					CallID:    "call_read",
					ToolName:  "read",
					Status:    "running",
					Input:     map[string]any{"path": "README.md"},
				},
				{
					ID:        "fixture_permission_1",
					Type:      "permission.asked",
					RequestID: "perm_fixture_shell",
					CallID:    "call_shell",
					ToolName:  "bash",
					RiskLevel: "high",
					Reason:    "fixture shell approval",
					Input:     map[string]any{"command": "go test ./internal/adapters -short -count=1"},
				},
				{
					ID:        "fixture_result_1",
					Type:      "run_result",
					SessionID: "fixture_session_1",
					Success:   &success,
					Summary:   "Fixture SDK stream completed.",
				},
			},
		}
		data, err := json.Marshal(stream)
		if err != nil {
			fmt.Fprintf(os.Stderr, "marshal fixture stream: %v\n", err)
			os.Exit(4)
		}
		fmt.Fprintln(os.Stdout, string(data))
	case "sdk-fixture-runner-contract-json":
		success := true
		stream := sdk.SDKFixtureStream{
			Provider: "agenthub-runner-process-fixture",
			Events: []sdk.SDKFixtureEvent{
				{
					ID:             "runner_session_1",
					Type:           "sidecar_session_ready",
					SessionID:      "runner_session_1",
					Model:          "fixture/model",
					PermissionMode: "approval-required",
					Tools:          []string{"read", "write", "bash"},
				},
				{
					ID:        "runner_text_1",
					Type:      "text_block",
					SessionID: "runner_session_1",
					Content:   "runner transcript fixture api_key=sk-fixture-runner-123456 path=D:\\private\\notes.md",
				},
				{
					ID:           "runner_task_1",
					Type:         "task_progress",
					TaskID:       "task_runner_fixture",
					Status:       "running",
					Description:  "normalize fixture process stream",
					LastToolName: "write",
					Percent:      50,
				},
				{
					ID:           "runner_route_1",
					Type:         "route_suggestion",
					Action:       "delegate",
					NextWorker:   "edge-fixture-adapter-runner",
					Instructions: "continue fixture-only contract validation",
					Reason:       "approval and artifact evidence ready",
				},
				{
					ID:        "runner_permission_1",
					Type:      "permission.asked",
					RequestID: "perm_runner_write",
					CallID:    "call_write_fixture",
					ToolName:  "write",
					RiskLevel: "high",
					Reason:    "write action requires approval evidence",
					Input: map[string]any{
						"path":      "C:\\Users\\Ding\\private\\fixture.patch",
						"api_token": "sk-fixture-runner-123456",
						"header":    "Authorization: Bearer runner-secret-token",
					},
				},
				{
					ID:       "runner_file_1",
					Type:     "file_change",
					ToolName: "write",
					CallID:   "call_write_fixture",
					Path:     "D:\\private\\fixture.patch",
					Kind:     "modified",
					Diff:     "@@ fixture @@\n-api_key=sk-fixture-runner-123456\n+api_key=[redacted]\n",
				},
				{
					ID:         "runner_artifact_1",
					Type:       "artifact",
					ArtifactID: "artifact_runner_report",
					Path:       "/home/ding/private/runner-report.json",
					Kind:       "file",
					SizeBytes:  256,
					Summary:    "runner artifact summary token=sk-fixture-runner-123456",
					Metadata: map[string]any{
						"api_token": "sk-fixture-runner-123456",
					},
				},
				{
					ID:        "runner_result_1",
					Type:      "run_result",
					SessionID: "runner_session_1",
					Success:   &success,
					Summary:   "runner fixture completed with Authorization: Bearer runner-secret-token",
				},
			},
		}
		data, err := json.Marshal(stream)
		if err != nil {
			fmt.Fprintf(os.Stderr, "marshal runner fixture stream: %v\n", err)
			os.Exit(4)
		}
		fmt.Fprintln(os.Stdout, string(data))
	case "sdk-fixture-malformed-json":
		fmt.Fprintln(os.Stdout, `{"provider":"agenthub-runner-process-fixture","events":[`)
		fmt.Fprintln(os.Stdout, `not-json`)
	case "sdk-fixture-error-json":
		stream := sdk.SDKFixtureStream{
			Provider: "agenthub-runner-process-fixture",
			Events: []sdk.SDKFixtureEvent{
				{
					ID:        "error_permission_1",
					Type:      "permission.asked",
					RequestID: "perm_error_fixture",
					ToolName:  "bash",
					RiskLevel: "high",
					Reason:    "fixture error stream approval event",
					Input: map[string]any{
						"command":   "go test ./internal/adapters -run SDKFixture -short -count=1",
						"api_token": "sk-error-fixture-123456",
					},
				},
				{
					ID:     "error_result_1",
					Type:   "error",
					Error:  "runtime failed with api_key=sk-error-fixture-123456",
					Reason: "fixture runtime error",
				},
			},
		}
		data, err := json.Marshal(stream)
		if err != nil {
			fmt.Fprintf(os.Stderr, "marshal error fixture stream: %v\n", err)
			os.Exit(4)
		}
		fmt.Fprintln(os.Stdout, string(data))
	default:
		fmt.Fprintf(os.Stderr, "unknown helper mode %q\n", mode)
		os.Exit(2)
	}
	os.Exit(0)
}

func processExecutorHelperMode() (string, bool) {
	if os.Getenv("AGENTHUB_PROCESS_EXECUTOR_HELPER") != "1" && !hasArg(os.Args, processExecutorHelperRunFlag) {
		return "", false
	}
	if len(os.Args) == 0 {
		return "", false
	}
	return os.Args[len(os.Args)-1], true
}

func hasArg(args []string, want string) bool {
	for _, arg := range args {
		if arg == want {
			return true
		}
	}
	return false
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

func TestSplitHubCallbackTextPreservesUTF8(t *testing.T) {
	text := "ab你好cd"

	chunks := splitHubCallbackText(text, 4)
	if len(chunks) < 2 {
		t.Fatalf("chunks = %#v, want multiple chunks", chunks)
	}
	for i, chunk := range chunks {
		if !utf8.ValidString(chunk) {
			t.Fatalf("chunk %d = %q is not valid UTF-8", i, chunk)
		}
	}
	if got := strings.Join(chunks, ""); got != text {
		t.Fatalf("joined chunks = %q, want %q", got, text)
	}
}

// ── Result aggregation tests ───────────────────────────────────────────────

func TestSendSubAgentResult_Completed(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	_, _ = s.CreateProject("proj-agg", "agg-project", "")
	_, _ = s.CreateThread("thread-agg", "proj-agg", "agg-thread", "", "", "")
	_, _ = s.CreateRun("parent-run", "proj-agg", "thread-agg")
	_, _ = s.CreateRun("child-run", "proj-agg", "thread-agg")

	reg := agents.NewRegistry()
	queue := agents.NewQueue()

	_ = reg.Register(&agents.AgentInstance{
		ID:        "parent-agent",
		AdapterID: "orchestrator",
		Status:    agents.StatusBusy,
	})
	_ = reg.Register(&agents.AgentInstance{
		ID:        "child-agent",
		AdapterID: "claude-code",
		ParentID:  "parent-agent",
		Status:    agents.StatusBusy,
	})

	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{processExecutorHelperRunFlag, "--", "success"},
		Env:     append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"),
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor: %v", err)
	}
	executor.WithAgentRegistry(reg).WithMessageQueue(queue)

	// Populate the runToAgent mapping (normally done by SpawnSubAgent).
	executor.mu.Lock()
	executor.runToAgent["child-run"] = "child-agent"
	executor.mu.Unlock()

	queue.EnsureAgent("parent-agent", 64)

	executor.sendSubAgentResult("child-run", "finished", map[string]any{
		"output": "sub-agent completed successfully",
	})

	select {
	case msg := <-queue.Receive("parent-agent"):
		if msg.Type != agents.MsgTypeResult {
			t.Fatalf("message type = %q, want %q", msg.Type, agents.MsgTypeResult)
		}
		if msg.FromAgentID != "child-agent" {
			t.Fatalf("FromAgentID = %q, want child-agent", msg.FromAgentID)
		}
		if msg.ToAgentID != "parent-agent" {
			t.Fatalf("ToAgentID = %q, want parent-agent", msg.ToAgentID)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for result message on parent queue")
	}
}

func TestSendSubAgentResult_Error(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	_, _ = s.CreateProject("proj-err", "err-project", "")
	_, _ = s.CreateThread("thread-err", "proj-err", "err-thread", "", "", "")
	_, _ = s.CreateRun("parent-err", "proj-err", "thread-err")
	_, _ = s.CreateRun("child-err", "proj-err", "thread-err")

	reg := agents.NewRegistry()
	queue := agents.NewQueue()

	_ = reg.Register(&agents.AgentInstance{
		ID:        "parent-agent-err",
		AdapterID: "orchestrator",
		Status:    agents.StatusBusy,
	})
	_ = reg.Register(&agents.AgentInstance{
		ID:        "child-agent-err",
		AdapterID: "claude-code",
		ParentID:  "parent-agent-err",
		Status:    agents.StatusBusy,
	})

	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{processExecutorHelperRunFlag, "--", "success"},
		Env:     append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"),
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor: %v", err)
	}
	executor.WithAgentRegistry(reg).WithMessageQueue(queue)

	executor.mu.Lock()
	executor.runToAgent["child-err"] = "child-agent-err"
	executor.mu.Unlock()

	queue.EnsureAgent("parent-agent-err", 64)

	executor.sendSubAgentResult("child-err", "failed", map[string]any{
		"error": "something went wrong",
	})

	select {
	case msg := <-queue.Receive("parent-agent-err"):
		if msg.Type != agents.MsgTypeError {
			t.Fatalf("message type = %q, want %q", msg.Type, agents.MsgTypeError)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for error message on parent queue")
	}
}

func TestSendSubAgentResult_NoRegistryNoCrash(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	_, _ = s.CreateProject("proj-noreg", "no-reg-project", "")
	_, _ = s.CreateThread("thread-noreg", "proj-noreg", "no-reg-thread", "", "", "")
	_, _ = s.CreateRun("run-noreg", "proj-noreg", "thread-noreg")

	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{processExecutorHelperRunFlag, "--", "success"},
		Env:     append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"),
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor: %v", err)
	}

	// Should not panic with nil registry and nil message queue.
	executor.sendSubAgentResult("run-noreg", "finished", nil)
}

func TestSendSubAgentResult_NonSubAgentNoAction(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	_, _ = s.CreateProject("proj-nosub", "nosub-project", "")
	_, _ = s.CreateThread("thread-nosub", "proj-nosub", "nosub-thread", "", "", "")
	_, _ = s.CreateRun("run-nosub", "proj-nosub", "thread-nosub")

	reg := agents.NewRegistry()
	queue := agents.NewQueue()

	// Register agent with no parent (top-level run, not a sub-agent).
	_ = reg.Register(&agents.AgentInstance{
		ID:        "top-level-agent",
		AdapterID: "claude-code",
		ParentID:  "",
		Status:    agents.StatusBusy,
	})

	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{processExecutorHelperRunFlag, "--", "success"},
		Env:     append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"),
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor: %v", err)
	}
	executor.WithAgentRegistry(reg).WithMessageQueue(queue)

	// Map run to the top-level agent (which has no parent).
	executor.mu.Lock()
	executor.runToAgent["run-nosub"] = "top-level-agent"
	executor.mu.Unlock()

	// Should not panic or send a message because parentID is empty.
	executor.sendSubAgentResult("run-nosub", "finished", nil)
}

// TestSendSubAgentResultFinalizesParentDirectly verifies the #1880 reliable
// lifecycle hook: when a child run reaches a terminal state, sendSubAgentResult
// finalizes a parked orchestrator parent directly (no lossy event-bus subscriber
// involvement), so a dropped run.finished/failed/cancelled cannot strand the parent.
func TestSendSubAgentResultFinalizesParentDirectly(t *testing.T) {
	bus := events.NewBus(10)
	s := store.New()
	_, _ = s.CreateProject("proj-direct", "direct-project", "")
	_, _ = s.CreateThread("thread-direct", "proj-direct", "direct-thread", "", "", "")
	_, _ = s.CreateRun("parent-direct", "proj-direct", "thread-direct")
	_, _ = s.CreateRun("child-direct", "proj-direct", "thread-direct")

	reg := agents.NewRegistry()
	queue := agents.NewQueue()
	_ = reg.Register(&agents.AgentInstance{ID: "parent-agent", AdapterID: "orchestrator", Status: agents.StatusBusy})
	_ = reg.Register(&agents.AgentInstance{
		ID: "child-agent", AdapterID: "claude-code", ParentID: "parent-agent",
		RunID: "child-direct", Status: agents.StatusBusy,
	})

	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{processExecutorHelperRunFlag, "--", "success"},
		Env:     append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"),
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor: %v", err)
	}
	executor.WithAgentRegistry(reg).WithMessageQueue(queue)

	ra := NewResultAggregator(bus, reg)
	finalized := make(chan string, 1)
	ra.WithParentFinalizer(func(parentID string) { finalized <- parentID })
	executor.WithResultAggregator(ra)

	executor.mu.Lock()
	executor.runToAgent["child-direct"] = "child-agent"
	executor.mu.Unlock()
	queue.EnsureAgent("parent-agent", 64)

	// Direct terminal delivery; no run.finished is published to the bus.
	executor.sendSubAgentResult("child-direct", "finished", map[string]any{"output": "ok"})

	select {
	case parentID := <-finalized:
		if parentID != "parent-agent" {
			t.Fatalf("finalized parent = %q, want parent-agent", parentID)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("sendSubAgentResult did not finalize the parent via the direct lifecycle hook")
	}
}

// ── SanitizeSubAgentResult tests ──────────────────────────────────────────────

func TestSanitizeSubAgentResult_Nil(t *testing.T) {
	result, reason := SanitizeSubAgentResult(nil)
	if result != nil {
		t.Fatalf("SanitizeSubAgentResult(nil) = %v, want nil", result)
	}
	if reason != "" {
		t.Fatalf("reason for nil = %q, want empty", reason)
	}
}

func TestSanitizeSubAgentResult_EmptyString(t *testing.T) {
	result, reason := SanitizeSubAgentResult("")
	if result != "" {
		t.Fatalf("SanitizeSubAgentResult(\"\") = %q, want empty", result)
	}
	if reason != "" {
		t.Fatalf("reason for empty = %q, want empty", reason)
	}
}

func TestSanitizeSubAgentResult_StackTrace(t *testing.T) {
	input := "error: something failed\n\tat com.example.MyClass.doThing(MyClass.java:42)\ngoroutine 7 [running]:\n.../pkg/module.go:123 +0x45\nmore text"
	result, reason := SanitizeSubAgentResult(input)
	s, ok := result.(string)
	if !ok {
		t.Fatalf("result type = %T, want string", result)
	}
	if s == input {
		t.Fatalf("stack trace was not redacted: %q", s)
	}
	if !strings.Contains(s, "[redacted:stack-trace]") {
		t.Fatalf("result does not contain redaction marker: %q", s)
	}
	if !strings.Contains(s, "more text") {
		t.Fatalf("non-trace text was redacted: %q", s)
	}
	if reason != "stack-trace-redacted" {
		t.Fatalf("reason = %q, want stack-trace-redacted", reason)
	}
}

func TestSanitizeSubAgentResult_APIKey(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{"OpenAI key", "config: api_key=sk-proj-abc123def456ghi789jkl012mno345pqr678stu"},
		{"Anthropic key", "Authorization: Bearer sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901vwx234"},
		{"Google key", "key: AIzaSyDabc123def456ghi789jkl012mno345pqr"},
		{"GitHub classic", "token: ghp_abc123def456ghi789jkl012mno345pqr678s"},
		{"GitHub fine-grained", "token: github_pat_abc123def456ghi789jkl0_12"},
		{"GitLab token", "token: glpat-abc123def456ghi789jk"},
		{"HuggingFace token", "token: hf_abc123def456ghi789jkl012mno345pqr678"},
		{"JWT token", "auth: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"},
		{"AWS key", "access: AKIA1234567890ABCDEF"},
		{"Bearer header", "Authorization: Bearer abc123def456ghi789jkl012mno345pqr"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, reason := SanitizeSubAgentResult(tt.input)
			s, ok := result.(string)
			if !ok {
				t.Fatalf("result type = %T, want string", result)
			}
			if s == tt.input {
				t.Fatalf("API key was not redacted: %q", s)
			}
			if !strings.Contains(s, "[redacted:api-key]") {
				t.Fatalf("result does not contain redaction marker: %q", s)
			}
			if reason != "api-keys-redacted" {
				t.Fatalf("reason = %q, want api-keys-redacted", reason)
			}
		})
	}
}

func TestSanitizeSubAgentResult_FilePath(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{"Windows Code path", "reading from D:\\Code\\TokenDance\\AgentHub\\src\\main.go"},
		{"Windows Users path", "found at C:\\Users\\Ding\\Documents\\file.txt"},
		{"Windows Projects path", "opening D:\\Projects\\myapp\\config.yaml"},
		{"Unix home path", "loading /home/ding/config/settings.json"},
		{"Unix Users path", "reading /Users/john/Documents/report.md"},
		{"Unix tmp path", "temp file at /tmp/build/output.log"},
		{"Windows Desktop path", "saved to C:\\Users\\Admin\\Desktop\\export.csv"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, reason := SanitizeSubAgentResult(tt.input)
			s, ok := result.(string)
			if !ok {
				t.Fatalf("result type = %T, want string", result)
			}
			if s == tt.input {
				t.Fatalf("file path was not redacted: %q", s)
			}
			if !strings.Contains(s, "[redacted:file-path]") {
				t.Fatalf("result does not contain redaction marker: %q", s)
			}
			if reason != "file-paths-redacted" {
				t.Fatalf("reason = %q, want file-paths-redacted", reason)
			}
		})
	}
}

func TestSanitizeSubAgentResult_ChineseText(t *testing.T) {
	input := "执行结果：代码审查完成，发现3个问题。建议修复文件 src/utils/helper.go 中的空指针检查。\n分析报告已生成在 D:\\Code\\Projects\\report.md"
	result, reason := SanitizeSubAgentResult(input)
	s, ok := result.(string)
	if !ok {
		t.Fatalf("result type = %T, want string", result)
	}
	// Chinese text itself should be preserved.
	if !strings.Contains(s, "执行结果") || !strings.Contains(s, "代码审查完成") {
		t.Fatalf("Chinese text was corrupted: %q", s)
	}
	if !strings.Contains(s, "发现3个问题") || !strings.Contains(s, "建议修复文件") {
		t.Fatalf("Chinese text content lost: %q", s)
	}
	// File paths within the Chinese text should be redacted.
	if !strings.Contains(s, "[redacted:file-path]") {
		t.Fatalf("file path in Chinese text was not redacted: %q", s)
	}
	if !strings.Contains(reason, "file-paths-redacted") {
		t.Fatalf("reason = %q, want containing file-paths-redacted", reason)
	}
}

func TestSanitizeSubAgentResult_OversizedPayload(t *testing.T) {
	// Build a string larger than 32KB (maxSanitizedResultBytes).
	chunk := "abcdefghijklmnopqrstuvwxyz0123456789\n" // 37 bytes
	// Need > 32KB: 32*1024 = 32768. With 37-byte chunks, need ~886 chunks for ~32.7KB base.
	// Build ~33KB to ensure truncation.
	var builder strings.Builder
	for builder.Len() < 33*1024 {
		builder.WriteString(chunk)
	}
	input := builder.String()
	if len(input) <= maxSanitizedResultBytes {
		t.Fatalf("test setup: input length = %d, must be > %d", len(input), maxSanitizedResultBytes)
	}

	result, reason := SanitizeSubAgentResult(input)
	s, ok := result.(string)
	if !ok {
		t.Fatalf("result type = %T, want string", result)
	}
	if len(s) >= len(input) {
		t.Fatalf("oversized payload was not truncated: len(result)=%d >= len(input)=%d", len(s), len(input))
	}
	if !strings.Contains(s, "[truncated") {
		t.Fatalf("result does not contain truncation marker: %q", s[:200])
	}
	if reason != "truncated-32kb" {
		t.Fatalf("reason = %q, want truncated-32kb", reason)
	}
	// Verify the result is valid UTF-8 after truncation.
	if !utf8.ValidString(s) {
		t.Fatal("truncated result is not valid UTF-8")
	}
}

func TestSanitizeSubAgentResult_MultipleRedactions(t *testing.T) {
	input := "panic: runtime error\ngoroutine 1 [running]:\n\tat main.main(main.go:10)\nConfig loaded from D:\\Code\\Projects\\config.yaml\nusing api key: sk-proj-abc123def456ghi789jkl012mno345pqr678stu"
	result, reason := SanitizeSubAgentResult(input)
	s, ok := result.(string)
	if !ok {
		t.Fatalf("result type = %T, want string", result)
	}
	if !strings.Contains(s, "[redacted:stack-trace]") {
		t.Fatalf("stack trace not redacted: %q", s)
	}
	if !strings.Contains(s, "[redacted:file-path]") {
		t.Fatalf("file path not redacted: %q", s)
	}
	if !strings.Contains(s, "[redacted:api-key]") {
		t.Fatalf("API key not redacted: %q", s)
	}
	// Reason should contain all three redaction types in order.
	if !strings.Contains(reason, "stack-trace-redacted") || !strings.Contains(reason, "file-paths-redacted") || !strings.Contains(reason, "api-keys-redacted") {
		t.Fatalf("reason = %q, want all three redaction reasons", reason)
	}
}

func TestSanitizeSubAgentResult_StructuredMapPayload(t *testing.T) {
	payload := map[string]any{
		"status":  "ok",
		"message": "deployed from D:\\Code\\Projects\\app",
		"token":   "sk-ant-api03-abc123def456ghi789jkl012mno345",
		"count":   float64(42),
		"nested": map[string]any{
			"path": "/home/user/secret/config.yaml",
			"key":  "github_pat_abc123def456ghi789jkl0_12",
		},
	}

	result, reason := SanitizeSubAgentResult(payload)
	m, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("result type = %T, want map[string]any", result)
	}

	// Non-sensitive fields should be preserved.
	if m["status"] != "ok" || m["count"] != float64(42) {
		t.Fatalf("non-sensitive fields corrupted: %#v", m)
	}

	// Sensitive string values in top-level map should be redacted.
	if msg, ok := m["message"].(string); !ok || !strings.Contains(msg, "[redacted:file-path]") {
		t.Fatalf("message not redacted: %v", m["message"])
	}
	if tok, ok := m["token"].(string); !ok || !strings.Contains(tok, "[redacted:api-key]") {
		t.Fatalf("token not redacted: %v", m["token"])
	}

	// Nested map values should also be redacted.
	nested, ok := m["nested"].(map[string]any)
	if !ok {
		t.Fatalf("nested type = %T, want map[string]any", m["nested"])
	}
	if p, ok := nested["path"].(string); !ok || !strings.Contains(p, "[redacted:file-path]") {
		t.Fatalf("nested path not redacted: %v", nested["path"])
	}
	if k, ok := nested["key"].(string); !ok || !strings.Contains(k, "[redacted:api-key]") {
		t.Fatalf("nested key not redacted: %v", nested["key"])
	}

	if reason == "" {
		t.Fatal("reason should not be empty for redacted structured payload")
	}
}

func TestSanitizeSubAgentResult_StructuredSlicePayload(t *testing.T) {
	payload := []any{
		"status ok",
		"path: D:\\Code\\Projects\\main.go",
		"key: sk-proj-abc123def456ghi789jkl012mno345",
		map[string]any{
			"error": "panic at /home/user/app/main.go:42\ngoroutine 1 [running]:",
		},
		float64(99),
	}

	result, reason := SanitizeSubAgentResult(payload)
	sl, ok := result.([]any)
	if !ok {
		t.Fatalf("result type = %T, want []any", result)
	}

	if sl[0] != "status ok" {
		t.Fatalf("non-sensitive element corrupted: %v", sl[0])
	}
	if s, ok := sl[1].(string); !ok || !strings.Contains(s, "[redacted:file-path]") {
		t.Fatalf("element 1 not redacted: %v", sl[1])
	}
	if s, ok := sl[2].(string); !ok || !strings.Contains(s, "[redacted:api-key]") {
		t.Fatalf("element 2 not redacted: %v", sl[2])
	}
	if sl[4] != float64(99) {
		t.Fatalf("numeric element corrupted: %v", sl[4])
	}

	nested, ok := sl[3].(map[string]any)
	if !ok {
		t.Fatalf("nested element type = %T, want map[string]any", sl[3])
	}
	if errStr, ok := nested["error"].(string); !ok || !strings.Contains(errStr, "[redacted:stack-trace]") {
		t.Fatalf("nested error not redacted: %v", nested["error"])
	}
	if errStr, ok := nested["error"].(string); !ok || !strings.Contains(errStr, "[redacted:file-path]") {
		t.Fatalf("nested file path not redacted: %v", nested["error"])
	}

	if reason == "" {
		t.Fatal("reason should not be empty for redacted structured payload")
	}
}

func TestSanitizeSubAgentResult_NonStringTypes(t *testing.T) {
	tests := []struct {
		name    string
		payload any
	}{
		{"int", 42},
		{"float", 3.14},
		{"bool true", true},
		{"bool false", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, reason := SanitizeSubAgentResult(tt.payload)
			if result != tt.payload {
				t.Fatalf("SanitizeSubAgentResult(%v) = %v, want unchanged", tt.payload, result)
			}
			if reason != "" {
				t.Fatalf("reason for %v = %q, want empty", tt.payload, reason)
			}
		})
	}
}

func TestSanitizeSubAgentResult_CleanPayload(t *testing.T) {
	input := "everything looks good, no secrets or paths here"
	result, reason := SanitizeSubAgentResult(input)
	s, ok := result.(string)
	if !ok {
		t.Fatalf("result type = %T, want string", result)
	}
	if s != input {
		t.Fatalf("clean payload modified: %q != %q", s, input)
	}
	if reason != "" {
		t.Fatalf("reason for clean payload = %q, want empty", reason)
	}
}

func TestSanitizeSubAgentResult_OversizedChineseText(t *testing.T) {
	// Build a large CJK string to ensure UTF-8 safe truncation works
	// for multi-byte characters.
	chineseChunk := "这是一段中文测试文字用于验证截断功能。" // 54 bytes (18 CJK chars * 3 bytes)
	var builder strings.Builder
	for builder.Len() < 33*1024 {
		builder.WriteString(chineseChunk)
	}
	input := builder.String()
	if len(input) <= maxSanitizedResultBytes {
		t.Fatalf("test setup: input length = %d, must be > %d", len(input), maxSanitizedResultBytes)
	}

	result, reason := SanitizeSubAgentResult(input)
	s, ok := result.(string)
	if !ok {
		t.Fatalf("result type = %T, want string", result)
	}
	if len(s) >= len(input) {
		t.Fatalf("oversized CJK payload was not truncated")
	}
	if !strings.Contains(s, "[truncated") {
		t.Fatalf("result does not contain truncation marker")
	}
	if reason != "truncated-32kb" {
		t.Fatalf("reason = %q, want truncated-32kb", reason)
	}
	// Verify the result is valid UTF-8 (no broken CJK characters).
	if !utf8.ValidString(s) {
		t.Fatal("truncated CJK result is not valid UTF-8")
	}
}

// needsStdinTestAdapter is a stub adapter that reports NeedsStdin=true and
// uses the test helper binary. Its ParseStream drains stdout and then writes
// a control response via stdin to verify the pipe is still open.
type needsStdinTestAdapter struct {
	cmdPath string
	cmdArgs []string
}

func (a *needsStdinTestAdapter) Metadata() adapters.AdapterMetadata {
	return adapters.AdapterMetadata{ID: "needs-stdin-test", Name: "Needs Stdin Test"}
}

func (a *needsStdinTestAdapter) Capabilities() adapters.AgentCapabilities {
	return adapters.AgentCapabilities{Streaming: true, MultiTurn: true}
}

func (a *needsStdinTestAdapter) BuildCommand(ctx adapters.RunProcessContext) (string, []string, []string, string) {
	return a.cmdPath, a.cmdArgs, append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"), ""
}

func (a *needsStdinTestAdapter) ParseStream(ctx context.Context, stdout io.Reader, stdin io.Writer, emitter adapters.EventEmitter, run store.Run) error {
	// Drain stdout (test helper prints "stdin-ok" after reading from stdin)
	data, err := io.ReadAll(stdout)
	if err != nil {
		return err
	}
	emitter.Emit(adapters.BusEventResult, map[string]any{
		"projectId": run.ProjectID,
		"threadId":  run.ThreadID,
		"runId":     run.ID,
	}, map[string]any{"output": string(data)})
	return nil
}

func (a *needsStdinTestAdapter) NeedsStdin() bool { return true }

func (a *needsStdinTestAdapter) Available() bool { return true }

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

// --- Process executor error path tests ---

// TestProcessExecutorTooManyConcurrentRuns verifies that Start returns
// ErrTooManyConcurrentRuns when the concurrency limit is reached.
func TestProcessExecutorTooManyConcurrentRuns(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	executor := newTestProcessExecutor(t, bus, s, "sleep")

	// Cap max concurrent runs at 2 for easy testing.
	executor.mu.Lock()
	executor.maxConcurrentRuns = 2
	executor.mu.Unlock()

	// Create 3 runs with explicit IDs (no nanosecond collision risk).
	var runs []store.Run
	for i := 0; i < 3; i++ {
		suffix := fmt.Sprintf("conc_%d_%d", i, time.Now().UnixNano())
		project, _ := s.CreateProject("proj_"+suffix, "Test", "")
		thread, err := s.CreateThread("thread_"+suffix, project.ID, "Test", "", "", "")
		if err != nil {
			t.Fatalf("CreateThread: %v", err)
		}
		run, err := s.CreateRun("run_"+suffix, project.ID, thread.ID)
		if err != nil {
			t.Fatalf("CreateRun: %v", err)
		}
		runs = append(runs, run)
	}

	// Start the first 2 — should succeed.
	for i := 0; i < 2; i++ {
		if err := executor.Start(runs[i], RunProcessContext{}); err != nil {
			t.Fatalf("Start run %d error = %v, want nil", i, err)
		}
	}

	// The 3rd must fail with concurrency error.
	err := executor.Start(runs[2], RunProcessContext{})
	if !errors.Is(err, ErrTooManyConcurrentRuns) {
		t.Fatalf("Start 3rd run error = %v, want ErrTooManyConcurrentRuns", err)
	}

	for i := 0; i < 2; i++ {
		executor.Cancel(runs[i].ID)
	}
}

// TestProcessExecutorStartRespectsCustomMaxConcurrent verifies that a
// custom maxConcurrentRuns is enforced correctly.
func TestProcessExecutorStartRespectsCustomMaxConcurrent(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	executor := newTestProcessExecutor(t, bus, s, "sleep")

	executor.mu.Lock()
	executor.maxConcurrentRuns = 1
	executor.mu.Unlock()

	run1 := newExecutorTestRun(t, s)
	run2 := newExecutorTestRun(t, s)

	if err := executor.Start(run1, RunProcessContext{}); err != nil {
		t.Fatalf("Start run1 error = %v", err)
	}
	err := executor.Start(run2, RunProcessContext{})
	if !errors.Is(err, ErrTooManyConcurrentRuns) {
		t.Fatalf("Start run2 error = %v, want ErrTooManyConcurrentRuns", err)
	}

	executor.Cancel(run1.ID)
}

// TestProcessExecutorContextCancellationMidRun verifies that cancelling
// the context mid-run results in a run.cancelled event.
func TestProcessExecutorContextCancellationMidRun(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)

	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command:    os.Args[0],
		Args:       []string{processExecutorHelperRunFlag, "--", "sleep"},
		Env:        append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"),
		RunTimeout: 500 * time.Millisecond,
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor: %v", err)
	}

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start: %v", err)
	}

	for {
		evt := nextEventWithin(t, ch, 10*time.Second)
		switch evt.Type {
		case "run.cancelled":
			stored, ok := s.GetRun(run.ID)
			if !ok {
				t.Fatalf("run %q not stored after cancellation", run.ID)
			}
			if stored.Status != "cancelled" {
				t.Fatalf("stored status = %q, want cancelled", stored.Status)
			}
			return
		case "run.started":
		case "run.output.batch":
		default:
			t.Fatalf("unexpected event: %s", evt.Type)
		}
	}
}

// TestProcessExecutorEmptyCommandPathRejection verifies that an empty
// command produces a meaningful error at startup, not a crash.
func TestProcessExecutorEmptyCommandPathRejection(t *testing.T) {
	_, err := NewProcessExecutor(events.NewBus(10), store.New(), ProcessExecutorConfig{
		Command: "",
	}, nil, nil)
	if err == nil {
		t.Fatal("NewProcessExecutor returned nil error for empty command")
	}
}

// TestProcessExecutorCommandNotFoundPublishesFailedEarly verifies that
// starting a run with a non-existent command path fails immediately
// with a descriptive error in the run.failed event payload.
func TestProcessExecutorCommandNotFoundPublishesFailedEarly(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)

	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: filepath.Join(t.TempDir(), "definitely-missing-binary-12345"),
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor: %v", err)
	}

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start: %v", err)
	}

	evt := nextEventWithin(t, ch, 20*time.Second)
	for evt.Type == "message.created" || evt.Type == "item.created" {
		evt = nextEventWithin(t, ch, 5*time.Second)
	}
	if evt.Type != "run.failed" {
		t.Fatalf("event type = %q, want run.failed", evt.Type)
	}
	payload, ok := evt.Payload.(map[string]any)
	if !ok {
		t.Fatalf("payload = %T, want map", evt.Payload)
	}
	if payload["status"] != "failed" || payload["error"] == "" {
		t.Fatalf("failed payload = %#v, want failed status and error", payload)
	}
}

// TestProcessExecutorCancelAlreadyTerminalReturnsStatus verifies that
// cancelling a run that is already in a terminal state returns the
// current status without modifying it.
func TestProcessExecutorCancelAlreadyTerminalReturnsStatus(t *testing.T) {
	for _, terminalStatus := range []string{"finished", "failed", "cancelled"} {
		t.Run(terminalStatus, func(t *testing.T) {
			bus := events.NewBus(100)
			s := store.New()
			run := newExecutorTestRun(t, s)
			_, ok := s.SetRunStatus(run.ID, terminalStatus)
			if !ok {
				t.Fatalf("SetRunStatus(%q) returned false", terminalStatus)
			}

			executor := newTestProcessExecutor(t, bus, s, "success")
			result := executor.Cancel(run.ID)
			if !result.Found || result.Status != terminalStatus {
				t.Fatalf("Cancel result = %#v, want found with status %q", result, terminalStatus)
			}

			stored, ok := s.GetRun(run.ID)
			if !ok || stored.Status != terminalStatus {
				t.Fatalf("stored status = %q, want unchanged %q", stored.Status, terminalStatus)
			}
		})
	}
}

// TestProcessExecutorStartWithRunTimeoutCancelsSlowRun verifies that
// a very short RunTimeout causes the run to be cancelled when the
// subprocess takes too long.
func TestProcessExecutorStartWithRunTimeoutCancelsSlowRun(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)

	executor := newTestProcessExecutor(t, bus, s, "sleep")
	executor.mu.Lock()
	executor.runTimeout = 200 * time.Millisecond
	executor.mu.Unlock()

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start: %v", err)
	}

	for {
		evt := nextEventWithin(t, ch, 10*time.Second)
		switch evt.Type {
		case "run.cancelled":
			return
		case "run.started":
		case "run.output.batch":
		case "run.failed":
			t.Fatal("run should be cancelled by timeout, not failed")
		default:
			t.Fatalf("unexpected event: %s", evt.Type)
		}
	}
}

// TestProcessExecutorParentFinishCascadesCancelToChildRunIDs verifies #1001:
// parent terminal finish must cascade Cancel to sub-agent process runIDs.
// Children are registered under agentInstanceID with ParentID=parentRunID, so
// ShutdownCascade must discover them by ParentID and Cancel those runIDs.
func TestProcessExecutorParentFinishCascadesCancelToChildRunIDs(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	parent := newExecutorTestRun(t, s)
	child, err := s.CreateRun("run_child_"+testID(t), parent.ProjectID, parent.ThreadID)
	if err != nil {
		t.Fatalf("CreateRun child: %v", err)
	}

	reg := agents.NewRegistry()
	// Mirror SpawnSubAgent: child agentInstanceID != parentRunID; ParentID is
	// the parent run ID. Parent itself is not necessarily registered.
	_ = reg.Register(&agents.AgentInstance{
		ID:        "agent_" + child.ID,
		AdapterID: "worker",
		ParentID:  parent.ID,
		RunID:     child.ID,
		Status:    agents.StatusBusy,
	})

	executor := newTestProcessExecutor(t, bus, s, "sleep")
	executor.WithAgentRegistry(reg)
	// Short grace so the cancelled child settles quickly under CI.
	executor.mu.Lock()
	executor.shutdownGracePeriod = 50 * time.Millisecond
	executor.shutdownForceTimeout = 50 * time.Millisecond
	executor.mu.Unlock()

	_, ch, _ := bus.Subscribe(0)

	if err := executor.Start(parent, RunProcessContext{}); err != nil {
		t.Fatalf("Start parent: %v", err)
	}
	if err := executor.Start(child, RunProcessContext{}); err != nil {
		t.Fatalf("Start child: %v", err)
	}

	// Wait until both processes are tracked so Cancel has a grace path.
	testkit.Eventually(t, processTrackedWaitTimeout, func() bool {
		executor.mu.Lock()
		defer executor.mu.Unlock()
		return executor.processes[parent.ID] != nil && executor.processes[child.ID] != nil
	}, "parent and child processes should be tracked", func() string {
		executor.mu.Lock()
		defer executor.mu.Unlock()
		return fmt.Sprintf("tracked processes=%d parentTracked=%v childTracked=%v",
			len(executor.processes), executor.processes[parent.ID] != nil, executor.processes[child.ID] != nil)
	})

	// Parent process finishes (success helper would exit immediately; here we
	// Cancel the parent so finish() runs with a registry cascade). Using Cancel
	// exercises the same finish() path as natural completion (#867 terminalFinish).
	if result := executor.Cancel(parent.ID); !result.Found {
		t.Fatalf("Cancel parent result = %#v, want found", result)
	}

	var parentDone, childCancelled bool
	timeout := time.After(10 * time.Second)
	for !parentDone || !childCancelled {
		select {
		case evt := <-ch:
			switch evt.Type {
			case "run.cancelled", "run.finished", "run.failed":
				runID, _ := evt.Scope["runId"].(string)
				if runID == parent.ID && (evt.Type == "run.cancelled" || evt.Type == "run.finished" || evt.Type == "run.failed") {
					parentDone = true
				}
				if runID == child.ID && evt.Type == "run.cancelled" {
					childCancelled = true
				}
			}
		case <-timeout:
			t.Fatalf("timeout waiting cascade: parentDone=%v childCancelled=%v", parentDone, childCancelled)
		}
	}

	// Child registry node must be disconnected by ShutdownCascade.
	inst, ok := reg.Get("agent_" + child.ID)
	if !ok {
		t.Fatal("child agent missing from registry after cascade")
	}
	if inst.Status != agents.StatusDisconnected {
		t.Fatalf("child agent status = %s, want disconnected", inst.Status)
	}

	// Child run should land in cancelled (Cancel path) rather than remain running.
	stored, ok := s.GetRun(child.ID)
	if !ok {
		t.Fatal("child run missing from store")
	}
	if stored.Status != "cancelled" && stored.Status != "cancelling" {
		// Allow brief race before store settles to cancelled.
		testkit.Eventually(t, childCancelSettleWaitTimeout, func() bool {
			current, _ := s.GetRun(child.ID)
			return current.Status == "cancelled"
		}, "child run status should settle to cancelled", func() string {
			current, ok := s.GetRun(child.ID)
			if !ok {
				return "child run missing from store"
			}
			return fmt.Sprintf("childStatus=%q", current.Status)
		})
	}
}
