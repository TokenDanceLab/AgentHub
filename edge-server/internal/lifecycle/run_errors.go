package lifecycle

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"strings"
)

// RunError represents a classified run failure with a machine-readable code.
type RunError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

// Well-known RunError codes.
const (
	ErrCodeBinaryNotFound   = "BINARY_NOT_FOUND"
	ErrCodeTimeout          = "TIMEOUT"
	ErrCodeNonzeroExit      = "NONZERO_EXIT"
	ErrCodeCancelled        = "CANCELLED"
	ErrCodePermissionDenied = "PERMISSION_DENIED"
	ErrCodeUnknown          = "UNKNOWN"
)

// ClassifyError inspects an error and optional exit code to produce a
// structured RunError suitable for the Desktop to display actionable
// messages instead of raw error strings.
//
// Classification priority (first match wins):
//  1. context.Canceled     -> CANCELLED
//  2. context.DeadlineExceeded -> TIMEOUT
//  3. exec.ErrNotFound / os.IsNotExist -> BINARY_NOT_FOUND
//  4. os.IsPermission      -> PERMISSION_DENIED
//  5. non-zero exit code   -> NONZERO_EXIT
//  6. fallback             -> UNKNOWN
func ClassifyError(err error, exitCode int) *RunError {
	if err == nil && exitCode == 0 {
		return nil
	}
	msg := ""
	if err != nil {
		msg = err.Error()
	}

	// 1. Cancellation.
	if errors.Is(err, context.Canceled) {
		return &RunError{
			Code:    ErrCodeCancelled,
			Message: msg,
			Details: map[string]any{"exitCode": exitCode},
		}
	}

	// 2. Deadline / timeout.
	if errors.Is(err, context.DeadlineExceeded) {
		return &RunError{
			Code:    ErrCodeTimeout,
			Message: msg,
		}
	}

	// 3. Binary not found.
	if errors.Is(err, exec.ErrNotFound) || isNotFoundErr(err) {
		return &RunError{
			Code:    ErrCodeBinaryNotFound,
			Message: msg,
		}
	}

	// 4. Permission denied.
	if isPermissionErr(err) {
		return &RunError{
			Code:    ErrCodePermissionDenied,
			Message: msg,
		}
	}

	// 5. Non-zero exit.
	if exitCode != 0 && exitCode != -1 {
		return &RunError{
			Code:    ErrCodeNonzeroExit,
			Message: msg,
			Details: map[string]any{"exitCode": exitCode},
		}
	}

	// Try extracting exit code from *exec.ExitError if we didn't get one.
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		code := exitErr.ExitCode()
		if code != 0 {
			return &RunError{
				Code:    ErrCodeNonzeroExit,
				Message: msg,
				Details: map[string]any{"exitCode": code},
			}
		}
	}

	// 6. Unknown.
	return &RunError{
		Code:    ErrCodeUnknown,
		Message: msg,
	}
}

func isNotFoundErr(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, os.ErrNotExist) {
		return true
	}
	// exec.Cmd.Start() may wrap the error; check the message too.
	msg := err.Error()
	return strings.Contains(msg, "executable file not found") ||
		strings.Contains(msg, "file not found")
}

func isPermissionErr(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, os.ErrPermission) {
		return true
	}
	msg := err.Error()
	return strings.Contains(msg, "permission denied") ||
		strings.Contains(msg, "Access is denied")
}

// ExitCodeFromErr extracts the process exit code from an error returned by
// exec.Cmd.Wait / exec.Cmd.Run. Returns -1 when the error does not carry
// an exit code.
func ExitCodeFromErr(err error) int {
	if err == nil {
		return 0
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitErr.ExitCode()
	}
	return -1
}
