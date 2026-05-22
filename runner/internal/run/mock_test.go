package run

import (
	"bytes"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/agenthub/runner/internal/process"
)

func TestMockRunStartProducesOutput(t *testing.T) {
	var buf bytes.Buffer
	m := NewMockRun("test-1", WithWriter(&buf))

	err := m.Start()
	if err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	output := buf.String()
	for _, chunk := range DefaultOutputChunks {
		if !strings.Contains(output, chunk) {
			t.Errorf("expected output to contain %q", chunk)
		}
	}

	if m.State() != process.StateFinished {
		t.Errorf("expected finished state, got %s", m.State())
	}
}

func TestMockRunFromContextUsesRunID(t *testing.T) {
	var buf bytes.Buffer
	m := NewMockRunFromContext(RunContext{
		RunID:     "run-context-1",
		ProjectID: "project-context-1",
		ThreadID:  "thread-context-1",
	}, WithWriter(&buf))

	if m.ID() != "run-context-1" {
		t.Errorf("expected context run ID, got %q", m.ID())
	}
}

func TestMockRunFromContextDefaultsRunID(t *testing.T) {
	var buf bytes.Buffer
	m := NewMockRunFromContext(RunContext{}, WithWriter(&buf))

	if m.ID() != DefaultMockRunID {
		t.Errorf("expected default run ID %q, got %q", DefaultMockRunID, m.ID())
	}
}

func TestMockRunStartProducesContextOutput(t *testing.T) {
	var buf bytes.Buffer
	m := NewMockRunFromContext(RunContext{
		RunID:     "run-context-2",
		ProjectID: "project-context-2",
		ThreadID:  "thread-context-2",
	}, WithWriter(&buf))

	if err := m.Start(); err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	output := buf.String()
	expectedContextLines := []string{
		"run=run-context-2\n",
		"project=project-context-2\n",
		"thread=thread-context-2\n",
	}
	for _, line := range expectedContextLines {
		if !strings.Contains(output, line) {
			t.Errorf("expected output to contain %q", line)
		}
	}

	for i, line := range expectedContextLines {
		if !strings.HasPrefix(output, strings.Join(expectedContextLines[:i+1], "")) {
			t.Fatalf("expected context line %d to be %q in the first stdout lines, got output:\n%s", i+1, line, output)
		}
	}
}

func TestMockRunStateTransitions(t *testing.T) {
	t.Run("running to finished via Start", func(t *testing.T) {
		m := NewMockRun("test-ft", WithWriter(&bytes.Buffer{}))
		err := m.Start()
		if err != nil {
			t.Fatalf("Start failed: %v", err)
		}
		if m.State() != process.StateFinished {
			t.Errorf("expected finished, got %s", m.State())
		}
	})

	t.Run("running to stopping to stopped via Cancel", func(t *testing.T) {
		m := NewMockRun("test-cancel", WithWriter(&bytes.Buffer{}))
		// Transition to running manually (same package, field accessible)
		if err := m.state.Transition(process.StateRunning); err != nil {
			t.Fatalf("setup: %v", err)
		}

		err := m.Cancel()
		if err != nil {
			t.Fatalf("Cancel failed: %v", err)
		}
		if m.State() != process.StateStopped {
			t.Errorf("expected stopped, got %s", m.State())
		}
	})
}

func TestMockRunStartFailsWhenNotIdle(t *testing.T) {
	m := NewMockRun("test-twice", WithWriter(&bytes.Buffer{}))

	// First start should succeed
	err := m.Start()
	if err != nil {
		t.Fatalf("first Start failed: %v", err)
	}

	// Second start should fail (already finished)
	err = m.Start()
	if err == nil {
		t.Error("expected error when starting an already finished run")
	}
}

func TestMockRunCancelFailsWhenNotRunning(t *testing.T) {
	m := NewMockRun("test-cancel-idle", WithWriter(&bytes.Buffer{}))

	// Cancel from idle should fail
	err := m.Cancel()
	if err == nil {
		t.Error("expected error when cancelling from idle state")
	}
}

func TestMockRunCancelAfterFinishedFails(t *testing.T) {
	m := NewMockRun("test-cancel-done", WithWriter(&bytes.Buffer{}))

	if err := m.Start(); err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	// Cancel after finished should fail
	err := m.Cancel()
	if err == nil {
		t.Error("expected error when cancelling a finished run")
	}
}

func TestMockRunCustomChunks(t *testing.T) {
	var buf bytes.Buffer
	customChunks := []string{"Custom step 1", "Custom step 2"}
	m := NewMockRun("test-custom",
		WithOutputChunks(customChunks),
		WithWriter(&buf),
	)

	if err := m.Start(); err != nil {
		t.Fatalf("Start failed: %v", err)
	}

	output := buf.String()
	for _, chunk := range customChunks {
		if !strings.Contains(output, chunk) {
			t.Errorf("expected output to contain %q", chunk)
		}
	}
}

func TestMockRunCustomDelay(t *testing.T) {
	var buf bytes.Buffer
	m := NewMockRun("test-delay",
		WithOutputChunks([]string{"one", "two"}),
		WithChunkDelay(5*time.Millisecond),
		WithWriter(&buf),
	)

	start := time.Now()
	if err := m.Start(); err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	elapsed := time.Since(start)

	// With 2 chunks and 5ms delays, should take at least 10ms
	if elapsed < 10*time.Millisecond {
		t.Errorf("expected at least 10ms elapsed, got %v", elapsed)
	}
}

func TestMockRunID(t *testing.T) {
	m := NewMockRun("my-run-id")
	if m.ID() != "my-run-id" {
		t.Errorf("expected ID 'my-run-id', got %s", m.ID())
	}
}

func TestMockRunDefaultWriter(t *testing.T) {
	m := NewMockRun("test-defaults")
	if m.writer == nil {
		t.Error("expected default writer to be set")
	}
	if m.chunkDelay == 0 {
		t.Error("expected default chunk delay to be set")
	}
	if len(m.outputChunks) == 0 {
		t.Error("expected default output chunks to be set")
	}
}

func TestMockRunConcurrentCancel(t *testing.T) {
	var buf bytes.Buffer
	m := NewMockRun("test-conc", WithWriter(&buf))

	// Set up running state
	if err := m.state.Transition(process.StateRunning); err != nil {
		t.Fatalf("setup: %v", err)
	}

	var wg sync.WaitGroup
	errCh := make(chan error, 2)

	wg.Add(2)
	go func() {
		defer wg.Done()
		errCh <- m.Cancel()
	}()
	go func() {
		defer wg.Done()
		errCh <- m.Cancel()
	}()
	wg.Wait()
	close(errCh)

	successCount := 0
	for err := range errCh {
		if err == nil {
			successCount++
		}
	}

	if successCount != 1 {
		t.Errorf("expected exactly 1 successful cancel, got %d", successCount)
	}

	final := m.State()
	if final != process.StateStopped {
		t.Errorf("expected stopped state, got %s", final)
	}
}
