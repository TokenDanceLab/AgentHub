// Package runnerctx provides a persistent output store for run stdout/stderr.
package runnerctx

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// RunOutputStore persists run output chunks to a temp file for replay.
// Each run gets its own temp file under os.TempDir().
// On Close(), the temp file is deleted.
type RunOutputStore struct {
	mu   sync.Mutex
	file *os.File
	path string
	runID string
}

// NewRunOutputStore creates a temp file at os.TempDir()/agenthub-run-<runID>.log
// and returns a store that writes output chunks to it.
func NewRunOutputStore(runID string) (*RunOutputStore, error) {
	dir := os.TempDir()
	filename := fmt.Sprintf("agenthub-run-%s.log", runID)
	path := filepath.Join(dir, filename)
	f, err := os.Create(path)
	if err != nil {
		return nil, fmt.Errorf("create run output file %s: %w", path, err)
	}
	return &RunOutputStore{
		file:  f,
		path:  path,
		runID: runID,
	}, nil
}

// Write appends text to the temp file. Safe for concurrent use.
func (s *RunOutputStore) Write(text string) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.file.WriteString(text)
}

// ReadAll returns the entire contents of the temp file.
// Returns ("", nil) if Close() has already been called.
func (s *RunOutputStore) ReadAll() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.file == nil {
		return "", nil
	}
	// Flush any buffered writes before reading.
	if err := s.file.Sync(); err != nil {
		return "", fmt.Errorf("sync output file: %w", err)
	}
	data, err := os.ReadFile(s.path)
	if err != nil {
		return "", fmt.Errorf("read output file: %w", err)
	}
	return string(data), nil
}

// Path returns the temp file path (for debugging/testing).
func (s *RunOutputStore) Path() string {
	return s.path
}

// Close syncs, closes, and removes the temp file. Idempotent.
func (s *RunOutputStore) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.file == nil {
		return nil
	}
	_ = s.file.Sync()
	_ = s.file.Close()
	s.file = nil
	if err := os.Remove(s.path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
