package lifecycle

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/agenthub/edge-server/internal/events"
	"github.com/agenthub/edge-server/internal/store"
)

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
