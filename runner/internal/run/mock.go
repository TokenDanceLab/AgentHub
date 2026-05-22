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

// NewMockRun creates a new MockRun with the given ID and options.
func NewMockRun(id string, opts ...MockRunOption) *MockRun {
	m := &MockRun{
		id:           id,
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

// Start begins the mock run simulation.
// It transitions from idle to running, outputs chunks with delays,
// then transitions to finished.
func (m *MockRun) Start() error {
	if err := m.state.Transition(process.StateRunning); err != nil {
		return fmt.Errorf("mock run start: %w", err)
	}

	slog.Info("mock run started", "id", m.id)

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
