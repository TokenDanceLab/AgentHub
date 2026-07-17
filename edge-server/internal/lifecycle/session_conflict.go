package lifecycle

import (
	"crypto/rand"
	"errors"
	"fmt"
	"os/exec"
	"strings"
)

// isSessionConflictError returns true when the error message or the process
// stderr indicates a Claude Code session conflict — either "Session ID ... is
// already in use" or "No conversation found with session ID". In both cases,
// retrying with a fresh random session ID (and ContinueLast=false) is the
// correct recovery.
//
// On Windows, exec.ExitError.Error() returns only "exit status N" without
// stderr content (stderr is read via StderrPipe in a separate goroutine).
// The caller should pass the captured stderr output as the second argument
// so the check can inspect it.
func isSessionConflictError(err error, stderrOutput string) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	if strings.Contains(msg, "is already in use") ||
		strings.Contains(msg, "No conversation found with session ID") {
		return true
	}
	// On Windows, stderr is not included in the ExitError message.
	// Check the captured stderr output from the pipe goroutine.
	if stderrOutput != "" {
		if strings.Contains(stderrOutput, "is already in use") ||
			strings.Contains(stderrOutput, "No conversation found with session ID") {
			return true
		}
	}
	// Also check ExitError.Stderr (populated when StderrPipe is NOT used).
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) && len(exitErr.Stderr) > 0 {
		stderrStr := string(exitErr.Stderr)
		if strings.Contains(stderrStr, "is already in use") ||
			strings.Contains(stderrStr, "No conversation found with session ID") {
			return true
		}
	}
	return false
}

// newRandomSessionID generates a random UUID v4 string for retrying CC
// sessions when the deterministic session ID conflicts with a stale process.
func newRandomSessionID() string {
	var uuid [16]byte
	_, _ = rand.Read(uuid[:])
	uuid[6] = (uuid[6] & 0x0f) | 0x40 // version 4
	uuid[8] = (uuid[8] & 0x3f) | 0x80 // variant 2
	return fmt.Sprintf("%x-%x-%x-%x-%x",
		uuid[0:4], uuid[4:6], uuid[6:8], uuid[8:10], uuid[10:16])
}
