package lifecycle

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
)

const processExecutorHelperRunFlag = "-test.run=^TestProcessExecutorHelper$"

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

	diffFiles := s.ListRunDiffFiles(run.ID)
	if len(diffFiles) != 1 || diffFiles[0].Path != "src/app.ts" || diffFiles[0].Diff == "" || diffFiles[0].Status != "modified" {
		t.Fatalf("ListRunDiffFiles = %#v, want persisted runtime diff evidence", diffFiles)
	}
	artifacts := s.ListArtifacts(run.ID)
	if len(artifacts) != 1 || artifacts[0].ID != "artifact_1" || artifacts[0].ThreadID != run.ThreadID || artifacts[0].SizeBytes != 128 {
		t.Fatalf("ListArtifacts = %#v, want persisted runtime artifact evidence", artifacts)
	}
	previews := s.ListPreviews(run.ID)
	if len(previews) != 1 || previews[0].ID != "preview_1" || previews[0].URL != "http://127.0.0.1:4173" || previews[0].Status != "ready" {
		t.Fatalf("ListPreviews = %#v, want persisted runtime preview evidence", previews)
	}
	if len(inner.events) != 3 {
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
	return executor
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
	_, _ = s.CreateProject("proj-agg", "agg-project")
	_, _ = s.CreateThread("thread-agg", "proj-agg", "agg-thread")
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
	_, _ = s.CreateProject("proj-err", "err-project")
	_, _ = s.CreateThread("thread-err", "proj-err", "err-thread")
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
	_, _ = s.CreateProject("proj-noreg", "no-reg-project")
	_, _ = s.CreateThread("thread-noreg", "proj-noreg", "no-reg-thread")
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
	_, _ = s.CreateProject("proj-nosub", "nosub-project")
	_, _ = s.CreateThread("thread-nosub", "proj-nosub", "nosub-thread")
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
			errInfo, _ := payload["error"]
			t.Fatalf("run failed: %#v", errInfo)
		}
	}
}
