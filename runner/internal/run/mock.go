// Package run provides the mock agent run implementation.
package run

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"time"

	"github.com/agenthub/runner/internal/process"
)

// DefaultOutputChunks are the default mock output lines.
var DefaultOutputChunks = []string{
	"Installing dependencies...",
	"Building project...",
	"Running tests...",
	"All tests passed!",
}

// MockRun represents a simulated agent execution.
type MockRun struct {
	id           string
	context      RunContext
	state        *process.StateMachine
	outputChunks []string
	chunkDelay   time.Duration
	writer       io.Writer
}

// MockRunOption configures a MockRun.
type MockRunOption func(*MockRun)

// WithOutputChunks sets custom output chunks for the mock run.
func WithOutputChunks(chunks []string) MockRunOption {
	return func(m *MockRun) {
		m.outputChunks = chunks
	}
}

// WithChunkDelay sets the delay between output chunks.
func WithChunkDelay(d time.Duration) MockRunOption {
	return func(m *MockRun) {
		m.chunkDelay = d
	}
}

// WithWriter sets the output writer for the mock run.
func WithWriter(w io.Writer) MockRunOption {
	return func(m *MockRun) {
		m.writer = w
	}
}

// WithRunContext sets the Edge-injected run context for mock output.
func WithRunContext(ctx RunContext) MockRunOption {
	return func(m *MockRun) {
		m.context = normalizeRunContext(ctx)
		m.id = m.context.RunID
	}
}

// NewMockRun creates a new MockRun with the given ID and options.
func NewMockRun(id string, opts ...MockRunOption) *MockRun {
	ctx := normalizeRunContext(RunContext{RunID: id})
	m := &MockRun{
		id:           ctx.RunID,
		context:      ctx,
		state:        process.NewStateMachine(),
		outputChunks: DefaultOutputChunks,
		chunkDelay:   80 * time.Millisecond,
		writer:       os.Stdout,
	}
	for _, opt := range opts {
		opt(m)
	}
	return m
}

// NewMockRunFromContext creates a mock run from Edge-injected context.
func NewMockRunFromContext(ctx RunContext, opts ...MockRunOption) *MockRun {
	ctx = normalizeRunContext(ctx)
	return NewMockRun(ctx.RunID, append([]MockRunOption{WithRunContext(ctx)}, opts...)...)
}

// Start begins the mock run simulation.
// It transitions from idle to running, outputs chunks with delays,
// then transitions to finished.
func (m *MockRun) Start() error {
	if err := m.state.Transition(process.StateRunning); err != nil {
		return fmt.Errorf("mock run start: %w", err)
	}

	slog.Info("mock run started", "id", m.id)

	fmt.Fprintf(m.writer, "run=%s\n", m.context.RunID)
	fmt.Fprintf(m.writer, "project=%s\n", m.context.ProjectID)
	fmt.Fprintf(m.writer, "thread=%s\n", m.context.ThreadID)

	for _, chunk := range m.outputChunks {
		fmt.Fprintln(m.writer, chunk)
		time.Sleep(m.chunkDelay)
	}

	if err := m.state.Transition(process.StateFinished); err != nil {
		return fmt.Errorf("mock run finish: %w", err)
	}

	slog.Info("mock run finished", "id", m.id)
	return nil
}

// Cancel stops the mock run by transitioning through stopping to stopped.
func (m *MockRun) Cancel() error {
	if err := m.state.Transition(process.StateStopping); err != nil {
		return fmt.Errorf("mock run cancel: %w", err)
	}

	slog.Info("mock run stopping", "id", m.id)

	// Simulate cleanup time
	time.Sleep(50 * time.Millisecond)

	if err := m.state.Transition(process.StateStopped); err != nil {
		return fmt.Errorf("mock run stop: %w", err)
	}

	slog.Info("mock run stopped", "id", m.id)
	return nil
}

// State returns the current state of the mock run.
func (m *MockRun) State() process.State {
	return m.state.Current()
}

// ID returns the run ID.
func (m *MockRun) ID() string {
	return m.id
}
