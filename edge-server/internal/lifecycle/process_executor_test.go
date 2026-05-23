package lifecycle

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/store"
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
				text, _ := chunks[0]["text"].(string)
				stdoutText += text
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

func TestProcessExecutorRunsCommandWithInjectedContext(t *testing.T) {
	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)

	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{"-test.run=TestProcessExecutorHelper", "--", "success"},
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
			text, _ := chunks[0]["text"].(string)
			stdoutText += text
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
		Args:    []string{"-test.run=TestProcessExecutorHelper", "--", "pwd"},
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
			text, _ := chunks[0]["text"].(string)
			stdoutText += text
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
			"-test.run=TestProcessExecutorHelper",
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
		Args:    []string{"-test.run=TestProcessExecutorHelper", "--", "env"},
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
		Args:    []string{"-test.run=TestProcessExecutorHelper", "--", "env"},
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
		Args:     []string{"-test.run=TestProcessExecutorHelper", "--", "env"},
		Env:      nil,
		ExtraEnv: []string{"PROFILE_RUN={{run.id}}"},
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}
}

func TestProcessExecutorNilEnvInheritsParentEnvironment(t *testing.T) {
	t.Setenv("AGENTHUB_PROCESS_EXECUTOR_HELPER", "1")
	t.Setenv("AGENTHUB_INHERITED_ENV_FOR_TEST", "expected")

	bus := events.NewBus(100)
	s := store.New()
	run := newExecutorTestRun(t, s)
	_, ch, _ := bus.Subscribe(0)
	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{"-test.run=TestProcessExecutorHelper", "--", "inherited-env"},
		Env:     nil,
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}

	if err := executor.Start(run, RunProcessContext{}); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	stdoutText := collectStdoutUntilFinished(t, ch)
	if !strings.Contains(stdoutText, "inherited=expected") {
		t.Fatalf("stdout text = %q, want inherited env value", stdoutText)
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

	evt := nextEvent(t, ch)
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

func newTestProcessExecutor(t *testing.T, bus *events.Bus, s store.RunLifecycleStore, mode string) *ProcessExecutor {
	t.Helper()

	executor, err := NewProcessExecutor(bus, s, ProcessExecutorConfig{
		Command: os.Args[0],
		Args:    []string{"-test.run=TestProcessExecutorHelper", "--", mode},
		Env:     append(os.Environ(), "AGENTHUB_PROCESS_EXECUTOR_HELPER=1"),
	}, nil, nil)
	if err != nil {
		t.Fatalf("NewProcessExecutor returned error: %v", err)
	}
	return executor
}

func TestProcessExecutorHelper(t *testing.T) {
	if os.Getenv("AGENTHUB_PROCESS_EXECUTOR_HELPER") != "1" {
		return
	}
	mode := os.Args[len(os.Args)-1]
	switch mode {
	case "success":
		fmt.Fprint(os.Stdout, "stdout chunk\n")
		fmt.Fprintf(os.Stdout, "run=%s\n", os.Getenv("AGENTHUB_RUN_ID"))
		fmt.Fprintf(os.Stdout, "project=%s\n", os.Getenv("AGENTHUB_PROJECT_ID"))
		fmt.Fprintf(os.Stdout, "thread=%s\n", os.Getenv("AGENTHUB_THREAD_ID"))
		fmt.Fprint(os.Stderr, "stderr chunk\n")
	case "fail":
		fmt.Fprint(os.Stderr, "failure chunk\n")
		os.Exit(7)
	case "sleep":
		time.Sleep(5 * time.Second)
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
		fmt.Fprintf(os.Stdout, "profileRun=%s\n", os.Getenv("PROFILE_RUN"))
		fmt.Fprintf(os.Stdout, "profileProject=%s\n", os.Getenv("PROFILE_PROJECT"))
		fmt.Fprintf(os.Stdout, "profileThread=%s\n", os.Getenv("PROFILE_THREAD"))
	case "inherited-env":
		fmt.Fprintf(os.Stdout, "inherited=%s\n", os.Getenv("AGENTHUB_INHERITED_ENV_FOR_TEST"))
	default:
		fmt.Fprintf(os.Stderr, "unknown helper mode %q\n", mode)
		os.Exit(2)
	}
	os.Exit(0)
}

func collectStdoutUntilFinished(t *testing.T, ch <-chan events.EventEnvelope) string {
	t.Helper()

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
			text, _ := chunks[0]["text"].(string)
			stdoutText += text
		case "run.finished":
			return stdoutText
		default:
			t.Fatalf("unexpected event type %q", evt.Type)
		}
	}
}

func nextEventWithin(t *testing.T, ch <-chan events.EventEnvelope, timeout time.Duration) events.EventEnvelope {
	t.Helper()
	select {
	case evt := <-ch:
		return evt
	case <-time.After(timeout):
		t.Fatalf("timed out after %s waiting for event", timeout)
		return events.EventEnvelope{}
	}
}