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
