package lifecycle

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/store"
)

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

func outputChunksText(chunks []map[string]any) string {
	var text strings.Builder
	for _, chunk := range chunks {
		if value, ok := chunk["text"].(string); ok {
			text.WriteString(value)
		}
	}
	return text.String()
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
